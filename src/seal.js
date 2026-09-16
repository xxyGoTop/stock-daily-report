#!/usr/bin/env node
/**
 * 封单监控：涨停买一还厚不厚，帮你判断能不能继续拿
 *
 * 用法：
 *   npm run seal -- 有研新材
 *   npm run 封单 -- 有研新材 600206
 *   npm run seal -- 有研新材 --watch
 *   npm run seal -- 有研新材 --watch --interval=15
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dayjs from 'dayjs';

import { analyzeSeal } from './analyze/seal.js';
import { renderSealHtml, saveSealHtml } from './output/sealHtml.js';
import { openInBrowser } from './output/open.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {
    tokens: [],
    watch: false,
    interval: 15,
    rounds: 0,
    noOpen: false,
    noMa5: false,
    help: false,
  };
  for (const a of argv) {
    if (a === '--watch' || a === '-w') args.watch = true;
    else if (a === '--no-open') args.noOpen = true;
    else if (a === '--no-ma5') args.noMa5 = true;
    else if (a.startsWith('--interval=')) {
      args.interval = Math.min(120, Math.max(5, Number(a.slice(11)) || 15));
    } else if (a.startsWith('--rounds=')) {
      args.rounds = Math.max(0, Number(a.slice(9)) || 0);
    } else if (a === '-h' || a === '--help') args.help = true;
    else if (!a.startsWith('-')) args.tokens.push(a);
  }
  return args;
}

function fmtPct(v) {
  if (v == null || Number.isNaN(+v)) return '-';
  return `${+v >= 0 ? '+' : ''}${(+v).toFixed(2)}%`;
}

function printCard(c) {
  if (c.error) {
    console.log(`  ${c.code} ${c.name}  ${c.error}`);
    return;
  }
  console.log(
    `  ${c.code} ${c.name}  ${c.price.toFixed(2)} ${fmtPct(c.changePct)}  ` +
      `[${c.action}]  ${c.score}分`
  );
  if (c.atLimit) {
    console.log(
      `      封单 ${c.sealAmountText}（${c.sealHandsText}）  占成交 ${c.sealRatioText}  ` +
        `开板${c.brokenTimes ?? 0}次  首封 ${c.firstSealText}`
    );
  } else {
    console.log(`      未封板  买一 ${c.buy1Text}  卖一 ${c.sell1Text}`);
  }
  console.log(`      ▸ ${c.verdict}`);
  if (c.sealDeltaText && c.sealDeltaHands != null) console.log(`      ─ ${c.sealDeltaText}`);
  if (c.techNote) console.log(`      ─ ${c.techNote}`);
  (c.reasons || []).forEach((x) => console.log(`        · ${x}`));
  (c.risks || []).forEach((x) => console.log(`        ! ${x}`));
}

function printResult(r, { watching = false, round = 0 } = {}) {
  console.log('');
  console.log('═'.repeat(64));
  console.log(
    `封单监控 · ${r.tradeDate} ${r.generatedAt.slice(11)} · ${r.phase?.label || ''}` +
      (watching ? ` · 第${round}轮` : '')
  );
  console.log('═'.repeat(64));
  for (const c of r.cards) printCard(c);
  if (r.unresolved?.length) {
    console.log(`  未识别：${r.unresolved.map((x) => x.token).join('、')}`);
  }
  console.log('');
}

function saveFiles(result, now) {
  const stamp = now.format('HHmmss');
  const html = renderSealHtml(result);
  const saved = saveSealHtml(html, { root, tradeDate: result.tradeDate, stamp });
  const dayDir = path.join(root, 'output', result.tradeDate);
  const jsonPath = path.join(dayDir, `seal_${stamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(path.join(dayDir, 'latest-seal.json'), JSON.stringify(result, null, 2), 'utf8');
  return { ...saved, jsonPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.tokens.length) {
    console.log(`用法：
  npm run seal -- 有研新材              看一只的封单和能否继续持有
  npm run 封单 -- 有研新材 600206       同上，可多只
  npm run seal -- 有研新材 --watch      默认每 15 秒刷新
  npm run seal -- 有研新材 --watch --interval=10 --rounds=20
  npm run seal -- 有研新材 --no-open    不弹浏览器

涨停：看买一封单金额、占成交比、是否开过板、何时首封。
没封板：封单逻辑用不上，改看买一/卖一和五日线。
Ctrl+C 结束监控。`);
    if (!args.tokens.length && !args.help) process.exit(1);
    return;
  }

  const prevMap = new Map();
  let round = 0;

  const runOnce = async ({ open } = {}) => {
    const now = dayjs();
    round += 1;
    const result = await analyzeSeal(args.tokens, {
      prevMap: prevMap.size ? prevMap : null,
      withMa5: !args.noMa5,
      now,
    });
    printResult(result, { watching: args.watch, round });
    const saved = saveFiles(result, now);
    for (const c of result.cards) {
      if (c.code && !c.error) prevMap.set(c.code, c);
    }
    if (open && !args.noOpen) openInBrowser(saved.latestInDay);
    return result;
  };

  console.log(`\n[封单] ${args.tokens.join(' ')} ...`);
  await runOnce({ open: !args.watch });

  if (!args.watch) return;

  console.log(`开始监控，每 ${args.interval} 秒刷新一次。Ctrl+C 结束。\n`);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    console.log('\n监控已停。最后一页在 output/latest-seal.html');
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  const timer = setInterval(async () => {
    if (args.rounds && round >= args.rounds) {
      clearInterval(timer);
      stop();
      return;
    }
    try {
      await runOnce({ open: false });
    } catch (err) {
      console.error('本轮失败：', err.message || err);
    }
  }, args.interval * 1000);
}

main().catch((err) => {
  console.error('失败：', err.message || err);
  process.exit(1);
});
