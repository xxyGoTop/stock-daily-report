/**
 * 当日复盘：指数、量能风格、涨跌家数、涨停梯队、情绪、主线与明日关注
 *
 * 定位和其他命令的区别：只做「今天发生了什么」的事实统计与归纳，
 * 不给个股买卖价——买点交给 tail / stock 命令。
 */

import dayjs from 'dayjs';
import {
  fetchIndexRealtime,
  fetchLimitPools,
  fetchMarketBreadth,
  fetchStrongCount,
} from '../crawl/eastmoney.js';
import { sessionPhase } from './session.js';
import { analyzeBoardStrength } from './boardStrength.js';
import { fetchTodayHotNews } from '../crawl/hotNews.js';

/** 复盘展示的指数（比风格判断用的那组更精简） */
const REVIEW_INDICES = [
  { code: '000001', name: '上证指数', market: 'sh' },
  { code: '399001', name: '深证成指', market: 'sz' },
  { code: '399006', name: '创业板指', market: 'sz' },
  { code: '000688', name: '科创50', market: 'sh' },
  { code: '000300', name: '沪深300', market: 'sh' },
  { code: '000852', name: '中证1000', market: 'sh' },
  { code: '399303', name: '国证2000', market: 'sz' },
];

function fmtYi(n) {
  if (!Number.isFinite(n)) return '-';
  const yi = n / 1e8;
  return `${Math.abs(yi) < 1 ? yi.toFixed(2) : yi.toFixed(1)}亿`;
}

/** 封板时间 92500 → 09:25 */
export function fmtSealTime(v) {
  const s = String(v ?? '').padStart(6, '0');
  if (!/^\d{6}$/.test(s)) return '-';
  return `${s.slice(0, 2)}:${s.slice(2, 4)}`;
}

/** 连板梯队：按连板数从高到低分组 */
export function buildLadder(limitUp = []) {
  const map = new Map();
  for (const s of limitUp) {
    const n = s.boards || 1;
    if (!map.has(n)) map.set(n, []);
    map.get(n).push(s);
  }
  return [...map.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([boards, list]) => ({
      boards,
      count: list.length,
      stocks: list.sort((a, b) => b.sealFund - a.sealFund),
    }));
}

/** 涨停按行业聚集，找出今天真正有承接的方向 */
export function buildLimitUpSectors(limitUp = [], topN = 8) {
  const map = new Map();
  for (const s of limitUp) {
    const key = s.industry || '未分类';
    const cur = map.get(key) || { name: key, count: 0, maxBoards: 0, stocks: [] };
    cur.count += 1;
    cur.maxBoards = Math.max(cur.maxBoards, s.boards || 1);
    cur.stocks.push(s);
    map.set(key, cur);
  }
  return [...map.values()]
    .sort((a, b) => b.count - a.count || b.maxBoards - a.maxBoards)
    .slice(0, topN)
    .map((s) => ({
      ...s,
      stocks: s.stocks.sort((a, b) => b.boards - a.boards || b.sealFund - a.sealFund).slice(0, 6),
    }));
}

/**
 * 情绪打分
 *
 * 五个维度各自给分，再折算成 0~100：涨停数、封板率、最高板高度、
 * 赚钱效应（上涨占比 + 涨幅>5%家数）、跌停数。
 * 单看涨停数会被「一字板低价股」误导，所以封板率和跌停数都要参与。
 */
export function scoreSentiment({ pools, breadth, strong }) {
  const up = pools?.limitUpCount ?? 0;
  const down = pools?.limitDownCount ?? 0;
  const broken = pools?.brokenCount ?? 0;
  const sealRate = up + broken > 0 ? up / (up + broken) : null;
  const maxBoards = (pools?.limitUp || []).reduce((m, s) => Math.max(m, s.boards || 1), 0);
  const upRatio = breadth?.upRatio ?? null;
  const over5 = strong?.over5 ?? null;

  const parts = [];
  const add = (name, score, weight, text) => parts.push({ name, score, weight, text });

  // 涨停家数：<30 过冷，30~60 偏冷，60~90 正常，>90 偏热
  add(
    '涨停家数',
    up >= 110 ? 100 : up >= 90 ? 85 : up >= 60 ? 65 : up >= 40 ? 45 : up >= 25 ? 30 : 15,
    0.25,
    `${up} 家涨停`
  );

  // 封板率：低于 60% 说明涨停普遍守不住
  add(
    '封板率',
    sealRate == null
      ? 50
      : sealRate >= 0.85
        ? 95
        : sealRate >= 0.75
          ? 78
          : sealRate >= 0.65
            ? 58
            : sealRate >= 0.5
              ? 38
              : 18,
    0.2,
    sealRate == null ? '封板率未知' : `封板率 ${(sealRate * 100).toFixed(0)}%（炸板 ${broken} 家）`
  );

  // 最高板：空间板高度决定资金愿不愿意打板
  add(
    '连板高度',
    maxBoards >= 7 ? 95 : maxBoards >= 5 ? 80 : maxBoards >= 4 ? 62 : maxBoards >= 3 ? 45 : maxBoards >= 2 ? 30 : 15,
    0.15,
    maxBoards ? `最高 ${maxBoards} 板` : '无连板'
  );

  // 赚钱效应：上涨占比为主，>5%家数辅助
  const moneyScore =
    upRatio == null
      ? 50
      : upRatio >= 0.7
        ? 95
        : upRatio >= 0.55
          ? 78
          : upRatio >= 0.45
            ? 58
            : upRatio >= 0.3
              ? 38
              : upRatio >= 0.18
                ? 25
                : 12;
  add(
    '赚钱效应',
    moneyScore,
    0.25,
    upRatio == null
      ? '涨跌家数未知'
      : `上涨占比 ${(upRatio * 100).toFixed(0)}%（涨${breadth.up}/跌${breadth.down}）` +
        (over5 != null ? `，涨超5% ${over5} 家` : '')
  );

  // 跌停家数：越多说明有个股在恐慌
  add(
    '跌停压力',
    down >= 40 ? 10 : down >= 25 ? 25 : down >= 15 ? 40 : down >= 8 ? 60 : down >= 3 ? 78 : 92,
    0.15,
    `${down} 家跌停`
  );

  const score = Math.round(
    parts.reduce((s, p) => s + p.score * p.weight, 0) / parts.reduce((s, p) => s + p.weight, 0)
  );

  const level =
    score >= 75 ? 'hot' : score >= 58 ? 'warm' : score >= 42 ? 'neutral' : score >= 28 ? 'cold' : 'freezing';
  const label =
    level === 'hot'
      ? '过热'
      : level === 'warm'
        ? '偏热'
        : level === 'neutral'
          ? '中性'
          : level === 'cold'
            ? '偏冷'
            : '过冷';

  const advice =
    level === 'hot'
      ? '情绪高位，追高风险大，优先兑现而非加仓'
      : level === 'warm'
        ? '情绪偏暖，可做主线，但不宜追末端连板'
        : level === 'neutral'
          ? '情绪中性，以轮动和低吸为主，控制单票仓位'
          : level === 'cold'
            ? '情绪偏冷，减少打板，等主线重新确立再动手'
            : '情绪过冷，优先空仓或轻仓观察，等放量止跌信号';

  return { score, level, label, advice, sealRate, maxBoards, parts };
}

/** 从板块强度 + 涨停行业的交集里认定今日主线 */
export function identifyMainLines({ boards, limitUpSectors }) {
  const strongNames = new Map();
  for (const b of boards?.topBoards || []) strongNames.set(b.name, b);

  const lines = [];
  for (const sec of limitUpSectors) {
    if (sec.name === '未分类') continue;
    // 涨停行业名与板块名不总是同一套命名，做包含匹配
    const hit =
      strongNames.get(sec.name) ||
      (boards?.topBoards || []).find(
        (b) => b.name.includes(sec.name) || sec.name.includes(b.name)
      );
    const confirmed = !!hit && sec.count >= 2;
    lines.push({
      name: sec.name,
      limitUpCount: sec.count,
      maxBoards: sec.maxBoards,
      boardChangePct: hit?.changePct ?? null,
      boardStrength: hit?.strengthScore ?? null,
      boardTrend: hit?.trend?.label ?? null,
      diverged: hit?.diverged ?? null,
      confirmed,
      leaders: sec.stocks.slice(0, 4).map((s) => ({
        code: s.code,
        name: s.name,
        boards: s.boards,
      })),
      note: confirmed
        ? `涨停 ${sec.count} 家、最高 ${sec.maxBoards} 板，且板块指数同步走强`
        : sec.count >= 2
          ? `涨停 ${sec.count} 家，但板块指数未同步确认，暂作题材看`
          : `仅 ${sec.count} 家涨停，属个股行为，不构成板块`,
    });
  }

  lines.sort(
    (a, b) =>
      Number(b.confirmed) - Number(a.confirmed) ||
      b.limitUpCount - a.limitUpCount ||
      b.maxBoards - a.maxBoards
  );
  return lines;
}

/** 明日关注：由情绪等级 + 主线确认情况 + 量能推导 */
export function buildTomorrowFocus({ sentiment, mainLines, boards, indexRows }) {
  const focus = [];
  const risks = [];

  const confirmed = mainLines.filter((l) => l.confirmed);
  if (confirmed.length) {
    focus.push(
      `主线跟踪：${confirmed
        .slice(0, 3)
        .map((l) => `${l.name}（最高${l.maxBoards}板）`)
        .join('、')}——明日看能否继续有新涨停接力，断板即视为主线衰减`
    );
  } else if (mainLines.length) {
    focus.push(
      `暂无板块指数确认的主线，${mainLines
        .slice(0, 2)
        .map((l) => l.name)
        .join('、')}只有零星涨停，明日先观察是否出现第二只涨停再跟`
    );
  } else {
    focus.push('今日没有成型的涨停板块，明日以指数和量能为主，不急于找主线');
  }

  const ladderTop = sentiment.maxBoards;
  if (ladderTop >= 3) {
    focus.push(`空间板在 ${ladderTop} 板，明日重点看最高板能否晋级——晋级则接力资金回归，失败则梯队重排`);
  } else {
    focus.push('连板高度不足3板，明日更适合做低吸和首板，不宜参与打板接力');
  }

  const t = boards?.marketStyle?.turnover;
  if (t && t.level !== 'unknown') {
    if (t.level === 'surge' || t.level === 'up') {
      focus.push(`量能${t.label}（${t.amountText}），明日若能维持在这个量级，轮动会继续活跃`);
    } else if (t.level === 'flat') {
      focus.push(`量能与5日均量持平（${t.amountText}），存量博弈格局，明日仍以轮动对待`);
    } else {
      risks.push(`量能${t.label}（${t.amountText}），承接不足，明日反弹高度需要放量验证`);
    }
  }

  const style = boards?.marketStyle?.styleTilt;
  if (style?.available && style.size?.winner) {
    focus.push(
      `风格上${style.size.winner}占优${
        style.flavor?.winner ? `、偏${style.flavor.winner}` : ''
      }，选股先对上风格再看个股`
    );
  }

  const dominant = boards?.marketStyle?.boardStyle?.dominant;
  if (dominant) {
    focus.push(`资金主导方向是${dominant}，明日在这个大类里找标的胜率更高`);
  }

  if (sentiment.level === 'freezing' || sentiment.level === 'cold') {
    risks.push(`情绪${sentiment.label}（${sentiment.score}分），明日首要任务是等止跌信号，不是找票`);
  }
  if (sentiment.level === 'hot') {
    risks.push(`情绪${sentiment.label}（${sentiment.score}分），明日高位股容易分歧，注意兑现`);
  }
  if (sentiment.sealRate != null && sentiment.sealRate < 0.65) {
    risks.push(`封板率仅 ${(sentiment.sealRate * 100).toFixed(0)}%，涨停普遍守不住，明日打板需格外谨慎`);
  }

  const weakIdx = (indexRows || []).filter((x) => x.changePct < 0).length;
  if (weakIdx >= 5) {
    risks.push('主要指数普跌，明日先看指数能否收回，不宜逆势重仓');
  }

  return { focus, risks };
}

/**
 * 生成当日复盘
 *
 * @param {{ top?: number, withNews?: boolean, onProgress?: Function, now?: import('dayjs').Dayjs }} opts
 */
export async function analyzeDailyReview({
  top = 10,
  withNews = true,
  onProgress,
  now = dayjs(),
} = {}) {
  const phase = sessionPhase(now);
  const tradeDate = now.format('YYYY-MM-DD');
  const poolDate = now.format('YYYYMMDD');

  onProgress?.('拉取指数收盘表现...');
  const indexRows = await fetchIndexRealtime(REVIEW_INDICES).catch(() => []);

  onProgress?.('统计涨跌家数与涨停/跌停/炸板...');
  const [breadth, pools, strong] = await Promise.all([
    fetchMarketBreadth().catch(() => null),
    fetchLimitPools({ date: poolDate }).catch(() => null),
    fetchStrongCount().catch(() => null),
  ]);

  onProgress?.('统计板块强度与市场风格...');
  const boards = await analyzeBoardStrength({
    top,
    withMarket: true,
    // 复盘的主线是从涨停聚集推出来的，不需要再逐板块拉成分股；龙头看 npm run boards
    withLeaders: false,
    onProgress,
    now,
  });

  let hotNews = [];
  if (withNews) {
    onProgress?.('拉取今日热点新闻...');
    hotNews = await fetchTodayHotNews({ limit: 10 }).catch(() => []);
  }

  const ladder = buildLadder(pools?.limitUp || []);
  const limitUpSectors = buildLimitUpSectors(pools?.limitUp || []);
  const sentiment = scoreSentiment({ pools, breadth, strong });
  const mainLines = identifyMainLines({ boards, limitUpSectors });
  const tomorrow = buildTomorrowFocus({ sentiment, mainLines, boards, indexRows });

  const turnover = boards?.marketStyle?.turnover || null;
  const headline = [
    `情绪${sentiment.label}(${sentiment.score})`,
    breadth ? `涨${breadth.up}/跌${breadth.down}` : null,
    pools ? `涨停${pools.limitUpCount}/跌停${pools.limitDownCount}` : null,
    turnover && turnover.level !== 'unknown' ? turnover.label : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    generatedAt: now.format('YYYY-MM-DD HH:mm:ss'),
    tradeDate,
    phase,
    closed: !phase.live,
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
    strong,
    pools: pools
      ? {
          limitUpCount: pools.limitUpCount,
          limitDownCount: pools.limitDownCount,
          brokenCount: pools.brokenCount,
          limitUp: pools.limitUp,
          limitDown: pools.limitDown.slice(0, 10),
        }
      : null,
    ladder,
    limitUpSectors,
    sentiment,
    mainLines,
    tomorrow,
    boards,
    hotNews,
  };
}
