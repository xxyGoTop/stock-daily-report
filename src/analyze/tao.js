/**
 * 陶博士体系公式（通达信逻辑移植）
 * - 每日观察选股 2.0（241103）
 * - 蓝色钻石公式（240901，用户所称「砖石底」）
 * - RPS：EXTRS 涨幅横向百分位排名（0~100）
 *
 * 说明：原公式依赖通达信 EXTDATA_USER；此处用同池个股涨幅排名近似 RPS。
 */

import { sma } from './indicators.js';

/** EXTRS:(C-REF(C,N))/REF(C,N) */
export function extras(klines, n) {
  if (!klines?.length || klines.length <= n) return null;
  const c = klines[klines.length - 1].close;
  const ref = klines[klines.length - 1 - n].close;
  if (!ref) return null;
  return (c - ref) / ref;
}

/** 对一组 extras 做 0~100 百分位排名（越大越强） */
export function rankRps(extraByCode) {
  const entries = Object.entries(extraByCode).filter(([, v]) => v != null && Number.isFinite(v));
  entries.sort((a, b) => a[1] - b[1]);
  const n = entries.length;
  const out = {};
  if (!n) return out;
  for (let i = 0; i < n; i++) {
    const [code] = entries[i];
    out[code] = n === 1 ? 100 : +((i / (n - 1)) * 100).toFixed(2);
  }
  return out;
}

/** 批量计算 RPS20/50/120/250 */
export function buildRpsMaps(codeKlines) {
  const periods = [20, 50, 120, 250];
  const extrasMaps = {};
  for (const p of periods) {
    const m = {};
    for (const [code, kl] of Object.entries(codeKlines)) {
      m[code] = extras(kl, p);
    }
    extrasMaps[p] = m;
  }
  return {
    rps20: rankRps(extrasMaps[20]),
    rps50: rankRps(extrasMaps[50]),
    rps120: rankRps(extrasMaps[120]),
    rps250: rankRps(extrasMaps[250]),
  };
}

function hhv(arr, n) {
  const slice = arr.slice(-n);
  return Math.max(...slice);
}

function countTrue(flags) {
  return flags.filter(Boolean).length;
}

/**
 * 每日观察选股 2.0
 * (XG1 OR XG2) AND XG3
 */
export function evalDailyObserve(klines, rps, turnover) {
  if (!klines || klines.length < 60) {
    return { hit: false, reason: 'K线不足' };
  }
  const highs = klines.map((k) => k.high);
  const closes = klines.map((k) => k.close);
  const i = klines.length - 1;
  const rps120 = rps.rps120 ?? 0;
  const rps250 = rps.rps250 ?? 0;
  const rps50 = rps.rps50 ?? 0;
  const turn = turnover ?? klines[i].turnover ?? 0;

  const hhv250 = hhv(highs, Math.min(250, highs.length));
  // XG11: 过去5天内至少1日最高价=250日最高价
  let xg11 = false;
  for (let d = 0; d < 5 && i - d >= 0; d++) {
    if (Math.abs(highs[i - d] - hhv250) < 1e-6 || highs[i - d] >= hhv250 * 0.9999) {
      xg11 = true;
      break;
    }
  }
  // XG12: RPS120>95.99 OR RPS250>95.99
  const xg12 = rps120 > 95.99 || rps250 > 95.99;
  // XG13: RPS120>94.99 AND RPS50>94.99
  const xg13 = rps120 > 94.99 && rps50 > 94.99;
  const xg1 = xg11 && (xg12 || xg13);

  // XG21: C/HHV(H,250)>=0.5
  const xg21 = closes[i] / hhv250 >= 0.5;
  // XG22: RPS120>97.99 OR RPS250>97.99
  const xg22 = rps120 > 97.99 || rps250 > 97.99;
  const xg2 = xg21 && xg22;

  // XG3: 换手<20%
  const xg3 = turn < 20;

  const hit = (xg1 || xg2) && xg3;
  const parts = [];
  if (xg1) parts.push('近5日创年高+高RPS');
  if (xg2) parts.push('回撤可控+极高RPS');
  if (!xg3) parts.push('换手过高剔除');

  return {
    hit,
    reason: hit ? parts.join('；') : parts.join('；') || '未满足每日观察条件',
    detail: { xg1, xg2, xg3, rps50, rps120, rps250, turn: +turn.toFixed?.(2) || turn },
  };
}

/**
 * 蓝色钻石（砖石底）公式 240901
 * 强势股急涨后回踩20日线附近，等待第二波（观察池，非立刻买入）
 */
export function evalBlueDiamond(klines, rps, turnover) {
  if (!klines || klines.length < 60) {
    return { hit: false, reason: 'K线不足' };
  }
  const highs = klines.map((k) => k.high);
  const lows = klines.map((k) => k.low);
  const closes = klines.map((k) => k.close);
  const i = closes.length - 1;
  const ma10 = sma(closes, 10);
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const ma120 = sma(closes, 120);
  const ma200 = sma(closes, 200);
  const ma250 = sma(closes, Math.min(250, closes.length));

  const rps50 = rps.rps50 ?? 0;
  const rps20 = rps.rps20 ?? 0;
  const turn = turnover ?? klines[i].turnover ?? 0;

  // HHVBARS(H,20): 距20日最高价的天数
  const win = Math.min(20, highs.length);
  let zcHighBars = 0;
  let peak = -Infinity;
  for (let j = i - win + 1; j <= i; j++) {
    if (highs[j] >= peak) {
      peak = highs[j];
      zcHighBars = i - j;
    }
  }
  // LLVBARS within that window from high
  let zcLowBars = 0;
  if (zcHighBars > 0) {
    let trough = Infinity;
    const from = i - zcHighBars;
    for (let j = from; j <= i; j++) {
      if (lows[j] <= trough) {
        trough = lows[j];
        zcLowBars = i - j;
      }
    }
  }
  const zcHighPrice = highs[i - zcHighBars];
  const zcLowPrice = lows[i - zcLowBars];
  const pullback = zcHighPrice > 0 ? (zcHighPrice - zcLowPrice) / zcHighPrice : 1;

  // 过去20天内最大回撤不超过25%（简化：当前回撤段<=25%）
  const zcdx0001 = pullback <= 0.25;
  const hhv250 = hhv(highs, Math.min(250, highs.length));
  const zcdx0002 = closes[i] / hhv250 > 0.8;
  const zcdx00 = zcdx0001 && zcdx0002;

  const zcdx011 = rps50 >= 98;
  const zcdx012 = rps20 >= 98;
  const zcdx013 = rps50 >= 97 && rps20 + rps50 >= 190;
  const zcdx01 = zcdx011 || zcdx012 || zcdx013;

  const zcdx02 = ma20[i] != null && closes[i] / ma20[i] < 1.005;

  const last20 = Math.min(20, i + 1);
  const closeBelow20 = [];
  const closeBelow10 = [];
  const lowBelow20 = [];
  for (let d = 0; d < last20; d++) {
    const idx = i - d;
    closeBelow20.push(ma20[idx] != null && closes[idx] < ma20[idx]);
    closeBelow10.push(ma10[idx] != null && closes[idx] < ma10[idx]);
    lowBelow20.push(ma20[idx] != null && lows[idx] < ma20[idx]);
  }
  const zcdx03 =
    countTrue(closeBelow20) <= 2 &&
    countTrue(closeBelow10) <= 8 &&
    (countTrue(lowBelow20) <= 4 || rps50 >= 99);

  const zcdx04 =
    ma50[i] != null &&
    ma120[i] != null &&
    ma200[i] != null &&
    ma250[i] != null &&
    ma50[i] > ma120[i] &&
    ma50[i] > ma200[i] &&
    ma50[i] > ma250[i];

  const zcdx05 = turn < 10;

  const hit = !!(zcdx00 && zcdx01 && zcdx02 && zcdx03 && zcdx04 && zcdx05);
  return {
    hit,
    reason: hit
      ? '蓝色钻石：强势回踩20日线附近（观察池，等口袋支点）'
      : '未满足蓝色钻石',
    detail: {
      pullback: +pullback.toFixed(3),
      rps20,
      rps50,
      nearMa20: zcdx02,
      ma50Strong: zcdx04,
      turn: +(+turn).toFixed(2),
      zcdx00,
      zcdx01,
      zcdx02,
      zcdx03,
      zcdx04,
      zcdx05,
    },
  };
}

/** 给短线评分叠加陶博士加分 */
export function applyTaoBoost(scoreResult, daily, diamond) {
  let score = scoreResult.score;
  const reasons = [...(scoreResult.reasons || [])];
  const tags = [];

  if (daily?.hit) {
    score += 18;
    reasons.push(`每日观察选股：${daily.reason}`);
    tags.push('每日观察');
  }
  if (diamond?.hit) {
    score += 14;
    reasons.push(`蓝色钻石：${diamond.reason}`);
    tags.push('蓝色钻石');
  }

  return {
    ...scoreResult,
    score,
    reasons,
    taoTags: tags,
    dailyObserve: daily,
    blueDiamond: diamond,
  };
}
