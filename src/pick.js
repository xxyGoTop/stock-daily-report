#!/usr/bin/env node
/**
 * 综合选股：盘面总结与分析 + 五套算法评分前 30
 *
 * 用法：
 *   npm run pick
 *   npm run 选股
 *   npm run pick -- --limit=20
 *   npm run pick -- --detail=300      扩大个股扫描池（更准但更慢）
 *   npm run pick -- --no-open
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dayjs from 'dayjs';

import { analyzeBoardStrength } from './analyze/boardStrength.js';
import { analyzeIndexBuySignals } from './analyze/indexSignals.js';
import { analyzeMarketTape } from './analyze/marketTape.js';
import { pickTopStocks, STRATEGIES } from './analyze/picker.js';
import { assessDataFreshness, sessionPhase } from './analyze/session.js';
import { getDataFreshness } from './crawl/eastmoney.js';
import { renderPickHtml, savePickHtml } from './output/pickHtml.js';
import { openInBrowser } from './output/open.js';
import { runShortTermStrategy } from './strategy/shortTerm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {
    limit: 30,
    top: 10,
    detail: 220,
    pages: 8,
    concept: false,
    noOpen: false,
    help: false,
    fast: false,
  };
  for (const a of argv) {
    if (a === '--no-open') args.noOpen = true;
    else if (a === '--fast') {
      args.fast = true;
      if (args.detail === 220) args.detail = 80;
      if (args.pages === 8) args.pages = 4;
    }
    else if (a === '--concept') args.concept = true;
    else if (a.startsWith('--limit=')) args.limit = Math.min(60, Math.max(5, Number(a.slice(8)) || 30));
    else if (a.startsWith('--top=')) args.top = Math.min(20, Math.max(5, Number(a.slice(6)) || 10));
    else if (a.startsWith('--detail=')) args.detail = Math.min(500, Math.max(60, Number(a.slice(9)) || 220));
    else if (a.startsWith('--pages=')) args.pages = Math.min(20, Math.max(2, Number(a.slice(8)) || 8));
    else if (a === '-h' || a === '--help') args.help = true;
  }
  return args;
}

function fmtPct(v) {
  if (v == null || Number.isNaN(+v)) return '-';
  return `${+v >= 0 ? '+' : ''}${(+v).toFixed(2)}%`;
}

function printConsole({ tape, indexSignals, boards, result, freshness, limit }) {
  const p = (s = '') => console.log(s);
  const line = (ch = '─') => p(ch.repeat(66));

  p('');
  p('═'.repeat(66));
  p(`综合选股 · ${tape.tradeDate} · ${tape.phase?.label || ''}`);
  p('═'.repeat(66));
  if (freshness) p(`${freshness.warn ? '⚠ 数据新鲜度' : '数据新鲜度'}：${freshness.text}`);
  p(`盘面：${tape.headline}`);
  p('');

  p('【盘面分析】');
  p(`  结论：${tape.analysis.conclusion}`);
  for (const x of tape.analysis.points) p(`  · ${x}`);
  if (tape.analysis.risks.length) {
    p('  风险：');
    for (const x of tape.analysis.risks) p(`    ! ${x}`);
  }
  p('');

  p('【指数与板块】');
  p(`  指数：${indexSignals?.summary || '-'}`);
  p(
    `  板块：${boards?.summary?.structure || '-'}｜前十：${(boards?.topBoards || [])
      .slice(0, 5)
      .map((b) => `${b.name}${fmtPct(b.changePct)}`)
      .join('、')}`
  );
  p('');

  p('【算法权重（按盘面调整）】');
  for (const st of STRATEGIES) {
    const w = result.weights[st.key] ?? 1;
    p(
      `  ${st.order}. ${st.name.padEnd(8, '　')} ×${String(w).padEnd(5)} 命中 ${String(
        result.strategyCount[st.key] || 0
      ).padStart(3)} 只　${st.note}`
    );
  }
  p(`  盘面系数：×${result.marketFactor}（由上面的盘面分析推出，直接乘在个股评分上）`);
  p('');

  p(
    `【评分前 ${Math.min(limit, result.picks.length)} 只】（全池达标 ${result.qualified} 只｜` +
      `现价可买 ${result.buyCount}　等价格 ${result.waitCount}` +
      `${result.excludedCrash ? `　当日大跌剔除 ${result.excludedCrash}` : ''}）`
  );
  line();
  if (!result.picks.length) {
    p('  今日没有个股满足任一算法的硬条件——没有符合的标的就不该硬凑。');
  }
  for (let i = 0; i < result.picks.length; i++) {
    const x = result.picks[i];
    p(
      `${String(i + 1).padStart(2)}. ${x.code} ${x.name}  ${fmtPct(x.changePct)}  ${String(x.score).padStart(
        3
      )}分  [${x.action}]  ${x.baseLabel}`
    );
    p(`    命中：${x.strategies.map((s) => s.short).join(' + ')}｜主策略：${x.primaryName}｜${x.industry}`);
    p(
      `    买入：${x.entry.buyLow}~${x.entry.buyHigh}（${x.entry.entryType}·${x.entry.entryMode}）` +
        ` 止损 ${x.entry.stop}（空间${x.entry.riskPct}%）　目标 ${x.entry.target1}/${x.entry.target2}（盈亏比${x.entry.rr}）`
    );
    for (const r of x.buyReasons.slice(0, 3)) p(`    ${r}`);
    for (const r of x.riskNotes.slice(0, 2)) p(`    ! ${r}`);
    p('');
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`用法：
  npm run pick                   盘面分析 + 五算法评分前 30（HTML 单页，分页看列表）
  npm run 选股                   同上
  npm run pick -- --limit=20     只取前 20
  npm run pick -- --top=15       板块强度列前 15
  npm run pick -- --fast         快速模式（少扫一些）
  npm run pick -- --detail=300   扩大个股扫描池（更准，更慢）
  npm run pick -- --concept      板块统计带上概念板块
  npm run pick -- --no-open      不自动打开浏览器

五套算法（按优先级）：
  1 率先一年新高（优先主流板块，重点看当日涨幅榜第一版）
  2 高RPS深调回升（第1/第2基底可参与，第3个起谨慎，卡片上标基底序号）
  3 顺向火车轨（优先RPS250高、右侧年高、10日线下买点）
  4 火车每日观察（高RPS且在年高附近）
  5 五日线多头共振短线（严格止损）

盘面分析会调整这五套算法的权重：指数走坏或情绪退潮时，高位思路自动降权。`);
    return;
  }

  const now = dayjs();
  const progress = (m) => console.log(`  · ${m}`);
  console.log('\n[综合选股] 开始...');

  const phase = sessionPhase(now);
  progress(`时段：${phase.label} · ${phase.note}`);

  const freshness = assessDataFreshness({ ...(await getDataFreshness()), now });
  progress(freshness.text);
  if (freshness.warn) console.error(`  ⚠ ${freshness.text}`);

  // 指数信号要先算：241005 的年新高思路需要它判断是否容易假突破
  const indexSignals = await analyzeIndexBuySignals({ onProgress: progress }).catch((e) => {
    progress(`指数分析失败：${e.message || e}`);
    return null;
  });

  const boards = await analyzeBoardStrength({
    top: args.top,
    includeConcept: args.concept,
    withMarket: true,
    withLeaders: true,
    leaderCount: 2,
    onProgress: progress,
    now,
  }).catch((e) => {
    progress(`板块分析失败：${e.message || e}`);
    return null;
  });

  const tape = await analyzeMarketTape({ indexSignals, boards, onProgress: progress, now });
  progress(`盘面：${tape.headline}｜出手力度 ${tape.bias.overall}`);

  const strategy = await runShortTermStrategy({
    maxCandidates: Math.max(args.limit, 20),
    scanPages: args.pages,
    detailLimit: args.detail,
    indexCanBuy: indexSignals?.marketCanBuy ?? true,
    fast: args.fast,
    onProgress: progress,
  });

  progress('按五套算法综合评分...');
  const result = pickTopStocks(strategy.allScored, {
    tape,
    boards,
    limit: args.limit,
  });
  progress(`达标 ${result.qualified} 只，取前 ${Math.min(args.limit, result.picks.length)}`);

  printConsole({ tape, indexSignals, boards, result, freshness, limit: args.limit });

  const meta = {
    generatedAt: now.format('YYYY-MM-DD HH:mm:ss'),
    freshness,
    limit: args.limit,
    scanned: strategy.scanned,
    scoredCount: strategy.scoredCount,
  };

  const html = renderPickHtml({
    tape,
    indexSignals,
    boards,
    result,
    strategies: STRATEGIES,
    meta,
  });

  const stamp = now.format('HHmmss');
  const saved = savePickHtml(html, { root, tradeDate: tape.tradeDate, stamp });

  const dayDir = path.join(root, 'output', tape.tradeDate);
  const payload = { meta, tape, indexSignals, boards, result };
  const jsonPath = path.join(dayDir, `pick_${stamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.writeFileSync(path.join(dayDir, 'latest-pick.json'), JSON.stringify(payload, null, 2), 'utf8');

  console.log(`已保存：\n  ${saved.htmlPath}\n  ${jsonPath}\n`);
  if (!args.noOpen) openInBrowser(saved.latestInDay);
}

main().catch((err) => {
  console.error('失败：', err.message || err);
  process.exit(1);
});
