#!/usr/bin/env node
/**
 * 早盘热点板块 + 集合竞价选股（9:30 前）
 *
 * 用法：
 *   npm run morning
 *   npm run 早盘
 *   npm run morning -- --max=8
 *   npm run morning -- --no-ma5
 *   npm run morning -- --no-open
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dayjs from 'dayjs';

import { analyzeMorningOpen } from './analyze/morning.js';
import { renderMorningHtml, saveMorningHtml } from './output/morningHtml.js';
import { openInBrowser } from './output/open.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { max: 10, top: 8, noMa5: false, noOpen: false, help: false };
  for (const a of argv) {
    if (a === '--no-ma5') args.noMa5 = true;
    else if (a === '--no-open') args.noOpen = true;
    else if (a.startsWith('--max=')) args.max = Math.min(20, Math.max(3, Number(a.slice(6)) || 10));
    else if (a.startsWith('--top=')) args.top = Math.min(15, Math.max(3, Number(a.slice(6)) || 8));
    else if (a === '-h' || a === '--help') args.help = true;
  }
  return args;
}

function fmtPct(v) {
  if (v == null || Number.isNaN(+v)) return '-';
  return `${+v >= 0 ? '+' : ''}${(+v).toFixed(2)}%`;
}

function printConsole(r) {
  const line = (ch = '─', n = 64) => ch.repeat(n);
  console.log('');
  console.log(line('═'));
  console.log(`早盘竞价 · ${r.tradeDate} · ${r.phase?.label || ''}`);
  console.log(line('═'));
  console.log(`一句话：${r.headline}`);
  console.log(r.note);
  console.log('');

  console.log('【早盘热点板块】');
  if (!r.hotBoards?.length) {
    console.log('  暂无高开聚集');
  } else {
    r.hotBoards.forEach((b, i) => {
      console.log(
        `  ${String(i + 1).padStart(2, '0')}. ${b.name}  均高开${fmtPct(b.avgChange)}  ` +
          `${b.confirmed ? '共振' : '个股'}  高开${b.count}家` +
          `${b.limitUp ? ` 顶板${b.limitUp}` : ''}` +
          `${b.amount ? ` 额${b.amountText}` : ''}`
      );
      console.log(`      ${b.note}`);
      console.log(
        `      领涨：${b.leaders.map((s) => `${s.name}${fmtPct(s.changePct)}`).join('、')}`
      );
    });
  }
  console.log('');

  console.log(`【早盘选股】${r.candidates.length} 只 · 扫描${r.scanned} / 高开${r.upCount}`);
  if (!r.candidates.length) {
    console.log('  没有符合板块共振且还能挂上价格的标的。');
  }
  r.candidates.forEach((c, i) => {
    console.log(
      `  ${String(i + 1).padStart(2, '0')}. ${c.code} ${c.name}  ${c.industry}  ` +
        `${fmtPct(c.changePct)}  [${c.action}]  分${c.score}`
    );
    console.log(`      ▸ ${c.buyPrice}${c.stop ? `  止损 ${c.stop}` : ''}`);
    if (c.techNote) console.log(`      ─ ${c.techNote}`);
    (c.reasons || []).forEach((x) => console.log(`        · ${x}`));
    (c.risks || []).forEach((x) => console.log(`        ! ${x}`));
  });
  console.log('');

  if (r.watch?.length) {
    console.log('【观察/回避】');
    r.watch.forEach((c, i) => {
      console.log(
        `  ${String(i + 1).padStart(2, '0')}. ${c.code} ${c.name}  ${fmtPct(c.changePct)}  ${c.action}`
      );
    });
    console.log('');
  }

  console.log(line('═'));
  console.log('9:25 撮合后再跑一次最准；开盘 3 分钟站不住竞价价就放弃。');
  console.log('');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`用法：
  npm run morning                 早盘热点板块 + 竞价选股，弹出 HTML
  npm run 早盘                    同上
  npm run morning -- --max=8      最多 8 只
  npm run morning -- --top=6      热点板块取前 6
  npm run morning -- --no-ma5     跳过五日线核对（更快）
  npm run morning -- --no-open    不自动打开浏览器

窗口：
  9:15–9:20  可撤单，只看板块方向
  9:20–9:25  不可撤，虚拟价还在跳
  9:25–9:30  开盘价锁定，做计划
  9:30 之后  按开盘价回看竞价，成交额已不纯

选股：板块共振优先，高开未顶死，有竞价额更好；一字板不追。`);
    return;
  }

  const now = dayjs();
  console.log(`\n[早盘竞价] ${now.format('YYYY-MM-DD HH:mm')} 开始...`);
  const result = await analyzeMorningOpen({
    top: args.top,
    max: args.max,
    withMa5: !args.noMa5,
    onProgress: (m) => console.log(`  · ${m}`),
    now,
  });

  printConsole(result);

  const stamp = now.format('HHmmss');
  const html = renderMorningHtml(result);
  const saved = saveMorningHtml(html, { root, tradeDate: result.tradeDate, stamp });
  const dayDir = path.join(root, 'output', result.tradeDate);
  const jsonPath = path.join(dayDir, `morning_${stamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(path.join(dayDir, 'latest-morning.json'), JSON.stringify(result, null, 2), 'utf8');

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
