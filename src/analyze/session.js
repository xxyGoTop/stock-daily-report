/**
 * A股交易时段判定 + 行情数据新鲜度评估
 *
 * 独立成模块是因为「现在是不是交易时段」既被尾盘选股用来折算量能，
 * 也被日报用来判断「今天该不该有当日K线」。
 */

import dayjs from 'dayjs';

const OPEN1 = 9 * 60 + 30;
const CLOSE1 = 11 * 60 + 30;
const OPEN2 = 13 * 60;
const CLOSE2 = 15 * 60;
const TAIL_START = 14 * 60 + 30;
const SESSION_MINUTES = 240;

/**
 * 当前处于哪个交易时段 + 已过去多少交易时间
 * ratio 用于把盘中累计量折算成全天量
 */
export function sessionPhase(now = dayjs()) {
  const dow = now.day();
  const mins = now.hour() * 60 + now.minute();

  if (dow === 0 || dow === 6) {
    return {
      phase: 'weekend',
      label: '周末非交易日',
      elapsed: SESSION_MINUTES,
      ratio: 1,
      isTail: false,
      live: false,
      note: '非交易日，以下按最近一个交易日收盘数据演练',
    };
  }
  if (mins < OPEN1) {
    return {
      phase: 'pre',
      label: '未开盘',
      elapsed: 0,
      ratio: 0,
      isTail: false,
      live: false,
      note: '尚未开盘，当日量能未知，以下按上一交易日收盘数据演练',
    };
  }
  if (mins < CLOSE1) {
    const elapsed = mins - OPEN1;
    return {
      phase: 'morning',
      label: '早盘',
      elapsed,
      ratio: elapsed / SESSION_MINUTES,
      isTail: false,
      live: true,
      note: `距尾盘还有约 ${CLOSE2 - mins} 分钟，量能已按当前进度折算，午后可能明显变化`,
    };
  }
  if (mins < OPEN2) {
    return {
      phase: 'lunch',
      label: '午间休市',
      elapsed: 120,
      ratio: 0.5,
      isTail: false,
      live: true,
      note: '仅半场数据，午后走势可能改变结论',
    };
  }
  if (mins < CLOSE2) {
    const elapsed = 120 + (mins - OPEN2);
    const isTail = mins >= TAIL_START;
    return {
      phase: isTail ? 'tail' : 'afternoon',
      label: isTail ? '尾盘时段' : '午后',
      elapsed,
      ratio: elapsed / SESSION_MINUTES,
      isTail,
      live: true,
      note: isTail
        ? `正处尾盘决策窗口，距收盘约 ${CLOSE2 - mins} 分钟`
        : `未到尾盘（14:30 开始），距收盘约 ${CLOSE2 - mins} 分钟，结论可能变化`,
    };
  }
  return {
    phase: 'closed',
    label: '已收盘',
    elapsed: SESSION_MINUTES,
    ratio: 1,
    isTail: false,
    live: false,
    note: '今日已收盘，以下为全天数据复盘，可作明日尾盘参考',
  };
}

/**
 * 评估「指标是基于哪天的收盘算的」，并判断这个日期是否合理。
 *
 * 用两条独立链路交叉验证：
 * - klineDate：三个K线源里最新的那个日期，决定了指标算在哪天
 * - quoteDate：实时行情接口的时间戳日期，走的是另一条链路
 *
 * 只看 klineDate 是不够的——K线源集体降级时它会跟着一起滞后，
 * 那样「基准」本身就是错的，告警会失效。quoteDate 能戳破这种情况。
 *
 * @returns {{level:'fresh'|'expected'|'stale'|'unknown', klineDate, quoteDate, reportDate, daysBehind, text, warn}}
 */
export function assessDataFreshness({ klineDate, quoteDate, baselineDate, now = dayjs() } = {}) {
  const reportDate = now.format('YYYY-MM-DD');
  const phase = sessionPhase(now);
  const kd = String(klineDate ?? baselineDate ?? '').slice(0, 10);
  const qd = String(quoteDate || '').slice(0, 10);

  const base = {
    klineDate: kd,
    quoteDate: qd,
    reportDate,
    daysBehind: kd ? now.startOf('day').diff(dayjs(kd).startOf('day'), 'day') : null,
  };

  if (!kd) {
    return {
      ...base,
      level: 'unknown',
      warn: true,
      text: '三个K线源全部探测失败，无法确认指标新鲜度，请检查网络或代理后重跑',
    };
  }

  // 实时行情比K线新 → K线源集体滞后，这是最需要警告的情况
  if (qd && kd < qd) {
    return {
      ...base,
      level: 'stale',
      warn: true,
      text:
        `实时行情已到 ${qd}，但K线源最新只到 ${kd} · ` +
        `均线/MACD/KDJ 等指标全部基于 ${kd} 收盘计算，不含当日走势。` +
        `常见原因是新浪日K盘中不更新、而腾讯/东财此刻不可用，结论请谨慎使用`,
    };
  }

  if (kd === reportDate) {
    return {
      ...base,
      level: 'fresh',
      warn: false,
      text: `K线基准日 ${kd}（今日）· 指标含当日数据${qd ? `，实时行情同为 ${qd}` : ''}`,
    };
  }

  // 未开盘或非交易日，指标本来就该是上一交易日的，不算异常
  if (phase.phase === 'pre' || phase.phase === 'weekend') {
    return {
      ...base,
      level: 'expected',
      warn: false,
      text: `K线基准日 ${kd}（${phase.label}）· 指标基于上一交易日收盘，属正常`,
    };
  }

  // 已开盘、且实时行情也停在同一天：多为节假日
  return {
    ...base,
    level: 'expected',
    warn: false,
    text:
      `K线基准日 ${kd}（落后今日 ${base.daysBehind} 个自然日）· ` +
      `实时行情也停在${qd ? ` ${qd}` : '同一天'}，今日应为非交易日，指标基于最近交易日收盘`,
  };
}
