/**
 * 当日板块强度统计：前十强、是否分化、资金、是否走强
 */

import dayjs from 'dayjs';
import { fetchTailBoardSignals } from '../crawl/eastmoney.js';
import { sessionPhase } from './session.js';

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function fmtYi(n) {
  if (!Number.isFinite(n)) return '-';
  const yi = n / 1e8;
  const sign = yi > 0 ? '+' : '';
  return `${sign}${yi.toFixed(2)}亿`;
}

/** 综合强度：涨幅 + 扩散 + 资金 + 相对加速 + 今日分位 */
export function scoreBoardStrength(b) {
  const fundPct = clamp(Number(b.mainNetInflowPct) || 0, -12, 18);
  const accel = Math.max(0, Number(b.acceleration) || 0);
  const breadth = Number(b.breadth) || 0;
  const change = Number(b.changePct) || 0;
  const rps = Number(b.todayRps) || 0;
  return +(
    change * 4 +
    breadth * 22 +
    fundPct * 0.9 +
    accel * 3.2 +
    rps * 0.12 +
    (b.mainNetInflow > 0 ? 3 : b.mainNetInflow < 0 ? -2 : 0)
  ).toFixed(2);
}

function judgeDivergence(b) {
  const breadth = Number(b.breadth) || 0;
  const change = Number(b.changePct) || 0;
  const leaderGap =
    Number.isFinite(b.leaderChangePct) && Number.isFinite(change)
      ? b.leaderChangePct - change
      : 0;

  // 涨幅靠前但上涨家数偏少，或领涨股明显脱离板块 → 分化
  const diverged =
    (change >= 1 && breadth < 0.45) ||
    (change >= 0.5 && breadth < 0.35) ||
    (leaderGap >= 4 && breadth < 0.55) ||
    (leaderGap >= 6 && breadth < 0.65);

  if (diverged) {
    return {
      diverged: true,
      label: '分化',
      note:
        leaderGap >= 4
          ? `领涨股${b.leader || ''}拉开${leaderGap.toFixed(1)}pt，上涨扩散仅${(breadth * 100).toFixed(0)}%`
          : `上涨扩散仅${(breadth * 100).toFixed(0)}%，涨幅更多由少数票贡献`,
    };
  }
  if (breadth >= 0.7 && change > 0) {
    return {
      diverged: false,
      label: '齐涨',
      note: `上涨家数占比${(breadth * 100).toFixed(0)}%，板块内部较整齐`,
    };
  }
  return {
    diverged: false,
    label: '一般',
    note: `上涨${b.up}/下跌${b.down}，扩散${(breadth * 100).toFixed(0)}%`,
  };
}

function judgeFund(b) {
  const amt = Number(b.mainNetInflow) || 0;
  const pct = Number(b.mainNetInflowPct) || 0;
  if (amt > 0 && pct >= 3) {
    return { level: 'strong_in', label: '主力大幅净流入', text: `${fmtYi(amt)}（占成交${pct.toFixed(1)}%）` };
  }
  if (amt > 0) {
    return { level: 'in', label: '主力净流入', text: `${fmtYi(amt)}（占成交${pct.toFixed(1)}%）` };
  }
  if (amt < 0 && pct <= -3) {
    return { level: 'strong_out', label: '主力大幅净流出', text: `${fmtYi(amt)}（占成交${pct.toFixed(1)}%）` };
  }
  if (amt < 0) {
    return { level: 'out', label: '主力净流出', text: `${fmtYi(amt)}（占成交${pct.toFixed(1)}%）` };
  }
  return { level: 'flat', label: '资金基本持平', text: `${fmtYi(amt)}` };
}

function judgeTrend(b, divergence) {
  const change = Number(b.changePct) || 0;
  const accel = Number(b.acceleration) || 0;
  const breadth = Number(b.breadth) || 0;
  const fundOk = (Number(b.mainNetInflow) || 0) >= 0;

  // 走强：正涨 +（加速或扩散良好）+ 资金不流出；分化严重则降为「冲高分化」
  if (change > 0 && fundOk && breadth >= 0.5 && (accel >= 0.5 || change >= 1.5)) {
    if (divergence.diverged) {
      return {
        strengthening: false,
        label: '冲高分化',
        note: '指数在涨但内部不齐，追高性价比偏差',
      };
    }
    return {
      strengthening: true,
      label: '走强',
      note:
        accel >= 1
          ? `相对近5日均速加速${accel.toFixed(2)}pt，扩散与资金共振`
          : `今日${change.toFixed(2)}%且扩散/资金确认`,
    };
  }
  if (change < 0 || (Number(b.mainNetInflow) || 0) < 0 && breadth < 0.45) {
    return {
      strengthening: false,
      label: '走弱',
      note: change < 0 ? `今日跌${Math.abs(change).toFixed(2)}%` : '扩散弱且资金流出',
    };
  }
  return {
    strengthening: false,
    label: '震荡',
    note: '涨幅、扩散或资金尚未形成共振',
  };
}

export function annotateBoard(raw) {
  const strengthScore = scoreBoardStrength(raw);
  const divergence = judgeDivergence(raw);
  const fund = judgeFund(raw);
  const trend = judgeTrend(raw, divergence);

  return {
    code: raw.code,
    name: raw.name,
    kind: raw.kind || '行业',
    changePct: raw.changePct,
    change5: raw.change5,
    acceleration: raw.acceleration,
    up: raw.up,
    down: raw.down,
    breadth: raw.breadth,
    mainNetInflow: raw.mainNetInflow,
    mainNetInflowPct: raw.mainNetInflowPct,
    leader: raw.leader,
    leaderCode: raw.leaderCode,
    leaderChangePct: raw.leaderChangePct,
    todayRank: raw.todayRank,
    todayRps: raw.todayRps,
    strengthScore,
    divergence,
    fund,
    trend,
    strengthening: trend.strengthening,
    diverged: divergence.diverged,
  };
}

function buildSummary(all, topBoards) {
  const upCount = all.filter((b) => b.changePct > 0).length;
  const downCount = all.filter((b) => b.changePct < 0).length;
  const strongCount = topBoards.filter((b) => b.strengthening).length;
  const divergedCount = topBoards.filter((b) => b.diverged).length;
  const fundInCount = topBoards.filter((b) => b.mainNetInflow > 0).length;
  const topFund = topBoards.reduce((s, b) => s + (b.mainNetInflow || 0), 0);
  const avgTopChange =
    topBoards.length > 0
      ? topBoards.reduce((s, b) => s + b.changePct, 0) / topBoards.length
      : 0;
  const avgAllBreadth =
    all.length > 0 ? all.reduce((s, b) => s + (b.breadth || 0), 0) / all.length : 0;

  // 市场结构：前三涨幅是否显著高于板块均值 → 热点集中
  const avgChange =
    all.length > 0 ? all.reduce((s, b) => s + b.changePct, 0) / all.length : 0;
  const top3Avg =
    topBoards.slice(0, 3).reduce((s, b) => s + b.changePct, 0) /
    Math.max(1, Math.min(3, topBoards.length));
  const concentrated = top3Avg - avgChange >= 1.8;

  let structure = '均衡';
  let structureNote = '强弱板块落差不大，尚未形成清晰主线';
  if (divergedCount >= Math.ceil(topBoards.length * 0.5) && strongCount <= 2) {
    structure = '分化明显';
    structureNote = `前十里有 ${divergedCount} 个板块呈分化，上涨靠少数领涨股支撑`;
  } else if (concentrated && strongCount >= 3) {
    structure = '热点集中走强';
    structureNote = `前三板块均值 ${top3Avg.toFixed(2)}%，显著强于全市场均值 ${avgChange.toFixed(2)}%`;
  } else if (upCount / Math.max(1, all.length) >= 0.6 && avgAllBreadth >= 0.55) {
    structure = '普涨扩散';
    structureNote = `上涨板块占比 ${(
      (upCount / Math.max(1, all.length)) *
      100
    ).toFixed(0)}%，整体扩散较好`;
  } else if (downCount > upCount) {
    structure = '偏弱';
    structureNote = `下跌板块 ${downCount} 个多于上涨 ${upCount} 个`;
  }

  const tone =
    strongCount >= 5 && fundInCount >= 6
      ? '前十整体偏强，资金配合较好'
      : strongCount >= 3
        ? '前十有主线走强，其余需辨别分化'
        : divergedCount >= 4
          ? '前十偏分化，不宜简单追高板块指数'
          : '前十强度一般，等待更明确的资金与扩散确认';

  return {
    boardCount: all.length,
    upCount,
    downCount,
    avgChange: +avgChange.toFixed(2),
    avgTopChange: +avgTopChange.toFixed(2),
    strongCount,
    divergedCount,
    fundInCount,
    topFund,
    topFundText: fmtYi(topFund),
    structure,
    structureNote,
    tone,
  };
}

/**
 * @param {{ top?: number, includeConcept?: boolean, onProgress?: Function, now?: import('dayjs').Dayjs }} opts
 */
export async function analyzeBoardStrength({
  top = 10,
  includeConcept = false,
  onProgress,
  now = dayjs(),
} = {}) {
  const phase = sessionPhase(now);
  onProgress?.(
    includeConcept ? '拉取行业+概念板块当日强度...' : '拉取行业板块当日强度...'
  );

  const snap = await fetchTailBoardSignals({
    limit: Math.max(top, 10),
    includeConcept,
  });

  // 强度榜默认以行业为主；若 includeConcept，概念也参与排名
  const pool = includeConcept
    ? snap.boards
    : snap.boards.filter((b) => (b.kind || '行业') === '行业');

  const annotated = pool.map(annotateBoard).sort((a, b) => {
    return (
      b.strengthScore - a.strengthScore ||
      b.changePct - a.changePct ||
      b.breadth - a.breadth
    );
  });

  // 相近成分去重，避免同一行情重复进前十
  const seen = new Set();
  const unique = [];
  for (const b of annotated) {
    const key = `${b.leaderCode || ''}|${b.up}|${b.down}|${(+b.changePct).toFixed(1)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(b);
  }

  const topBoards = unique.slice(0, top).map((b, i) => ({
    ...b,
    strengthRank: i + 1,
  }));
  const summary = buildSummary(unique, topBoards);
  const weakBoards = [...unique]
    .sort((a, b) => a.strengthScore - b.strengthScore || a.changePct - b.changePct)
    .slice(0, 5);

  return {
    generatedAt: now.format('YYYY-MM-DD HH:mm:ss'),
    tradeDate: now.format('YYYY-MM-DD'),
    phase,
    includeConcept,
    top,
    topBoards,
    weakBoards,
    summary,
    boardCount: unique.length,
  };
}
