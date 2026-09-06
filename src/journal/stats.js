/**
 * 周/月统计 + 选股策略优化建议
 */

import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import {
  readTrades,
  writeInsights,
  readInsights,
  saveWeekDiagnosis,
  saveMonthReview,
  weekKey,
  monthKey,
} from './store.js';

dayjs.extend(isoWeek);

function closedTrades(trades) {
  return trades.filter((t) => t.status === 'win' || t.status === 'loss' || t.status === 'breakeven');
}

function summarize(list) {
  const closed = closedTrades(list);
  const wins = closed.filter((t) => t.status === 'win');
  const losses = closed.filter((t) => t.status === 'loss');
  const holding = list.filter((t) => t.status === 'holding');
  const avgReturn =
    closed.length === 0
      ? 0
      : +(closed.reduce((s, t) => s + (t.returnPct || 0), 0) / closed.length).toFixed(2);
  const totalReturnPct =
    closed.length === 0
      ? 0
      : +closed.reduce((s, t) => s + (t.returnPct || 0), 0).toFixed(2);
  const winRate = closed.length ? +((wins.length / closed.length) * 100).toFixed(1) : 0;

  const failReasons = {};
  for (const t of losses) {
    const key = (t.failReason || '未填写失败原因').trim() || '未填写失败原因';
    failReasons[key] = (failReasons[key] || 0) + 1;
  }
  const successReasons = {};
  for (const t of wins) {
    const key = (t.successReason || '未填写成功原因').trim() || '未填写成功原因';
    successReasons[key] = (successReasons[key] || 0) + 1;
  }

  const byModule = {};
  for (const t of closed) {
    const m = t.module || '其他';
    if (!byModule[m]) byModule[m] = { n: 0, wins: 0, sumRet: 0 };
    byModule[m].n += 1;
    byModule[m].sumRet += t.returnPct || 0;
    if (t.status === 'win') byModule[m].wins += 1;
  }
  const moduleStats = Object.entries(byModule).map(([name, v]) => ({
    module: name,
    count: v.n,
    winRate: +((v.wins / v.n) * 100).toFixed(1),
    avgReturn: +(v.sumRet / v.n).toFixed(2),
  }));

  return {
    total: list.length,
    closed: closed.length,
    holding: holding.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    avgReturn,
    totalReturnPct,
    failReasons: Object.entries(failReasons)
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => ({ reason, count })),
    successReasons: Object.entries(successReasons)
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => ({ reason, count })),
    moduleStats,
  };
}

function buildTips(weekly, monthly, trades) {
  const tips = [];
  const checklistPatch = [];
  const closed = closedTrades(trades);

  if (closed.length < 3) {
    tips.push('已平仓样本不足 3 笔，先坚持按纪律录入买卖与失败原因，再谈策略优化。');
    checklistPatch.push('每笔交易必须填写：模块、买入价、卖出价、成功/失败原因');
    return { tips, checklistPatch };
  }

  if (weekly.winRate < 45) {
    tips.push(`本周胜率 ${weekly.winRate}% 偏低：优先减少追高，只做乖离温和且 MACD 绿柱缩小/金叉的票。`);
    checklistPatch.push('正股买入前：乖离MA5 ≤ 5%，且非严重正乖离');
    checklistPatch.push('优先 MACD 绿柱缩小或金叉，回避红柱末端追涨');
  } else if (weekly.winRate >= 60) {
    tips.push(`本周胜率 ${weekly.winRate}% 较好：保持现有模块权重，可对同类信号略增出手频率。`);
  }

  if (weekly.avgReturn < 0) {
    tips.push(`本周平均收益 ${weekly.avgReturn}%：止损可能偏慢，建议跌破买入价 3%~5% 或放量破 MA5 当日执行。`);
    checklistPatch.push('止损纪律：亏损达 3%~5% 或放量跌破五日线，次日开盘前必须处理');
  }

  const topFail = weekly.failReasons[0] || monthly.failReasons[0];
  if (topFail) {
    tips.push(`最高频失败原因：「${topFail.reason}」（${topFail.count}次）——下周选股专门规避该类情形。`);
    checklistPatch.push(`规避项：${topFail.reason}`);
  }

  const weakMod = [...(monthly.moduleStats || [])].sort((a, b) => a.winRate - b.winRate)[0];
  const strongMod = [...(monthly.moduleStats || [])].sort((a, b) => b.winRate - a.winRate)[0];
  if (weakMod && weakMod.count >= 2 && weakMod.winRate < 40) {
    tips.push(`近月「${weakMod.module}」胜率仅 ${weakMod.winRate}%：建议降仓或暂停该模块，只跟踪不重仓。`);
    checklistPatch.push(`${weakMod.module}模块：单票仓位上限下调，或暂不新开仓`);
  }
  if (strongMod && strongMod.count >= 2 && strongMod.winRate >= 55) {
    tips.push(`近月「${strongMod.module}」胜率 ${strongMod.winRate}%、均收益 ${strongMod.avgReturn}%：可提高该模块候选优先级。`);
    checklistPatch.push(`选股优先级上调：${strongMod.module}`);
  }

  // 乖离/MACD 文本粗匹配
  const lossWithHighBias = closed.filter(
    (t) => t.status === 'loss' && /严重正乖离|偏大正乖离/.test(t.biasAtBuy || '')
  );
  if (lossWithHighBias.length >= 2) {
    tips.push(`有 ${lossWithHighBias.length} 笔亏损买入时乖离偏大：强化“不追高”过滤。`);
    checklistPatch.push('一票否决：严重正乖离不买入');
  }
  const winWithGreen = closed.filter(
    (t) => t.status === 'win' && /绿柱缩小|金叉/.test(t.macdAtBuy || '')
  );
  if (winWithGreen.length >= 2) {
    tips.push(`盈利单中有 ${winWithGreen.length} 笔带「绿柱缩小/金叉」：将该信号设为加分硬条件。`);
    checklistPatch.push('加分硬条件：MACD 绿柱缩小或金叉至少满足其一');
  }

  if (!tips.length) tips.push('样本表现平稳，继续严格执行现有纪律并完善失败原因标签。');
  // 去重
  return {
    tips: [...new Set(tips)],
    checklistPatch: [...new Set(checklistPatch)],
  };
}

export function analyzeAndOptimize({ week, month } = {}) {
  const trades = readTrades();
  const now = dayjs();
  const weekOf = week || weekKey(now.format('YYYY-MM-DD'));
  const monthOf = month || monthKey(now.format('YYYY-MM-DD'));

  const weekTrades = trades.filter((t) => t.weekOf === weekOf);
  const monthTrades = trades.filter((t) => t.monthOf === monthOf);

  const weekly = { weekOf, ...summarize(weekTrades), trades: weekTrades };
  const monthly = { monthOf, ...summarize(monthTrades), trades: monthTrades };
  const { tips, checklistPatch } = buildTips(weekly, monthly, trades);

  // 写回策略优化清单，供日报侧参考（保留历史诊断）
  const prev = readInsights();
  const insights = writeInsights({
    ...prev,
    weekly: {
      weekOf: weekly.weekOf,
      winRate: weekly.winRate,
      avgReturn: weekly.avgReturn,
      totalReturnPct: weekly.totalReturnPct,
      wins: weekly.wins,
      losses: weekly.losses,
      holding: weekly.holding,
      failReasons: weekly.failReasons,
      moduleStats: weekly.moduleStats,
    },
    monthly: {
      monthOf: monthly.monthOf,
      winRate: monthly.winRate,
      avgReturn: monthly.avgReturn,
      totalReturnPct: monthly.totalReturnPct,
      wins: monthly.wins,
      losses: monthly.losses,
      holding: monthly.holding,
      failReasons: monthly.failReasons,
      moduleStats: monthly.moduleStats,
    },
    tips,
    checklistPatch,
  });

  return { weekly, monthly, tips, checklistPatch, insights };
}

/** 周诊断：有录入且未过期的周可执行 */
export function diagnoseWeek(weekOf) {
  const trades = readTrades().filter((t) => (t.weekOf || weekKey(t.buyDate)) === weekOf);
  if (!trades.length) {
    throw new Error('该周没有录入，无法诊断');
  }
  if (isWeekExpired(weekOf)) {
    throw new Error('该周已过期，不再开放诊断');
  }
  const result = analyzeAndOptimize({ week: weekOf });
  const report = {
    weekOf,
    winRate: result.weekly.winRate,
    avgReturn: result.weekly.avgReturn,
    wins: result.weekly.wins,
    losses: result.weekly.losses,
    holding: result.weekly.holding,
    failReasons: result.weekly.failReasons,
    tips: result.tips,
    checklistPatch: result.checklistPatch,
  };
  saveWeekDiagnosis(weekOf, report);
  return report;
}

/** 月分期：仅允许在当月最后一天执行当月分期 */
export function reviewMonth(monthOf) {
  const now = dayjs();
  const currentMonth = now.format('YYYY-MM');
  if (monthOf !== currentMonth) {
    throw new Error('只能对本月进行分期');
  }
  if (!isMonthLastDay(now)) {
    throw new Error('分期按钮仅在每月最后一天可点击');
  }
  const result = analyzeAndOptimize({ month: monthOf });
  const report = {
    monthOf,
    winRate: result.monthly.winRate,
    avgReturn: result.monthly.avgReturn,
    wins: result.monthly.wins,
    losses: result.monthly.losses,
    holding: result.monthly.holding,
    failReasons: result.monthly.failReasons,
    tips: result.tips,
    checklistPatch: result.checklistPatch,
  };
  saveMonthReview(monthOf, report);
  return report;
}

export function isWeekExpired(weekOf, now = dayjs()) {
  // 仅本周 + 上周可诊断，更早的周视为过期
  const currentWeekStart = now.startOf('isoWeek').format('YYYY-MM-DD');
  const prevWeekStart = now.startOf('isoWeek').subtract(7, 'day').format('YYYY-MM-DD');
  return weekOf !== currentWeekStart && weekOf !== prevWeekStart;
}

export function isMonthLastDay(now = dayjs()) {
  return now.date() === now.daysInMonth();
}

export function monthMeta(now = dayjs()) {
  const monthOf = now.format('YYYY-MM');
  const lastDay = now.daysInMonth();
  const canReview = isMonthLastDay(now);
  const insights = readInsights();
  return {
    monthOf,
    lastDay,
    today: now.date(),
    canReview,
    done: !!insights.monthReviews?.[monthOf],
    review: insights.monthReviews?.[monthOf] || null,
  };
}

/** 按周分组，供页面“每周一栏” */
export function groupTradesByWeek(trades = readTrades()) {
  const map = new Map();
  const insights = readInsights();
  const now = dayjs();
  for (const t of trades) {
    const k = t.weekOf || weekKey(t.buyDate);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([weekOf, list]) => {
      const expired = isWeekExpired(weekOf, now);
      const diagnosed = insights.weekDiagnoses?.[weekOf] || null;
      return {
        weekOf,
        weekLabel: `${weekOf} ~ ${dayjs(weekOf).add(6, 'day').format('MM-DD')}`,
        trades: list.sort((a, b) => String(b.buyDate).localeCompare(String(a.buyDate))),
        stats: summarize(list),
        canDiagnose: list.length > 0 && !expired,
        expired,
        diagnosed,
      };
    });
}
