/**
 * 自选股分析：输入多个代码，输出技术面 + 事件进展 + 买卖价
 */

import { fetchKlines, fetchActiveStocks } from '../crawl/eastmoney.js';
import { searchCninfoKeyword } from '../crawl/cninfo.js';
import { computeIndicators } from './indicators.js';
import { shortTermPrices, eventDrivenPrices } from './pricing.js';
import { inferProgress, listMajorEvents, seasonalPriority } from './progress.js';
import { classifyAnnouncement } from '../strategy/turnaround.js';
import { scoreShortTerm } from '../strategy/shortTerm.js';
import { buildSignalBoard } from './modules.js';
import { attachMarketMeta, describeFundFlow, estimateChipConcentration } from './marketMeta.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeCodes(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(/[\s,，;；|]+/);
  const codes = [];
  const seen = new Set();
  for (const item of raw) {
    const m = String(item).match(/(\d{6})/);
    if (!m) continue;
    const code = m[1];
    if (seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
  }
  return codes;
}

async function fetchQuoteName(code) {
  const c = String(code).padStart(6, '0');
  const prefix = c.startsWith('6') || c.startsWith('9') ? 'sh' : 'sz';
  try {
    const res = await fetch(`https://qt.gtimg.cn/q=${prefix}${c}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const text = await res.text();
    // v_sz000001="51~平安银行~000001~11.89~...
    const m = text.match(/="[^~]*~([^~]+)~(\d{6})~([^~]+)~([^~]+)~([^~]+)/);
    if (!m) return null;
    return {
      name: m[1],
      code: m[2],
      price: Number(m[3]) || 0,
      changePct: 0, // 后面用K线补
      prevClose: Number(m[4]) || 0,
    };
  } catch {
    return null;
  }
}

async function resolveQuotes(codes) {
  const nameMap = new Map();
  try {
    const stocks = await fetchActiveStocks({ pages: 4, pageSize: 100 });
    for (const s of stocks) {
      if (codes.includes(s.code)) nameMap.set(s.code, s);
    }
  } catch {
    /* ignore */
  }
  for (const code of codes) {
    if (nameMap.has(code)) continue;
    const q = await fetchQuoteName(code);
    if (q) {
      const changePct = q.prevClose ? ((q.price - q.prevClose) / q.prevClose) * 100 : 0;
      nameMap.set(code, {
        code,
        name: q.name,
        price: q.price,
        changePct,
        volumeRatio: 0,
        turnover: 0,
        amplitude: 0,
        mainNetInflow: 0,
      });
    }
    await sleep(80);
  }
  return nameMap;
}

async function fetchEventsForCode(code) {
  const hits = [];
  const seen = new Set();
  // 按股票代码检索近期公告，再本地分类
  try {
    const list = await searchCninfoKeyword('', { pages: 1, pageSize: 30, stock: code });
    // 若空 searchkey + stock 无效，再用代码作关键词
    const list2 = list.length
      ? list
      : await searchCninfoKeyword(code, { pages: 1, pageSize: 30 });

    for (const ann of list2) {
      const matched = (ann.codes || []).some((c) => c.code === code);
      if (!matched) continue;
      const cls = classifyAnnouncement(ann.title);
      if (!cls) continue;
      if (seen.has(ann.title)) continue;
      seen.add(ann.title);
      hits.push({
        type: cls.type,
        keyword: cls.keyword,
        certainty: cls.certainty,
        intentional: cls.intentional,
        title: ann.title,
        date: ann.date,
        url: ann.url,
      });
    }
  } catch {
    /* ignore */
  }
  return hits.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/**
 * @param {string[]|string} codesInput
 */
export async function analyzeCustomStocks(codesInput, { onProgress } = {}) {
  const codes = normalizeCodes(codesInput);
  if (!codes.length) {
    throw new Error('请至少输入一个6位股票代码，例如：npm run stock -- 600519 000001');
  }

  onProgress?.(`解析自选股 ${codes.length} 只：${codes.join(', ')}`);
  const quoteMap = await resolveQuotes(codes);
  const season = seasonalPriority();
  const cards = [];
  const codeKlines = {};

  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    onProgress?.(`[${i + 1}/${codes.length}] 分析 ${code}...`);
    const quote = quoteMap.get(code);
    let klines = [];
    try {
      klines = await fetchKlines(code, { limit: 90 });
    } catch {
      klines = [];
    }
    codeKlines[code] = klines;

    const ind = klines.length >= 30 ? computeIndicators(klines) : null;
    const stock = {
      code,
      name: quote?.name || code,
      price: quote?.price || ind?.price || klines.at(-1)?.close || 0,
      changePct: quote?.changePct ?? klines.at(-1)?.changePct ?? 0,
      volumeRatio: quote?.volumeRatio || 0,
      turnover: quote?.turnover || ind?.lastTurnover || 0,
      amplitude: quote?.amplitude || 0,
      mainNetInflow: quote?.mainNetInflow || 0,
      mainNetInflowPct: quote?.mainNetInflowPct || 0,
      industry: quote?.industry || '',
      region: quote?.region || '',
    };

    // 名称兜底：从公告带出
    const events = await fetchEventsForCode(code);
    if (stock.name === code && events.length) {
      /* keep code if unknown */
    }
    const isST = /ST/i.test(stock.name);
    const types = [...new Set(events.map((e) => e.type))];

    const progress = events.length
      ? inferProgress(events, types)
      : {
          direction: isST ? 'ST跟踪' : '五日线短线',
          stageLabel: ind ? (ind.aboveMa5 ? '站上MA5' : '跌破MA5') : '数据不足',
          progressText: ind
            ? `技术面：${ind.bullAlign ? '多头排列' : '非多头'} / ${ind.aboveMa5 ? '站上MA5' : '未站上MA5'}`
            : '暂无足够K线',
          nextAction: '结合自选逻辑继续跟踪',
          nextStageLabel: '下一交易日验证',
          expectWindow: '下一交易日',
          expectNote: '自选股以你的交易计划为准',
          timeline: [],
        };

    const majorEvents = listMajorEvents(events, 6);
    let techScore = null;
    if (ind && !isST) techScore = scoreShortTerm(stock, ind);

    const prices =
      isST || types.length
        ? eventDrivenPrices(
            { close: stock.price, changePct: stock.changePct },
            quote,
            { isST, ind }
          )
        : shortTermPrices(stock, ind || { price: stock.price, ma5: stock.price });

    let action = prices.action;
    let buyReason = prices.buyReason;
    let sellReason = prices.sellReason;

    if (techScore?.mustPass) {
      action = '技术面可关注买入';
      buyReason = `${prices.buyReason}；得分${techScore.score}`;
    } else if (
      ind?.brokenMa5 &&
      (stock.volumeRatio >= 1.2 || ind.lastVolume > ind.prevVolume * 1.2)
    ) {
      action = '卖出/止损';
      buyReason = '暂不买入：放量跌破五日线';
      sellReason = '放量跌破MA5，建议离场';
    }

    cards.push({
      code,
      name: stock.name,
      score: techScore?.score ?? (events[0]?.certainty || 0) * 20,
      price: stock.price,
      changePct: stock.changePct,
      volumeRatio: stock.volumeRatio,
      turnover: stock.turnover,
      industry: stock.industry || '未知行业',
      region: stock.region || '',
      mainNetInflow: stock.mainNetInflow || 0,
      mainNetInflowPct: stock.mainNetInflowPct || 0,
      fundFlow: describeFundFlow({
        mainNetInflow: stock.mainNetInflow || 0,
        mainNetInflowPct: stock.mainNetInflowPct || 0,
      }),
      chips: estimateChipConcentration(klines),
      direction: progress.direction || types.join('/') || (isST ? 'ST' : '自选'),
      category: '自选股',
      types,
      isST,
      certainty: events.reduce((m, e) => Math.max(m, e.certainty || 0), 0) || undefined,
      action,
      buyPrice: prices.buyPrice,
      sellPrice: prices.sellPrice,
      buyReason,
      sellReason,
      techEntry: prices.techEntry,
      techEntryText: prices.techEntryText,
      techSuitable: prices.techSuitable,
      ma5Ok: prices.ma5Ok,
      progress: progress.progressText,
      stageLabel: progress.stageLabel,
      nextAction: progress.nextAction,
      nextStageLabel: progress.nextStageLabel,
      expectWindow: progress.expectWindow,
      expectNote: progress.expectNote,
      timeline: progress.timeline || [],
      signalBoard: buildSignalBoard(ind),
      majorEvents: majorEvents.length
        ? majorEvents
        : (techScore?.reasons || []).slice(0, 4).map((t) => ({ date: '', title: t, type: '技术' })),
      indicators: ind
        ? {
            ma5: ind.ma5,
            ma10: ind.ma10,
            ma20: ind.ma20,
            bias5: ind.bias5,
            rsi6: ind.rsi6,
            macdGolden: ind.macdGolden,
            macdGreenShrinking: ind.macdGreenShrinking,
          }
        : null,
      mustPass: techScore?.mustPass,
      veto: techScore?.veto || [],
      season,
    });

    await sleep(120);
  }

  await attachMarketMeta(cards, { codeKlines, onProgress });

  return {
    codes,
    season,
    candidates: cards,
    scanned: codes.length,
    scoredCount: cards.length,
  };
}

export { normalizeCodes };
