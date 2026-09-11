#!/usr/bin/env node
/**
 * 当日复盘报告（HTML + 控制台 + JSON）
 *
 * 用法：
 *   npm run review
 *   npm run 复盘
 *   npm run review -- --top=15
 *   npm run review -- --no-news
 *   npm run review -- --no-open
 *   npm run review -- --date=2026-09-10   复盘指定交易日的涨停/跌停梯队
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dayjs from 'dayjs';

import { analyzeDailyReview, fmtSealTime } from './analyze/review.js';
import { renderReviewHtml, saveReviewHtml } from './output/reviewHtml.js';
import { openInBrowser } from './output/open.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { top: 10, noNews: false, noOpen: false, date: null, help: false };
  for (const a of argv) {
    if (a === '--no-news') args.noNews = true;
    else if (a === '--no-open') args.noOpen = true;
    else if (a.startsWith('--top=')) {
      args.top = Math.min(30, Math.max(5, Number(a.slice(6)) || 10));
    } else if (a.startsWith('--date=')) {
      args.date = a.slice(7).trim();
    } else if (a === '-h' || a === '--help') {
      args.help = true;
    }
  }
  return args;
}

function fmtPct(v) {
  if (v == null || Number.isNaN(+v)) return '-';
  return `${+v >= 0 ? '+' : ''}${(+v).toFixed(2)}%`;
}

function printConsole(r) {
  const line = (ch = '─', n = 64) => ch.repeat(n);
  const p = (s = '') => console.log(s);
  const s = r.sentiment;

  p('');
  p(line('═'));
  p(`当日复盘 · ${r.tradeDate} · ${r.phase?.label || ''}`);
  p(line('═'));
  p(`一句话：${r.headline}`);
  if (r.phase?.live) p('⚠ 当前未收盘，以下为盘中快照，收盘后请重跑。');
  p('');

  if (r.indices?.length) {
    p('【指数】');
    for (const x of r.indices) {
      p(`  ${x.name.padEnd(8, '　')} ${String(x.price.toFixed(2)).padStart(9)}  ${fmtPct(x.changePct)}`);
    }
    p('');
  }

  p('【情绪】');
  p(`  ${s.score} 分 · ${s.label} —— ${s.advice}`);
  for (const part of s.parts) p(`    · ${part.name}：${part.text}（${part.score}分）`);
  p('');

  if (r.ladder?.length) {
    p(`【连板梯队】最高 ${r.ladder[0].boards} 板`);
    for (const lv of r.ladder) {
      const names = lv.stocks
        .slice(0, 12)
        .map((x) => `${x.name}${lv.boards >= 2 ? `(${fmtSealTime(x.firstSealTime)})` : ''}`)
        .join('、');
      p(`  ${String(lv.boards).padStart(2)}板 ${String(lv.count).padStart(3)}只：${names}${
        lv.stocks.length > 12 ? ` …另${lv.stocks.length - 12}只` : ''
      }`);
    }
    p('');
  }

  if (r.mainLines?.length) {
    p('【今日主线】');
    r.mainLines.slice(0, 6).forEach((l, i) => {
      p(
        `  ${i + 1}. ${l.name} [${l.confirmed ? '已确认' : '待确认'}]  涨停${l.limitUpCount}家 · 最高${l.maxBoards}板` +
          (l.boardChangePct != null ? ` · 板块${fmtPct(l.boardChangePct)}` : '')
      );
      p(`     ${l.note}`);
      p(`     领涨：${l.leaders.map((x) => `${x.name}(${x.boards}板)`).join('、') || '-'}`);
    });
    p('');
  }

  const ms = r.boards?.marketStyle;
  if (ms) {
    p('【风格与量能】');
    if (ms.styleTilt?.available) p(`  风格：${ms.styleTilt.label} —— ${ms.styleTilt.note}`);
    if (ms.turnover && ms.turnover.level !== 'unknown') {
      p(`  量能：${ms.turnover.label} · 成交${ms.turnover.amountText} —— ${ms.turnover.note}`);
    }
    if (ms.boardStyle?.available) p(`  主导：${ms.boardStyle.dominant || '无明确主导'} —— ${ms.boardStyle.note}`);
    p('');
  }

  if (r.boards?.topBoards?.length) {
    p('【板块强度前十】');
    for (const b of r.boards.topBoards) {
      p(
        `  ${String(b.strengthRank).padStart(2, '0')}. ${b.name} ${fmtPct(b.changePct)}  强度${b.strengthScore}  ` +
          `${b.trend?.label || '-'}/${b.divergence?.label || '-'}  主力${(b.mainNetInflow / 1e8).toFixed(2)}亿`
      );
    }
    p('');
  }

  const t = r.tomorrow || {};
  if (t.focus?.length || t.risks?.length) {
    p('【明日关注】');
    (t.focus || []).forEach((x, i) => p(`  ${i + 1}) ${x}`));
    (t.risks || []).forEach((x) => p(`  ! ${x}`));
    p('');
  }

  p(line('═'));
  p('复盘只统计事实与归纳倾向，不给个股买卖价；买点请用 npm run tail / npm run stock。');
  p('');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`用法：
  npm run review                    生成今天的复盘报告并弹出 HTML
  npm run 复盘                      同上
  npm run review -- --top=15        板块强度取前15
  npm run review -- --date=2026-09-10  复盘指定交易日
  npm run review -- --no-news       跳过热点新闻
  npm run review -- --no-open       不自动打开浏览器

内容：指数表现、涨跌家数、涨停/跌停/炸板与连板梯队、情绪打分、
      今日主线（涨停聚集 × 板块指数确认）、风格与量能、明日关注。`);
    return;
  }

  const now = args.date ? dayjs(`${args.date} 15:05:00`) : dayjs();
  if (!now.isValid()) {
    throw new Error(`--date 格式不对：${args.date}，应为 YYYY-MM-DD`);
  }

  console.log(`\n[当日复盘] ${now.format('YYYY-MM-DD')} 开始...`);
  if (args.date && now.format('YYYY-MM-DD') !== dayjs().format('YYYY-MM-DD')) {
    console.log('  ⚠ 指定了历史日期：涨停/跌停梯队为该日数据，板块强度与量能仍是实时接口的当前值。');
  }
  const progress = (m) => console.log(`  · ${m}`);

  const result = await analyzeDailyReview({
    top: args.top,
    withNews: !args.noNews,
    onProgress: progress,
    now,
  });

  printConsole(result);

  const stamp = dayjs().format('HHmmss');
  const html = renderReviewHtml(result);
  const saved = saveReviewHtml(html, { root, tradeDate: result.tradeDate, stamp });

  const dayDir = path.join(root, 'output', result.tradeDate);
  const jsonPath = path.join(dayDir, `review_${stamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(path.join(dayDir, 'latest-review.json'), JSON.stringify(result, null, 2), 'utf8');

  console.log('已保存：');
  console.log(`  ${saved.htmlPath}`);
  console.log(`  ${saved.latestRoot}`);
  console.log(`  ${jsonPath}\n`);

  if (!args.noOpen) openInBrowser(saved.latestInDay);
}

main().catch((err) => {
  console.error('失败：', err.message || err);
  process.exit(1);
});
