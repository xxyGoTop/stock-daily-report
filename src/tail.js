#!/usr/bin/env node
/**
 * 尾盘选股：今天尾盘适合买哪些、买入点、买入理由
 *
 * 用法：
 *   npm run tail
 *   npm run 尾盘
 *   npm run tail -- --max=8 --fast
 *   npm run tail -- --no-open   只出文件，不弹浏览器
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dayjs from 'dayjs';

import { screenTailEnd } from './analyze/tailEnd.js';
import { analyzeIndexBuySignals } from './analyze/indexSignals.js';
import { renderTailHtml, saveTailHtml } from './output/tailHtml.js';
import { openInBrowser } from './output/open.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { max: 10, fast: false, detailLimit: null, noMarket: false, noOpen: false };
  for (const a of argv) {
    if (a === '--fast') args.fast = true;
    else if (a === '--no-market') args.noMarket = true;
    else if (a === '--no-open') args.noOpen = true;
    else if (a.startsWith('--max=')) {
      args.max = Math.min(30, Math.max(1, Number(a.slice(6)) || 10));
    } else if (a.startsWith('--pool=')) {
      args.detailLimit = Math.min(300, Math.max(20, Number(a.slice(7)) || 80));
    } else if (a === '-h' || a === '--help') {
      args.help = true;
    }
  }
  return args;
}

function fmtPct(v) {
  if (v == null || Number.isNaN(+v)) return '-';
  const n = +v;
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function fmtPrice(v) {
  if (v == null || Number.isNaN(+v)) return '-';
  return (+v).toFixed(2);
}

function line(ch = '─', n = 68) {
  return ch.repeat(n);
}

function render(result) {
  const out = [];
  const p = (s = '') => out.push(s);
  const { phase, market, candidates, freshness } = result;

  p('');
  p('╔══════════════════════════════════════════════════════════════╗');
  p('║  尾盘买入候选 · 当日量能 + 大盘环境 + 五日线                 ║');
  p('╚══════════════════════════════════════════════════════════════╝');
  p(`生成时间：${result.generatedAt}`);
  p(`交易时段：${phase.label} · ${phase.note}`);
  if (freshness) p(`${freshness.warn ? '⚠ 数据新鲜度' : '数据新鲜度'}：${freshness.text}`);
  if (!phase.isTail) {
    p('⚠ 当前不在 14:30~15:00 尾盘窗口，以下结果仅作准备/复盘，实际下单前请重新运行。');
  }
  p('免责声明：程序按规则自动筛选，不构成投资建议，请自行风控。');
  p('');

  p(line('═'));
  p('【大盘环境】');
  p(line('═'));
  if (market) {
    p(`结论：${market.marketCanBuy ? '偏可买' : market.marketSignal} · ${market.summary}`);
    for (const x of (market.indices || []).slice(0, 4)) {
      p(`  ${x.name}  ${x.signal}  强度${x.strength}  ${(x.reasons || []).slice(0, 2).join('；')}`);
    }
    if (market.hotSectors?.length) {
      p(`  热门板块：${market.hotSectors.map((s) => `${s.name}${fmtPct(s.changePct)}`).join('、')}`);
    }
  } else {
    p('  已跳过大盘分析（--no-market）');
  }
  p('');

  const strongestBoards = result.strongestBoards || [];
  p(line('═'));
  p(`【今天最强板块】${strongestBoards.length} 个 · 今日涨幅+上涨扩散+资金流确认`);
  p(line('═'));
  if (!strongestBoards.length) {
    p('  暂无同时满足涨幅、扩散度和资金流确认的强势板块。');
  } else {
    strongestBoards.forEach((b, i) => {
      p(
        `${String(i + 1).padStart(2, '0')}. ${b.name} ${fmtPct(b.changePct)}  ` +
          `上涨${b.up}/下跌${b.down}  主力${b.mainNetInflow >= 0 ? '+' : ''}${(
            b.mainNetInflow / 1e8
          ).toFixed(2)}亿`
      );
      if (b.leader) {
        p(`    领涨：${b.leader}${b.leaderCode ? `(${b.leaderCode})` : ''} ${fmtPct(b.leaderChangePct)}`);
      }
    });
  }
  p('');

  const tailMovingBoards = result.tailMovingBoards || [];
  p(line('═'));
  p(`【尾盘异动板块提醒】${tailMovingBoards.length} 个 · 今日突然加速且有资金/扩散确认`);
  p(line('═'));
  if (!tailMovingBoards.length) {
    p('  暂无可信的板块异动，不因单只涨停股强行定义板块行情。');
  } else {
    tailMovingBoards.forEach((b, i) => {
      p(
        `${String(i + 1).padStart(2, '0')}. ${b.name} ${fmtPct(b.changePct)}  ` +
          `较5日均速加速 ${fmtPct(b.acceleration)}  上涨扩散${(b.breadth * 100).toFixed(0)}%  ` +
          `主力${b.mainNetInflow >= 0 ? '+' : ''}${(b.mainNetInflow / 1e8).toFixed(2)}亿`
      );
      if (b.leader) {
        p(`    领涨：${b.leader}${b.leaderCode ? `(${b.leaderCode})` : ''} ${fmtPct(b.leaderChangePct)}`);
      }
    });
  }
  p('');

  const boardRecommendations = result.boardRecommendations || [];
  if (boardRecommendations.length) {
    p(line('═'));
    p(`【板块共振推荐】${boardRecommendations.length} 只 · 仅列通过个股硬门槛的股票`);
    p(line('═'));
    boardRecommendations.forEach((c, i) => {
      p(
        `${String(i + 1).padStart(2, '0')}. ${c.code} ${c.name}  ${c.industry} ` +
          `[${c.boardType}·板块${fmtPct(c.boardChangePct)}]  得分${c.score}`
      );
      p(`    ▸ ${c.action}：${c.buyPrice}`);
    });
    p('');
  }

  p(line('═'));
  p(`【尾盘可买】${candidates.length} 只`);
  p(line('═'));
  p(
    `筛选漏斗：全市场 ${result.scanned} → 快照预筛 ${result.prescreened} → 细算 ${result.detailed} → 通过 ${result.passedCount} → 可买 ${candidates.length}`
  );
  p('');

  if (!candidates.length) {
    p('  今天尾盘没有符合条件、且当前价位就能买的标的。');
    const stats = Object.entries(result.rejectStats || {}).sort((a, b) => b[1] - a[1]);
    if (stats.length) {
      p('  主要落选原因：');
      for (const [reason, n] of stats.slice(0, 6)) p(`    · ${reason}：${n} 只`);
    }
    p('  空仓也是一种决策，不必勉强出手。');
    p('');
  }

  candidates.forEach((c, i) => {
    p(`${String(i + 1).padStart(2, '0')}. ${c.code} ${c.name}  ${c.industry}  [得分 ${c.score}]`);
    p(`    现价 ${fmtPrice(c.price)} ${fmtPct(c.changePct)}  日内 ${fmtPrice(c.low)}~${fmtPrice(c.high)}`);
    p(`    ▸ 买入点：${c.buyPrice}`);
    p(`    ▸ 止损/止盈：${c.sellPrice}`);
    p(`    ▸ 建议仓位：${c.positionPct}（${c.positionNote}）`);
    p(`    ─ 五日线：${c.ma5Text}`);
    p(`    ─ ${c.volumeText}`);
    p(`    ─ ${c.dayPosText}`);
    if (c.boardSignal?.isMover) {
      p(
        `    ─ 板块：尾盘异动·${c.boardSignal.name} ${fmtPct(c.boardSignal.changePct)} ` +
          `（扩散${(c.boardSignal.breadth * 100).toFixed(0)}%）`
      );
    } else if (c.boardSignal?.isStrong) {
      p(
        `    ─ 板块：今日最强第${c.boardSignal.todayRank}·${c.boardSignal.name} ${fmtPct(
          c.boardSignal.changePct
        )}`
      );
    }
    p(`    ─ 资金：${c.fundFlow?.text || '-'}`);
    p(`    ─ ${c.signalBoard?.macdText || '-'}`);
    p('    ▸ 买入理由：');
    c.buyReasons.forEach((r, k) => p(`        ${k + 1}) ${r}`));
    if (c.riskNotes?.length) {
      p('    ▸ 风险提示：');
      c.riskNotes.forEach((r) => p(`        ! ${r}`));
    }
    p(`    ▸ 操作说明：${c.buyReason}`);
    p(`    ▸ 离场纪律：${c.sellReason}`);
    p('');
  });

  const watch = result.watchList || [];
  if (watch.length) {
    p(line('═'));
    p(`【观察区】${watch.length} 只 · 技术面合格但当前价位不宜追`);
    p(line('═'));
    watch.forEach((c, i) => {
      p(`${String(i + 1).padStart(2, '0')}. ${c.code} ${c.name}  ${c.industry}  [得分 ${c.score}]`);
      p(`    现价 ${fmtPrice(c.price)} ${fmtPct(c.changePct)}  MA5 ${fmtPrice(c.ma5)}  乖离 ${fmtPct(c.bias5)}`);
      if (c.boardSignal?.isMover || c.boardSignal?.isStrong) {
        p(
          `    ▸ 板块：${c.boardSignal.isMover ? '尾盘异动' : `今日最强第${c.boardSignal.todayRank}`}·` +
            `${c.boardSignal.name} ${fmtPct(c.boardSignal.changePct)}`
        );
      }
      p(`    ▸ 为何不买：${c.buyReason}`);
      p(`    ▸ 若回踩到位：可在 ${fmtPrice(c.ma5)} 附近再评估，止损参考 ${fmtPrice(c.stop)}`);
      p('');
    });
  }

  p(line('═'));
  p('尾盘纪律提醒：');
  p('  1) 买入点是「当场可挂的价位」，收盘前未成交就不追，明天重新评估。');
  p('  2) 止损位当天就写进备忘，次日开盘跌破直接执行，不要等反弹。');
  p('  3) 大盘为 avoid 时，本表仅供观察，不建议新开仓。');
  p('  4) 买入理由只列支持做多的因子，风险提示务必一起看完再决定。');
  p('');

  return out.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`用法：
  npm run tail                 尾盘选股（默认10只）
  npm run 尾盘                 同上
  npm run tail -- --max=8      最多输出8只
  npm run tail -- --fast       快速模式（少扫一些）
  npm run tail -- --pool=120   细算的候选池大小
  npm run tail -- --no-market  跳过大盘分析（更快）
  npm run tail -- --no-open    不自动打开 HTML

依据：当日成交量（盘中按已过交易时间折算）、大盘指数中期信号、五日线状态。
输出：HTML/文本/JSON 三份，含尾盘买入点、止损止盈、建议仓位、买入理由。`);
    return;
  }

  const now = dayjs();
  const progress = (m) => console.log(`  · ${m}`);
  console.log('\n[尾盘选股] 开始...');

  let market = null;
  if (!args.noMarket) {
    market = await analyzeIndexBuySignals({ onProgress: progress });
    console.log(`  √ 大盘：${market.marketSignal} · 可买指数 ${market.buyCount} 个`);
  }

  const result = await screenTailEnd({
    maxCandidates: args.max,
    detailLimit: args.detailLimit ?? (args.fast ? 50 : 80),
    scanPages: args.fast ? 4 : 6,
    market,
    onProgress: progress,
    now,
  });

  const text = render(result);
  console.log(text);

  const day = now.format('YYYY-MM-DD');
  const dayDir = path.join(root, 'output', day);
  fs.mkdirSync(dayDir, { recursive: true });
  const stamp = now.format('HHmmss');
  const txtPath = path.join(dayDir, `tail_${stamp}.txt`);
  const jsonPath = path.join(dayDir, `tail_${stamp}.json`);
  fs.writeFileSync(txtPath, text, 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(path.join(dayDir, 'latest-tail.txt'), text, 'utf8');
  fs.writeFileSync(path.join(root, 'output', 'latest-tail.txt'), text, 'utf8');

  const saved = saveTailHtml(renderTailHtml(result), { root, tradeDate: day, stamp });
  console.log(`已保存：\n  ${saved.htmlPath}\n  ${txtPath}\n  ${jsonPath}\n`);

  if (!args.noOpen) openInBrowser(saved.latestInDay);
}

main().catch((err) => {
  console.error('失败：', err.message || err);
  process.exit(1);
});
