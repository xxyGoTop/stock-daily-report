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

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

/**
 * 腾讯五档盘口。买一量单位是「手」。
 * 涨停时卖一为 0、买一堆在涨停价，买一量×100×现价 ≈ 封单金额。
 */
export async function fetchTencentDepth(code) {
  const c = String(code).padStart(6, '0');
  const res = await fetch(`https://qt.gtimg.cn/q=${marketPrefix(c)}${c}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://gu.qq.com/',
    },
  });
  if (!res.ok) return null;
  const text = await readResponseText(res);
  const p = text.split('~');
  if (p.length < 29) return null;
  const name = cleanStockName(p[1]);
  if (!name) return null;
  const bids = [1, 2, 3, 4, 5].map((i) => ({
    price: n(p[7 + i * 2]),
    volume: n(p[8 + i * 2]),
  }));
  const asks = [1, 2, 3, 4, 5].map((i) => ({
    price: n(p[17 + i * 2]),
    volume: n(p[18 + i * 2]),
  }));
  const price = n(p[3]);
  const buy1 = bids[0];
  const sell1 = asks[0];
  const sealShares = buy1.volume * 100;
  const sealAmount = sealShares * price;
  return {
    code: c,
    name,
    price,
    prevClose: n(p[4]),
    open: n(p[5]),
    volume: n(p[6]),
    changePct: n(p[32]),
    high: n(p[33]),
    low: n(p[34]),
    amount: n(p[37]) * 1e4,
    turnover: n(p[38]),
    amplitude: n(p[43]),
    volumeRatio: n(p[49]),
    quoteTime: String(p[30] || ''),
    bids,
    asks,
    buy1,
    sell1,
    sealShares,
    sealAmount,
  };
}
