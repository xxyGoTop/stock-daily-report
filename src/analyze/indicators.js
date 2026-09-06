/**
 * 技术指标：MA / MACD / KDJ / RSI / 量能 / 乖离
 */

export function sma(values, period) {
  const out = Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values, period) {
  const out = Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) continue;
    if (prev == null) {
      // 用前 period 个 SMA 初始化更稳
      if (i < period - 1) continue;
      let s = 0;
      for (let j = i - period + 1; j <= i; j++) s += values[j];
      prev = s / period;
      out[i] = prev;
    } else {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

export function macd(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const dif = closes.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
  );
  const dea = ema(
    dif.map((v) => (v == null ? 0 : v)),
    signal
  );
  // 修正：dea 只在 dif 有效区间有意义
  const deaFixed = dif.map((v, i) => (v == null ? null : dea[i]));
  const hist = dif.map((v, i) =>
    v != null && deaFixed[i] != null ? (v - deaFixed[i]) * 2 : null
  );
  return { dif, dea: deaFixed, hist };
}

export function kdj(klines, n = 9, m1 = 3, m2 = 3) {
  const len = klines.length;
  const kArr = Array(len).fill(null);
  const dArr = Array(len).fill(null);
  const jArr = Array(len).fill(null);
  let k = 50;
  let d = 50;
  for (let i = 0; i < len; i++) {
    if (i < n - 1) continue;
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i - n + 1; j <= i; j++) {
      highest = Math.max(highest, klines[j].high);
      lowest = Math.min(lowest, klines[j].low);
    }
    const rsv = highest === lowest ? 50 : ((klines[i].close - lowest) / (highest - lowest)) * 100;
    k = (rsv + (m1 - 1) * k) / m1;
    d = (k + (m2 - 1) * d) / m2;
    const j = 3 * k - 2 * d;
    kArr[i] = k;
    dArr[i] = d;
    jArr[i] = j;
  }
  return { k: kArr, d: dArr, j: jArr };
}

export function rsi(closes, period = 6) {
  const out = Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/** 乖离率 %：(price - ma) / ma * 100 */
export function bias(price, ma) {
  if (!ma) return null;
  return ((price - ma) / ma) * 100;
}

/** 近 N 日成交量是否温和放大（避免单日暴量后萎缩） */
export function isGentleVolumeExpansion(volumes, lookback = 5) {
  if (volumes.length < lookback) return false;
  const recent = volumes.slice(-lookback);
  const first = recent[0] || 1;
  const last = recent[lookback - 1];
  // 整体抬升，且最大日不超过均值 2.8 倍（过滤暴量派发）
  const avg = recent.reduce((a, b) => a + b, 0) / lookback;
  const max = Math.max(...recent);
  const rising = last > first * 1.05 && last >= avg * 0.9;
  const notSpikeDump = max <= avg * 2.8;
  return rising && notSpikeDump;
}

/** MA 是否向上倾斜（比较今日与 3 日前） */
export function isMaRising(maArr, lookback = 3) {
  const i = maArr.length - 1;
  if (i < lookback || maArr[i] == null || maArr[i - lookback] == null) return false;
  return maArr[i] > maArr[i - lookback];
}

/** 近 N 日是否出现「死叉后又快速金叉」的反复缠绕（不稳定） */
export function hasUnstableCross(maShort, maLong, lookback = 10) {
  const start = Math.max(1, maShort.length - lookback);
  let deathThenGolden = 0;
  let lastCross = null; // 'golden' | 'death'
  for (let i = start; i < maShort.length; i++) {
    if (maShort[i] == null || maLong[i] == null || maShort[i - 1] == null || maLong[i - 1] == null)
      continue;
    const prev = maShort[i - 1] - maLong[i - 1];
    const cur = maShort[i] - maLong[i];
    if (prev <= 0 && cur > 0) {
      if (lastCross === 'death') deathThenGolden++;
      lastCross = 'golden';
    } else if (prev >= 0 && cur < 0) {
      lastCross = 'death';
    }
  }
  // 「反复」至少两轮死叉→金叉；单次回抽穿越不算缠绕
  return deathThenGolden >= 2;
}

/** 近 N 日连续涨停次数（近似：涨幅>=9.5%） */
export function consecutiveLimitUps(klines, lookback = 5) {
  let count = 0;
  for (let i = klines.length - 1; i >= Math.max(0, klines.length - lookback); i--) {
    if (klines[i].changePct >= 9.5) count++;
    else break;
  }
  return count;
}

export function computeIndicators(klines) {
  const closes = klines.map((k) => k.close);
  const volumes = klines.map((k) => k.volume);
  const ma5 = sma(closes, 5);
  const ma10 = sma(closes, 10);
  const ma20 = sma(closes, 20);
  const { dif, dea, hist } = macd(closes);
  const { k, d, j } = kdj(klines);
  const rsi6 = rsi(closes, 6);
  const i = closes.length - 1;
  const prev = i - 1;

  const price = closes[i];
  const bias5 = bias(price, ma5[i]);
  const bias10 = bias(price, ma10[i]);
  const bias20 = bias(price, ma20[i]);

  const macdGolden =
    prev >= 0 &&
    dif[prev] != null &&
    dea[prev] != null &&
    dif[i] != null &&
    dea[i] != null &&
    dif[prev] <= dea[prev] &&
    dif[i] > dea[i];

  // 绿柱缩小：柱值为负，且绝对值在缩小（向零轴收敛，常作转强前兆）
  const macdGreenShrinking =
    prev >= 0 &&
    hist[i] != null &&
    hist[prev] != null &&
    hist[i] < 0 &&
    hist[prev] < 0 &&
    hist[i] > hist[prev]; // -0.3 > -0.5 → 绿柱缩短

  // 绿柱缩小后金叉：近期绿柱曾缩短，且今日金叉（或接近金叉）
  const macdNearGolden =
    prev >= 0 &&
    dif[i] != null &&
    dea[i] != null &&
    Math.abs(dif[i] - dea[i]) < Math.abs((dif[prev] ?? 0) - (dea[prev] ?? 0)) &&
    dif[i] <= dea[i] &&
    dif[i] > (dif[prev] ?? dif[i]);

  const macdHistExpanding =
    prev >= 0 && hist[i] != null && hist[prev] != null && hist[i] > 0 && hist[i] > hist[prev];

  // 近3日是否出现绿柱连续缩短
  let greenShrinkDays = 0;
  for (let k = 0; k < 3; k++) {
    const a = i - k;
    const b = a - 1;
    if (b < 0 || hist[a] == null || hist[b] == null) break;
    if (hist[a] < 0 && hist[b] < 0 && hist[a] > hist[b]) greenShrinkDays++;
    else break;
  }

  const biasLevel =
    bias5 == null
      ? '未知'
      : bias5 > 8
        ? '严重正乖离(追高风险)'
        : bias5 > 5
          ? '偏大正乖离'
          : bias5 >= 0
            ? '温和正乖离'
            : bias5 >= -3
              ? '贴近均线/小负乖离'
              : bias5 >= -6
                ? '负乖离回撤'
                : '大幅负乖离';

  const kdjGolden =
    prev >= 0 &&
    k[prev] != null &&
    d[prev] != null &&
    k[i] != null &&
    d[i] != null &&
    k[prev] <= d[prev] &&
    k[i] > d[i];

  /** 固定展示字段：乖离偏离 + MACD绿柱/金叉 */
  const signalBoard = {
    bias5: bias5 == null ? null : +bias5.toFixed(2),
    bias10: bias10 == null ? null : +bias10.toFixed(2),
    bias20: bias20 == null ? null : +bias20.toFixed(2),
    biasLevel,
    biasText:
      bias5 == null
        ? '乖离：数据不足'
        : `乖离MA5 ${bias5 >= 0 ? '+' : ''}${bias5.toFixed(2)}%（${biasLevel}）` +
          (bias10 != null ? `｜MA10 ${bias10 >= 0 ? '+' : ''}${bias10.toFixed(2)}%` : ''),
    macdHist: hist[i] == null ? null : +hist[i].toFixed(4),
    macdDif: dif[i] == null ? null : +dif[i].toFixed(4),
    macdDea: dea[i] == null ? null : +dea[i].toFixed(4),
    macdGolden,
    macdGreenShrinking,
    macdNearGolden,
    greenShrinkDays,
    macdText: (() => {
      if (hist[i] == null) return 'MACD：数据不足';
      const parts = [];
      if (macdGolden) parts.push('金叉确认');
      else if (macdNearGolden && macdGreenShrinking) parts.push('绿柱缩小且向金叉收敛');
      else if (macdGreenShrinking) parts.push(`绿柱缩小(${greenShrinkDays}日)`);
      else if (hist[i] < 0) parts.push('仍处绿柱');
      else if (macdHistExpanding) parts.push('红柱放大');
      else parts.push('红柱运行');
      parts.push(`柱值${hist[i].toFixed(3)}`);
      return `MACD：${parts.join(' · ')}`;
    })(),
  };

  return {
    price,
    ma5: ma5[i],
    ma10: ma10[i],
    ma20: ma20[i],
    ma5Rising: isMaRising(ma5),
    ma10Rising: isMaRising(ma10),
    bullAlign: ma5[i] != null && ma10[i] != null && ma20[i] != null && ma5[i] > ma10[i] && ma10[i] > ma20[i],
    aboveMa5: ma5[i] != null && price >= ma5[i],
    brokenMa5: ma5[i] != null && price < ma5[i],
    bias5,
    bias10,
    bias20,
    dif: dif[i],
    dea: dea[i],
    hist: hist[i],
    macdAboveZero: dif[i] != null && dif[i] > 0,
    macdGolden,
    macdGreenShrinking,
    macdNearGolden,
    greenShrinkDays,
    macdHistExpanding,
    signalBoard,
    k: k[i],
    d: d[i],
    j: j[i],
    kdjGolden,
    kdjAbove50: k[i] != null && k[i] >= 50,
    rsi6: rsi6[i],
    gentleVolume: isGentleVolumeExpansion(volumes),
    unstableTrend: hasUnstableCross(ma5, ma10, 10),
    limitUpStreak: consecutiveLimitUps(klines, 5),
    lastChangePct: klines[i]?.changePct ?? 0,
    lastTurnover: klines[i]?.turnover ?? 0,
    lastVolume: volumes[i] ?? 0,
    prevVolume: volumes[prev] ?? 0,
  };
}
