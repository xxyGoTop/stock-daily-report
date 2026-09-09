/**
 * 板块一：正股短线滚动复利（五日线为核心 · 多指标共振）
 * 同时并入正股的股权转让 / 要约收购 / 重组事件
 */

import {
  fetchActiveStocks,
  fetchKlines,
  fetchBoardRps5,
  fetchMarketReturns,
} from '../crawl/eastmoney.js';
import { computeIndicators } from '../analyze/indicators.js';
import { shortTermPrices, eventDrivenPrices } from '../analyze/pricing.js';
import { inferProgress, listMajorEvents } from '../analyze/progress.js';
import { buildSignalBoard } from '../analyze/modules.js';
import {
  buildRpsMaps,
  buildMarketRpsMaps,
  evalDailyObserve,
  evalForwardTrain,
  evalTaoPick241005,
  evalBlueDiamond,
  applyTaoBoost,
} from '../analyze/tao.js';
import { describeFundFlow, estimateChipConcentration } from '../analyze/marketMeta.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 陶博士 241005：软件自选股一版约 29 只，只看第一版 */
const FIRST_PAGE_SIZE = 29;

function isChiNextOrStar(code) {
  return /^(30|68)/.test(code);
}

function turnoverOk(code, turnover) {
  if (isChiNextOrStar(code)) return turnover >= 5 && turnover <= 15;
  return turnover >= 3 && turnover <= 8;
}

export function scoreShortTerm(stock, ind) {
  const reasons = [];
  const veto = [];
  let score = 0;

  if (ind.limitUpStreak >= 2) veto.push('连续涨停高位，不适合稳定复利');
  if (ind.bias5 != null && ind.bias5 > 10) veto.push(`乖离率过大(${ind.bias5.toFixed(1)}%)，透支追高风险`);
  if (/ST/i.test(stock.name)) veto.push('ST/*ST 不纳入短线正股池');
  // 已明确多头且五日线向上时，不再用「历史一次穿越」否决
  if (
    ind.unstableTrend &&
    !(ind.bullAlign && ind.aboveMa5 && ind.ma5Rising)
  ) {
    veto.push('近10日均线反复缠绕，趋势不稳');
  }

  const must = [];
  if (ind.bullAlign) {
    must.push('MA5>MA10>MA20 多头排列');
    score += 25;
  } else {
    must.push('未满足多头排列');
  }
  if (ind.aboveMa5 && ind.ma5Rising) {
    must.push('股价站上MA5且五日线向上');
    score += 25;
  } else {
    must.push('未站稳向上的五日线');
  }

  const volRatio = stock.volumeRatio || 0;
  // 量比门槛略放宽到 1.3；或日线温和放量亦可
  const volOk = volRatio >= 1.3 || (ind.gentleVolume && ind.lastVolume > ind.prevVolume);
  if (volOk) {
    must.push(`量能确认(量比${volRatio.toFixed(2)}/温和放量)`);
    score += 20;
  } else {
    must.push('量能不足');
  }

  const mustPass = ind.bullAlign && ind.aboveMa5 && ind.ma5Rising && volOk && veto.length === 0;

  if (ind.macdAboveZero && (ind.macdGolden || ind.macdHistExpanding)) {
    score += 12;
    reasons.push('MACD零轴上方金叉/红柱放大');
  } else if (ind.macdHistExpanding) {
    score += 6;
    reasons.push('MACD红柱放大(零轴下谨慎)');
  }

  if (ind.kdjGolden && ind.kdjAbove50) {
    score += 8;
    reasons.push('KDJ在50轴上方金叉');
  }

  if (ind.rsi6 != null && ind.rsi6 >= 50 && ind.rsi6 <= 80) {
    score += 8;
    reasons.push(`RSI(6)=${ind.rsi6.toFixed(1)} 处于50~80`);
  }
  // RSI 偏高透支不再作为扣分/展示理由（短线以量价与五日线为主）

  if (turnoverOk(stock.code, stock.turnover || ind.lastTurnover)) {
    score += 6;
    reasons.push(`换手率${(stock.turnover || ind.lastTurnover).toFixed(1)}%合理`);
  }

  if (ind.bias5 != null && ind.bias5 >= 0 && ind.bias5 <= 5) {
    score += 6;
    reasons.push(`乖离适中(${ind.bias5.toFixed(1)}%)，非追高`);
  }

  if (stock.mainNetInflow > 0) {
    score += 4;
    reasons.push('主力资金净流入');
  }

  if (
    ind.aboveMa5 &&
    ind.bias5 != null &&
    ind.bias5 < 2 &&
    stock.amplitude > 0 &&
    stock.amplitude < 5
  ) {
    score += 5;
    reasons.push('贴近五日线企稳特征');
  }

  return { score, mustPass, must, reasons, veto, ind };
}

export function buildShortTermOps(scored) {
  const buy = [];
  const holdWatch = [];
  const sell = [];
  const avoid = [];

  for (const s of scored) {
    const { ind, mustPass, veto, score } = s;
    if (veto.length) {
      avoid.push(s);
      continue;
    }
    if (ind.brokenMa5 && (s.stock.volumeRatio >= 1.2 || ind.lastVolume > ind.prevVolume * 1.2)) {
      sell.push(s);
      continue;
    }
    if (ind.brokenMa5) {
      holdWatch.push({ ...s, watchNote: '缩量跌破五日线，观察次日能否收回' });
      continue;
    }
    if (mustPass && score >= 60) buy.push(s);
    else if (ind.aboveMa5 && ind.ma5Rising) {
      holdWatch.push({ ...s, watchNote: '站上五日线但共振不足，仅观察' });
    } else avoid.push(s);
  }

  buy.sort((a, b) => b.score - a.score);
  sell.sort((a, b) => b.score - a.score);
  holdWatch.sort((a, b) => b.score - a.score);

  return { buy, holdWatch, sell, avoid };
}

function enrichTechCard(s, tag = '买入') {
  const prices = shortTermPrices(s.stock, s.ind);
  const signalBoard = buildSignalBoard(s.ind);
  const action =
    tag === '卖出'
      ? '卖出/止损'
      : s.fillFromWatch
        ? '观察/轻仓试错'
        : prices.action.includes('买入')
          ? '关注买入/回踩低吸'
          : prices.action;

  const taoTags = s.taoTags || [];
  const direction =
    taoTags.length > 0 ? `五日线短线/${taoTags.join('+')}` : '五日线短线';
  const fundFlow = describeFundFlow({
    mainNetInflow: s.stock.mainNetInflow || 0,
    mainNetInflowPct: s.stock.mainNetInflowPct || 0,
  });
  const chips = estimateChipConcentration(s.klines);

  return {
    code: s.stock.code,
    name: s.stock.name,
    score: s.score,
    price: s.stock.price,
    changePct: s.stock.changePct,
    volumeRatio: s.stock.volumeRatio,
    turnover: s.stock.turnover,
    industry: s.stock.industry || '未知行业',
    region: s.stock.region || '',
    mainNetInflow: s.stock.mainNetInflow || 0,
    mainNetInflowPct: s.stock.mainNetInflowPct || 0,
    fundFlow,
    chips,
    direction,
    category: taoTags.includes('率先年新高')
      ? '率先年新高'
      : taoTags.includes('深调高RPS回升')
        ? '深调高RPS回升'
        : taoTags.includes('顺向火车轨')
          ? '顺向火车轨'
          : taoTags.includes('蓝色钻石')
            ? '蓝色钻石观察'
            : taoTags.includes('每日观察')
              ? '火车每日观察'
              : '技术共振',
    action,
    buyPrice: prices.buyPrice,
    sellPrice: prices.sellPrice,
    buyTrigger: prices.buyTrigger,
    entryMode: prices.entryMode,
    buyReason:
      tag === '卖出'
        ? '不建议买入：已触发离场信号'
        : `${prices.buyReason}；${s.must.filter((m) => !m.startsWith('未')).slice(0, 2).join('；')}`,
    sellReason:
      tag === '卖出' ? '放量跌破五日线，复利纪律卖出' : prices.sellReason,
    progress: s.ind.aboveMa5
      ? `股价在MA5(${prices.refMa5})上方运行`
      : `股价跌破MA5(${prices.refMa5})`,
    stageLabel: tag === '卖出' ? '破位离场' : s.mustPass ? '多指标共振' : '观察等待',
    nextAction: tag === '卖出' ? '等待重新站稳MA5再议' : '盯量能与MA5得失',
    nextStageLabel: '下一交易日验证五日线',
    expectWindow: '下一交易日',
    expectNote: '短线以次日分时回踩/放量为验证',
    signalBoard,
    majorEvents: [
      ...(s.reasons || []).slice(0, 3).map((r) => ({ date: '', title: r, type: '技术' })),
      ...(s.must || [])
        .filter((m) => !m.startsWith('未'))
        .slice(0, 2)
        .map((m) => ({ date: '', title: m, type: '条件' })),
    ],
    indicators: {
      ma5: s.ind.ma5,
      ma10: s.ind.ma10,
      ma20: s.ind.ma20,
      bias5: s.ind.bias5,
      rsi6: s.ind.rsi6,
      macdGolden: s.ind.macdGolden,
      macdGreenShrinking: s.ind.macdGreenShrinking,
    },
    taoTags: s.taoTags || [],
    dailyObserve: s.dailyObserve || null,
    blueDiamond: s.blueDiamond || null,
    forwardTrain: s.forwardTrain || null,
    pick241005: s.pick241005 || null,
    board: s.board ? { name: s.board.name, rps5: s.board.rps5, change5: s.board.change5 } : null,
    observeRank: s.observeRank ?? null,
    inFirstPage: !!s.inFirstPage,
    rps: s.rps || null,
    mustPass: s.mustPass,
    veto: s.veto,
  };
}

function enrichEventCard(row) {
  const progress = row.progress || inferProgress(row.events, row.types);
  const prices = eventDrivenPrices(row.latest, row.quote, {
    isST: false,
    ind: row.ind || null,
  });
  const majorEvents = row.majorEvents || listMajorEvents(row.events, 6);

  let action =
    row.maxCertainty >= 4
      ? prices.techSuitable === true
        ? '事件驱动关注'
        : prices.techSuitable === 'wait'
          ? '事件关注·等回踩'
          : '事件跟踪·等五日线'
      : prices.action;

  return {
    code: row.code,
    name: row.name,
    score: row.score,
    price: row.latest?.close ?? row.quote?.price,
    changePct: row.latest?.changePct ?? row.quote?.changePct,
    direction: progress.direction,
    category: '正股事件驱动',
    types: row.types,
    action,
    buyPrice: prices.buyPrice,
    sellPrice: prices.sellPrice,
    buyReason: `${progress.progressText}。${prices.buyReason}`,
    sellReason: prices.sellReason,
    techEntry: prices.techEntry,
    techEntryText: prices.techEntryText,
    techSuitable: prices.techSuitable,
    ma5Ok: prices.ma5Ok,
    progress: progress.progressText,
    stageLabel: progress.stageLabel,
    nextAction: progress.nextAction,
    nextStageLabel: progress.nextStageLabel,
    expectWindow: progress.expectWindow,
    expectNote: progress.expectNote,
    timeline: progress.timeline,
    majorEvents,
    certainty: row.maxCertainty,
    riskFlags: row.riskFlags || [],
  };
}

export async function runShortTermStrategy({
  maxCandidates = 15,
  scanPages = 8,
  klineLimit = 300,
  detailLimit = 200,
  corporateEvents = [],
  indexCanBuy = true,
  fast = false,
  onProgress,
} = {}) {
  onProgress?.('拉取活跃正股列表...');
  const stocks = await fetchActiveStocks({ pages: scanPages, pageSize: 100 });
  const base = stocks.filter((s) => s.price > 0 && !/ST/i.test(s.name) && s.amount > 2e7);
  const byAmount = [...base].sort((a, b) => b.amount - a.amount).slice(0, Math.ceil(detailLimit * 0.6));
  const byChange = [...base]
    .filter((s) => s.changePct > 0 && s.changePct < 9.5)
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, Math.ceil(detailLimit * 0.5));
  const byVolRatio = [...base]
    .filter((s) => s.volumeRatio >= 1.5 && s.changePct < 9.5)
    .sort((a, b) => b.volumeRatio - a.volumeRatio)
    .slice(0, Math.ceil(detailLimit * 0.4));

  const map = new Map();
  for (const s of [...byAmount, ...byChange, ...byVolRatio]) map.set(s.code, s);
  const pool = [...map.values()].slice(0, detailLimit);

  onProgress?.(`预选 ${pool.length} 只，开始拉K线计算指标+陶博士公式...`);

  const scored = [];
  const codeKlines = {};
  for (let i = 0; i < pool.length; i++) {
    const stock = pool[i];
    try {
      const klines = await fetchKlines(stock.code, { limit: Math.max(klineLimit, 300) });
      if (klines.length < 30) continue;
      const ind = computeIndicators(klines);
      if (!stock.turnover) stock.turnover = ind.lastTurnover;
      codeKlines[stock.code] = klines;
      scored.push({ stock, ...scoreShortTerm(stock, ind), klines });
    } catch {
      /* skip */
    }
    if (i % 10 === 9) onProgress?.(`已分析 ${i + 1}/${pool.length}`);
    await sleep(120);
  }

  onProgress?.('拉取板块指数 RPS5（主流板块优先）...');
  let boardIndex = { boards: [], byName: new Map() };
  try {
    boardIndex = await fetchBoardRps5({ includeConcept: !fast });
  } catch {
    onProgress?.('板块 RPS5 拉取失败，跳过主流板块加分');
  }

  // RPS 必须是全市场分位（欧奈尔口径），只在扫描池内排名会让 95/96/98 阈值失真
  onProgress?.('拉取全市场周期涨幅，计算欧奈尔 RPS...');
  let rpsMaps = null;
  try {
    const marketRows = await fetchMarketReturns();
    if (marketRows.length > 1000) {
      rpsMaps = buildMarketRpsMaps(marketRows);
      onProgress?.(`全市场 RPS 基准：${marketRows.length} 只`);
    }
  } catch {
    /* 落回池内排名 */
  }
  if (!rpsMaps) {
    onProgress?.('全市场基准不可用，回退为扫描池内 RPS 排名');
    rpsMaps = buildRpsMaps(codeKlines);
  }

  onProgress?.('套用顺向火车轨/火车每日观察/241005择股...');
  for (const s of scored) {
    const code = s.stock.code;
    const rps = {
      rps20: rpsMaps.rps20[code] ?? 0,
      rps50: rpsMaps.rps50[code] ?? 0,
      rps120: rpsMaps.rps120[code] ?? 0,
      rps250: rpsMaps.rps250[code] ?? 0,
    };
    const train = evalForwardTrain(s.klines, rps, s.stock.turnover);
    const daily = evalDailyObserve(s.klines, rps, s.stock.turnover);
    const diamond = evalBlueDiamond(s.klines, rps, s.stock.turnover);
    const pick241005 = evalTaoPick241005(s.klines, rps, s.stock.turnover, { indexCanBuy });
    const board = boardIndex.byName.get(s.stock.industry) || null;
    const boosted = applyTaoBoost(s, { daily, diamond, train, pick241005, board });
    Object.assign(s, boosted, { rps });
  }

  // 241005 用法：每日观察选股结果只看「当天涨幅榜第一版」，挤不进第一版的说明不够优秀
  const observeHits = scored
    .filter((x) => x.pick241005?.hit && !x.veto?.length)
    .sort((a, b) => (b.stock.changePct ?? 0) - (a.stock.changePct ?? 0));
  const firstPage = observeHits.slice(0, FIRST_PAGE_SIZE);
  firstPage.forEach((s, idx) => {
    s.observeRank = idx + 1;
    s.inFirstPage = true;
    s.score += idx < 10 ? 6 : 3;
    s.reasons = [...(s.reasons || []), `当日涨幅榜第一版第${idx + 1}名（${(s.stock.changePct ?? 0).toFixed(2)}%）`];
  });
  onProgress?.(
    `241005每日观察命中 ${observeHits.length} 只，按当日涨幅取第一版 ${firstPage.length} 只`
  );

  const ops = buildShortTermOps(scored);
  let techList = ops.buy.slice(0, maxCandidates);

  // 陶博士命中优先补入候选：当日涨幅榜第一版优先，避免向全市场扩散
  const taoHits = scored
    .filter((x) => (x.taoTags || []).length && !x.veto?.length)
    .sort(
      (a, b) =>
        (b.inFirstPage ? 1 : 0) - (a.inFirstPage ? 1 : 0) ||
        (a.observeRank ?? 999) - (b.observeRank ?? 999) ||
        b.score - a.score
    );
  for (const t of taoHits) {
    if (techList.length >= maxCandidates) break;
    if (techList.some((x) => x.stock.code === t.stock.code)) continue;
    techList.push({ ...t, fillFromWatch: !t.mustPass });
  }

  if (techList.length < maxCandidates) {
    const extra = ops.holdWatch
      .filter((x) => x.score >= 40 && !x.ind.brokenMa5)
      .slice(0, maxCandidates - techList.length)
      .map((x) => ({ ...x, fillFromWatch: true }));
    techList = techList.concat(extra);
  }

  const techCards = techList.map((s) => enrichTechCard(s, '买入'));
  const sellCards = ops.sell.slice(0, 5).map((s) => enrichTechCard(s, '卖出'));

  // 正股模块仅保留技术面（事件股交给「收购/转让/重整」模块）
  const candidates = [];
  const seen = new Set();
  for (const c of techCards) {
    if (candidates.length >= maxCandidates) break;
    if (seen.has(c.code)) continue;
    seen.add(c.code);
    candidates.push(c);
  }

  return {
    scanned: pool.length,
    scoredCount: scored.length,
    candidates,
    sellCards,
    eventCards: [],
    // 241005：当天交易日的每日观察涨幅榜第一版（不向后续版面扩散）
    observeFirstPage: firstPage.map((s) => enrichTechCard(s, '买入')),
    observeHitCount: observeHits.length,
    hotBoards: boardIndex.boards.filter((b) => b.rps5 >= 90).slice(0, 12),
    taoHits: taoHits.slice(0, 20).map((s) => enrichTechCard(s, '买入')),
    ops: {
      buy: ops.buy.slice(0, maxCandidates),
      holdWatch: ops.holdWatch.slice(0, 10),
      sell: ops.sell.slice(0, 10),
    },
    allScored: scored,
  };
}

export function summarizeShortTermActions(result) {
  const today = [];
  const tomorrow = [];

  for (const c of result.candidates.slice(0, 15)) {
    today.push({
      code: c.code,
      name: c.name,
      action: c.action,
      direction: c.direction,
      reason: c.buyReason,
      sellReason: c.sellReason,
      buyPrice: c.buyPrice,
      sellPrice: c.sellPrice,
      progress: c.progress,
      expectWindow: c.expectWindow,
      price: c.price,
      changePct: c.changePct,
      majorEvents: c.majorEvents,
    });
    tomorrow.push({
      code: c.code,
      name: c.name,
      action: `${c.nextAction}；买 ${c.buyPrice}｜卖 ${c.sellPrice}`,
      reason: c.expectNote || c.progress,
      buyPrice: c.buyPrice,
      sellPrice: c.sellPrice,
    });
  }

  for (const c of (result.sellCards || []).slice(0, 5)) {
    if (today.some((t) => t.code === c.code)) continue;
    today.push({
      code: c.code,
      name: c.name,
      action: c.action,
      direction: c.direction,
      reason: c.sellReason,
      sellReason: c.sellReason,
      buyPrice: c.buyPrice,
      sellPrice: c.sellPrice,
      price: c.price,
      changePct: c.changePct,
    });
  }

  return { today, tomorrow };
}
