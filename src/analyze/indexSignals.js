/**
 * 指数是否可买 / 中期信号（陶博士公开规则近似实现）
 * + 重点 ETF 技术线买卖（沪深300 / 半导体设备 / 创新药）
 *
 * 早期公开条件：指数站上10周均线 + 有主流热点板块
 * 后续融合：海龟/四周规则（突破20日高点）、多指数互相确认
 *
 * 日线近似：10周均线 ≈ MA50；周线确认用 MA50 向上
 */

import { fetchKlines } from '../crawl/eastmoney.js';
import { sma, isMaRising, computeIndicators } from './indicators.js';
import { fetchSectorLeaders } from './marketTheme.js';

const INDEX_LIST = [
  { code: '000001', name: '上证指数' },
  { code: '399001', name: '深证成指' },
  { code: '399106', name: '深证综指' },
  { code: '399006', name: '创业板指' },
  { code: '000300', name: '沪深300' },
  { code: '399005', name: '中小板指' },
  { code: '000016', name: '上证50' },
];

/** 用户关注的可交易 ETF（技术线买卖） */
const ETF_LIST = [
  { code: '510300', name: '沪深300ETF', theme: '宽基' },
  { code: '159516', name: '半导体设备ETF', theme: '半导体设备' },
  { code: '517120', name: '创新药ETF', theme: '创新药' },
];

function hhv(values, n) {
  return Math.max(...values.slice(-n));
}

function llv(values, n) {
  return Math.min(...values.slice(-n));
}

function analyzeOneIndex(klines, meta) {
  const closes = klines.map((k) => k.close);
  const highs = klines.map((k) => k.high);
  const i = closes.length - 1;
  if (i < 55) {
    return {
      ...meta,
      signal: 'none',
      canBuy: false,
      strength: 0,
      reasons: ['K线不足'],
    };
  }

  const ma10 = sma(closes, 10);
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50); // ≈10周
  const price = closes[i];
  const reasons = [];
  let strength = 0;

  const aboveMa50 = ma50[i] != null && price > ma50[i];
  const ma50Up = isMaRising(ma50, 5);
  const aboveMa10 = ma10[i] != null && price > ma10[i];
  const ma10Up = isMaRising(ma10, 3);
  const aboveMa20 = ma20[i] != null && price > ma20[i];

  const high20Prev = hhv(highs.slice(0, -1), Math.min(20, highs.length - 1));
  const breakout20 = price >= high20Prev;
  const nearBreakout = price >= high20Prev * 0.985;

  if (aboveMa50) {
    strength += 35;
    reasons.push('站上10周线(MA50)');
  } else {
    reasons.push('未站上10周线');
  }
  if (ma50Up) {
    strength += 15;
    reasons.push('10周线向上');
  }
  if (aboveMa10 && ma10Up) {
    strength += 15;
    reasons.push('沿10日线强势');
  }
  if (breakout20) {
    strength += 25;
    reasons.push('突破20日高点(四周规则)');
  } else if (nearBreakout) {
    strength += 10;
    reasons.push('逼近20日高点');
  }
  if (aboveMa20) {
    strength += 10;
    reasons.push('站上20日线');
  }

  const brokenMa50 = ma50[i] != null && price < ma50[i];
  if (brokenMa50 && !ma10Up) {
    strength = Math.min(strength, 25);
    reasons.push('收盘低于10周线，中期偏谨慎');
  }

  let signal = 'none';
  let canBuy = false;
  if (aboveMa50 && (breakout20 || (aboveMa10 && ma10Up))) {
    signal = 'buy';
    canBuy = true;
  } else if (aboveMa50 || nearBreakout) {
    signal = 'watch';
    canBuy = false;
  } else if (brokenMa50) {
    signal = 'avoid';
    canBuy = false;
  }

  return {
    ...meta,
    signal,
    canBuy,
    strength: Math.min(100, strength),
    price: +price.toFixed(3),
    changePct: klines[i].changePct ?? null,
    ma10: ma10[i] != null ? +ma10[i].toFixed(3) : null,
    ma50: ma50[i] != null ? +ma50[i].toFixed(3) : null,
    reasons,
    asOf: klines[i].date,
  };
}

/**
 * ETF 技术线：五日/十日/二十日 + MACD/乖离 → 买入/卖出区间与操作
 */
function analyzeEtfTech(klines, meta) {
  const base = analyzeOneIndex(klines, meta);
  if (klines.length < 30) {
    return {
      ...base,
      kind: 'etf',
      action: '数据不足',
      techLine: 'K线不足',
      buyPrice: null,
      sellPrice: null,
      buyReason: '暂无法计算',
      sellReason: '暂无法计算',
    };
  }

  const ind = computeIndicators(klines);
  const closes = klines.map((k) => k.close);
  const highs = klines.map((k) => k.high);
  const lows = klines.map((k) => k.low);
  const i = closes.length - 1;
  const price = closes[i];
  const ma5 = ind.ma5;
  const ma10 = ind.ma10;
  const ma20 = ind.ma20;

  const reasons = [...(base.reasons || [])];
  if (ind.macdGolden) reasons.push('MACD金叉');
  else if (ind.macdGreenShrinking) reasons.push('MACD绿柱缩小');
  else if (ind.macdHistExpanding) reasons.push('MACD红柱放大');
  if (ind.bias5 != null) {
    reasons.push(`乖离MA5 ${ind.bias5 >= 0 ? '+' : ''}${ind.bias5.toFixed(2)}%`);
  }

  // 技术线状态
  let techLine = '震荡';
  if (ind.bullAlign && ind.aboveMa5 && ind.ma5Rising) techLine = '多头沿五日线上行';
  else if (ind.aboveMa5 && ind.ma5Rising) techLine = '站上五日线向上';
  else if (price > ma10 && isMaRising(sma(closes, 10))) techLine = '站上十日线';
  else if (price > ma20) techLine = '站上二十日线、五日偏弱';
  else if (ind.brokenMa5) techLine = '跌破五日线偏弱';
  else techLine = '均线纠缠震荡';

  // 买卖价：回踩 MA5~MA10 低吸；止损破 MA5/近低；目标近高或 +5%
  const buyLow = Math.min(ma5 || price, ma10 || price) * 0.995;
  const buyHigh = Math.max(ma5 || price, (ma5 + ma10) / 2 || price);
  const stop = Math.min(llv(lows, 5), (ma5 || price) * 0.985);
  const target = Math.max(hhv(highs, 20), price * 1.05);

  let action = '观望';
  let signal = base.signal;
  let canBuy = base.canBuy;

  if (ind.brokenMa5 && (ind.lastVolume > ind.prevVolume * 1.15 || price < ma10)) {
    action = '卖出/减仓';
    signal = 'sell';
    canBuy = false;
    reasons.unshift('放量或有效跌破五日/十日线');
  } else if (
    ind.bullAlign &&
    ind.aboveMa5 &&
    ind.ma5Rising &&
    ind.bias5 != null &&
    ind.bias5 <= 5 &&
    (ind.macdGolden || ind.macdGreenShrinking || ind.macdHistExpanding || base.canBuy)
  ) {
    action = '买入/回踩低吸';
    signal = 'buy';
    canBuy = true;
  } else if (ind.aboveMa5 && ind.ma5Rising && ind.bias5 != null && ind.bias5 < 3) {
    action = '轻仓试错/观察';
    signal = 'watch';
    canBuy = false;
  } else if (base.signal === 'avoid' || (!ind.aboveMa5 && price < ma20)) {
    action = '回避/等待企稳';
    signal = 'avoid';
    canBuy = false;
  } else {
    action = '观望';
    signal = 'watch';
  }

  const buyPrice = `${buyLow.toFixed(3)} ~ ${buyHigh.toFixed(3)}`;
  const sellPrice = `止损 ${stop.toFixed(3)} / 目标 ${target.toFixed(3)}`;

  return {
    ...base,
    ...meta,
    kind: 'etf',
    signal,
    canBuy,
    action,
    techLine,
    strength: Math.min(100, base.strength + (ind.macdGolden ? 8 : 0)),
    price: +price.toFixed(3),
    changePct: klines[i].changePct ?? null,
    ma5: ma5 != null ? +ma5.toFixed(3) : null,
    ma10: ma10 != null ? +ma10.toFixed(3) : null,
    ma20: ma20 != null ? +ma20.toFixed(3) : null,
    bias5: ind.bias5 != null ? +ind.bias5.toFixed(2) : null,
    macdText: ind.signalBoard?.macdText || '',
    biasText: ind.signalBoard?.biasText || '',
    buyPrice,
    sellPrice,
    buyReason:
      action.includes('买入')
        ? `技术线「${techLine}」：回踩 ${buyPrice} 分批；${reasons.slice(0, 3).join('；')}`
        : `暂不追高：${techLine}；若介入仅看 ${buyPrice}`,
    sellReason:
      action.includes('卖出')
        ? `触发离场：${reasons[0] || techLine}；止损参考 ${stop.toFixed(3)}`
        : `持仓纪律：跌破五日线或 ${stop.toFixed(3)} 减仓；强势可看到 ${target.toFixed(3)}`,
    reasons: reasons.slice(0, 6),
    asOf: klines[i].date,
  };
}

/**
 * @returns {{
 *   marketCanBuy: boolean,
 *   marketSignal: 'buy'|'watch'|'avoid'|'none',
 *   summary: string,
 *   hotSectors: array,
 *   indices: array,
 *   etfs: array,
 *   buyCount: number
 * }}
 */
export async function analyzeIndexBuySignals({ onProgress } = {}) {
  onProgress?.('分析指数中期可买信号...');
  let hotSectors = [];
  try {
    hotSectors = await fetchSectorLeaders({ pageSize: 8 });
  } catch {
    hotSectors = [];
  }
  const hotOk = hotSectors.some((s) => s.changePct >= 1.5);

  const indices = [];
  for (const meta of INDEX_LIST) {
    try {
      const kl = await fetchKlines(meta.code, { limit: 120 });
      indices.push(analyzeOneIndex(kl, meta));
    } catch {
      indices.push({
        ...meta,
        signal: 'none',
        canBuy: false,
        strength: 0,
        reasons: ['拉取失败'],
      });
    }
  }

  onProgress?.('分析重点ETF技术线买卖（300/半导体设备/创新药）...');
  const etfs = [];
  for (const meta of ETF_LIST) {
    try {
      const kl = await fetchKlines(meta.code, { limit: 120 });
      if (!kl.length) {
        etfs.push({
          ...meta,
          kind: 'etf',
          signal: 'none',
          canBuy: false,
          action: '拉取失败',
          techLine: '-',
          strength: 0,
          reasons: ['K线拉取失败'],
          buyPrice: null,
          sellPrice: null,
        });
        continue;
      }
      etfs.push(analyzeEtfTech(kl, meta));
    } catch (err) {
      etfs.push({
        ...meta,
        kind: 'etf',
        signal: 'none',
        canBuy: false,
        action: '拉取失败',
        techLine: '-',
        strength: 0,
        reasons: [err.message || '错误'],
        buyPrice: null,
        sellPrice: null,
      });
    }
  }

  const buyCount = indices.filter((x) => x.signal === 'buy').length;
  const watchCount = indices.filter((x) => x.signal === 'watch').length;
  const avoidCount = indices.filter((x) => x.signal === 'avoid').length;

  const core = indices.filter((x) => ['000001', '399001', '399006', '000300'].includes(x.code));
  const coreBuy = core.filter((x) => x.canBuy).length;

  let marketSignal = 'none';
  let marketCanBuy = false;
  if (coreBuy >= 2 || (coreBuy >= 1 && hotOk && buyCount >= 2)) {
    marketSignal = 'buy';
    marketCanBuy = true;
  } else if (buyCount >= 1 || watchCount >= 2) {
    marketSignal = 'watch';
  } else if (avoidCount >= 3) {
    marketSignal = 'avoid';
  }

  const names = indices.filter((x) => x.canBuy).map((x) => x.name);
  const etfBuy = etfs.filter((e) => e.signal === 'buy' || (e.action || '').includes('买入'));
  const etfSell = etfs.filter((e) => e.signal === 'sell' || (e.action || '').includes('卖出'));
  const etfSummary = etfs
    .map((e) => `${e.name}[${e.action || e.signal}]`)
    .join('；');

  const summary =
    marketSignal === 'buy'
      ? `指数中期偏多：可买信号 ${buyCount} 个（${names.join('、') || '-'}）${hotOk ? '，且有板块热点配合' : '；板块热点一般，仓位宜克制'}`
      : marketSignal === 'watch'
        ? `指数观望：部分指数接近中期买点（可买${buyCount}/观察${watchCount}），等待更多确认`
        : marketSignal === 'avoid'
          ? '指数偏谨慎：多数指数未站稳10周线，不宜激进加仓'
          : '指数信号不明，以个股纪律为主';

  return {
    marketCanBuy,
    marketSignal,
    summary,
    buyCount,
    watchCount,
    hotSectors: hotSectors.slice(0, 5),
    hotOk,
    indices,
    etfs,
    etfSummary,
    etfBuyCount: etfBuy.length,
    etfSellCount: etfSell.length,
    ruleNote:
      '大盘：站上10周线(MA50)+20日突破/沿10日线。ETF：五日线技术线 + 乖离/MACD 给出买卖区间。',
  };
}
