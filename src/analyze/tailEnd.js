/**
 * 尾盘选股：当日量能 + 大盘环境 + 五日线状态
 *
 * 与「下一交易日」逻辑的区别：
 * - 买入点是**当场可挂的价位**，不是明日回踩价
 * - 量能必须按已过交易时间折算，否则盘中运行会严重低估当日量
 * - 额外看「收盘价在日内区间的位置」——尾盘拉升 vs 尾盘杀跌是决定性差别
 */

import dayjs from 'dayjs';
import {
  fetchActiveStocks,
  fetchKlines,
  fetchTailBoardSignals,
  getDataFreshness,
} from '../crawl/eastmoney.js';
import { computeIndicators } from './indicators.js';
import { buildSignalBoard } from './modules.js';
import { describeFundFlow, estimateChipConcentration } from './marketMeta.js';
import { sessionPhase, assessDataFreshness } from './session.js';

export { sessionPhase };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 涨跌幅限制：创业板/科创板 20%，北交所 30%，其余 10% */
export function limitPct(code) {
  const c = String(code).padStart(6, '0');
  if (/^(30|68)/.test(c)) return 20;
  if (/^(4|8)/.test(c)) return 30;
  return 10;
}

/**
 * 当日量能：量比 + 折算全天量 / 过去5日均量
 * 量比本身已按时间归一，折算量作为交叉验证
 */
export function analyzeTodayVolume(stock, klines, phase, now = dayjs()) {
  const volRatio = num(stock.volumeRatio) ?? 0;
  const today = now.format('YYYY-MM-DD');
  const last = klines[klines.length - 1];
  const hasTodayBar = last && String(last.date).slice(0, 10) === today;

  // 单位一致性：今日量与历史均量都取自同一份K线
  const history = (hasTodayBar ? klines.slice(0, -1) : klines).slice(-5).map((k) => k.volume);
  const valid = history.filter((v) => v > 0);
  const avg5 = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;

  let projected = null;
  let projRatio = null;
  if (hasTodayBar && last.volume > 0) {
    // 盘中按已过时间线性外推；ratio 过小时外推噪声太大，不做
    projected = phase.ratio >= 0.15 ? last.volume / phase.ratio : null;
    if (projected && avg5 > 0) projRatio = projected / avg5;
  }

  let level = 'unknown';
  let text = '当日量能：数据不足';
  const basis = projRatio != null ? projRatio : volRatio > 0 ? volRatio : null;
  if (basis != null) {
    if (basis >= 2.5) level = 'surge';
    else if (basis >= 1.5) level = 'strong';
    else if (basis >= 1.15) level = 'mild';
    else if (basis >= 0.8) level = 'flat';
    else level = 'shrink';

    const label = {
      surge: '显著放量',
      strong: '明显放量',
      mild: '温和放量',
      flat: '量能持平',
      shrink: '缩量',
    }[level];
    const parts = [`量比 ${volRatio.toFixed(2)}`];
    if (projRatio != null) {
      parts.push(
        phase.ratio < 1
          ? `折算全天量为5日均量 ${projRatio.toFixed(2)} 倍`
          : `全天量为5日均量 ${projRatio.toFixed(2)} 倍`
      );
    }
    text = `当日量能：${label}（${parts.join('，')}）`;
  }

  return { volRatio, avg5, projected, projRatio, level, text, hasTodayBar };
}

/** 收盘价在日内区间的位置：尾盘拉升 vs 尾盘杀跌 */
export function analyzeDayPosition(stock) {
  const price = num(stock.price);
  const high = num(stock.high);
  const low = num(stock.low);
  const open = num(stock.open);
  if (price == null || high == null || low == null || !(high > low)) {
    return { pos: null, level: 'unknown', text: '日内位置：数据不足' };
  }
  const pos = (price - low) / (high - low);
  let level = 'mid';
  if (pos >= 0.85) level = 'top';
  else if (pos >= 0.6) level = 'upper';
  else if (pos >= 0.4) level = 'mid';
  else if (pos >= 0.2) level = 'lower';
  else level = 'bottom';

  const label = {
    top: '收在日内最高区，尾盘资金抢筹',
    upper: '收在日内偏上区，尾盘承接良好',
    mid: '收在日内中枢，多空均衡',
    lower: '收在日内偏下区，尾盘承接偏弱',
    bottom: '收在日内最低区，尾盘杀跌',
  }[level];

  const aboveOpen = open != null && price > open;
  return {
    pos: +pos.toFixed(3),
    level,
    aboveOpen,
    text: `日内位置：${label}（处于当日区间 ${(pos * 100).toFixed(0)}% 分位${aboveOpen ? '，收在开盘价上方' : ''}）`,
  };
}

/**
 * 尾盘买入点：当场可挂的价位 + 止损/止盈
 */
export function tailEndPrices(stock, ind, { dayPos } = {}) {
  const price = num(stock.price) || 0;
  const ma5 = num(ind?.ma5) || price;
  const high = num(stock.high) || price;
  const low = num(stock.low) || price;
  const bias5 = num(ind?.bias5) ?? 0;

  const tick = Math.max(round2(price * 0.003), 0.01);
  const ma5r = round2(ma5);

  // 买入窄带：现价下方一档到现价微上，且不越过日内高点
  let buyLow = round2(Math.max(price - tick, ma5 * 0.998));
  let buyHigh = round2(Math.min(price + tick * 0.6, high));
  if (buyHigh < buyLow) buyHigh = round2(buyLow + tick * 0.5);

  // 止损取更近的一档（纪律更严）：今日低点下方 或 MA5 下方
  const stopByLow = round2(low * 0.995);
  const stopByMa5 = round2(ma5 * 0.995);
  const stop = round2(Math.max(stopByLow, stopByMa5));
  const t1 = round2(price * 1.03);
  const t2 = round2(price * 1.05);

  // 乖离过大或收在日内低位 → 不建议尾盘追，改为观察
  const tooExtended = bias5 > 6.5;
  const weakClose = dayPos?.level === 'bottom' || dayPos?.level === 'lower';

  let entryMode = '分2批';
  let action = '尾盘可买';
  let buyPrice = '';
  let buyReason = '';

  if (tooExtended) {
    action = '不追高';
    entryMode = '不买';
    buyPrice = `不追（乖离+${bias5.toFixed(1)}%）`;
    buyReason = `现价高出五日线 ${bias5.toFixed(1)}%，尾盘接在这个位置风险收益比差，等回踩 ${ma5r} 附近再看`;
  } else if (weakClose) {
    action = '观察';
    entryMode = '不买';
    buyPrice = '不买（尾盘承接弱）';
    buyReason = `尾盘收在日内偏下区，说明最后半小时没有资金承接，不宜买入`;
  } else {
    // 贴近五日线且量能确认可一次买入，否则分两批
    const tight = bias5 <= 2.5;
    entryMode = tight ? '一次买入' : '分2批';
    action = '尾盘可买';
    buyPrice = `${buyLow}~${buyHigh}·${entryMode}`;
    buyReason = tight
      ? `贴近五日线(${ma5r})、乖离仅 +${bias5.toFixed(1)}%，尾盘 ${buyLow}~${buyHigh} 一次买入即可`
      : `尾盘在 ${buyLow}~${buyHigh} 分2批（半仓挂价+半仓收盘前确认），避免一次打满在日内高点`;
  }

  return {
    action,
    buyPrice,
    buyLow: entryMode === '不买' ? 0 : buyLow,
    buyHigh: entryMode === '不买' ? 0 : buyHigh,
    entryMode,
    buyReason,
    stop,
    stopByLow,
    stopByMa5,
    sellPrice: `破${stop}止损/${t1}减半/${t2}`,
    sellReason: `跌破 ${stop} 止损（今日低点 ${round2(low)}、MA5 ${ma5r} 取更近一档）；次日冲 ${t1} 先减半，余仓看 ${t2}`,
    target1: t1,
    target2: t2,
    refMa5: ma5r,
  };
}

/** 大盘环境 → 仓位建议 */
export function positionAdvice(market, score) {
  const sig = market?.marketSignal || 'none';
  if (sig === 'avoid') {
    return {
      level: 'none',
      pct: '0%',
      note: '多数指数未站稳10周线，尾盘原则上不新开仓，只做减仓与观察',
    };
  }
  if (sig === 'buy') {
    return score >= 75
      ? { level: 'high', pct: '20~30%', note: '大盘中期偏多，强信号可给到单票上限' }
      : { level: 'mid', pct: '10~20%', note: '大盘偏多但个股共振一般，仓位减半' };
  }
  if (sig === 'watch') {
    return score >= 75
      ? { level: 'mid', pct: '10~15%', note: '大盘观望，仅强信号轻仓试错' }
      : { level: 'low', pct: '5~10%', note: '大盘观望且个股信号一般，试错仓即可' };
  }
  return { level: 'low', pct: '5~10%', note: '大盘信号不明，以个股纪律为主，控制单票仓位' };
}

/**
 * 尾盘叙述：买入理由只放支持买入的因子，利空单列风险提示
 */
function buildTailNarrative(ctx) {
  const { stock, ind, vol, dayPos, market, boardSignal } = ctx;
  const pros = [];
  const risks = [];
  const addPro = (w, text) => {
    if (text) pros.push({ w, text });
  };

  // 日内位置（尾盘最核心）
  if (dayPos.pos != null) {
    const body = dayPos.text.replace(/^日内位置：/, '');
    if (dayPos.level === 'top' || dayPos.level === 'upper') {
      addPro(60 + (dayPos.pos - 0.5) * 60, body);
    } else if (dayPos.level === 'mid') {
      addPro(35, body);
    } else {
      risks.push(body);
    }
  }

  // 当日量能
  if (vol.level !== 'unknown') {
    const basis = vol.projRatio ?? vol.volRatio;
    const body = vol.text.replace(/^当日量能：/, '');
    if (vol.level === 'shrink') risks.push(`${body}，尾盘缺乏资金推动`);
    else if (vol.level === 'surge') {
      addPro(70, body);
      risks.push(`量能达到5日均量 ${basis.toFixed(1)} 倍，放量过猛需防冲高回落`);
    } else addPro(55 + Math.min(38, Math.abs(basis - 1) * 24), body);
  }

  // 五日线状态
  const bias5 = num(ind.bias5);
  if (ind.bullAlign && ind.aboveMa5 && ind.ma5Rising) {
    addPro(
      82,
      `MA5>MA10>MA20 多头排列且五日线向上，现价站上MA5(${round2(ind.ma5)})${bias5 != null ? ` ${bias5 >= 0 ? '+' : ''}${bias5.toFixed(1)}%` : ''}`
    );
  } else if (ind.aboveMa5 && ind.ma5Rising) {
    addPro(
      68,
      `站上向上的五日线(${round2(ind.ma5)})${bias5 != null ? `，乖离 ${bias5 >= 0 ? '+' : ''}${bias5.toFixed(1)}%` : ''}，但未完全多头排列`
    );
  }
  if (bias5 != null && bias5 >= 0 && bias5 <= 2.5) {
    addPro(64, `乖离仅 +${bias5.toFixed(1)}%，买点贴着均线、回撤空间小`);
  } else if (bias5 != null && bias5 > 4) {
    risks.push(`已高出五日线 ${bias5.toFixed(1)}%，次日回踩概率上升`);
  }

  // 换手：低换手对大盘股是常态，只有成交额也小时才算风险
  const to = num(stock.turnover);
  const amt = num(stock.amount) ?? 0;
  if (to != null && to > 0) {
    if (to >= 15) risks.push(`换手 ${to.toFixed(1)}%，情绪偏热、次日波动会放大`);
    else if (to >= 5) addPro(46, `换手 ${to.toFixed(1)}%，交投活跃有承接`);
    else if (to <= 1.5) {
      if (amt >= 1e9) {
        addPro(38, `换手仅 ${to.toFixed(1)}% 但成交额 ${(amt / 1e8).toFixed(1)}亿，大盘股常态、盘口容量充足`);
      } else {
        risks.push(`换手仅 ${to.toFixed(1)}%、成交额 ${(amt / 1e8).toFixed(2)}亿，盘面清淡不易进出`);
      }
    }
  }

  // MACD
  if (ind.macdGolden) {
    addPro(74, `MACD 金叉（DIF ${num(ind.dif)?.toFixed(3)} 上穿 DEA ${num(ind.dea)?.toFixed(3)}）`);
  } else if (ind.macdAboveZero && ind.macdHistExpanding) {
    addPro(52, `MACD 零轴上方红柱放大（柱值 ${num(ind.hist)?.toFixed(3)}）`);
  } else if (ind.macdGreenShrinking) {
    addPro(50, `MACD 绿柱已缩短 ${ind.greenShrinkDays || 0} 日，动能修复中`);
  }

  // 资金：流入才算买入理由，流出一律进风险
  const fpct = num(stock.mainNetInflowPct);
  const famt = num(stock.mainNetInflow);
  if (fpct != null && famt != null && Math.abs(fpct) >= 1) {
    const yi = famt / 1e8;
    if (fpct > 0) {
      addPro(58 + Math.min(34, fpct * 4), `主力净流入 ${yi >= 0 ? '+' : ''}${yi.toFixed(2)}亿，占成交 ${fpct.toFixed(1)}%`);
    } else {
      risks.push(
        `主力净流出 ${yi.toFixed(2)}亿（占成交 ${fpct.toFixed(1)}%），股价上涨但资金在撤，防尾盘对倒`
      );
    }
  }

  // 涨幅位置
  const chg = num(stock.changePct);
  const lim = limitPct(stock.code);
  if (chg != null) {
    if (chg >= lim - 1.5) risks.push(`已涨 ${chg.toFixed(2)}%，逼近 ${lim}% 涨停板，尾盘买入成本偏高`);
    else if (chg > 0 && chg <= 3) addPro(40, `今日温和上涨 ${chg.toFixed(2)}%，未过度透支`);
  }

  // 大盘环境只在报告顶部说一次，不在每只票上重复；
  // 仅逆势（avoid）时才逐票强提醒
  if (market?.marketSignal === 'avoid') {
    risks.push('大盘多数指数未站稳10周线，属逆势买入');
  }

  if (boardSignal?.isMover) {
    addPro(
      88,
      `所属${boardSignal.name}尾盘异动，今日${boardSignal.changePct.toFixed(2)}%、上涨扩散${(
        boardSignal.breadth * 100
      ).toFixed(0)}%、主力净流入${(boardSignal.mainNetInflow / 1e8).toFixed(2)}亿`
    );
  } else if (boardSignal?.isStrong) {
    addPro(
      76,
      `所属${boardSignal.name}为今日最强板块第${boardSignal.todayRank}名，板块涨${boardSignal.changePct.toFixed(2)}%`
    );
  }

  pros.sort((a, b) => b.w - a.w);
  return {
    buyReasons: pros.slice(0, 5).map((d) => d.text),
    riskNotes: risks.slice(0, 4),
  };
}

/** 尾盘评分 */
function scoreTail(ctx) {
  const { stock, ind, vol, dayPos, market, boardSignal } = ctx;
  let score = 0;
  const veto = [];

  // 权重合计约 105，避免频繁撞到 100 上限而丢失区分度

  // 五日线（32分，核心）
  if (ind.bullAlign) score += 14;
  if (ind.aboveMa5 && ind.ma5Rising) score += 18;

  // 当日量能（22分）—— 放量过猛反而降档
  const basis = vol.projRatio ?? vol.volRatio ?? 0;
  if (basis >= 2.5) score += 18;
  else if (basis >= 1.5) score += 22;
  else if (basis >= 1.15) score += 16;
  else if (basis >= 0.8) score += 7;

  // 日内位置（18分）—— 尾盘特有
  if (dayPos.level === 'top') score += 16;
  else if (dayPos.level === 'upper') score += 18;
  else if (dayPos.level === 'mid') score += 7;

  // 乖离（9分）
  const bias5 = num(ind.bias5);
  if (bias5 != null) {
    if (bias5 >= 0 && bias5 <= 2.5) score += 9;
    else if (bias5 <= 4) score += 5;
    else if (bias5 <= 6.5) score += 2;
  }

  // 动能（10分）
  if (ind.macdAboveZero && (ind.macdGolden || ind.macdHistExpanding)) score += 7;
  if (ind.kdjGolden && ind.kdjAbove50) score += 3;

  // 资金（9分）：流入加分，温和流出扣分，大幅流出直接否决
  const fpct = num(stock.mainNetInflowPct);
  if (fpct != null) {
    if (fpct >= 5) score += 9;
    else if (fpct >= 2) score += 5;
    else if (fpct <= -2) score -= 10;
  }

  // 大盘环境调整
  if (market?.marketSignal === 'buy') score += 5;
  else if (market?.marketSignal === 'avoid') score -= 12;

  // 板块只做加分，不绕过个股五日线/量能/尾盘位置硬门槛
  if (boardSignal?.isMover) score += 10;
  else if (boardSignal?.isStrong) score += 7;

  // 否决项
  const chg = num(stock.changePct) ?? 0;
  const lim = limitPct(stock.code);
  if (ind.limitUpStreak >= 2) veto.push('连续涨停高位，尾盘不接');
  if (chg >= lim - 0.5) veto.push(`已接近/触及涨停(${chg.toFixed(1)}%)，尾盘难成交且次日风险大`);
  if (bias5 != null && bias5 > 9) veto.push(`乖离过大(+${bias5.toFixed(1)}%)`);
  if (ind.brokenMa5) veto.push('已跌破五日线');
  if (ind.unstableTrend && !(ind.bullAlign && ind.aboveMa5 && ind.ma5Rising)) {
    veto.push('近10日均线反复缠绕，趋势不稳');
  }
  if (dayPos.level === 'bottom') veto.push('尾盘收在日内最低区，承接崩塌');
  // 股价在涨、主力却大幅撤退：典型尾盘对倒，不参与
  if (fpct != null && fpct <= -5) {
    veto.push(`主力大幅净流出(占成交${fpct.toFixed(1)}%)，涨势缺资金支撑`);
  }

  // 归一到 0~100
  return { score: Math.max(0, Math.min(100, Math.round(score))), veto };
}

/**
 * 主流程
 */
export async function screenTailEnd({
  maxCandidates = 10,
  detailLimit = 80,
  scanPages = 6,
  minAmount = 5e7,
  market = null,
  onProgress,
  now = dayjs(),
} = {}) {
  const phase = sessionPhase(now);
  onProgress?.(`时段：${phase.label} · ${phase.note}`);

  const freshness = assessDataFreshness({ ...(await getDataFreshness()), now });
  onProgress?.(freshness.text);

  onProgress?.('扫描今日最强板块与尾盘异动板块...');
  let boardSignals = {
    boards: [],
    byName: new Map(),
    strongestToday: [],
    tailMovers: [],
  };
  try {
    boardSignals = await fetchTailBoardSignals({ limit: 10 });
    const strongSet = new Set(boardSignals.strongestToday.map((b) => b.name));
    const moverSet = new Set(boardSignals.tailMovers.map((b) => b.name));
    for (const board of boardSignals.boards) {
      board.isStrong = strongSet.has(board.name);
      board.isMover = moverSet.has(board.name);
    }
    onProgress?.(
      `板块：今日最强 ${boardSignals.strongestToday.length} 个，尾盘异动 ${boardSignals.tailMovers.length} 个`
    );
  } catch {
    onProgress?.('板块快照不可用，本次仅按个股信号筛选');
  }

  onProgress?.('拉取全市场快照...');
  const stocks = await fetchActiveStocks({ pages: scanPages, pageSize: 100 });

  // 快照预筛：流动性 + 当日量能 + 日内位置，先把范围压到可接受的K线请求量
  const pre = [];
  for (const s of stocks) {
    if (!(s.price > 0)) continue;
    if (/ST/i.test(s.name)) continue;
    if (/^(200|900)/.test(s.code)) continue;
    if (!(s.amount >= minAmount)) continue;

    const lim = limitPct(s.code);
    const chg = num(s.changePct) ?? 0;
    if (chg <= -3) continue; // 尾盘杀跌不接
    if (chg >= lim - 0.5) continue; // 已封板

    const vr = num(s.volumeRatio) ?? 0;
    if (vr < 1.05) continue; // 当日量能不足

    const dp = analyzeDayPosition(s);
    if (dp.pos != null && dp.pos < 0.4) continue; // 收在日内下半区

    // 预筛打分：量能 × 日内位置 × 温和涨幅
    const preScore =
      Math.min(vr, 4) * 20 + (dp.pos ?? 0.5) * 40 + Math.max(0, 6 - Math.abs(chg - 3)) * 3;
    pre.push({ stock: s, dayPos: dp, preScore });
  }

  pre.sort((a, b) => b.preScore - a.preScore);
  const pool = pre.slice(0, detailLimit);
  onProgress?.(`快照 ${stocks.length} 只 → 预筛 ${pre.length} 只 → 细算前 ${pool.length} 只`);

  const rows = [];
  for (let i = 0; i < pool.length; i++) {
    const { stock, dayPos } = pool[i];
    try {
      const klines = await fetchKlines(stock.code, { limit: 120 });
      if (klines.length < 30) continue;
      const ind = computeIndicators(klines);
      if (!stock.turnover) stock.turnover = ind.lastTurnover;

      const vol = analyzeTodayVolume(stock, klines, phase, now);
      const boardSignal = boardSignals.byName.get(stock.industry) || null;
      const ctx = { stock, ind, vol, dayPos, market, boardSignal };
      const { score, veto } = scoreTail(ctx);

      // 五日线硬门槛：尾盘只买站上向上五日线的
      const ma5Ok = ind.aboveMa5 && ind.ma5Rising;
      rows.push({ stock, ind, klines, vol, dayPos, score, veto, ma5Ok, ctx });
    } catch {
      /* skip */
    }
    if (i % 10 === 9) onProgress?.(`已细算 ${i + 1}/${pool.length}`);
    await sleep(110);
  }

  const passed = rows
    .filter((r) => r.ma5Ok && !r.veto.length)
    .sort((a, b) => b.score - a.score);

  const toCard = (r) => {
    const prices = tailEndPrices(r.stock, r.ind, { dayPos: r.dayPos });
    const advice = positionAdvice(market, r.score);
    const { buyReasons, riskNotes } = buildTailNarrative(r.ctx);
    return {
      code: r.stock.code,
      name: r.stock.name,
      score: r.score,
      price: r.stock.price,
      changePct: r.stock.changePct,
      high: r.stock.high,
      low: r.stock.low,
      open: r.stock.open,
      volumeRatio: r.stock.volumeRatio,
      turnover: r.stock.turnover,
      amount: r.stock.amount,
      industry: r.stock.industry || '未知行业',
      boardSignal: r.ctx.boardSignal
        ? {
            name: r.ctx.boardSignal.name,
            changePct: r.ctx.boardSignal.changePct,
            change5: r.ctx.boardSignal.change5,
            acceleration: r.ctx.boardSignal.acceleration,
            breadth: r.ctx.boardSignal.breadth,
            mainNetInflow: r.ctx.boardSignal.mainNetInflow,
            todayRank: r.ctx.boardSignal.todayRank,
            isStrong: !!r.ctx.boardSignal.isStrong,
            isMover: !!r.ctx.boardSignal.isMover,
          }
        : null,
      mainNetInflow: r.stock.mainNetInflow || 0,
      mainNetInflowPct: r.stock.mainNetInflowPct || 0,
      fundFlow: describeFundFlow({
        mainNetInflow: r.stock.mainNetInflow || 0,
        mainNetInflowPct: r.stock.mainNetInflowPct || 0,
      }),
      chips: estimateChipConcentration(r.klines),
      signalBoard: buildSignalBoard(r.ind),
      volumeText: r.vol.text,
      volumeLevel: r.vol.level,
      projRatio: r.vol.projRatio != null ? +r.vol.projRatio.toFixed(2) : null,
      dayPosText: r.dayPos.text,
      dayPos: r.dayPos.pos,
      ma5: round2(r.ind.ma5),
      ma10: round2(r.ind.ma10),
      ma20: round2(r.ind.ma20),
      bias5: r.ind.bias5 != null ? +r.ind.bias5.toFixed(2) : null,
      ma5Text: `MA5 ${round2(r.ind.ma5)}${r.ind.ma5Rising ? '(向上)' : '(走平/向下)'}｜${r.ind.bullAlign ? '多头排列' : '未完全多头'}`,
      ...prices,
      positionPct: advice.pct,
      positionNote: advice.note,
      buyReasons,
      riskNotes,
      buyReasonText: buyReasons.join('；'),
    };
  };

  // 定价环节判定「不买」的（乖离过大等回踩 / 尾盘承接弱）单列观察区，
  // 不与真正可买的混在一张榜单里
  const allCards = passed.map(toCard);
  const candidates = allCards.filter((c) => c.entryMode !== '不买').slice(0, maxCandidates);
  const watchList = allCards
    .filter((c) => c.entryMode === '不买')
    .slice(0, Math.max(5, Math.ceil(maxCandidates / 2)));

  // 板块推荐只从已经通过个股硬门槛的尾盘候选/观察池中产生，不扩散推荐板块内其他股票。
  const boardRecommendations = allCards
    .filter((c) => c.boardSignal?.isMover || c.boardSignal?.isStrong)
    .sort(
      (a, b) =>
        (b.boardSignal?.isMover ? 1 : 0) - (a.boardSignal?.isMover ? 1 : 0) ||
        b.score - a.score
    )
    .slice(0, maxCandidates)
    .map((c) => ({
      code: c.code,
      name: c.name,
      industry: c.industry,
      score: c.score,
      action: c.entryMode === '不买' ? '观察等回踩' : '尾盘优先',
      buyPrice: c.buyPrice,
      boardType: c.boardSignal.isMover ? '尾盘异动' : '今日最强',
      boardChangePct: c.boardSignal.changePct,
      boardRank: c.boardSignal.todayRank,
    }));

  // 落选原因统计，方便判断是「市场没机会」还是「筛太严」
  const rejectStats = {};
  for (const r of rows) {
    if (r.ma5Ok && !r.veto.length) continue;
    const key = !r.ma5Ok ? '未站上向上的五日线' : r.veto[0];
    rejectStats[key] = (rejectStats[key] || 0) + 1;
  }

  return {
    phase,
    freshness,
    market,
    scanned: stocks.length,
    prescreened: pre.length,
    detailed: rows.length,
    passedCount: passed.length,
    candidates,
    watchList,
    strongestBoards: boardSignals.strongestToday,
    tailMovingBoards: boardSignals.tailMovers,
    boardRecommendations,
    rejectStats,
    generatedAt: now.format('YYYY-MM-DD HH:mm:ss'),
  };
}
