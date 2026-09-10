#!/usr/bin/env node
/**
 * 当日板块强度统计（HTML）
 *
 * 用法：
 *   npm run boards
 *   npm run 板块
 *   npm run boards -- --top=15
 *   npm run boards -- --concept
 *   npm run boards -- --no-open
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import dayjs from 'dayjs';

import { analyzeBoardStrength } from './analyze/boardStrength.js';
import { renderBoardStrengthHtml, saveBoardStrengthHtml } from './output/boardHtml.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { top: 10, concept: false, noOpen: false, noMarket: false, help: false };
  for (const a of argv) {
    if (a === '--concept') args.concept = true;
    else if (a === '--no-open') args.noOpen = true;
    else if (a === '--no-market') args.noMarket = true;
    else if (a.startsWith('--top=')) {
      args.top = Math.min(30, Math.max(5, Number(a.slice(6)) || 10));
    } else if (a === '-h' || a === '--help') {
      args.help = true;
    }
  }
  return args;
}

function openInBrowser(filePath) {
  exec(`cmd /c start "" "${filePath}"`);
}

function fmtPct(v) {
  if (v == null || Number.isNaN(+v)) return '-';
  const n = +v;
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function printConsole(result) {
  const s = result.summary || {};
  const ms = result.marketStyle || {};
  console.log('');
  console.log('═'.repeat(64));
  console.log(`当日板块强度 · ${result.tradeDate} · ${result.phase?.label || ''}`);
  console.log('═'.repeat(64));
  console.log(`结构：${s.structure} · ${s.tone}`);
  console.log(
    `板块涨/跌 ${s.upCount}/${s.downCount} · 前十均涨 ${fmtPct(s.avgTopChange)} · 前十资金 ${s.topFundText}`
  );
  console.log(`走强 ${s.strongCount} · 分化 ${s.divergedCount} · 资金流入 ${s.fundInCount}`);

  if (ms.headline) {
    console.log('');
    console.log(`【市场风格与量能】${ms.headline}`);
    if (ms.styleTilt?.available) console.log(`  风格：${ms.styleTilt.label}｜${ms.styleTilt.note}`);
    if (ms.boardStyle?.available) console.log(`  主导：${ms.boardStyle.dominant}｜${ms.boardStyle.note}`);
    if (ms.turnover && ms.turnover.level !== 'unknown') {
      const t = ms.turnover;
      console.log(
        `  量能：${t.label}｜今日成交 ${t.amountText}` +
          `${t.intraday ? `（折算全天约 ${t.projectedAmountText}）` : ''}` +
          `${t.ratio != null ? `，为近5日均量 ${(t.ratio * 100).toFixed(0)}%` : ''}`
      );
    }
  }
  console.log('');
  console.log(`【前 ${result.top} 强度板块】`);
  for (const b of result.topBoards || []) {
    console.log(
      `${String(b.strengthRank).padStart(2, '0')}. ${b.name}  ${fmtPct(b.changePct)}  强度${b.strengthScore}  ` +
        `${b.divergence?.label} · ${b.fund?.label} · ${b.trend?.label}`
    );
    console.log(
      `    扩散${((b.breadth || 0) * 100).toFixed(0)}%  资金${b.fund?.text || '-'}  ` +
        `领涨${b.leader || '-'}${fmtPct(b.leaderChangePct)}`
    );
  }
  console.log('');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`用法：
  npm run boards                 当日板块强度前十（行业）+ HTML
  npm run 板块                   同上
  npm run boards -- --top=15     前 15
  npm run boards -- --concept    行业+概念一起排
  npm run boards -- --no-market  跳过市场风格与量能统计（更快）
  npm run boards -- --no-open    不自动打开浏览器

输出：市场风格、两市量能、板块强度、是否分化、资金情况、是否走强。`);
    return;
  }

  const now = dayjs();
  const progress = (m) => console.log(`  · ${m}`);
  console.log('\n[板块强度] 开始...');

  const result = await analyzeBoardStrength({
    top: args.top,
    includeConcept: args.concept,
    withMarket: !args.noMarket,
    onProgress: progress,
    now,
  });

  printConsole(result);

  const html = renderBoardStrengthHtml(result);
  const stamp = now.format('HHmmss');
  const saved = saveBoardStrengthHtml(html, {
    root,
    tradeDate: result.tradeDate,
    stamp,
  });

  const dayDir = path.join(root, 'output', result.tradeDate);
  const jsonPath = path.join(dayDir, `boards_${stamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(path.join(dayDir, 'latest-boards.json'), JSON.stringify(result, null, 2), 'utf8');

  console.log(`已保存：\n  ${saved.htmlPath}\n  ${jsonPath}\n`);
  if (!args.noOpen) openInBrowser(saved.latestInDay);
}

main().catch((err) => {
  console.error('失败：', err.message || err);
  process.exit(1);
});
