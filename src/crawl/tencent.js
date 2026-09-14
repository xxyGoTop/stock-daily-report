/**
 * 腾讯行情（GBK）。stock / note 在东财列表里找不到票时走这里补名称。
 */

import { cleanStockName, readResponseText } from './decode.js';

function marketPrefix(code) {
  const c = String(code).padStart(6, '0');
  return /^[695]/.test(c) ? 'sh' : 'sz';
}

/**
 * @returns {Promise<{code,name,price,prevClose,changePct,turnover,volumeRatio,amplitude}|null>}
 */
export async function fetchTencentQuote(code) {
  const c = String(code).padStart(6, '0');
  const res = await fetch(`https://qt.gtimg.cn/q=${marketPrefix(c)}${c}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://gu.qq.com/',
    },
  });
  if (!res.ok) return null;
  const text = await readResponseText(res);
  const parts = text.split('~');
  if (parts.length < 5) return null;
  const name = cleanStockName(parts[1]);
  if (!name) return null;
  return {
    code: c,
    name,
    price: Number(parts[3]) || 0,
    prevClose: Number(parts[4]) || 0,
    changePct: Number(parts[32]) || 0,
    turnover: Number(parts[38]) || 0,
    volumeRatio: Number(parts[49]) || 0,
    amplitude: Number(parts[43]) || 0,
  };
}
