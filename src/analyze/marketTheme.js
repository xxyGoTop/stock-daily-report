/**
 * 上个交易日 / 本交易日主流方向 & 推荐方向总结
 */

import dayjs from 'dayjs';
import { seasonalPriority } from './progress.js';
import { fetchTodayHotNews } from '../crawl/hotNews.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://quote.eastmoney.com/' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** 东财行业板块涨幅榜 */
export async function fetchSectorLeaders({ pageSize = 12 } = {}) {
  const hosts = ['https://push2delay.eastmoney.com', 'https://push2.eastmoney.com'];
  const query =
    `pn=1&pz=${pageSize}&po=1&np=1&fltt=2&invt=2&fid=f3` +
    `&fs=${encodeURIComponent('m:90+t:2')}` +
    `&fields=f12,f14,f2,f3,f4,f8,f104,f105`;

  for (const host of hosts) {
    try {
      const data = await fetchJson(`${host}/api/qt/clist/get?${query}`);
      const list = data?.data?.diff || [];
      return list.map((x) => ({
        code: String(x.f12),
        name: String(x.f14 || ''),
        changePct: Number(x.f3) || 0,
        price: Number(x.f2) || 0,
      }));
    } catch {
      /* next */
    }
  }
  return [];
}

function countDirections(items) {
  const map = new Map();
  for (const it of items) {
    const dirs = Array.isArray(it.direction)
      ? it.direction
      : String(it.direction || it.types?.join?.('/') || it.type || '短线技术')
          .split(/[\/,，]/)
          .map((s) => s.trim())
          .filter(Boolean);
    for (const d of dirs) {
      map.set(d, (map.get(d) || 0) + (it.score || 1));
    }
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, weight]) => ({ name, weight: Math.round(weight) }));
}

/**
 * 生成顶部方向总结
 */
export async function buildMarketBrief({
  shortCards = [],
  turnCards = [],
  indexSignals = null,
  now = dayjs(),
} = {}) {
  const season = seasonalPriority(now);
  let sectors = [];
  let hotNews = [];
  try {
    sectors = await fetchSectorLeaders({ pageSize: 10 });
  } catch {
    sectors = [];
  }
  try {
    hotNews = await fetchTodayHotNews({ limit: 15 });
  } catch {
    hotNews = [];
  }

  const hotSectors = sectors.slice(0, 5).map((s) => `${s.name}(${s.changePct >= 0 ? '+' : ''}${s.changePct.toFixed(1)}%)`);
  const weakSectors = [...sectors].sort((a, b) => a.changePct - b.changePct).slice(0, 3);

  const eventDirs = countDirections(turnCards);
  const techDirs = countDirections(
    shortCards.map((c) => ({
      direction: c.direction || (c.corporateEvent ? c.corporateEvent : '五日线短线'),
      score: c.score || 1,
    }))
  );

  const prevDayThemes =
    hotSectors.length > 0
      ? `板块热度靠前：${hotSectors.join('、')}`
      : '板块数据暂缺，以下一交易日候选方向为主';

  const currentThemes = [
    indexSignals?.summary || null,
    eventDirs[0] ? `事件线主线偏「${eventDirs[0].name}」` : null,
    techDirs[0] ? `正股技术线偏「${techDirs[0].name}」` : '正股以五日线共振为主',
    season.focusNote,
  ]
    .filter(Boolean)
    .join('；');

  const recommend = [];
  if (indexSignals?.marketCanBuy) {
    recommend.push('指数中期可买：可适当提高仓位，优先强势RPS个股');
  } else if (indexSignals?.marketSignal === 'watch') {
    recommend.push('指数观望：轻仓试错，等待更多指数确认');
  } else if (indexSignals?.marketSignal === 'avoid') {
    recommend.push('指数偏谨慎：控制仓位，少追高');
  }
  for (const name of season.order.slice(0, 3)) {
    const hit = eventDirs.find((d) => d.name === name);
    if (hit) recommend.push(`${name}（候选加权高）`);
    else recommend.push(`${name}（季节性优先跟踪）`);
  }
  if (shortCards.some((c) => (c.taoTags || []).includes('率先年新高'))) {
    recommend.push('有个股率先一年新高：优先在主流板块里选，重点看当日涨幅榜第一版');
  }
  if (shortCards.some((c) => (c.taoTags || []).includes('深调高RPS回升'))) {
    recommend.push('高RPS深调回升标的：第1/第2基底可参与，第3个基底起谨慎');
  }
  if (shortCards.some((c) => (c.taoTags || []).includes('顺向火车轨'))) {
    recommend.push('顺向火车轨命中，优先看RPS250高、右侧年高、10日线下买点');
  }
  if (shortCards.some((c) => (c.taoTags || []).includes('每日观察'))) {
    recommend.push('火车每日观察（高RPS年高附近）命中');
  }
  if (shortCards.some((c) => (c.taoTags || []).includes('蓝色钻石'))) {
    recommend.push('蓝色钻石观察池（等口袋支点，勿追涨）');
  }
  if (indexSignals?.etfs?.length) {
    for (const e of indexSignals.etfs) {
      if ((e.action || '').includes('买入') || e.signal === 'buy') {
        recommend.push(`${e.name}(${e.code})：技术线偏买入`);
      } else if ((e.action || '').includes('卖出') || e.signal === 'sell') {
        recommend.push(`${e.name}(${e.code})：技术线偏卖出/减仓`);
      }
    }
  }
  if (shortCards.some((c) => (c.action || '').includes('买入'))) {
    recommend.push('五日线多头共振短线（严格止损）');
  }

  const riskNotes = [];
  if (weakSectors.length) {
    riskNotes.push(`注意走弱板块：${weakSectors.map((s) => s.name).join('、')}`);
  }
  if (indexSignals?.ruleNote) riskNotes.push(indexSignals.ruleNote);
  if (now.day() === 0 || now.day() === 6) {
    riskNotes.push('今日非交易日，方向总结沿用最近收盘数据，下个交易日再验证');
  }

  return {
    season,
    hotNews,
    prevTradingDay: {
      title: '上个交易日主流方向',
      summary: prevDayThemes,
      sectors: sectors.slice(0, 8),
    },
    currentSession: {
      title: '本交易日 / 下一交易日主线判断',
      summary: currentThemes,
      eventDirs,
      techDirs,
    },
    recommend: {
      title: '推荐方向',
      items: recommend,
      note: season.label,
    },
    indexSignals,
    riskNotes,
    generatedAt: now.format('YYYY-MM-DD HH:mm:ss'),
  };
}
