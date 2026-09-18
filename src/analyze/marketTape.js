/**
 * 盘面情况总结与分析
 *
 * 不只是把涨跌家数、涨停数罗列出来，而是把它折算成「今天该怎么出手」：
 * 输出的 strategyBias 会直接改变五套选股算法的权重，
 * 所以盘面差的日子高位思路会自动降权、甚至整体转为观望。
 */

import dayjs from 'dayjs';

import {
  fetchMarketBreadth,
  fetchLimitPools,
  fetchStrongCount,
  fetchIndexRealtime,
} from '../crawl/eastmoney.js';
import {
  scoreSentiment,
  buildLadder,
  buildLimitUpSectors,
  identifyMainLines,
} from './review.js';
import { sessionPhase } from './session.js';

/** 盘面用的宽基指数（比风格判断那组更精简） */
const TAPE_INDICES = [
  { code: '000001', name: '上证指数', market: 'sh' },
  { code: '399001', name: '深证成指', market: 'sz' },
  { code: '399006', name: '创业板指', market: 'sz' },
  { code: '000300', name: '沪深300', market: 'sh' },
  { code: '000852', name: '中证1000', market: 'sh' },
];

/** 五套算法的权重初值，1 表示按基准分计入 */
function baseWeights() {
  return {
    yearHigh: 1,
    deepRebound: 1,
    forwardTrain: 1,
    dailyObserve: 1,
    ma5: 1,
  };
}

function fmtYi(v) {
  if (v == null || Number.isNaN(+v)) return '-';
  const yi = +v / 1e8;
  return `${Math.abs(yi) < 1 ? yi.toFixed(2) : yi.toFixed(1)}亿`;
}

/**
 * 把盘面折算成选股偏向
 *
 * 五套算法对盘面的敏感度不一样：
 * - 率先年新高、顺向火车轨是「高位右侧」思路，情绪退潮或指数走坏时最先失效
 * - 高RPS深调回升是「低吸左侧」思路，情绪过热时反而更安全
 * - 五日线共振是短线纪律，冷市里唯一要求是止损必须严
 */
function buildStrategyBias({ sentiment, indexSignals, turnover, mainLines, breadth }) {
  const weights = baseWeights();
  const notes = [];
  let scoreAdj = 0;

  const marketSignal = indexSignals?.marketSignal || 'none';
  const confirmedLines = (mainLines || []).filter((l) => l.confirmed).length;
  const level = sentiment?.level || 'neutral';

  // 指数中期信号：决定整体是否该出手
  if (marketSignal === 'buy') {
    scoreAdj += 6;
    weights.yearHigh += 0.25;
    weights.forwardTrain += 0.2;
    notes.push('指数中期偏多，右侧突破思路（率先年新高/顺向火车轨）加权');
  } else if (marketSignal === 'avoid') {
    scoreAdj -= 14;
    weights.yearHigh -= 0.45;
    weights.forwardTrain -= 0.2;
    weights.deepRebound -= 0.1;
    notes.push('多数指数未站稳10周线，年新高多为假突破，高位思路大幅降权');
  } else if (marketSignal === 'watch') {
    scoreAdj -= 3;
    weights.yearHigh -= 0.1;
    notes.push('指数仅观望，年新高思路小幅降权，要求个股自身更强');
  }

  // 情绪温度：决定做右侧还是做左侧
  if (level === 'hot') {
    weights.yearHigh -= 0.2;
    weights.deepRebound += 0.3;
    notes.push('情绪过热，追高位年新高容易接在末端，转为偏好深调回升的低吸标的');
  } else if (level === 'warm') {
    weights.yearHigh += 0.2;
    weights.forwardTrain += 0.15;
    notes.push('情绪偏暖且有主线，右侧思路胜率较高');
  } else if (level === 'cold') {
    scoreAdj -= 8;
    weights.yearHigh -= 0.3;
    weights.dailyObserve -= 0.15;
    notes.push('情绪偏冷，减少高位参与，五日线止损必须严格执行');
  } else if (level === 'freezing') {
    scoreAdj -= 18;
    weights.yearHigh -= 0.5;
    weights.forwardTrain -= 0.3;
    weights.dailyObserve -= 0.3;
    notes.push('情绪过冷，本表仅作观察池，不建议新开仓');
  }

  // 量能：决定突破能不能走远
  if (turnover && turnover.level !== 'unknown') {
    if (turnover.level === 'surge' || turnover.level === 'up') {
      scoreAdj += 4;
      weights.yearHigh += 0.15;
      notes.push(`两市${turnover.label}，突破有量能配合`);
    } else if (turnover.level === 'shrink') {
      scoreAdj -= 6;
      weights.yearHigh -= 0.2;
      weights.forwardTrain -= 0.1;
      notes.push(`两市${turnover.label}，缩量突破难持续，右侧思路降权`);
    }
  }

  // 主线：241005 要求「优先在主流板块里选」，有主线才谈得上主流
  if (confirmedLines >= 2) {
    weights.yearHigh += 0.2;
    notes.push(`有 ${confirmedLines} 条板块指数确认的主线，主流板块内选股优先级提高`);
  } else if (confirmedLines === 0) {
    weights.yearHigh -= 0.15;
    notes.push('今日没有板块指数确认的主线，年新高个股多为独立行情，权重下调');
  }

  // 普跌日：赚钱效应差，整体降分
  if (breadth?.upRatio != null) {
    if (breadth.upRatio >= 0.65) {
      scoreAdj += 3;
      notes.push(`上涨家数占比 ${(breadth.upRatio * 100).toFixed(0)}%，赚钱效应好`);
    } else if (breadth.upRatio <= 0.35) {
      scoreAdj -= 6;
      notes.push(`上涨家数占比仅 ${(breadth.upRatio * 100).toFixed(0)}%，普跌格局，逆势选股需降低预期`);
    }
  }

  for (const k of Object.keys(weights)) {
    weights[k] = +Math.max(0.2, Math.min(1.6, weights[k])).toFixed(2);
  }

  let overall = 'normal';
  if (level === 'freezing' || marketSignal === 'avoid') overall = 'standby';
  else if (scoreAdj <= -8) overall = 'defensive';
  else if (scoreAdj >= 8) overall = 'aggressive';

  const positionHint = {
    aggressive: '指数与情绪共振，单票可给到 20~30%，总仓位可偏高',
    normal: '常规节奏，单票 10~20%，总仓位控制在 5~6 成',
    defensive: '盘面偏弱，单票压到 5~10%，只做最强的一两只',
    standby: '盘面不支持新开仓，本表仅作观察池，等指数与情绪修复',
  }[overall];

  return { overall, scoreAdj, weights, notes, positionHint, confirmedLines };
}

/** 盘面分析结论：结合情绪/量能/主线/指数给出可执行判断 */
function buildTapeAnalysis({ sentiment, breadth, pools, strong, turnover, mainLines, indexSignals, bias }) {
  const points = [];
  const risks = [];

  if (breadth) {
    points.push(
      `涨跌家数 ${breadth.up}/${breadth.down}（上涨占比 ${(breadth.upRatio * 100).toFixed(0)}%）` +
        `${strong ? `，涨幅超5% ${strong.over5} 家、超7% ${strong.over7} 家` : ''}`
    );
  }
  if (pools) {
    const sealText =
      sentiment?.sealRate != null ? `，封板率 ${(sentiment.sealRate * 100).toFixed(0)}%` : '';
    points.push(
      `涨停 ${pools.limitUpCount} 家、跌停 ${pools.limitDownCount} 家、炸板 ${pools.brokenCount} 家${sealText}` +
        `${sentiment?.maxBoards ? `，最高 ${sentiment.maxBoards} 板` : ''}`
    );
  }
  if (turnover && turnover.level !== 'unknown') {
    points.push(
      `两市成交 ${turnover.amountText}${turnover.intraday ? `（折算全天约 ${turnover.projectedAmountText}）` : ''}，` +
        `${turnover.label}：${turnover.note}`
    );
  }
  if (indexSignals?.summary) points.push(`指数：${indexSignals.summary}`);

  const confirmed = (mainLines || []).filter((l) => l.confirmed);
  if (confirmed.length) {
    points.push(
      `板块指数确认的主线：${confirmed
        .slice(0, 3)
        .map((l) => `${l.name}（涨停${l.limitUpCount}家/最高${l.maxBoards}板）`)
        .join('、')}`
    );
  } else {
    points.push('今日没有被板块指数确认的主线，涨停以个股行为为主');
  }

  if (sentiment?.advice) risks.push(`情绪${sentiment.label}(${sentiment.score}分)：${sentiment.advice}`);
  if (sentiment?.sealRate != null && sentiment.sealRate < 0.65) {
    risks.push(`封板率仅 ${(sentiment.sealRate * 100).toFixed(0)}%，涨停普遍守不住，高位接力需谨慎`);
  }
  if (turnover?.level === 'shrink') risks.push(`量能${turnover.label}，突破缺乏承接，注意冲高回落`);
  if (indexSignals?.marketSignal === 'avoid') {
    risks.push('多数指数未站稳10周线，属逆势环境，年新高思路易假突破');
  }
  if (breadth?.upRatio != null && breadth.upRatio <= 0.35) {
    risks.push('普跌格局，即使选到强势股也要缩小仓位和持有周期');
  }

  const conclusion = `${
    {
      aggressive: '盘面偏强，可以正常按算法出手',
      normal: '盘面中性，按算法选股但控制仓位',
      defensive: '盘面偏弱，只做最强标的并严格止损',
      standby: '盘面不支持新开仓，以观察为主',
    }[bias.overall]
  }。${bias.positionHint}`;

  return { conclusion, points, risks };
}

/**
 * 生成当日盘面总结与分析
 *
 * @param {{ indexSignals?: object, boards?: object, onProgress?: Function, now?: import('dayjs').Dayjs }} opts
 */
export async function analyzeMarketTape({ indexSignals = null, boards = null, onProgress, now = dayjs() } = {}) {
  const phase = sessionPhase(now);
  const tradeDate = now.format('YYYY-MM-DD');
  const poolDate = now.format('YYYYMMDD');

  onProgress?.('统计涨跌家数、涨停跌停与强势股...');
  const [indexRows, breadth, pools, strong] = await Promise.all([
    fetchIndexRealtime(TAPE_INDICES).catch(() => []),
    fetchMarketBreadth().catch(() => null),
    fetchLimitPools({ date: poolDate }).catch(() => null),
    fetchStrongCount().catch(() => null),
  ]);

  const ladder = buildLadder(pools?.limitUp || []);
  const limitUpSectors = buildLimitUpSectors(pools?.limitUp || []);
  const sentiment = scoreSentiment({ pools, breadth, strong });
  const mainLines = identifyMainLines({ boards, limitUpSectors });
  const turnover = boards?.marketStyle?.turnover || null;

  const bias = buildStrategyBias({ sentiment, indexSignals, turnover, mainLines, breadth });
  const analysis = buildTapeAnalysis({
    sentiment,
    breadth,
    pools,
    strong,
    turnover,
    mainLines,
    indexSignals,
    bias,
  });

  const headline = [
    `情绪${sentiment.label}(${sentiment.score})`,
    breadth ? `涨${breadth.up}/跌${breadth.down}` : null,
    pools ? `涨停${pools.limitUpCount}/跌停${pools.limitDownCount}` : null,
    turnover && turnover.level !== 'unknown' ? turnover.label : null,
    indexSignals?.marketSignal ? `指数${indexSignals.marketSignal}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    tradeDate,
    phase,
    headline,
    indices: indexRows.map((x) => ({
      code: x.code,
      name: x.name,
      price: x.price,
      changePct: x.changePct,
      amount: x.amount,
      amountText: fmtYi(x.amount),
    })),
    breadth,
    pools: pools
      ? {
          limitUpCount: pools.limitUpCount,
          limitDownCount: pools.limitDownCount,
          brokenCount: pools.brokenCount,
          limitUp: pools.limitUp.slice(0, 30),
        }
      : null,
    strong,
    sentiment,
    ladder,
    limitUpSectors,
    mainLines,
    turnover,
    analysis,
    bias,
  };
}
