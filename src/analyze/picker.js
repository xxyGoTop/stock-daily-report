/**
 * 五套算法综合选股
 *
 * 算法本身已在 tao.js / shortTerm.js 实现，这里负责三件事：
 * 1. 按用户给定的优先级把五套算法的命中折算成统一评分
 * 2. 让盘面分析（marketTape 的 strategyBias）真正改变排序，而不是只印在报告顶部
 * 3. 为每只股票生成与其命中算法对应的买入计划、理由和风险
 */

import { countBases } from './tao.js';
import { sma } from './indicators.js';

/**
 * 五套算法，order 即用户给定的优先级（1 最高）
 * base 是命中后的基准分，会被盘面权重缩放
 */
export const STRATEGIES = [
  {
    key: 'yearHigh',
    order: 1,
    name: '率先一年新高',
    short: '年新高',
    base: 46,
    note: '优先主流板块，重点看当日涨幅榜第一版',
  },
  {
    key: 'deepRebound',
    order: 2,
    name: '高RPS深调回升',
    short: '深调回升',
    base: 40,
    note: '第1/第2基底可参与，第3个起谨慎',
  },
  {
    key: 'forwardTrain',
    order: 3,
    name: '顺向火车轨',
    short: '火车轨',
    base: 36,
    note: '优先RPS250高、右侧年高、10日线下买点',
  },
  {
    key: 'dailyObserve',
    order: 4,
    name: '火车每日观察',
    short: '每日观察',
    base: 30,
    note: '高RPS且在年高附近',
  },
  {
    key: 'ma5',
    order: 5,
    name: '五日线多头共振',
    short: '五日线',
    base: 24,
    note: '短线，严格止损',
  },
];

const STRATEGY_BY_KEY = new Map(STRATEGIES.map((s) => [s.key, s]));

/** 当日跌幅超过这个数的股票不进「可买入」清单，无论算法是否命中 */
const CRASH_DROP_PCT = -7;

function round2(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtYiSigned(v) {
  const n = num(v);
  if (n == null) return '-';
  const yi = n / 1e8;
  return `${yi >= 0 ? '+' : ''}${yi.toFixed(2)}亿`;
}

/** 基底序号的可参与程度（241005：第3个基底起谨慎） */
export function baseStance(baseCount) {
  if (!baseCount) return { label: '未形成基底', level: 'unknown', delta: 0 };
  if (baseCount === 1) return { label: '第1个基底', level: 'good', delta: 8 };
  if (baseCount === 2) return { label: '第2个基底', level: 'good', delta: 5 };
  if (baseCount === 3) return { label: '第3个基底', level: 'caution', delta: -6 };
  return { label: `第${baseCount}个基底`, level: 'risky', delta: -12 };
}

/**
 * 统一整理买入计划，保证四件事一定成立：
 *   买入下限 ≤ 上限、区间宽度可控、止损在买入下限之下、目标在买入上限之上
 * 否则会出现「买 63.82~68.83 止损 63.87」这种自相矛盾的计划。
 *
 * 止损同时给两个价：
 *   structuralStop 是均线破位位（可能离得很远），hardStop 是按 maxRisk 截断后的实际止损。
 * 只报结构位会出现「止损 15% / 目标 12%」的负期望计划，只报硬止损又丢了结构含义。
 */
function normalizePlan({
  price,
  zoneLow,
  zoneHigh,
  structuralStop,
  maxWidth = 0.03,
  minStopGap = 0.015,
  maxRisk = 0.07,
  t1 = 0.12,
  t2 = 0.22,
}) {
  let low = Math.min(zoneLow, zoneHigh);
  let high = Math.max(zoneLow, zoneHigh);
  if (!(low > 0) || !(high > 0)) {
    low = price * 0.99;
    high = price * 1.01;
  }
  // 区间太宽就不是买点而是猜测，向上收窄
  if ((high - low) / low > maxWidth) low = high / (1 + maxWidth);

  const structural = num(structuralStop);
  // 先保证止损在买入区间下方，再把过远的止损截到可接受风险内
  let stop = Math.min(structural ?? low * (1 - minStopGap), low * (1 - minStopGap));
  stop = Math.max(stop, high * (1 - maxRisk));

  const target1 = high * (1 + t1);
  const target2 = Math.max(high * (1 + t2), target1 * 1.04);

  const riskPct = ((high - stop) / high) * 100;
  const rr = (target1 - high) / (high - stop);

  // 现价相对买入区间的位置，决定这是「现在可买」还是「等价格过来」
  let stance = 'in';
  if (price > high * 1.01) stance = 'above';
  else if (price < low * 0.99) stance = 'below';

  return {
    buyLow: round2(low),
    buyHigh: round2(high),
    stop: round2(stop),
    structuralStop: structural != null ? round2(structural) : null,
    stopTightened: structural != null && structural < stop * 0.999,
    target1: round2(target1),
    target2: round2(target2),
    riskPct: round2(riskPct),
    rr: round2(rr),
    stance,
  };
}

/** 现价与买入区间的关系说明 */
function stanceNote(stance, price, plan) {
  if (stance === 'above') {
    const gap = ((price - plan.buyHigh) / plan.buyHigh) * 100;
    return `现价 ${round2(price)} 已高出买入上限 ${gap.toFixed(1)}%，不追，挂单等回踩`;
  }
  if (stance === 'below') {
    const gap = ((plan.buyLow - price) / price) * 100;
    return `现价 ${round2(price)} 低于买入下限 ${gap.toFixed(1)}%，等价格站回区间再动手`;
  }
  return `现价 ${round2(price)} 正在买入区间内，可按计划分批`;
}

/**
 * 判定每只股票命中了哪几套算法，并给出各自的质量加分
 */
function detectStrategies(s, ctx) {
  const { boardTopNames, boardByName } = ctx;
  const stock = s.stock;
  const ind = s.ind || {};
  const pick = s.pick241005 || {};
  const train = s.forwardTrain || {};
  const daily = s.dailyObserve || {};
  const via = pick.via || [];
  const rps = s.rps || {};

  const klines = s.klines || [];
  const bases = countBases(klines);
  const stance = baseStance(bases.baseCount);
  const board = s.board || boardByName?.get(stock.industry) || null;
  const inTopBoard = !!(board && boardTopNames?.has(board.name));

  // 年高位置：多处判断都要用，统一算一次
  const closes = klines.map((k) => k.close);
  const yearHigh = klines.length ? Math.max(...klines.slice(-250).map((k) => k.high)) : 0;
  const yearHighRatio = yearHigh > 0 && closes.length ? closes[closes.length - 1] / yearHigh : null;
  const ma50Arr = closes.length >= 50 ? sma(closes, 50) : [];
  const ma50 = ma50Arr.length ? ma50Arr[ma50Arr.length - 1] : null;
  const price = num(stock.price) ?? closes[closes.length - 1] ?? 0;

  const hits = [];

  // 1. 率先一年新高：优先主流板块 + 当日涨幅榜第一版
  if (pick.hit && via.includes('率先年新高')) {
    let bonus = 0;
    const detail = [];
    const barsAgo = pick.detail?.yearHighBarsAgo;
    detail.push(barsAgo === 0 ? '今日最高价即250日新高' : `${barsAgo}日前创250日新高`);
    detail.push(
      `RPS120=${(rps.rps120 ?? 0).toFixed(0)}／RPS250=${(rps.rps250 ?? 0).toFixed(0)}`
    );

    if (board?.rps5 != null) {
      if (board.rps5 >= 90) {
        bonus += 8;
        detail.push(`主流板块「${board.name}」板块RPS5=${board.rps5.toFixed(0)}`);
      } else if (board.rps5 >= 80) {
        bonus += 5;
        detail.push(`强势板块「${board.name}」板块RPS5=${board.rps5.toFixed(0)}`);
      } else {
        bonus -= 4;
        detail.push(`板块「${board.name}」RPS5仅${board.rps5.toFixed(0)}，非主流`);
      }
    }
    if (inTopBoard) {
      bonus += 6;
      detail.push('所属板块在当日强度前十');
    }
    if (s.inFirstPage) {
      const rank = s.observeRank || 99;
      bonus += rank <= 10 ? 8 : rank <= 20 ? 5 : 2;
      detail.push(`当日涨幅榜第一版第${rank}名`);
    } else {
      bonus -= 5;
      detail.push('未进当日涨幅榜第一版，强度不足');
    }
    if (pick.weakBreakout) {
      bonus -= 8;
      detail.push('无指数中期信号，需防假突破');
    }
    hits.push({ key: 'yearHigh', bonus, detail });
  }

  // 2. 高RPS深调回升：必须「已经在回升」，还在深坑里的不算
  if (pick.hit && via.includes('深调高RPS回升')) {
    let bonus = stance.delta;
    const detail = [`${stance.label}`];
    const ratio = yearHighRatio ?? num(pick.detail?.priceRatio);

    if (ratio != null) {
      detail.push(`现价为年内最高的 ${(ratio * 100).toFixed(0)}%`);
      if (ratio >= 0.85) {
        bonus += 6;
        detail.push('已回升到年高附近，右侧确认度高');
      } else if (ratio >= 0.7) {
        bonus += 2;
      } else if (ratio < 0.6) {
        bonus -= 12;
        detail.push('距年高仍有40%以上空间，回升尚未确认');
      }
    }

    // 回升的最低要求：站上20日线；更强的确认是站上50日线
    const aboveMa20 = ind.ma20 != null && price > ind.ma20;
    const aboveMa50 = ma50 != null && price > ma50;
    if (aboveMa20 && aboveMa50) {
      bonus += 5;
      detail.push('已站上20日线与50日线，回升成立');
    } else if (aboveMa20) {
      detail.push('已站上20日线，但仍在50日线下方');
    } else {
      bonus -= 8;
      detail.push('尚未站上20日线，还谈不上回升');
    }

    const rpsBase = num(pick.detail?.rpsBase);
    if (rpsBase != null) {
      if (rpsBase >= 98) {
        bonus += 5;
        detail.push(`RPS 最高分位 ${rpsBase.toFixed(0)}，深调但强度未破坏`);
      } else {
        detail.push(`RPS 最高分位 ${rpsBase.toFixed(0)}`);
      }
    }

    if (bases.resetCount > 0 && bases.lastResetBarsAgo != null && bases.lastResetBarsAgo <= 120) {
      bonus -= 8;
      detail.push(`${bases.lastResetBarsAgo}日前出现过40%级别回撤，上涨结构曾被破坏，基底重新起算`);
    }
    if (num(bases.baseDrop)) {
      detail.push(`本轮基底回撤 ${(bases.baseDrop * 100).toFixed(0)}%`);
    }
    hits.push({ key: 'deepRebound', bonus, detail });
  }

  // 3. 顺向火车轨：优先 RPS250 高、右侧年高、10日线下买点
  if (train.hit) {
    let bonus = 0;
    const detail = [];
    const rps250 = num(train.detail?.rps250);
    const rpsSum = num(train.detail?.rpsSum);
    if (rps250 != null) {
      if (rps250 >= 98) {
        bonus += 7;
        detail.push(`RPS250=${rps250.toFixed(0)}，年度强度最前列`);
      } else if (rps250 >= 95) {
        bonus += 4;
        detail.push(`RPS250=${rps250.toFixed(0)}`);
      } else {
        detail.push(`RPS250=${rps250.toFixed(0)}`);
      }
    }
    if (rpsSum != null) detail.push(`RPS120+250=${rpsSum.toFixed(0)}`);
    if (train.detail?.yearHighRight) {
      bonus += 6;
      detail.push('收盘即年内最高，属右侧年高');
    }
    if (train.detail?.belowMa10) {
      bonus += 6;
      detail.push('现价在10日线下方，正是火车轨偏好的买点');
    }
    const pb20 = num(train.detail?.pullback20);
    if (pb20 != null && pb20 <= 0.12) {
      bonus += 3;
      detail.push(`近20日回撤仅 ${(pb20 * 100).toFixed(0)}%，走势紧凑`);
    }
    hits.push({ key: 'forwardTrain', bonus, detail });
  }

  // 4. 火车每日观察
  if (daily.hit) {
    let bonus = 0;
    const detail = [];
    const d = daily.detail || {};
    detail.push(
      `RPS50=${(d.rps50 ?? rps.rps50 ?? 0).toFixed(0)}／RPS120=${(d.rps120 ?? 0).toFixed(
        0
      )}／RPS250=${(d.rps250 ?? 0).toFixed(0)}`
    );
    if (yearHighRatio != null) detail.push(`现价为年内最高的 ${(yearHighRatio * 100).toFixed(0)}%`);
    if (d.xg1) {
      bonus += 5;
      detail.push('近5日有收盘创250日新高且RPS达标');
    }
    if (d.xg2) {
      bonus += 4;
      detail.push('价格≥年高85%且RPS极高');
    } else if (d.xg3) {
      bonus += 3;
      detail.push('价格≥年高70%且RPS超高');
    }
    if (d.xg4) detail.push('120日回撤≤35%，调整可控');
    if (num(d.pullback120) != null) {
      detail.push(`120日最大回撤 ${(d.pullback120 * 100).toFixed(0)}%`);
    }
    hits.push({ key: 'dailyObserve', bonus, detail });
  }

  // 5. 五日线多头共振：必须完整共振才算命中
  if (s.mustPass && !(s.veto || []).length) {
    let bonus = 0;
    const detail = ['MA5>MA10>MA20 多头排列，股价站上向上的五日线'];
    const bias5 = num(ind.bias5);
    if (bias5 != null && bias5 >= 0 && bias5 <= 2.5) {
      bonus += 4;
      detail.push(`乖离仅 +${bias5.toFixed(1)}%，贴着均线，止损空间小`);
    } else if (bias5 != null && bias5 > 6) {
      bonus -= 4;
      detail.push(`乖离 +${bias5.toFixed(1)}%，离五日线偏远，需等回踩`);
    } else if (bias5 != null) {
      detail.push(`乖离 ${bias5 >= 0 ? '+' : ''}${bias5.toFixed(1)}%`);
    }
    const vr = num(stock.volumeRatio);
    if (vr != null && vr >= 1.5) {
      bonus += 3;
      detail.push(`量比 ${vr.toFixed(2)}，量能确认`);
    }
    if (ind.macdAboveZero && (ind.macdGolden || ind.macdHistExpanding)) {
      bonus += 2;
      detail.push('MACD 零轴上方走强');
    }
    hits.push({ key: 'ma5', bonus, detail });
  }

  return { hits, bases, stance, board, inTopBoard, yearHighRatio, ma50, price };
}

/**
 * 策略对应的买入区间与止损
 *
 * 不同思路的买点位置不一样，不能都套「MA5 附近」：
 * 火车轨明确偏好 10 日线下方低吸，年新高是突破右侧，五日线是贴着均线。
 */
function buildEntryPlan({ stock, ind, primary, detect }) {
  const price = num(stock.price) || detect.price || 0;
  const ma5 = num(ind.ma5) || price;
  const ma10 = num(ind.ma10) || ma5;
  const ma20 = num(ind.ma20) || ma10;

  const trainHit = detect.hits.find((h) => h.key === 'forwardTrain');
  const wantMa10 = primary === 'forwardTrain' && trainHit?.detail.some((d) => d.includes('10日线下'));

  let entryType;
  let zoneLow;
  let zoneHigh;
  let structuralStop;
  let entryMode = '分2批';
  let extra = '';

  if (wantMa10) {
    entryType = '10日线下低吸';
    zoneLow = ma10 * 0.985;
    zoneHigh = ma10 * 1.004;
    structuralStop = ma20 * 0.985;
    extra = `火车轨标的回到10日线(${round2(ma10)})下方，跌破20日线(${round2(ma20)})止损`;
  } else if (primary === 'yearHigh') {
    entryType = '年高右侧·回踩5日线';
    zoneLow = ma5;
    zoneHigh = Math.max(ma5 * 1.01, Math.min(price, ma5 * 1.03));
    structuralStop = Math.max(ma10 * 0.985, zoneLow * 0.93);
    extra = `年新高右侧：回踩站稳5日线(${round2(ma5)})再进，跌破10日线(${round2(ma10)})离场，不在冲高当日追满`;
  } else if (primary === 'deepRebound') {
    entryType = '回升确认·贴10日线';
    zoneLow = Math.min(ma10, ma5) * 0.995;
    zoneHigh = Math.max(ma10, ma5) * 1.005;
    structuralStop = ma20 * 0.97;
    extra = `深调回升：在10日线(${round2(ma10)})附近分批，跌破20日线(${round2(
      ma20
    )})止损；基底序号越靠前仓位越可放`;
  } else if (primary === 'dailyObserve') {
    entryType = '观察池·等回踩';
    zoneLow = Math.min(ma10, ma5) * 0.995;
    zoneHigh = Math.max(ma10, ma5) * 1.005;
    structuralStop = ma20 * 0.97;
    extra = '每日观察属观察池，等回踩到区间再分批，不在观察当日直接追';
  } else {
    entryType = '五日线短线';
    zoneLow = ma5 * 0.997;
    zoneHigh = ma5 * 1.008;
    structuralStop = ma5 * 0.985;
    entryMode = '一次买入';
    extra = `硬止损设在 ${round2(ma5 * 0.985)}，破了当天就走，不留隔夜`;
  }

  const t = primary === 'ma5' ? { t1: 0.03, t2: 0.06 } : { t1: 0.06, t2: 0.12 };
  const plan = normalizePlan({ price, zoneLow, zoneHigh, structuralStop, ...t });

  return {
    entryType,
    entryMode,
    ...plan,
    note: `${stanceNote(plan.stance, price, plan)}。${extra}`,
  };
}

/** 买入理由：按命中策略展开，附带盘面与资金的配合情况 */
function buildReasons({ detect, primary, stock, tape, hitKeys }) {
  const reasons = [];

  const ordered = [...detect.hits].sort(
    (a, b) => STRATEGY_BY_KEY.get(a.key).order - STRATEGY_BY_KEY.get(b.key).order
  );
  for (const h of ordered) {
    const meta = STRATEGY_BY_KEY.get(h.key);
    reasons.push(`【${meta.name}】${h.detail.join('；')}`);
  }

  if (hitKeys.length >= 3) {
    reasons.push(
      `【多路共振】同时满足 ${hitKeys.length} 套算法（${hitKeys
        .map((k) => STRATEGY_BY_KEY.get(k).short)
        .join('+')}），是本表里信号最密集的一类`
    );
  } else if (hitKeys.length === 2) {
    reasons.push(`【共振】${hitKeys.map((k) => STRATEGY_BY_KEY.get(k).short).join(' + ')} 同时成立`);
  }

  const fpct = num(stock.mainNetInflowPct);
  if (fpct != null && fpct >= 2) {
    reasons.push(`【资金】主力净流入 ${fmtYiSigned(stock.mainNetInflow)}，占成交 ${fpct.toFixed(1)}%`);
  }

  const w = tape?.bias?.weights || {};
  const pw = w[primary];
  if (pw != null) {
    if (pw >= 1.15) {
      reasons.push(`【盘面配合】今日盘面对「${STRATEGY_BY_KEY.get(primary).name}」是加权环境（权重${pw}）`);
    } else if (pw <= 0.85) {
      reasons.push(
        `【盘面不利】今日盘面对「${STRATEGY_BY_KEY.get(primary).name}」已降权（权重${pw}），入场需更谨慎`
      );
    }
  }

  return reasons;
}

function buildRisks({ detect, stock, ind, tape, hitKeys, entry }) {
  const risks = [];

  if (detect.stance.level === 'caution' || detect.stance.level === 'risky') {
    risks.push(`${detect.stance.label}，241005 提示第3个基底起成功率下降，仓位要降`);
  }

  if (entry.stance === 'above') {
    risks.push(`现价高于买入区间，直接买等于追高——本条的前提是价格回到 ${entry.buyHigh} 以下`);
  } else if (entry.stance === 'below') {
    risks.push(`现价还在买入区间下方，属于尚未确认，站回 ${entry.buyLow} 之上才成立`);
  }

  if (entry.rr != null && entry.rr < 1.2) {
    risks.push(`按该计划盈亏比仅 ${entry.rr}，止损空间 ${entry.riskPct}%，性价比一般`);
  }

  const bias5 = num(ind.bias5);
  if (bias5 != null && bias5 > 8) risks.push(`已高出五日线 ${bias5.toFixed(1)}%，短期透支，等回踩再动手`);

  const turn = num(stock.turnover);
  if (turn != null && turn >= 20) risks.push(`换手 ${turn.toFixed(1)}%，游资特征明显，波动会很大`);

  const fpct = num(stock.mainNetInflowPct);
  if (fpct != null && fpct <= -3) {
    risks.push(`主力净流出 ${fmtYiSigned(stock.mainNetInflow)}（占成交 ${fpct.toFixed(1)}%），涨势缺资金支撑`);
  }

  if (detect.board?.rps5 != null && detect.board.rps5 < 60) {
    risks.push(`所属板块「${detect.board.name}」板块RPS5仅 ${detect.board.rps5.toFixed(0)}，个股独走难持续`);
  }

  if (hitKeys.length === 1 && hitKeys[0] === 'ma5') {
    risks.push('仅五日线共振、无中长期强度支撑，只能做短线，止损必须严格');
  }

  if (tape?.bias?.overall === 'standby') {
    risks.push('盘面整体不支持新开仓，本条仅作观察');
  }

  return risks;
}

/** 可执行程度：盘面 + 评分 + 现价位置共同决定 */
function decideAction({ score, entry, tape }) {
  if (tape?.bias?.overall === 'standby') {
    return { action: '仅观察', actionLevel: 'watch', actionNote: '盘面不支持新开仓' };
  }
  if (score < 45) {
    return { action: '仅观察', actionLevel: 'watch', actionNote: '评分偏低，信号不够密集' };
  }
  if (entry.stance === 'in') {
    return { action: '可买入', actionLevel: 'buy', actionNote: '现价在买入区间内' };
  }
  if (entry.stance === 'above') {
    return { action: '等回踩', actionLevel: 'wait', actionNote: `等回到 ${entry.buyHigh} 以下` };
  }
  return { action: '等站回', actionLevel: 'wait', actionNote: `等站回 ${entry.buyLow} 之上` };
}

/**
 * 综合评分并取前 N
 *
 * @param {object[]} allScored  runShortTermStrategy 返回的 allScored
 * @param {object}   opts
 * @param {object}   opts.tape    marketTape 结果（提供 strategyBias）
 * @param {object}   opts.boards  analyzeBoardStrength 结果（提供主流板块）
 * @param {number}   opts.limit   取前几只
 */
export function pickTopStocks(allScored = [], { tape = null, boards = null, limit = 30 } = {}) {
  const weights = tape?.bias?.weights || {
    yearHigh: 1,
    deepRebound: 1,
    forwardTrain: 1,
    dailyObserve: 1,
    ma5: 1,
  };
  const scoreAdj = num(tape?.bias?.scoreAdj) ?? 0;
  // 盘面用乘数而不是直接减分：否则弱势盘面会把所有个股压到 0~5 分，排名就没意义了
  const marketFactor = Math.max(0.6, Math.min(1.25, 1 + scoreAdj / 100));

  const boardTopNames = new Set((boards?.topBoards || []).map((b) => b.name));
  const boardByName = new Map();
  for (const b of boards?.topBoards || []) boardByName.set(b.name, b);

  const rows = [];
  const strategyCount = {};
  let excludedCrash = 0;

  for (const s of allScored) {
    if (!s?.stock) continue;
    if ((s.veto || []).length) continue;

    // 当日大跌的票不该出现在「今天可买入」的清单里
    if (num(s.stock.changePct) != null && s.stock.changePct <= CRASH_DROP_PCT) {
      excludedCrash++;
      continue;
    }

    const detect = detectStrategies(s, { boardTopNames, boardByName });
    if (!detect.hits.length) continue;

    const ordered = [...detect.hits].sort(
      (a, b) => STRATEGY_BY_KEY.get(a.key).order - STRATEGY_BY_KEY.get(b.key).order
    );
    const primary = ordered[0].key;
    const hitKeys = ordered.map((h) => h.key);
    for (const k of hitKeys) strategyCount[k] = (strategyCount[k] || 0) + 1;

    // 主策略取全额基准分，其余按 45% 叠加：奖励共振但不让分数爆掉
    const weighted = detect.hits.map((h) => ({
      key: h.key,
      value: STRATEGY_BY_KEY.get(h.key).base * (weights[h.key] ?? 1),
      bonus: h.bonus,
    }));
    const maxBase = Math.max(...weighted.map((w) => w.value));
    const restBase = weighted.reduce((sum, w) => sum + w.value, 0) - maxBase;
    const bonusSum = weighted.reduce((sum, w) => sum + w.bonus, 0);

    let score = (maxBase + restBase * 0.45 + bonusSum) * marketFactor;

    const fpct = num(s.stock.mainNetInflowPct);
    if (fpct != null && fpct <= -5) score -= 8;

    const ind = s.ind || {};
    const entry = buildEntryPlan({ stock: s.stock, ind, primary, detect });
    const finalScore = Math.max(0, Math.min(100, Math.round(score)));
    const reasons = buildReasons({ detect, primary, stock: s.stock, tape, hitKeys });
    const risks = buildRisks({ detect, stock: s.stock, ind, tape, hitKeys, entry });
    const act = decideAction({ score: finalScore, entry, tape });

    rows.push({
      code: s.stock.code,
      name: s.stock.name,
      score: finalScore,
      rawScore: round2(score),
      price: s.stock.price,
      changePct: s.stock.changePct,
      turnover: num(s.stock.turnover),
      volumeRatio: num(s.stock.volumeRatio),
      amount: s.stock.amount,
      industry: s.stock.industry || '未知行业',
      mainNetInflow: s.stock.mainNetInflow || 0,
      mainNetInflowPct: s.stock.mainNetInflowPct || 0,

      primary,
      primaryName: STRATEGY_BY_KEY.get(primary).name,
      strategies: ordered.map((h) => ({
        key: h.key,
        name: STRATEGY_BY_KEY.get(h.key).name,
        short: STRATEGY_BY_KEY.get(h.key).short,
        order: STRATEGY_BY_KEY.get(h.key).order,
        detail: h.detail,
      })),
      hitCount: hitKeys.length,

      baseCount: detect.bases.baseCount,
      baseLabel: detect.stance.label,
      baseLevel: detect.stance.level,
      baseDrop: detect.bases.baseDrop,
      inBase: detect.bases.inBase,
      yearHighRatio: detect.yearHighRatio != null ? round2(detect.yearHighRatio) : null,

      ...act,

      rps: s.rps || null,
      board: detect.board
        ? { name: detect.board.name, rps5: detect.board.rps5, changePct: detect.board.changePct }
        : null,
      inTopBoard: detect.inTopBoard,
      inFirstPage: !!s.inFirstPage,
      observeRank: s.observeRank || null,

      ma5: round2(ind.ma5),
      ma10: round2(ind.ma10),
      ma20: round2(ind.ma20),
      bias5: ind.bias5 != null ? round2(ind.bias5) : null,

      entry,
      buyReasons: reasons,
      riskNotes: risks,
      taoTags: s.taoTags || [],
    });
  }

  rows.sort((a, b) => b.rawScore - a.rawScore || b.hitCount - a.hitCount);

  const picks = rows.slice(0, limit);
  return {
    picks,
    qualified: rows.length,
    excludedCrash,
    buyCount: picks.filter((p) => p.actionLevel === 'buy').length,
    waitCount: picks.filter((p) => p.actionLevel === 'wait').length,
    strategyCount,
    weights,
    scoreAdj,
    marketFactor: round2(marketFactor),
  };
}
