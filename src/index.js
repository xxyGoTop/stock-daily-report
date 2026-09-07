#!/usr/bin/env node
/**
 * A股三模块分析入口
 * 1) 正股纯技术  2) ST  3) 收购/股权转让/重整(非ST)
 *
 * 用法：
 *   npm start -- --fast
 *   npm run stock -- 600519 000001
 *   # 雪球大V：自动弹浏览器，手动登录后抓取（勿再配账号密码）
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import dayjs from 'dayjs';

import { runShortTermStrategy, summarizeShortTermActions } from './strategy/shortTerm.js';
import { runTurnaroundStrategy, summarizeTurnaroundActions } from './strategy/turnaround.js';
import { printReport, saveReportFiles, tradingDayLabels } from './output/report.js';
import { renderHtmlReport, saveHtmlReport } from './output/htmlReport.js';
import { buildMarketBrief } from './analyze/marketTheme.js';
import { analyzeCustomStocks, normalizeCodes } from './analyze/customStocks.js';
import { resolveStockTokens } from './analyze/resolveNames.js';
import { splitThreeModules } from './analyze/modules.js';
import { assessDataFreshness } from './analyze/session.js';
import { getDataFreshness } from './crawl/eastmoney.js';
import { attachXueqiuOpinions } from './crawl/xueqiu.js';
import { analyzeIndexBuySignals } from './analyze/indexSignals.js';
import { attachMarketMeta } from './analyze/marketMeta.js';
import { attachThemeExpect } from './analyze/themeExpect.js';
import { fetchTodayHotNews } from './crawl/hotNews.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {
    fast: false,
    shortOnly: false,
    turnaroundOnly: false,
    noOpen: false,
    noXueqiu: false,
    max: 15,
    codes: [],
    // 未能直接识别成6位代码的输入（中文名/简称），交给名称解析
    nameTokens: [],
  };
  const rest = [];
  for (const a of argv) {
    if (a === '--fast') args.fast = true;
    else if (a === '--short-only') args.shortOnly = true;
    else if (a === '--turnaround-only') args.turnaroundOnly = true;
    else if (a === '--no-open') args.noOpen = true;
    else if (a === '--no-xueqiu') args.noXueqiu = true;
    else if (a.startsWith('--max=')) {
      args.max = Math.min(30, Math.max(1, Number(a.slice(6)) || 15));
    } else if (a.startsWith('--codes=')) {
      rest.push(a.slice(8));
    } else if (a === '--stock' || a === '--codes') {
      // skip
    } else if (!a.startsWith('-')) {
      rest.push(a);
    }
  }

  // 支持混写：600519 贵州茅台,远东股份 英力特
  for (const token of splitTokens(rest)) {
    const m = token.match(/^\d{6}$/) ? token : null;
    if (m) {
      if (!args.codes.includes(m)) args.codes.push(m);
    } else if (/\d{6}/.test(token)) {
      for (const c of normalizeCodes(token)) if (!args.codes.includes(c)) args.codes.push(c);
    } else if (token) {
      args.nameTokens.push(token);
    }
  }
  return args;
}

/** 按空格/逗号/顿号等切分，兼容中文标点 */
function splitTokens(input) {
  return (Array.isArray(input) ? input : [input])
    .flatMap((s) => String(s || '').split(/[\s,，;；|、]+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

function openInBrowser(filePath) {
  exec(`cmd /c start "" "${filePath}"`);
}

async function maybeAttachXueqiu(cards, args, progress) {
  if (args.noXueqiu || !cards.length) return cards;
  progress?.('雪球大V：将打开浏览器，请手动登录后自动抓取…');
  try {
    await attachXueqiuOpinions(cards, {
      onProgress: (m) => progress?.(m),
      concurrencyGap: args.fast ? 280 : 400,
    });
  } catch (err) {
    progress?.(`雪球跳过：${err.message}`);
  }
  return cards;
}

async function runCustomMode(args, labels, outDir, dateFolder) {
  console.log('\n[自选股] 开始分析...');
  const progress = (msg) => console.log(`  · ${msg}`);

  // 中文名 / 简称 → 6位代码
  const codes = [...args.codes];
  if (args.nameTokens.length) {
    progress(`解析中文名：${args.nameTokens.join('、')}`);
    const { results } = await resolveStockTokens(args.nameTokens);
    for (const r of results) {
      if (r.code) {
        if (!codes.includes(r.code)) codes.push(r.code);
        progress(`  ${r.token} → ${r.code} ${r.name}`);
      } else {
        console.log(`  ! 无法识别「${r.token}」，已跳过（可直接给6位代码）`);
      }
    }
  }
  if (!codes.length) {
    throw new Error('没有可分析的股票。用法：npm run stock -- 贵州茅台 600519');
  }

  const customRaw = await analyzeCustomStocks(codes, { onProgress: progress });
  await maybeAttachXueqiu(customRaw.candidates, args, progress);

  let hotNews = [];
  try {
    hotNews = await fetchTodayHotNews({ limit: 15 });
    progress(`今日热点新闻 ${hotNews.length} 条`);
  } catch (err) {
    progress(`热点新闻跳过：${err.message}`);
  }
  attachThemeExpect(customRaw.candidates, { hotNews, hotSectors: [] });

  const custom = {
    codes: customRaw.codes,
    season: customRaw.season,
    candidates: customRaw.candidates,
    scanned: customRaw.scanned,
    scoredCount: customRaw.scoredCount,
  };

  const brief = {
    season: custom.season,
    hotNews,
    prevTradingDay: {
      title: '自选模式',
      summary: `共 ${custom.codes.length} 只：${custom.codes.join('、')}`,
      sectors: [],
    },
    currentSession: { title: '分析说明', summary: '技术面 + 事件 + 乖离/MACD + 雪球大V' },
    recommend: {
      title: '操作提示',
      items: custom.candidates.map((c) => `${c.code} ${c.name}：${c.action}`),
      note: '自选股',
    },
    riskNotes: ['自选分析结果仅供参考，请自行风控'],
  };

  const meta = {
    generatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    ...labels,
    args,
    mode: 'custom',
    season: custom.season,
    freshness: assessDataFreshness(await getDataFreshness()),
  };
  if (meta.freshness.warn) console.error(`  ⚠ ${meta.freshness.text}`);

  const empty = { scanned: 0, scoredCount: 0, candidates: [], announcementHits: 0, rankedCount: 0 };
  const html = renderHtmlReport({ meta, brief, shortTerm: empty, turnaround: empty, custom });

  const textLines = [
    `自选股分析 ${meta.generatedAt}`,
    `代码：${custom.codes.join(', ')}`,
    '',
    '【今日热点新闻】',
    ...(hotNews.length
      ? hotNews.map((n, i) => `${String(i + 1).padStart(2, '0')}. ${n.title}${n.source ? `（${n.source}）` : ''}`)
      : ['  （暂无）']),
    '',
    ...custom.candidates.map((c, i) => {
      const sb = c.signalBoard || {};
      return (
        `${i + 1}. ${c.code} ${c.name} [${c.direction}] ${c.action}\n` +
        `   ${sb.biasText || ''}｜${sb.macdText || ''}\n` +
        `   ${c.themeExpect || ''}\n` +
        `   ${c.moveReason || ''}\n` +
        `   买 ${c.buyPrice}｜卖 ${c.sellPrice}\n` +
        `   进展 ${c.progress}｜窗口 ${c.expectWindow}\n` +
        `   买因：${c.buyReason}\n   卖因：${c.sellReason}`
      );
    }),
  ];
  const text = textLines.join('\n');
  console.log('\n' + text + '\n');

  const payload = { meta, brief, custom };
  const saved = saveReportFiles(text, payload, outDir, { dateFolder });
  const htmlSaved = saveHtmlReport(html, outDir, { dateFolder });
  console.log(`已保存到日期目录：\n  ${saved.dayDir}\n  ${htmlSaved.latestInDay}\n`);
  if (!args.noOpen) openInBrowser(htmlSaved.latestInDay);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const labels = tradingDayLabels(dayjs());
  const dateFolder = dayjs().format('YYYY-MM-DD');
  const outDir = path.join(root, 'output');

  if (args.codes.length || args.nameTokens.length) {
    await runCustomMode(args, labels, outDir, dateFolder);
    return;
  }

  const maxCandidates = args.max;
  console.log('\n启动分析...');
  console.log(
    `模式：${args.fast ? '快速' : '标准'} | 每模块最多 ${maxCandidates} 只 | 输出 output/${dateFolder}\n`
  );

  const progress = (msg) => console.log(`  · ${msg}`);
  let shortRaw = null;
  let turnRaw = null;
  const runShort = !args.turnaroundOnly;
  const runTurn = !args.shortOnly;

  if (runTurn) {
    console.log('[事件/ST] 收购·转让·重整 + ST');
    turnRaw = await runTurnaroundStrategy({
      maxCandidates,
      pagesPerKeyword: args.fast ? 2 : 3,
      lookbackDays: 200,
      onProgress: progress,
    });
    console.log(`  √ 事件池 ${turnRaw.candidates.length} 只 · ${turnRaw.season.label}\n`);
  }

  if (runShort) {
    console.log('[正股] 五日线纯技术（不含事件股）');
    shortRaw = await runShortTermStrategy({
      maxCandidates,
      scanPages: args.fast ? 4 : 8,
      detailLimit: args.fast ? 80 : 200,
      klineLimit: 260,
      onProgress: progress,
    });
    console.log(`  √ 正股 ${shortRaw.candidates.length} 只\n`);
  }

  const shortTerm = shortRaw
    ? {
        scanned: shortRaw.scanned,
        scoredCount: shortRaw.scoredCount,
        candidates: shortRaw.candidates,
        sellCards: shortRaw.sellCards || [],
        ops: shortRaw.ops,
        actions: summarizeShortTermActions(shortRaw),
      }
    : emptyShort();

  const turnaround = turnRaw
    ? {
        season: turnRaw.season,
        announcementHits: turnRaw.announcementHits,
        rankedCount: turnRaw.rankedCount,
        candidates: turnRaw.candidates,
        ops: turnRaw.ops,
        actions: summarizeTurnaroundActions(turnRaw),
      }
    : emptyTurn();

  const modules = splitThreeModules({
    shortCandidates: shortTerm.candidates,
    turnCandidates: turnaround.candidates,
    max: maxCandidates,
  });

  console.log(
    `三模块：正股${modules.plainStocks.length} / ST${modules.stStocks.length} / 事件${modules.eventStocks.length}`
  );

  // 行业 / 资金流入 / 筹码集中度
  const metaCards = [
    ...modules.plainStocks,
    ...modules.stStocks,
    ...modules.eventStocks,
    ...(shortTerm.sellCards || []),
  ];
  const codeKlines = {};
  for (const s of shortRaw?.allScored || []) {
    if (s.stock?.code && s.klines?.length) codeKlines[s.stock.code] = s.klines;
  }
  await attachMarketMeta(metaCards, { codeKlines, onProgress: progress });

  // 雪球：优先覆盖 ST + 事件 + 正股前若干
  const xqTargets = [
    ...modules.stStocks,
    ...modules.eventStocks,
    ...modules.plainStocks.slice(0, args.fast ? 8 : 15),
  ];
  const seen = new Set();
  const uniq = [];
  for (const c of xqTargets) {
    if (seen.has(c.code)) continue;
    seen.add(c.code);
    uniq.push(c);
  }
  await maybeAttachXueqiu(uniq, args, progress);

  console.log('生成方向总结与 HTML 报告...');
  const indexSignals = await analyzeIndexBuySignals({ onProgress: progress });
  console.log(`  √ 指数信号：${indexSignals.marketSignal} · 可买指数 ${indexSignals.buyCount} 个`);

  const brief = await buildMarketBrief({
    shortCards: modules.plainStocks,
    turnCards: [...modules.stStocks, ...modules.eventStocks],
    indexSignals,
    now: dayjs(),
  });
  console.log(`  √ 今日热点新闻：${(brief.hotNews || []).length} 条`);

  // 炒作预期 + 涨跌归因（模块三同为非ST正股，一并覆盖）
  attachThemeExpect([...modules.plainStocks, ...modules.eventStocks], {
    hotNews: brief.hotNews || [],
    hotSectors: brief.prevTradingDay?.sectors || [],
  });

  // 合并台账策略优化建议
  try {
    const insightsPath = path.join(root, 'data', 'strategy-insights.json');
    const { readFileSync, existsSync } = await import('node:fs');
    if (existsSync(insightsPath)) {
      const insights = JSON.parse(readFileSync(insightsPath, 'utf8'));
      if (insights.tips?.length) {
        brief.recommend.items = [
          ...insights.tips.slice(0, 3).map((t) => `台账优化：${t}`),
          ...(brief.recommend.items || []),
        ];
      }
      if (insights.checklistPatch?.length) {
        brief.riskNotes = [
          ...(brief.riskNotes || []),
          ...insights.checklistPatch.slice(0, 4).map((c) => `策略补丁：${c}`),
        ];
      }
    }
  } catch {
    /* ignore */
  }

  const meta = {
    generatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    ...labels,
    args,
    mode: 'daily',
    season: turnaround.season || brief.season,
    freshness: assessDataFreshness(await getDataFreshness()),
  };
  if (meta.freshness.warn) console.error(`  ⚠ ${meta.freshness.text}`);

  const text = printReport({ modules, meta, turnaround, indexSignals, brief });
  const html = renderHtmlReport({ meta, brief, modules, shortTerm, turnaround, indexSignals });

  const payload = {
    meta,
    brief,
    indexSignals,
    modules,
    shortTerm: {
      scanned: shortTerm.scanned,
      scoredCount: shortTerm.scoredCount,
      candidates: shortTerm.candidates,
      taoHits: shortRaw?.taoHits || [],
    },
    turnaround: {
      season: turnaround.season,
      announcementHits: turnaround.announcementHits,
      rankedCount: turnaround.rankedCount,
      candidates: turnaround.candidates,
    },
  };

  const saved = saveReportFiles(text, payload, outDir, { dateFolder });
  const htmlSaved = saveHtmlReport(html, outDir, { dateFolder });

  console.log(
    `报告已保存到：\n  ${saved.dayDir}\n  ${htmlSaved.latestInDay}\n  (快捷) ${htmlSaved.latestRoot}\n`
  );

  if (!args.noOpen) {
    try {
      openInBrowser(htmlSaved.latestInDay);
      console.log('已尝试打开 HTML 预览\n');
    } catch {
      console.log('请手动打开：' + htmlSaved.latestInDay + '\n');
    }
  }
}

function emptyShort() {
  return {
    scanned: 0,
    scoredCount: 0,
    candidates: [],
    sellCards: [],
    ops: { buy: [], holdWatch: [], sell: [] },
    actions: { today: [], tomorrow: [] },
  };
}

function emptyTurn() {
  return {
    season: null,
    announcementHits: 0,
    rankedCount: 0,
    candidates: [],
    ops: { focus: [], watch: [], avoid: [] },
    actions: { today: [], tomorrow: [] },
  };
}

main().catch((err) => {
  console.error('\n分析失败：', err?.message || err);
  process.exit(1);
});
