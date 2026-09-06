/**
 * 板块二：困境反转类（ST摘帽 / 重整 / 重组 / 股权转让 / 要约收购）
 * 11月前优先重整重组转让要约；11月后优先摘帽
 */

import { fetchStStocks, fetchKlines, toSecId } from '../crawl/eastmoney.js';
import { fetchTurnaroundAnnouncements } from '../crawl/cninfo.js';
import {
  inferProgress,
  listMajorEvents,
  seasonalPriority,
} from '../analyze/progress.js';
import { eventDrivenPrices } from '../analyze/pricing.js';
import { computeIndicators } from '../analyze/indicators.js';
import { buildSignalBoard } from '../analyze/modules.js';
import { describeFundFlow, estimateChipConcentration } from '../analyze/marketMeta.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchLiveNames(codes = []) {
  const map = new Map();
  const uniq = [...new Set(codes.map((c) => String(c).padStart(6, '0')))];
  for (let i = 0; i < uniq.length; i += 20) {
    const chunk = uniq.slice(i, i + 20);
    const secids = chunk.map((c) => toSecId(c)).join(',');
    try {
      const res = await fetch(
        `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${encodeURIComponent(secids)}&fields=f12,f14`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0',
            Referer: 'https://quote.eastmoney.com/',
          },
        }
      );
      let t = await res.text();
      const m = t.match(/^[a-zA-Z0-9_]+\((.*)\)\s*$/s);
      if (m) t = m[1];
      const data = JSON.parse(t);
      for (const item of data?.data?.diff || []) {
        map.set(String(item.f12).padStart(6, '0'), String(item.f14 || ''));
      }
    } catch {
      /* ignore */
    }
    await sleep(80);
  }
  return map;
}

export const EVENT_RULES = [
  {
    type: '摘帽',
    keywords: ['撤销风险警示', '摘帽', '撤销退市风险警示', '申请撤销风险警示', '申请撤销'],
    certainty: {
      撤销风险警示: 5,
      申请撤销风险警示: 4,
      申请撤销: 4,
      撤销退市风险警示: 5,
      摘帽: 3,
    },
  },
  {
    type: '重整',
    keywords: [
      '法院裁定批准重整',
      '裁定受理重整',
      '选定重整投资人',
      '签署《重整投资协议',
      '签署《预重整投资协议',
      '重整投资协议',
      '继续延长预重整',
      '延长预重整',
      '公开招募和遴选重整投资人',
      '公开招募重整投资人',
      '重整计划',
      '破产重整',
      '重整投资',
      '指定管理人',
      '债权人会议',
      '预重整',
    ],
    certainty: {
      法院裁定批准重整: 5,
      裁定受理重整: 4,
      '选定重整投资人': 4,
      '签署《重整投资协议': 4,
      '签署《预重整投资协议': 4,
      重整投资协议: 4,
      重整计划: 4,
      指定管理人: 3,
      债权人会议: 3,
      重整投资: 3,
      公开招募重整投资人: 3,
      公开招募和遴选重整投资人: 3,
      延长预重整: 3,
      继续延长预重整: 3,
      破产重整: 2,
      预重整: 2,
    },
  },
  {
    type: '重组',
    keywords: ['重大资产重组', '重组预案', '重组报告书', '筹划重大资产重组', '资产重组'],
    certainty: {
      重组报告书: 4,
      重组预案: 4,
      重大资产重组: 3,
      筹划重大资产重组: 2,
      资产重组: 2,
    },
  },
  {
    type: '股权转让',
    keywords: [
      '股份转让协议',
      '公开征集方式转让',
      '公开征集受让方',
      '控制权变更',
      '协议转让',
      '权益变动',
      '详式权益变动报告书',
      '意向性协议',
    ],
    certainty: {
      详式权益变动报告书: 4,
      股份转让协议: 4,
      公开征集方式转让: 3,
      公开征集受让方: 3,
      控制权变更: 3,
      协议转让: 3,
      权益变动: 2,
      意向性协议: 1,
    },
  },
  {
    type: '要约收购',
    keywords: ['要约收购报告书', '要约收购', '要约收购提示性公告', '要约期'],
    certainty: {
      要约收购报告书: 5,
      要约收购提示性公告: 4,
      要约期: 3,
      要约收购: 3,
    },
  },
];

export const SEARCH_KEYWORDS = [
  '撤销风险警示',
  '申请撤销',
  '重整投资人',
  '预重整投资协议',
  '重整投资协议',
  '破产重整',
  '重整计划',
  '裁定受理重整',
  '预重整',
  '重大资产重组',
  '重组预案',
  '股份转让协议',
  '控制权变更',
  '协议转让',
  '要约收购',
  '要约收购报告书',
];

export function classifyAnnouncement(title) {
  for (const rule of EVENT_RULES) {
    for (const kw of rule.keywords) {
      if (title.includes(kw)) {
        const certainty = rule.certainty[kw] ?? 2;
        // 「拟/可能」降级：已签署协议、公开征集转让等正式节点不再当纯意向
        const softIntent = /意向|筹划|拟|可能/.test(title);
        const formalNode =
          /签署.*股份转让协议|股份转让协议|详式权益变动|要约收购报告书|公开征集方式转让|公开征集受让方/.test(
            title
          );
        const intentional = softIntent && !formalNode;
        return {
          type: rule.type,
          keyword: kw,
          certainty: intentional ? Math.max(1, certainty - 2) : certainty,
          intentional,
        };
      }
    }
  }
  return null;
}

function riskFlags(title) {
  const flags = [];
  if (/终止|失败|驳回|不予|无法|中止|撤回/.test(title)) flags.push('负面/终止信号');
  if (/问询|补充材料|核查/.test(title)) flags.push('监管问询/补充材料');
  if (/延期/.test(title)) flags.push('进度延期');
  if (/子公司|孙公司|控股子公司/.test(title) && /重整|破产|重组/.test(title)) {
    flags.push('非上市公司本体事件');
  }
  if (/控股股东|间接控股股东/.test(title) && /破产重整|重整/.test(title)) {
    flags.push('非上市公司本体事件');
  }
  return flags;
}

export function aggregateTurnaround(announcements, stMap = new Map(), season = seasonalPriority()) {
  const byCode = new Map();

  for (const ann of announcements) {
    const cls = classifyAnnouncement(ann.title);
    if (!cls) continue;
    const flags = riskFlags(ann.title);
    const stocks = ann.codes?.length ? ann.codes : [{ code: '', name: '' }];

    for (const s of stocks) {
      if (!s.code || !/^\d{6}$/.test(s.code)) continue;
      if (!byCode.has(s.code)) {
        byCode.set(s.code, {
          code: s.code,
          name: s.name || stMap.get(s.code)?.name || '',
          events: [],
          maxCertainty: 0,
          types: new Set(),
          titles: [],
          riskFlags: new Set(),
          score: 0,
        });
      }
      const row = byCode.get(s.code);
      if (!row.name && s.name) row.name = s.name;
      row.events.push({
        type: cls.type,
        keyword: cls.keyword,
        certainty: cls.certainty,
        intentional: cls.intentional,
        title: ann.title,
        date: ann.date,
        url: ann.url,
      });
      row.types.add(cls.type);
      row.titles.push(ann.title);
      flags.forEach((f) => row.riskFlags.add(f));
      row.maxCertainty = Math.max(row.maxCertainty, cls.certainty);
    }
  }

  const list = [...byCode.values()].map((row) => {
    const types = [...row.types];
    const quote = stMap.get(row.code);
    const liveName = quote?.name || row.name;
    const companyLevel = row.events.some(
      (e) =>
        e.certainty >= 3 &&
        !/控股股东|间接控股股东|子公司|孙公司/.test(e.title || '')
    );
    let flags = [...row.riskFlags];
    if (companyLevel) {
      flags = flags.filter((f) => !f.includes('非上市公司本体'));
    }

    let score = row.maxCertainty * 15;
    score += types.length * 5;
    score += Math.min(row.events.length, 5) * 3;
    if (/ST/i.test(liveName) || /ST/i.test(row.name)) score += 6;
    if (row.events.some((e) => e.certainty >= 4 && !e.intentional)) score += 12;
    for (const t of types) score += season.boost[t] || 0;
    score -= flags.length * 8;
    if (flags.some((f) => f.includes('终止'))) score -= 20;
    if (flags.some((f) => f.includes('非上市公司'))) score -= 12;

    // 近期进展加权：刚披露的重整动作优先于陈旧摘帽/历史节点
    const latestTs = row.events.reduce((max, e) => {
      const t = Date.parse(String(e.date || '').replace(/-/g, '/'));
      return Number.isFinite(t) && t > max ? t : max;
    }, 0);
    if (latestTs) {
      const days = (Date.now() - latestTs) / 86400000;
      if (days <= 21) score += 22;
      else if (days <= 45) score += 14;
      else if (days <= 90) score += 8;
      else if (days <= 200 && types.includes('重整') && row.maxCertainty >= 4) score += 10;
    }
    // 仍在预重整程序中（法院延期续期）略加权
    if (row.events.some((e) => /延长预重整|继续延长预重整/.test(e.keyword || ''))) {
      score += 28;
    }

    const progress = inferProgress(row.events, types);
    const majorEvents = listMajorEvents(row.events, 6);

    return {
      ...row,
      name: /ST/i.test(liveName) ? liveName : row.name,
      types,
      riskFlags: flags,
      score,
      quote: quote || null,
      progress,
      majorEvents,
      isST: /ST/i.test(liveName) || /ST/i.test(row.name),
    };
  });

  return list
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.maxCertainty - a.maxCertainty);
}

export function buildTurnaroundOps(ranked) {
  const watch = [];
  const avoid = [];
  const focus = [];

  for (const r of ranked) {
    if (r.riskFlags.some((f) => f.includes('终止'))) {
      avoid.push(r);
      continue;
    }
    if (r.maxCertainty >= 4 && r.score >= 50) focus.push(r);
    else if (r.maxCertainty >= 2) watch.push(r);
    else avoid.push(r);
  }
  return { focus, watch, avoid };
}

function eventRecencyDays(row) {
  const latestTs = (row.events || []).reduce((max, e) => {
    const t = Date.parse(String(e.date || '').replace(/-/g, '/'));
    return Number.isFinite(t) && t > max ? t : max;
  }, 0);
  if (!latestTs) return 9999;
  return (Date.now() - latestTs) / 86400000;
}

function pickCandidates(ops, season, maxCandidates, { preferTypes = [] } = {}) {
  const pool = [...ops.focus, ...ops.watch].sort(
    (a, b) => b.score - a.score || b.maxCertainty - a.maxCertainty
  );
  const picked = [];
  const seen = new Set();

  const prefer = preferTypes.length ? preferTypes : season.order.slice(0, 1);
  const main = prefer[0];
  const preferQuota =
    main === '重整' || main === '摘帽'
      ? maxCandidates
      : Math.min(maxCandidates, Math.max(6, Math.ceil(maxCandidates * 0.55)));

  for (const t of prefer) {
    const bucket = pool.filter((r) => r.types.includes(t) && !seen.has(r.code));
    let ordered = bucket;
    if (t === '重整') {
      const byScore = (a, b) => b.score - a.score || b.maxCertainty - a.maxCertainty;
      const recent = bucket.filter((r) => eventRecencyDays(r) <= 30).sort(byScore);
      const older = bucket.filter((r) => eventRecencyDays(r) > 30).sort(byScore);
      const recentQuota = Math.min(8, Math.max(5, Math.ceil(preferQuota * 0.4)));
      const head = recent.slice(0, recentQuota);
      const headCodes = new Set(head.map((r) => r.code));
      ordered = [...head, ...bucket.filter((r) => !headCodes.has(r.code)).sort(byScore)];
    }
    for (const r of ordered) {
      if (picked.length >= preferQuota) break;
      if (seen.has(r.code)) continue;
      seen.add(r.code);
      picked.push(r);
    }
  }

  if (picked.length >= maxCandidates) return picked.slice(0, maxCandidates);

  const buckets = Object.fromEntries(
    season.order.map((t) => [t, pool.filter((r) => r.types.includes(t) && !seen.has(r.code))])
  );

  let guard = 0;
  while (picked.length < maxCandidates && guard < 120) {
    guard += 1;
    let added = false;
    for (const t of season.order) {
      if (picked.length >= maxCandidates) break;
      while (buckets[t]?.length) {
        const r = buckets[t].shift();
        if (seen.has(r.code)) continue;
        seen.add(r.code);
        picked.push(r);
        added = true;
        break;
      }
    }
    if (!added) break;
  }
  return picked.slice(0, maxCandidates);
}

function enrichCandidate(c) {
  const prices = eventDrivenPrices(c.latest, c.quote, { isST: c.isST });
  const progress = c.progress || inferProgress(c.events, c.types);
  const majorEvents = c.majorEvents || listMajorEvents(c.events, 6);
  const signalBoard =
    c.signalBoard ||
    (c.ind ? buildSignalBoard(c.ind) : buildSignalBoard(null));

  let action = prices.action;
  let buyReason = prices.buyReason;
  let sellReason = prices.sellReason;

  if (c.maxCertainty >= 4 && !c.riskFlags.length) {
    action = '小仓买入关注';
    buyReason = `${progress.progressText}；确定性${c.maxCertainty}/5。${prices.buyReason}`;
  } else if (c.riskFlags.some((f) => f.includes('问询'))) {
    action = '观望';
    buyReason = '存在问询/补充材料，暂缓买入';
    sellReason = '若已持仓，问询反复则优先减仓';
  } else if (c.riskFlags.some((f) => f.includes('终止'))) {
    action = '卖出/回避';
    buyReason = '事件终止信号，不买入';
    sellReason = '节点落空，立即离场';
  }

  const quote = c.quote || {};
  const fundFlow = describeFundFlow({
    mainNetInflow: quote.mainNetInflow || 0,
    mainNetInflowPct: quote.mainNetInflowPct || 0,
  });
  const chips = estimateChipConcentration(c.klines);

  return {
    code: c.code,
    name: c.name,
    score: c.score,
    types: c.types,
    direction: progress.direction,
    isST: c.isST,
    certainty: c.maxCertainty,
    riskFlags: c.riskFlags,
    price: c.latest?.close ?? c.quote?.price,
    changePct: c.latest?.changePct ?? c.quote?.changePct,
    industry: quote.industry || '未知行业',
    region: quote.region || '',
    mainNetInflow: quote.mainNetInflow || 0,
    mainNetInflowPct: quote.mainNetInflowPct || 0,
    fundFlow,
    chips,
    action,
    buyPrice: prices.buyPrice,
    sellPrice: prices.sellPrice,
    buyReason,
    sellReason,
    progress: progress.progressText,
    stageLabel: progress.stageLabel,
    nextAction: progress.nextAction,
    nextStageLabel: progress.nextStageLabel,
    expectWindow: progress.expectWindow,
    expectNote: progress.expectNote,
    timeline: progress.timeline,
    majorEvents,
    signalBoard,
    titles: c.titles.slice(0, 5),
    events: c.events.slice(0, 8),
    latest: c.latest || null,
  };
}

export async function runTurnaroundStrategy({
  maxCandidates = 15,
  pagesPerKeyword = 2,
  lookbackDays = 200,
  onProgress,
  nonSTOnly = false,
  stOnly = false,
} = {}) {
  const season = seasonalPriority();
  onProgress?.(`巨潮检索困境反转公告（${season.label}，回看${lookbackDays}天）...`);
  const anns = await fetchTurnaroundAnnouncements(SEARCH_KEYWORDS, {
    pagesPerKeyword,
    lookbackDays,
  });
  onProgress?.(`命中公告 ${anns.length} 条，拉取ST列表辅助...`);

  let stList = [];
  try {
    stList = await fetchStStocks({ pages: 8, pageSize: 100 });
  } catch {
    stList = [];
  }
  const stMap = new Map(stList.map((s) => [s.code, s]));
  onProgress?.(`ST行情池 ${stList.length} 只`);

  for (const ann of anns) {
    for (const c of ann.codes || []) {
      const q = stMap.get(c.code);
      if (q?.name) {
        if (!c.name || (/ST/i.test(q.name) && !/ST/i.test(c.name))) c.name = q.name;
      }
    }
  }

  let ranked = aggregateTurnaround(anns, stMap, season);

    // 用实时简称纠正「公告名无ST前缀」导致的模块错分（如雪浪环境→ST雪浪）
  try {
    const live = await fetchLiveNames(ranked.map((r) => r.code));
    for (const r of ranked) {
      const nm = live.get(String(r.code).padStart(6, '0'));
      if (!nm) continue;
      if (/ST/i.test(nm)) {
        const wasST = r.isST;
        r.name = nm;
        r.isST = true;
        if (!wasST) r.score += 6; // 补回 ST 加分
        if (!r.quote) r.quote = { code: r.code, name: nm };
        else r.quote.name = nm;
      }
    }
    ranked.sort((a, b) => b.score - a.score || b.maxCertainty - a.maxCertainty);
  } catch {
    /* ignore */
  }

  if (stOnly) ranked = ranked.filter((r) => r.isST || /ST/i.test(r.name));
  if (nonSTOnly) ranked = ranked.filter((r) => !r.isST && !/ST/i.test(r.name));

  const ops = buildTurnaroundOps(ranked);

  // 分别多取 ST 与 非ST事件，供三模块拆分
  const stPool = {
    focus: ops.focus.filter((r) => r.isST),
    watch: ops.watch.filter((r) => r.isST),
  };
  const eventPool = {
    focus: ops.focus.filter((r) => !r.isST),
    watch: ops.watch.filter((r) => !r.isST),
  };
  const preferTypes = season.order[0] === '重整' ? ['重整'] : season.order.slice(0, 1);
  // ST 重整池略放宽，减少“有进展却挤不进15”的漏选
  const stMax =
    preferTypes[0] === '重整' ? Math.min(25, maxCandidates + 10) : maxCandidates;
  const stPicked = pickCandidates(stPool, season, stMax, { preferTypes });
  const eventPicked = pickCandidates(eventPool, season, maxCandidates, { preferTypes });
  const pickedMap = new Map();
  for (const r of [...stPicked, ...eventPicked]) pickedMap.set(r.code, r);
  const picked = [...pickedMap.values()];

  onProgress?.(`为前 ${picked.length} 只补行情/乖离/MACD...`);
  for (let i = 0; i < picked.length; i++) {
    const c = picked[i];
    try {
      const kl = await fetchKlines(c.code, { limit: 80 });
      if (kl.length) {
        const last = kl[kl.length - 1];
        c.latest = {
          date: last.date,
          close: last.close,
          changePct: last.changePct,
          turnover: last.turnover,
        };
        c.klines = kl;
        if (kl.length >= 30) {
          c.ind = computeIndicators(kl);
          c.signalBoard = buildSignalBoard(c.ind);
        }
      }
    } catch {
      /* ignore */
    }
    await sleep(100);
  }

  const candidates = picked.map(enrichCandidate);

  return {
    season,
    announcementHits: anns.length,
    rankedCount: ranked.length,
    candidates,
    ops: {
      focus: ops.focus.slice(0, maxCandidates).map(enrichCandidate),
      watch: ops.watch.slice(0, 10).map(enrichCandidate),
      avoid: ops.avoid.slice(0, 10).map(enrichCandidate),
    },
    sampleAnnouncements: anns.slice(0, 20),
    // 供正股板块合并：非ST的转让/要约/重组
    nonStEvents: ranked.filter((r) => !r.isST).slice(0, 30),
  };
}

export function summarizeTurnaroundActions(result) {
  const today = [];
  const tomorrow = [];

  for (const c of result.candidates.slice(0, 15)) {
    today.push({
      code: c.code,
      name: c.name,
      type: c.types.join('/'),
      direction: c.direction,
      action: c.action,
      certainty: `${c.certainty}/5`,
      reason: c.buyReason,
      sellReason: c.sellReason,
      buyPrice: c.buyPrice,
      sellPrice: c.sellPrice,
      progress: c.progress,
      expectWindow: c.expectWindow,
      score: c.score,
      riskFlags: c.riskFlags,
      price: c.price,
      changePct: c.changePct,
      majorEvents: c.majorEvents,
    });

    tomorrow.push({
      code: c.code,
      name: c.name,
      action: `下一节点：${c.nextAction}；敏感窗口 ${c.expectWindow}`,
      reason: `${c.progress}｜买 ${c.buyPrice}｜卖 ${c.sellPrice}`,
      buyPrice: c.buyPrice,
      sellPrice: c.sellPrice,
    });
  }

  return { today, tomorrow };
}
