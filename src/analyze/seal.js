/**
 * 单票封单监控：涨停买一堆单厚不厚，决定还能不能拿
 */

import dayjs from 'dayjs';
import { fetchTencentDepth } from '../crawl/tencent.js';
import { fetchKlines, fetchLimitPools } from '../crawl/eastmoney.js';
import { computeIndicators } from './indicators.js';
import { limitUpPct } from './boardLeaders.js';
import { sessionPhase } from './session.js';
import { resolveStockTokens } from './resolveNames.js';
import { fmtSealTime } from './review.js';

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function fmtYi(n) {
  if (!Number.isFinite(n)) return '-';
  const yi = n / 1e8;
  const sign = yi > 0 ? '+' : '';
  return `${sign}${Math.abs(yi) < 1 ? Math.abs(yi).toFixed(2) : Math.abs(yi).toFixed(1)}亿`;
}

function fmtHands(v) {
  if (!Number.isFinite(v)) return '-';
  if (v >= 10000) return `${(v / 10000).toFixed(1)}万手`;
  return `${Math.round(v)}手`;
}

function parseQuoteMins(quoteTime) {
  const s = String(quoteTime || '');
  if (s.length < 12) return null;
  const hh = Number(s.slice(8, 10));
  const mm = Number(s.slice(10, 12));
  if (!Number.isFinite(hh)) return null;
  return hh * 60 + mm;
}

function sealLevel(amount, ratio) {
  const yi = (amount || 0) / 1e8;
  if (yi >= 5 && ratio >= 0.15) return { key: 'thick', label: '封单很厚' };
  if (yi >= 2 || ratio >= 0.1) return { key: 'ok', label: '封单够用' };
  if (yi >= 0.6 || ratio >= 0.04) return { key: 'thin', label: '封单偏薄' };
  return { key: 'fragile', label: '封单很弱' };
}

export function judgeHold(snap) {
  const reasons = [];
  const risks = [];
  const {
    atLimit,
    sealAmount,
    amount,
    brokenTimes,
    firstSealMins,
    firstSealText,
    sell1,
    buy1,
    changePct,
    aboveMa5,
    ma5Rising,
    brokenMa5,
    turnover,
    phase,
  } = snap;

  if (!atLimit) {
    const buy = buy1?.volume || 0;
    const sell = sell1?.volume || 0;
    const imb = sell > 0 ? buy / sell : buy > 0 ? 9 : 1;
    reasons.push('当前没有封在涨停价，封单逻辑用不上，改看买一卖一和五日线');
    if (imb >= 3 && changePct >= 3) reasons.push(`买一是卖一的 ${imb.toFixed(1)} 倍，短线买盘还在`);
    if (sell > buy * 2) risks.push('卖一明显厚于买一，抛压大于接盘');
    if (brokenMa5) {
      risks.push('已经跌破五日线，继续拿要有事件或板块理由');
      return {
        action: '减仓',
        level: 'sell',
        score: 32,
        verdict: '未封板且跌破五日线，优先减仓，不要用「等反包」拖延',
        reasons,
        risks,
      };
    }
    if (changePct >= 5 && aboveMa5 && ma5Rising) {
      return {
        action: '持有观察',
        level: 'watch',
        score: 58,
        verdict: '没封板但还在五日线上方，可以拿，封不住就按回踩五日线处理，不要改成打板思路',
        reasons,
        risks,
      };
    }
    return {
      action: '观察',
      level: 'watch',
      score: 48,
      verdict: '未涨停，谈不上封单质量。有票就按五日线持有，没有板块或买盘优势就不要加仓',
      reasons,
      risks,
    };
  }

  const ratio = amount > 0 ? sealAmount / amount : 0;
  const yi = sealAmount / 1e8;
  const level = sealLevel(sealAmount, ratio);
  let score = 50;

  if (level.key === 'thick') {
    score += 22;
    reasons.push(`封单 ${fmtYi(sealAmount).replace('+', '')}，占今日成交 ${(ratio * 100).toFixed(0)}%，资金愿意排队`);
  } else if (level.key === 'ok') {
    score += 12;
    reasons.push(`封单 ${fmtYi(sealAmount).replace('+', '')}，短线还压得住`);
  } else if (level.key === 'thin') {
    score -= 6;
    risks.push(`封单只有 ${fmtYi(sealAmount).replace('+', '')}，稍有抛盘就可能打开`);
  } else {
    score -= 16;
    risks.push(`封单过薄（${fmtYi(sealAmount).replace('+', '')}），炸板概率高`);
  }

  if ((brokenTimes || 0) === 0) {
    score += 8;
    reasons.push('今天还没打开过，封板过程干净');
  } else if (brokenTimes >= 3) {
    score -= 14;
    risks.push(`已开板 ${brokenTimes} 次，封单不稳`);
  } else {
    score -= 6;
    risks.push(`开过 ${brokenTimes} 次，属于回封，持有仓位要小于一字板`);
  }

  if (firstSealMins != null) {
    if (firstSealMins <= 9 * 60 + 40) {
      score += 8;
      reasons.push(`早封（${firstSealText || '-'}），分歧少`);
    } else if (firstSealMins >= 14 * 60 + 20) {
      score -= 10;
      risks.push(`尾盘才封上（${firstSealText || '-'}），隔夜分歧通常更大`);
    } else {
      reasons.push(`首次封板 ${firstSealText || '-'}`);
    }
  }

  if ((sell1?.volume || 0) > 0 && (sell1?.price || 0) > 0) {
    score -= 10;
    risks.push('涨停价上还有卖一，并没有封死');
  } else {
    reasons.push('涨停价没有卖一，目前封死');
  }

  if (aboveMa5 && ma5Rising) {
    score += 6;
    reasons.push('站上向上五日线，技术上允许持有');
  } else if (brokenMa5) {
    score -= 8;
    risks.push('涨停但五日线状态不好，属于情绪板，更要看封单');
  }

  if (turnover >= 15) {
    score -= 6;
    risks.push(`换手 ${turnover.toFixed(1)}%，短线筹码换得猛，明天承接不一定在`);
  } else if (turnover >= 8) {
    risks.push(`换手 ${turnover.toFixed(1)}%，不算轻，明天先看竞价，不要默认连板`);
  }

  if (phase?.isTail) {
    reasons.push('已到尾盘，封得住收盘，明天才是下一关');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  if (score >= 75) {
    return {
      action: '继续持有',
      level: 'hold',
      score,
      verdict: `${level.label}，今天可以拿到收盘。明天能不能连，看开盘竞价，不看今天封单有多狠`,
      reasons,
      risks,
      sealLabel: level.label,
    };
  }
  if (score >= 58) {
    return {
      action: '继续持有·盯封单',
      level: 'hold',
      score,
      verdict: `${level.label}，仓位可以留，但封单掉一层就要准备减。不要因为涨停就加仓`,
      reasons,
      risks,
      sealLabel: level.label,
    };
  }
  if (score >= 42) {
    return {
      action: '减仓防炸板',
      level: 'watch',
      score,
      verdict: `${level.label}，持有体验会很差。有利润就先拿下一部分，剩下用封单变化做决定`,
      reasons,
      risks,
      sealLabel: level.label,
    };
  }
  return {
    action: '不建议继续拿',
    level: 'sell',
    score,
    verdict: `${level.label}，炸板后往往杀得比涨得快。与其赌回封，不如先出来`,
    reasons,
    risks,
    sealLabel: level.label,
  };
}

function attachDelta(curr, prev) {
  if (!prev) return { ...curr, sealDeltaHands: null, sealDeltaText: '首次采样' };
  const d = (curr.buy1?.volume || 0) - (prev.buy1?.volume || 0);
  const text =
    d > 0
      ? `封单增加 ${fmtHands(d)}`
      : d < 0
        ? `封单减少 ${fmtHands(-d)}`
        : '封单几乎没变';
  return { ...curr, sealDeltaHands: d, sealDeltaText: text };
}

/**
 * @param {string[]|string} input
 * @param {{ prevMap?: Map, withMa5?: boolean, now?: import('dayjs').Dayjs }} opts
 */
export async function analyzeSeal(input, { prevMap = null, withMa5 = true, now = dayjs() } = {}) {
  const { results } = await resolveStockTokens(input);
  const unresolved = results.filter((r) => !r.code);
  const targets = results.filter((r) => r.code);
  if (!targets.length) {
    throw new Error(`没认出股票：${unresolved.map((r) => r.token).join('、') || '请输入名称或代码'}`);
  }

  const phase = sessionPhase(now);
  const poolDate = now.format('YYYYMMDD');
  const pools = await fetchLimitPools({ date: poolDate }).catch(() => null);
  const ztMap = new Map((pools?.limitUp || []).map((s) => [String(s.code).padStart(6, '0'), s]));

  const cards = [];
  for (const t of targets) {
    const depth = await fetchTencentDepth(t.code);
    if (!depth) {
      cards.push({
        token: t.token,
        code: t.code,
        name: t.name,
        error: '行情拉取失败',
      });
      continue;
    }

    const cap = limitUpPct(depth.code);
    const atLimit = depth.changePct >= cap && depth.price > 0 && depth.buy1.price > 0;
    const zt = ztMap.get(depth.code);
    const firstSealTime = zt?.firstSealTime || null;
    let firstSealMins = null;
    if (firstSealTime && /^\d+$/.test(String(firstSealTime))) {
      const raw = String(firstSealTime).padStart(6, '0');
      firstSealMins = Number(raw.slice(0, 2)) * 60 + Number(raw.slice(2, 4));
    }

    let ma5 = null;
    let aboveMa5 = null;
    let ma5Rising = null;
    let brokenMa5 = null;
    let techNote = '五日线未取到';
    if (withMa5) {
      try {
        const kl = await fetchKlines(depth.code, { limit: 30 });
        const ind = kl.length >= 10 ? computeIndicators(kl) : null;
        if (ind?.ma5 != null) {
          ma5 = round2(ind.ma5);
          aboveMa5 = !!ind.aboveMa5;
          ma5Rising = !!ind.ma5Rising;
          brokenMa5 = !!ind.brokenMa5;
          techNote = brokenMa5
            ? `未站稳MA5 ${ma5}`
            : aboveMa5 && ma5Rising
              ? `站上向上五日线 MA5 ${ma5}`
              : `在MA5 ${ma5} 附近，五日线${ma5Rising ? '向上' : '走平/向下'}`;
        }
      } catch {
        /* ignore */
      }
    }

    const amount = depth.amount || 0;
    const sealAmount = atLimit ? depth.sealAmount : 0;
    const sealRatio = atLimit && amount > 0 ? sealAmount / amount : null;
    const snap = {
      token: t.token,
      code: depth.code,
      name: depth.name,
      price: depth.price,
      prevClose: depth.prevClose,
      open: depth.open,
      high: depth.high,
      low: depth.low,
      changePct: depth.changePct,
      amount,
      amountText: fmtYi(amount).replace('+', ''),
      turnover: depth.turnover,
      volumeRatio: depth.volumeRatio,
      amplitude: depth.amplitude,
      quoteTime: depth.quoteTime,
      quoteMins: parseQuoteMins(depth.quoteTime),
      bids: depth.bids,
      asks: depth.asks,
      buy1: depth.buy1,
      sell1: depth.sell1,
      buy1Text: `${depth.buy1.price.toFixed(2)} × ${fmtHands(depth.buy1.volume)}`,
      sell1Text:
        depth.sell1.price > 0
          ? `${depth.sell1.price.toFixed(2)} × ${fmtHands(depth.sell1.volume)}`
          : '无卖一',
      atLimit,
      limitPct: cap,
      sealAmount,
      sealAmountText: atLimit ? fmtYi(sealAmount).replace('+', '') : '-',
      sealHands: atLimit ? depth.buy1.volume : 0,
      sealHandsText: atLimit ? fmtHands(depth.buy1.volume) : '-',
      sealRatio,
      sealRatioText: sealRatio != null ? `${(sealRatio * 100).toFixed(0)}%` : '-',
      boards: zt?.boards || (atLimit ? 1 : 0),
      brokenTimes: zt?.brokenTimes ?? null,
      firstSealTime,
      firstSealText: firstSealTime ? fmtSealTime(firstSealTime) : '-',
      lastSealText: zt?.lastSealTime ? fmtSealTime(zt.lastSealTime) : '-',
      industry: zt?.industry || '',
      ma5,
      aboveMa5,
      ma5Rising,
      brokenMa5,
      techNote,
      phase,
    };

    const judged = judgeHold({ ...snap });
    const withDelta = attachDelta({ ...snap, ...judged }, prevMap?.get(depth.code));
    cards.push(withDelta);
  }

  return {
    generatedAt: now.format('YYYY-MM-DD HH:mm:ss'),
    tradeDate: now.format('YYYY-MM-DD'),
    phase,
    cards,
    unresolved,
  };
}
