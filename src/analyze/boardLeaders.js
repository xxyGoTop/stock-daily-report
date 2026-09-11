/**
 * 板块龙头股筛选
 *
 * 东财板块快照自带的「领涨股」只是涨幅第一名，小盘股拉一下就能占位，
 * 不代表资金认可的龙头。这里改成在板块成分股里做多因子评分：
 * 涨幅分位 + 成交额分位（资金聚焦度）+ 主力净流入 + 涨停/连板，
 * 并把次新股、微盘股和纯题材脉冲挡在外面。
 */

import { fetchBoardMembers } from '../crawl/eastmoney.js';

/** 流通市值下限：低于这个量级拉涨停也带不动板块 */
const MIN_CIRC_MV = 15e8;
/** 成交额下限：板块里没有成交额的票不可能是龙头 */
const MIN_AMOUNT = 8000e4;

/** 涨停阈值随板块而异：创业板/科创板 20cm，北交所 30cm，其余 10cm */
export function limitUpPct(code = '') {
  const c = String(code);
  if (/^(30|68)/.test(c)) return 19.5;
  if (/^(43|83|87|88|92)/.test(c)) return 29.5;
  return 9.8;
}

/** 上市首日/次新：N 开头是首日，C 开头是上市后 5 日内，涨幅没有可比性 */
function isNewListing(name = '') {
  return /^[NC]\s?/.test(String(name));
}

/** 在一组数里取某个值的分位（0~1），并列时取平均名次 */
function percentile(values, v) {
  if (!values.length) return 0;
  const below = values.filter((x) => x < v).length;
  const equal = values.filter((x) => x === v).length;
  return (below + equal / 2) / values.length;
}

function fmtYi(n) {
  if (!Number.isFinite(n)) return '-';
  const yi = n / 1e8;
  return `${yi > 0 ? '+' : ''}${Math.abs(yi) < 1 ? yi.toFixed(2) : yi.toFixed(1)}亿`;
}

function fmtAmount(n) {
  if (!Number.isFinite(n)) return '-';
  return n >= 1e8 ? `${(n / 1e8).toFixed(1)}亿` : `${(n / 1e4).toFixed(0)}万`;
}

/**
 * 给单只成分股打龙头分
 *
 * 分位是相对同板块其他成分股算的——龙头本来就是「板块内部比出来的」，
 * 用绝对阈值在大小板块之间不可比。
 */
export function scoreLeader(s, ctx) {
  const { changes, amounts, inflows, ztInfo } = ctx;

  const changeP = percentile(changes, s.changePct);
  const amountP = percentile(amounts, s.amount);
  const inflowP = percentile(inflows, s.mainNetInflow);

  const zt = ztInfo?.get(s.code) || null;
  const atLimit = zt ? true : s.changePct >= limitUpPct(s.code);
  const boards = zt?.boards || (atLimit ? 1 : 0);

  // 主力净流入：既看在板块内的相对位置，也看占自身成交的比例
  const fundPct = Math.max(-10, Math.min(15, s.mainNetInflowPct || 0));
  const fundScore = inflowP * 18 + (s.mainNetInflow > 0 ? fundPct * 0.8 : fundPct * 0.4);

  const score =
    changeP * 30 +
    amountP * 26 +
    fundScore +
    (atLimit ? 8 : 0) +
    Math.min(18, Math.max(0, boards - 1) * 6);

  const reasons = [];
  if (boards >= 2) reasons.push(`${boards}连板`);
  else if (atLimit) reasons.push('涨停');
  if (amountP >= 0.9) reasons.push(`成交额板块前10%（${fmtAmount(s.amount)}）`);
  else if (amountP >= 0.75) reasons.push(`成交额居前（${fmtAmount(s.amount)}）`);
  if (s.mainNetInflow > 0 && inflowP >= 0.8) {
    reasons.push(`主力净流入${fmtYi(s.mainNetInflow)}（占成交${(s.mainNetInflowPct || 0).toFixed(1)}%）`);
  } else if (s.mainNetInflow < 0) {
    reasons.push(`主力净流出${fmtYi(s.mainNetInflow)}`);
  }
  if (changeP >= 0.9 && !atLimit) reasons.push(`涨幅板块前10%`);

  return {
    code: s.code,
    name: s.name,
    price: s.price,
    changePct: s.changePct,
    amount: s.amount,
    amountText: fmtAmount(s.amount),
    turnover: s.turnover,
    circMV: s.circMV,
    circMVText: `${(s.circMV / 1e8).toFixed(0)}亿`,
    mainNetInflow: s.mainNetInflow,
    mainNetInflowText: fmtYi(s.mainNetInflow),
    mainNetInflowPct: s.mainNetInflowPct,
    atLimit,
    boards,
    firstSealTime: zt?.firstSealTime || null,
    leaderScore: +score.toFixed(2),
    reasons,
  };
}

/**
 * 筛出一个板块的龙头股
 *
 * @param {{code:string,name:string}} board
 * @param {{ take?: number, ztInfo?: Map, members?: Array }} opts
 */
export async function pickBoardLeaders(board, { take = 3, ztInfo = null, members = null } = {}) {
  const raw = members || (await fetchBoardMembers(board.code, { limit: 50 }));
  if (!raw.length) {
    return { leaders: [], pool: 0, confident: false, note: '成分股拉取失败，无法评选龙头' };
  }

  const eligible = raw.filter(
    (s) => !isNewListing(s.name) && s.circMV >= MIN_CIRC_MV && s.amount >= MIN_AMOUNT
  );
  // 门槛卡光了就放宽到只剔次新，小板块不至于一个龙头都没有
  const pool = eligible.length >= 3 ? eligible : raw.filter((s) => !isNewListing(s.name));
  if (!pool.length) {
    return { leaders: [], pool: 0, confident: false, note: '成分股均为次新或微盘，不评龙头' };
  }

  const ctx = {
    changes: pool.map((s) => s.changePct),
    amounts: pool.map((s) => s.amount),
    inflows: pool.map((s) => s.mainNetInflow),
    ztInfo,
  };

  const scored = pool
    .map((s) => scoreLeader(s, ctx))
    // 今天没收红的票不配叫龙头，哪怕它成交额最大
    .filter((s) => s.changePct > 0)
    .sort((a, b) => b.leaderScore - a.leaderScore || b.changePct - a.changePct);

  if (!scored.length) {
    return { leaders: [], pool: pool.length, confident: false, note: '板块内无上涨个股，今日不评龙头' };
  }

  const leaders = scored.slice(0, take).map((s, i) => ({ ...s, leaderRank: i + 1 }));
  const first = leaders[0];
  const second = leaders[1];
  const gap = second ? first.leaderScore - second.leaderScore : null;

  // 「明确」要么是涨停摆在那，要么是把第二名甩开；
  // 只有一个候选时不能自动算明确——板块整体没动的话，微涨 0.1% 也会排第一
  const confident = first.atLimit || (gap != null ? gap >= 8 : first.changePct >= 5);

  const note = confident
    ? `${first.name}领先明确（${first.reasons.slice(0, 2).join('、') || '涨幅与成交额居前'}）`
    : gap != null
      ? `${first.name}暂时居前，但与${second.name}只差 ${gap.toFixed(1)} 分，龙头尚未走出来`
      : `板块内只有${first.name}等少数票收红且涨幅有限，谈不上龙头`;

  return { leaders, pool: pool.length, confident, note };
}

/**
 * 批量给多个板块选龙头（顺序请求，避免被东财限流）
 *
 * @param {Array} boards
 * @param {{ take?: number, ztInfo?: Map, onProgress?: Function }} opts
 */
export async function attachBoardLeaders(boards = [], { take = 3, ztInfo = null, onProgress } = {}) {
  const out = [];
  for (let i = 0; i < boards.length; i++) {
    const b = boards[i];
    onProgress?.(`筛选板块龙头 ${i + 1}/${boards.length}：${b.name}`);
    const res = await pickBoardLeaders(b, { take, ztInfo }).catch(() => ({
      leaders: [],
      pool: 0,
      confident: false,
      note: '龙头评选失败',
    }));
    out.push({ ...b, leaders: res.leaders, leaderPool: res.pool, leaderConfident: res.confident, leaderNote: res.note });
  }
  return out;
}

/** 把涨停池整理成 code → {boards, firstSealTime} 的查表 */
export function buildZtInfo(limitUp = []) {
  const m = new Map();
  for (const s of limitUp) {
    m.set(String(s.code).padStart(6, '0'), {
      boards: s.boards || 1,
      firstSealTime: s.firstSealTime,
    });
  }
  return m;
}
