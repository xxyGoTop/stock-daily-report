/**
 * 早盘（9:30 前）热点板块 + 竞价选股
 *
 * 和 boards / tail 的分工：
 * - boards 看全天板块强度，开盘后才准
 * - tail 看尾盘买点
 * - 这里只回答「集合竞价在抢什么、开盘能不能跟」
 */

import dayjs from 'dayjs';
import { fetchAuctionStocks, fetchKlines } from '../crawl/eastmoney.js';
import { computeIndicators } from './indicators.js';
import { limitUpPct } from './boardLeaders.js';
import { sessionPhase } from './session.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function fmtYi(n) {
  if (!Number.isFinite(n) || n <= 0) return '-';
  const yi = n / 1e8;
  return `${yi >= 1 ? yi.toFixed(1) : yi.toFixed(2)}亿`;
}

function atLimit(s) {
  const cap = limitUpPct(s.code);
  return s.changePct != null && s.changePct >= cap;
}

/** 从高开个股自下而上聚板块——9:30 前板块指数经常还是昨收，不能信 */
export function clusterHotBoards(stocks = [], { top = 8 } = {}) {
  const map = new Map();
  for (const s of stocks) {
    if (s.changePct == null || s.changePct < 0.5) continue;
    const key = s.industry || '未分类';
    const cur = map.get(key) || {
      name: key,
      count: 0,
      limitUp: 0,
      sumChange: 0,
      sumAmount: 0,
      stocks: [],
    };
    cur.count += 1;
    if (atLimit(s)) cur.limitUp += 1;
    cur.sumChange += s.changePct;
    cur.sumAmount += s.amount || 0;
    cur.stocks.push(s);
    map.set(key, cur);
  }

  return [...map.values()]
    .map((b) => {
      const avgChange = b.sumChange / b.count;
      const confirmed = b.count >= 2;
      const leadScore = b.count * 10 + avgChange * 4 + b.limitUp * 8 + Math.min(12, b.sumAmount / 5e8);
      const leaders = [...b.stocks]
        .sort((a, c) => c.changePct - a.changePct || (c.amount || 0) - (a.amount || 0))
        .slice(0, 4);
      return {
        name: b.name,
        count: b.count,
        limitUp: b.limitUp,
        avgChange: +avgChange.toFixed(2),
        amount: b.sumAmount,
        amountText: fmtYi(b.sumAmount),
        confirmed,
        leadScore: +leadScore.toFixed(2),
        leaders: leaders.map((s) => ({
          code: s.code,
          name: s.name,
          changePct: s.changePct,
          atLimit: atLimit(s),
        })),
        note: confirmed
          ? `竞价高开 ${b.count} 家${b.limitUp ? `，其中 ${b.limitUp} 家顶到板` : ''}，均高开 ${avgChange.toFixed(2)}%`
          : `只有 ${b.count} 家高开，暂算个股行为`,
      };
    })
    .sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || b.leadScore - a.leadScore)
    .slice(0, top);
}

function scoreAuctionStock(s, hotNames, hasAmount) {
  const reasons = [];
  const risks = [];
  const change = s.changePct || 0;
  const cap = limitUpPct(s.code);
  const limited = atLimit(s);
  const inHot = hotNames.has(s.industry);
  const hot = hotNames.get(s.industry);

  let score = Math.min(change, cap) * 3.2;
  if (inHot && hot.confirmed) {
    score += 14 + Math.min(10, hot.count * 2);
    reasons.push(`板块共振：${s.industry} 竞价高开 ${hot.count} 家`);
  } else if (change >= 5) {
    score -= 10;
    risks.push('高开缺少板块跟风，更像孤立脉冲');
  }

  if (hasAmount && s.amount > 0) {
    if (s.amount >= 1e8) {
      score += 12;
      reasons.push(`竞价额 ${fmtYi(s.amount)}，资金愿意排队`);
    } else if (s.amount >= 3e7) {
      score += 6;
      reasons.push(`竞价额 ${fmtYi(s.amount)}`);
    } else if (s.amount < 8e6 && change >= 5) {
      score -= 8;
      risks.push('高开但竞价额偏小，容易开盘回落');
    }
  } else {
    reasons.push('竞价额尚未出来，先按涨幅和板块聚集看');
  }

  if (limited) {
    score += inHot && hot.confirmed ? 6 : -4;
    reasons.push(inHot ? '竞价顶板且有板块支持' : '竞价顶板');
    if (!inHot) risks.push('一字/顶板缺少板块，开盘打板胜率差');
  } else if (change >= 1.2 && change <= cap - 1.5) {
    score += 5;
    reasons.push(`高开 ${change.toFixed(2)}%，还没顶死，开盘有价格可以挂`);
  }

  if (s.circMV && s.circMV < 20e8) {
    score -= 4;
    risks.push(`流通市值 ${(s.circMV / 1e8).toFixed(0)} 亿，波动大`);
  }
  if (s.circMV && s.circMV >= 80e8 && change >= 2) {
    score += 4;
    reasons.push('偏大票高开，比微盘跟风更有板块意义');
  }

  if (s.volumeRatio >= 2) {
    score += 4;
    reasons.push(`量比 ${s.volumeRatio.toFixed(2)}`);
  }

  return { score: +score.toFixed(2), reasons: reasons.slice(0, 4), risks: risks.slice(0, 3) };
}

function decideAction(s, scored, hotNames) {
  const change = s.changePct || 0;
  const cap = limitUpPct(s.code);
  const limited = atLimit(s);
  const inHot = hotNames.get(s.industry)?.confirmed;

  if (limited && inHot) {
    return {
      action: '观察等开板',
      entryMode: '不追',
      buyPrice: '不追（竞价顶板，等开板再评估）',
      buyLow: 0,
      buyHigh: 0,
    };
  }
  if (limited) {
    return {
      action: '回避打板',
      entryMode: '不买',
      buyPrice: '不买（孤立顶板）',
      buyLow: 0,
      buyHigh: 0,
    };
  }
  if (!inHot && change >= 6) {
    return {
      action: '回避孤立高开',
      entryMode: '不买',
      buyPrice: '不买（无板块共振）',
      buyLow: 0,
      buyHigh: 0,
    };
  }
  const chaseCap = cap >= 19 ? 10 : 6.5;
  if (inHot && change >= 1.2 && change <= chaseCap && scored.score >= 28) {
    const px = s.price || s.open || 0;
    const buyLow = round2(px);
    const buyHigh = round2(px * 1.008);
    return {
      action: '开盘可关注',
      entryMode: '开盘附近',
      buyPrice: `${buyLow.toFixed(2)}~${buyHigh.toFixed(2)}·开盘附近`,
      buyLow,
      buyHigh,
      stop: round2(px * 0.972),
    };
  }
  if (inHot && change > chaseCap) {
    return {
      action: '盯盘观察',
      entryMode: '等回落',
      buyPrice: `高开 ${change.toFixed(2)}% 偏大，等开盘回踩再看，不追第一枪`,
      buyLow: 0,
      buyHigh: 0,
    };
  }
  if (inHot && change >= 0.8) {
    return {
      action: '盯盘观察',
      entryMode: '等确认',
      buyPrice: '先看开盘3分钟，站住竞价价再考虑',
      buyLow: 0,
      buyHigh: 0,
    };
  }
  return {
    action: '观察',
    entryMode: '不急',
    buyPrice: '板块未确认，继续看竞价',
    buyLow: 0,
    buyHigh: 0,
  };
}

async function attachMa5(cards, onProgress) {
  const out = [];
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    onProgress?.(`核对五日线 ${i + 1}/${cards.length}：${c.name}`);
    let ma5 = null;
    let aboveMa5 = null;
    let ma5Rising = null;
    let techNote = '五日线未取到';
    try {
      const kl = await fetchKlines(c.code, { limit: 30 });
      const ind = kl.length >= 10 ? computeIndicators(kl) : null;
      if (ind?.ma5 != null) {
        ma5 = round2(ind.ma5);
        aboveMa5 = !!ind.aboveMa5;
        ma5Rising = !!ind.ma5Rising;
        if (ind.brokenMa5 || !aboveMa5) {
          techNote = `未站上MA5 ${ma5}，开盘即使高开也只适合观察`;
        } else if (!ma5Rising) {
          techNote = `在MA5 ${ma5} 上方但五日线走平/向下`;
        } else {
          techNote = `站上向上五日线 MA5 ${ma5}`;
        }
      }
    } catch {
      /* keep empty */
    }
    await sleep(80);
    out.push({ ...c, ma5, aboveMa5, ma5Rising, techNote });
  }
  return out;
}

/**
 * @param {{ top?: number, max?: number, withMa5?: boolean, onProgress?: Function, now?: import('dayjs').Dayjs }} opts
 */
export async function analyzeMorningOpen({
  top = 8,
  max = 10,
  withMa5 = true,
  onProgress,
  now = dayjs(),
} = {}) {
  const phase = sessionPhase(now);
  const tradeDate = now.format('YYYY-MM-DD');

  onProgress?.('拉取集合竞价高开名单...');
  const snap = await fetchAuctionStocks({ pages: 8, pageSize: 80 });
  const upStocks = snap.stocks.filter((s) => s.changePct != null && s.changePct >= 0.5);
  const hotBoards = clusterHotBoards(upStocks, { top });
  const hotNames = new Map(hotBoards.filter((b) => b.confirmed).map((b) => [b.name, b]));

  const scored = upStocks
    .map((s) => {
      const extra = scoreAuctionStock(s, hotNames, snap.hasAmount);
      const plan = decideAction(s, extra, hotNames);
      return {
        ...s,
        amountText: fmtYi(s.amount),
        circMVText: s.circMV ? `${(s.circMV / 1e8).toFixed(0)}亿` : '-',
        atLimit: atLimit(s),
        ...extra,
        ...plan,
      };
    })
    .sort((a, b) => b.score - a.score || b.changePct - a.changePct);

  const actionRank = (a) =>
    a === '开盘可关注' ? 0 : a === '盯盘观察' ? 1 : a === '观察等开板' ? 2 : 3;
  const focus = scored
    .filter((s) => /开盘可关注|盯盘观察|观察等开板/.test(s.action))
    .sort((a, b) => actionRank(a.action) - actionRank(b.action) || b.score - a.score);
  let candidates = (focus.length ? focus : scored).slice(0, max);
  if (withMa5 && candidates.length) {
    candidates = await attachMa5(candidates, onProgress);
    candidates = candidates.map((c) => {
      if (c.action === '开盘可关注' && c.aboveMa5 === false) {
        return {
          ...c,
          action: '盯盘观察',
          entryMode: '等五日线',
          buyPrice: `不急（${c.techNote}）`,
          buyLow: 0,
          buyHigh: 0,
          reasons: [...(c.reasons || []), c.techNote],
        };
      }
      return c;
    });
  }

  const watch = scored
    .filter((s) => !candidates.some((c) => c.code === s.code))
    .filter((s) => /回避/.test(s.action) || s.atLimit)
    .slice(0, 8);

  const confirmed = hotBoards.filter((b) => b.confirmed);
  const headline = [
    phase.label,
    confirmed.length ? `热点 ${confirmed.map((b) => b.name).slice(0, 3).join('、')}` : '暂无板块共振',
    snap.hasAmount ? '已含竞价额' : '竞价额未出',
    `高开 ${upStocks.length} 家`,
  ].join(' · ');

  return {
    generatedAt: now.format('YYYY-MM-DD HH:mm:ss'),
    tradeDate,
    phase,
    headline,
    hasAmount: snap.hasAmount,
    scanned: snap.scanned,
    upCount: upStocks.length,
    hotBoards,
    candidates,
    watch,
    note: phase.isAuction
      ? phase.note
      : phase.phase === 'pre'
        ? '竞价还没开始，以下若有数据也只是昨收残留，9:15 后再跑一次'
        : '已经过了 9:30，开盘价可当竞价结果看，但成交额已混进连续竞价，只作早盘回顾',
  };
}
