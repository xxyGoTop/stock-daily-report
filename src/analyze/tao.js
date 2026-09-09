/**
 * 陶博士体系公式（通达信逻辑移植）
 * - 火车每日观察（250706，合并升级版 MRGC）
 * - 顺向火车轨 3.0（250302；250706 换手放宽至 <15% 并加 120 日回撤）
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

/**
 * 全市场 RPS（欧奈尔口径：涨幅在全市场的横向百分位）
 *
 * 交易所公开数据只提供 5日/60日/年初至今 三个窗口，故按窗口就近映射：
 *   RPS50  ← 60日（窗口最接近）
 *   RPS250 ← 年初至今
 *   RPS20/RPS120 ← 相邻窗口加权
 * 比只在扫描池内排名更接近真实市场分位，95/96/98 这类阈值才有意义。
 */
export function buildMarketRpsMaps(rows = []) {
  const pick = (key) => {
    const m = {};
    for (const r of rows) m[r.code] = r[key];
    return rankRps(m);
  };
  const r5 = pick('change5');
  const r60 = pick('change60');
  const rYtd = pick('changeYtd');

  const mix = (a, b, wa) => {
    const out = {};
    for (const code of Object.keys(b)) {
      if (a[code] == null) continue;
      out[code] = +(a[code] * wa + b[code] * (1 - wa)).toFixed(2);
    }
    return out;
  };

  return {
    rps20: mix(r5, r60, 0.4),
    rps50: r60,
    rps120: mix(r60, rYtd, 0.5),
    rps250: rYtd,
    universe: rows.length,
  };
}

function hhv(arr, n) {
  const slice = arr.slice(-n);
  return Math.max(...slice);
}

function countTrue(flags) {
  return flags.filter(Boolean).length;
}

/** HHVBARS：距近 n 日内最高价的天数（0=当日创新高） */
function hhvBarsAt(arr, n, i) {
  const from = Math.max(0, i - n + 1);
  let peak = -Infinity;
  let bars = 0;
  for (let j = from; j <= i; j++) {
    if (arr[j] >= peak) {
      peak = arr[j];
      bars = i - j;
    }
  }
  return { bars, value: peak };
}

/** LLVBARS：从 lookbackBars 根前到今日的最低价距今天数 */
function llvBarsAt(arr, lookbackBars, i) {
  if (lookbackBars <= 0) return { bars: 0, value: arr[i] };
  const from = Math.max(0, i - lookbackBars);
  let trough = Infinity;
  let bars = 0;
  for (let j = from; j <= i; j++) {
    if (arr[j] <= trough) {
      trough = arr[j];
      bars = i - j;
    }
  }
  return { bars, value: trough };
}

/**
 * 近 window 日内：从最高价到其后最低价的回撤，且窗口内各节点回撤均不超过 maxRatio
 * 对应 COUNT(回撤幅度>maxRatio, 新高天数)=0 的简化实现
 */
function maxPullbackOk(highs, lows, i, window, maxRatio) {
  const { bars: highBars, value: highPrice } = hhvBarsAt(highs, window, i);
  if (!(highPrice > 0)) return { ok: false, pullback: 1 };
  const { value: lowPrice } = llvBarsAt(lows, highBars, i);
  const pullback = (highPrice - lowPrice) / highPrice;
  if (pullback > maxRatio) return { ok: false, pullback };

  // 从新高日走到今日，任一日相对该窗内高点的回撤超限则否
  const from = i - highBars;
  let peak = highs[from];
  for (let j = from; j <= i; j++) {
    if (highs[j] >= peak) peak = highs[j];
    const dd = peak > 0 ? (peak - lows[j]) / peak : 0;
    if (dd > maxRatio) return { ok: false, pullback: dd };
  }
  return { ok: true, pullback };
}

function countCloseAboveMa(closes, maArr, lookback, i) {
  let n = 0;
  let valid = 0;
  for (let d = 0; d < lookback; d++) {
    const idx = i - d;
    if (idx < 0 || maArr[idx] == null) continue;
    valid++;
    if (closes[idx] > maArr[idx]) n++;
  }
  return { n, valid };
}

function everyMaRising(maArr, lookback, i) {
  for (let d = 0; d < lookback; d++) {
    const idx = i - d;
    if (idx < 1 || maArr[idx] == null || maArr[idx - 1] == null) return false;
    if (maArr[idx] < maArr[idx - 1]) return false;
  }
  return true;
}

function everyMa10AboveMa20(ma10, ma20, lookback, i) {
  for (let d = 0; d < lookback; d++) {
    const idx = i - d;
    if (idx < 0 || ma10[idx] == null || ma20[idx] == null) return false;
    if (ma10[idx] < ma20[idx]) return false;
  }
  return true;
}

/**
 * 火车每日观察（250706 MRGC）
 * MRGC := 换手<25% AND 120日回撤≤50%且价>年高70% AND (XG1|XG2|XG3|XG4)
 */
export function evalDailyObserve(klines, rps, turnover) {
  if (!klines || klines.length < 120) {
    return { hit: false, reason: 'K线不足' };
  }
  const highs = klines.map((k) => k.high);
  const lows = klines.map((k) => k.low);
  const closes = klines.map((k) => k.close);
  const i = klines.length - 1;
  const rps120 = rps.rps120 ?? 0;
  const rps250 = rps.rps250 ?? 0;
  const rps50 = rps.rps50 ?? 0;
  const turn = turnover ?? klines[i].turnover ?? 0;

  // MRGC00: 日换手 < 25%
  const mrgc00 = turn < 25;

  const win120 = Math.min(120, i + 1);
  const pb50 = maxPullbackOk(highs, lows, i, win120, 0.5);
  const hhvC250 = hhv(closes, Math.min(250, closes.length));
  const hhvH250 = hhv(highs, Math.min(250, highs.length));

  // MRGC01: 120日最大回撤≤50% 且 C/HHV(C,250)>0.7
  const mrgc002 = hhvC250 > 0 && closes[i] / hhvC250 > 0.7;
  const mrgc01 = pb50.ok && mrgc002;

  // MRGC回撤HC: 120日回撤≤35% 且 C/HHV(C,250)>0.8
  const pb35 = maxPullbackOk(highs, lows, i, win120, 0.35);
  const mrgc004 = hhvC250 > 0 && closes[i] / hhvC250 > 0.8;
  const mrgc回撤HC = pb35.ok && mrgc004;

  // XG11: 近5日至少1日收盘 = 250日最高收盘
  let xg11 = false;
  for (let d = 0; d < 5 && i - d >= 0; d++) {
    if (hhvC250 > 0 && closes[i - d] >= hhvC250 * 0.9999) {
      xg11 = true;
      break;
    }
  }
  // XG12: RPS120>95.99 OR RPS250>95.99
  const xg12 = rps120 > 95.99 || rps250 > 95.99;
  // XG13: RPS120>94.99 AND RPS50>94.99
  const xg13 = rps120 > 94.99 && rps50 > 94.99;
  const xg1 = xg11 && (xg12 || xg13);

  // XG2: C/HHV(H,250)>=0.85 且 (RPS120>96.99 OR RPS250>96.99)
  const xg2 = hhvH250 > 0 && closes[i] / hhvH250 >= 0.85 && (rps120 > 96.99 || rps250 > 96.99);

  // XG3: C/HHV(H,250)>=0.70 且 (RPS120>97.99 OR RPS250>97.99)
  const xg3 = hhvH250 > 0 && closes[i] / hhvH250 >= 0.7 && (rps120 > 97.99 || rps250 > 97.99);

  // XG4: 回撤紧凑(≤35%+价>年高80%) 且 (RPS120>94.99 OR RPS250>94.99)
  const xg4 = mrgc回撤HC && (rps120 > 94.99 || rps250 > 94.99);

  const hit = !!(mrgc00 && mrgc01 && (xg1 || xg2 || xg3 || xg4));
  const parts = [];
  if (xg1) parts.push('近5日收盘年高+高RPS');
  if (xg2) parts.push('价≥年高85%+极高RPS');
  if (xg3) parts.push('价≥年高70%+超高RPS');
  if (xg4) parts.push('120日回撤≤35%+高RPS');
  if (!mrgc00) parts.push('换手≥25%剔除');
  if (!mrgc01) parts.push('120日回撤/年高位置未达标');

  return {
    hit,
    reason: hit ? parts.filter((p) => !p.includes('剔除') && !p.includes('未达标')).join('；') || '火车每日观察' : parts.join('；') || '未满足火车每日观察',
    detail: {
      xg1,
      xg2,
      xg3,
      xg4,
      mrgc00,
      mrgc01,
      pullback120: +pb50.pullback.toFixed(3),
      rps50,
      rps120,
      rps250,
      turn: +(+turn).toFixed(2),
    },
  };
}

/**
 * 顺向火车轨 3.0（含 250706：换手<15% + 120日回撤≤50%）
 * SXHCG := RPS强度 AND 站稳均线 AND 回撤可控 AND 均线顺向 AND 换手 AND 中期回撤
 */
export function evalForwardTrain(klines, rps, turnover) {
  if (!klines || klines.length < 250) {
    return { hit: false, reason: 'K线不足(需≥250日)' };
  }
  const highs = klines.map((k) => k.high);
  const lows = klines.map((k) => k.low);
  const closes = klines.map((k) => k.close);
  const i = closes.length - 1;
  const turn = turnover ?? klines[i].turnover ?? 0;
  const rps120 = rps.rps120 ?? 0;
  const rps250 = rps.rps250 ?? 0;

  const ma10 = sma(closes, 10);
  const ma20 = sma(closes, 20);
  const ma200 = sma(closes, 200);
  const ma250 = sma(closes, 250);

  // SXHCG1: RPS120+RPS250 > 185
  const sxhcg1 = rps120 + rps250 > 185;

  // SXHCG20: C > MA20
  const sxhcg20 = ma20[i] != null && closes[i] > ma20[i];

  // SXHCG21/22: 近30日收盘在 MA250/MA200 上方至少25天
  const c250 = countCloseAboveMa(closes, ma250, 30, i);
  const c200 = countCloseAboveMa(closes, ma200, 30, i);
  const sxhcg21 = c250.n >= 25;
  const sxhcg22 = c200.n >= 25;

  // SXHCG23: 近10日收盘在 MA20 上方至少9天
  const c20_10 = countCloseAboveMa(closes, ma20, 10, i);
  const sxhcg23 = c20_10.n >= 9;

  // SXHCG24: 近4日收盘在 MA10 与 MA20 上方均至少3天
  const c10_4 = countCloseAboveMa(closes, ma10, 4, i);
  const c20_4 = countCloseAboveMa(closes, ma20, 4, i);
  const sxhcg24 = c10_4.n >= 3 && c20_4.n >= 3;

  const sxhcg2 = sxhcg20 && sxhcg21 && sxhcg22 && (sxhcg23 || sxhcg24);

  // SXHCG3: 近20日最大回撤≤25% 且 C/HHV(C,250)>0.8
  const pb20 = maxPullbackOk(highs, lows, i, Math.min(20, i + 1), 0.25);
  const hhvC250 = hhv(closes, Math.min(250, closes.length));
  const sxhcg32 = hhvC250 > 0 && closes[i] / hhvC250 > 0.8;
  const sxhcg3 = pb20.ok && sxhcg32;

  // SXHCG41: 近5日 MA20 一直上升 且 MA10 一直 ≥ MA20
  const sxhcg41 = everyMaRising(ma20, 5, i) && everyMa10AboveMa20(ma10, ma20, 5, i);
  // SXHCG42: 当日 MA10↑ MA20↑ 且 MA10≥MA20
  const sxhcg42 =
    ma10[i] != null &&
    ma10[i - 1] != null &&
    ma20[i] != null &&
    ma20[i - 1] != null &&
    ma10[i] >= ma10[i - 1] &&
    ma20[i] >= ma20[i - 1] &&
    ma10[i] >= ma20[i];
  const sxhcg4 = sxhcg41 || sxhcg42;

  // SXHCG5: 换手 < 15%（250706 合并版；3.0 原文为 <10%）
  const sxhcg5 = turn < 15;

  // SXHCG6: 120日最大回撤 ≤ 50%
  const pb120 = maxPullbackOk(highs, lows, i, Math.min(120, i + 1), 0.5);
  const sxhcg6 = pb120.ok;

  const hit = !!(sxhcg1 && sxhcg2 && sxhcg3 && sxhcg4 && sxhcg5 && sxhcg6);
  const parts = [];
  if (!sxhcg1) parts.push(`RPS120+250=${(rps120 + rps250).toFixed(1)}≤185`);
  if (!sxhcg2) parts.push('未站稳中长期均线');
  if (!sxhcg3) parts.push('20日回撤或年高位置未达标');
  if (!sxhcg4) parts.push('均线未顺向');
  if (!sxhcg5) parts.push('换手≥15%');
  if (!sxhcg6) parts.push('120日回撤>50%');

  const belowMa10 = ma10[i] != null && closes[i] < ma10[i];
  const yearHighRight = hhvC250 > 0 && closes[i] >= hhvC250 * 0.9999;

  return {
    hit,
    reason: hit
      ? `顺向火车轨(RPS合计${(rps120 + rps250).toFixed(0)}${belowMa10 ? '·偏好10日线下买点' : ''}${yearHighRight ? '·右侧年高' : ''})`
      : parts.join('；') || '未满足顺向火车轨',
    detail: {
      sxhcg1,
      sxhcg2,
      sxhcg3,
      sxhcg4,
      sxhcg5,
      sxhcg6,
      rps120,
      rps250,
      rpsSum: +(rps120 + rps250).toFixed(2),
      pullback20: +pb20.pullback.toFixed(3),
      pullback120: +pb120.pullback.toFixed(3),
      belowMa10,
      yearHighRight,
      turn: +(+turn).toFixed(2),
    },
  };
}

/**
 * 基底计数（241005「第一个或第二个基底」）
 * 从新高回落 minDrop 以上视为进入一个基底，收盘重新突破前高视为该基底结束。
 * 第 3 个及以上基底，文章建议谨慎。
 */
export function countBases(klines, { minDrop = 0.18 } = {}) {
  if (!klines?.length) return { baseCount: 0, inBase: false, drawdown: 0 };
  const highs = klines.map((k) => k.high);
  const lows = klines.map((k) => k.low);
  const closes = klines.map((k) => k.close);

  let peak = highs[0];
  let baseCount = 0;
  let inBase = false;
  let baseLow = Infinity;
  let lastBaseDrop = 0;

  for (let i = 1; i < klines.length; i++) {
    if (!inBase) {
      if (highs[i] > peak) peak = highs[i];
      if (peak > 0 && (peak - lows[i]) / peak >= minDrop) {
        inBase = true;
        baseCount++;
        baseLow = lows[i];
      }
    } else {
      if (lows[i] < baseLow) baseLow = lows[i];
      if (closes[i] > peak) {
        lastBaseDrop = peak > 0 ? (peak - baseLow) / peak : 0;
        inBase = false;
        peak = highs[i];
        baseLow = Infinity;
      }
    }
  }

  const i = klines.length - 1;
  const drawdown = peak > 0 ? (peak - closes[i]) / peak : 0;
  const baseDrop = inBase && peak > 0 ? (peak - baseLow) / peak : lastBaseDrop;

  return {
    baseCount,
    inBase,
    drawdown: +drawdown.toFixed(3),
    baseDrop: +baseDrop.toFixed(3),
  };
}

/**
 * 241005 择股思路（个股思路一 + 思路二，原文「每日观察选股」）
 *   XG1 = 近5日内最高价创250日新高 AND (RPS120>96 OR RPS250>96)   —— 率先一年新高
 *   XG2 = C/HHV(H,250)>=0.5      AND (RPS120>98 OR RPS250>98)   —— 深度调整后开始回升
 *   XG3 = 日换手 < 20%
 *   命中 = (XG1 OR XG2) AND XG3，前提是 RPS120 或 RPS250 ≥ 95
 *
 * indexCanBuy=false（熊市/无指数中期信号）时，原文提醒一年新高多为假突破，此处只降级为观察。
 */
export function evalTaoPick241005(klines, rps, turnover, { indexCanBuy = true } = {}) {
  if (!klines || klines.length < 120) {
    return { hit: false, reason: 'K线不足', via: [] };
  }
  const highs = klines.map((k) => k.high);
  const closes = klines.map((k) => k.close);
  const i = klines.length - 1;
  const rps120 = rps.rps120 ?? 0;
  const rps250 = rps.rps250 ?? 0;
  const turn = turnover ?? klines[i].turnover ?? 0;

  // 第一优先原则：RPS250 或 RPS120 至少 95
  const rpsBase = Math.max(rps120, rps250);
  const premiseOk = rpsBase >= 95;

  const hhvH250 = hhv(highs, Math.min(250, highs.length));

  // XG11：近5日内至少1日最高价 = 250日最高价
  let xg11 = false;
  let yearHighBarsAgo = null;
  for (let d = 0; d < 5 && i - d >= 0; d++) {
    if (hhvH250 > 0 && highs[i - d] >= hhvH250 * 0.9999) {
      xg11 = true;
      yearHighBarsAgo = d;
      break;
    }
  }
  const xg12 = rps120 > 96 || rps250 > 96;
  const xg1 = xg11 && xg12;

  // XG21：收盘价 ≥ 一年最高价的 50%（深调但已开始回升）
  const priceRatio = hhvH250 > 0 ? closes[i] / hhvH250 : 0;
  const xg21 = priceRatio >= 0.5;
  const xg22 = rps120 > 98 || rps250 > 98;
  const xg2 = xg21 && xg22;

  // XG3：换手率 < 20%（超过多为游资票）
  const xg3 = turn < 20;

  const bases = countBases(klines);
  const via = [];
  if (xg1) via.push('率先年新高');
  if (xg2 && !xg1) via.push('深调高RPS回升');

  const hit = !!(premiseOk && (xg1 || xg2) && xg3);
  // 一年新高思路在没有指数中期信号时容易假突破，降级为观察
  const weakBreakout = xg1 && !xg2 && !indexCanBuy;

  const notes = [];
  if (!premiseOk) notes.push(`RPS120/250 最高仅${rpsBase.toFixed(0)}，未达95前提`);
  if (!xg3) notes.push(`换手${(+turn).toFixed(1)}%≥20%，游资票剔除`);
  if (hit && bases.baseCount >= 3) notes.push(`已是第${bases.baseCount}个基底，文章建议谨慎`);
  if (weakBreakout) notes.push('无指数中期信号，年新高需防假突破');

  const reason = hit
    ? `${via.join('+')}（RPS120=${rps120.toFixed(0)}/RPS250=${rps250.toFixed(0)}${
        bases.baseCount ? `·第${bases.baseCount}基底` : ''
      }）${notes.length ? `｜${notes.join('；')}` : ''}`
    : notes.join('；') || '未满足241005择股思路';

  return {
    hit,
    via,
    reason,
    weakBreakout,
    detail: {
      premiseOk,
      xg1,
      xg2,
      xg3,
      rps120,
      rps250,
      rpsBase: +rpsBase.toFixed(2),
      priceRatio: +priceRatio.toFixed(3),
      yearHighBarsAgo,
      baseCount: bases.baseCount,
      baseDrop: bases.baseDrop,
      drawdown: bases.drawdown,
      turn: +(+turn).toFixed(2),
    },
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

  const win = Math.min(20, highs.length);
  let zcHighBars = 0;
  let peak = -Infinity;
  for (let j = i - win + 1; j <= i; j++) {
    if (highs[j] >= peak) {
      peak = highs[j];
      zcHighBars = i - j;
    }
  }
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
export function applyTaoBoost(scoreResult, { daily, diamond, train, pick241005, board } = {}) {
  let score = scoreResult.score;
  const reasons = [...(scoreResult.reasons || [])];
  const tags = [];

  if (train?.hit) {
    score += 20;
    reasons.push(`顺向火车轨：${train.reason}`);
    tags.push('顺向火车轨');
  }
  if (daily?.hit) {
    score += 18;
    reasons.push(`火车每日观察：${daily.reason}`);
    tags.push('每日观察');
  }
  if (diamond?.hit) {
    score += 14;
    reasons.push(`蓝色钻石：${diamond.reason}`);
    tags.push('蓝色钻石');
  }

  if (pick241005?.hit) {
    if (pick241005.via.includes('率先年新高')) {
      score += pick241005.weakBreakout ? 8 : 16;
      tags.push('率先年新高');
    }
    if (pick241005.via.includes('深调高RPS回升')) {
      score += 12;
      tags.push('深调高RPS回升');
    }
    reasons.push(`241005择股：${pick241005.reason}`);
    if (pick241005.detail?.baseCount >= 3) score -= 8;
  }

  // 主流板块优先（板块指数 RPS5）
  if (board?.rps5 != null) {
    if (board.rps5 >= 90) {
      score += 10;
      reasons.push(`主流板块：${board.name} 板块RPS5=${board.rps5.toFixed(0)}`);
      tags.push('主流板块');
    } else if (board.rps5 >= 80) {
      score += 6;
      reasons.push(`强势板块：${board.name} 板块RPS5=${board.rps5.toFixed(0)}`);
    } else if (board.rps5 <= 30) {
      score -= 4;
      reasons.push(`板块偏弱：${board.name} 板块RPS5=${board.rps5.toFixed(0)}`);
    }
  }

  return {
    ...scoreResult,
    score,
    reasons,
    taoTags: tags,
    dailyObserve: daily,
    blueDiamond: diamond,
    forwardTrain: train || null,
    pick241005: pick241005 || null,
    board: board || null,
  };
}
