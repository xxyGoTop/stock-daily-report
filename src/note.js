#!/usr/bin/env node
/**
 * 明日交易便签
 *
 * 用法：
 *   npm run note -- 远东股份 英力特 海鸥住工 600869
 *   npm run note -- 高争民爆、*ST赛为、雪浪
 *
 * 输出一行一只：现价 / 买 / 卖 / 注意项，方便粘贴便签
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import dayjs from 'dayjs';
import { buildTradeNotes } from './analyze/tradeNote.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { noClip: false, tokens: [] };
  for (const a of argv) {
    if (a === '--no-clip') args.noClip = true;
    else if (!a.startsWith('-')) args.tokens.push(a);
  }
  return args;
}

function copyToClipboard(text) {
  try {
    execFileSync('clip', { input: Buffer.from(text, 'utf16le'), stdio: ['pipe', 'ignore', 'ignore'] });
    // Windows clip 需要 UTF-16LE；上面可能不对，改用 chcp 方案
    return false;
  } catch {
    return false;
  }
}

function copyToClipboardWin(text) {
  const tmp = path.join(root, 'output', '_clip_trade_note.txt');
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  // clip.exe 读 stdin 默认系统代码页；写临时文件再用 Get-Clipboard 更稳
  fs.writeFileSync(tmp, text, 'utf8');
  try {
    execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `Get-Content -Raw -Encoding UTF8 '${tmp.replace(/'/g, "''")}' | Set-Clipboard`],
      { stdio: 'ignore' }
    );
    return true;
  } catch {
    try {
      execFileSync('cmd', ['/c', `type "${tmp}" | clip`], { stdio: 'ignore', windowsHide: true });
      return true;
    } catch {
      return false;
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.tokens.length) {
    console.log(`用法：npm run note -- 远东股份 英力特 海鸥住工
或：  npm run note -- 600869 高争民爆

输出下一交易日买入/卖出参考价 + 一行注意项，并尽量复制到剪贴板。
加 --no-clip 可只打印不复制。`);
    process.exit(1);
  }

  const progress = (m) => console.error(`  · ${m}`);
  console.error('\n[交易便签] 生成中…');
  const { text, labels, rows } = await buildTradeNotes(args.tokens, { onProgress: progress });

  const day = dayjs().format('YYYY-MM-DD');
  const dayDir = path.join(root, 'output', day);
  fs.mkdirSync(dayDir, { recursive: true });
  const notePath = path.join(dayDir, 'trade-note.txt');
  const latestPath = path.join(root, 'output', 'latest-trade-note.txt');
  fs.writeFileSync(notePath, text, 'utf8');
  fs.writeFileSync(latestPath, text, 'utf8');

  console.log('\n' + text);

  const okCount = rows.filter((r) => r.ok).length;
  console.error(`已生成 ${okCount}/${rows.length} 只 · 下一交易日 ${labels.tomorrowLabel}`);
  console.error(`文件：${notePath}`);

  if (!args.noClip) {
    const clipped = copyToClipboardWin(text);
    console.error(clipped ? '已复制到剪贴板，可直接粘贴到便签。' : '未能写入剪贴板，请手动全选上方文本复制。');
  }
}

main().catch((err) => {
  console.error('失败：', err.message || err);
  process.exit(1);
});
