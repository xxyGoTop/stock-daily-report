/**
 * 资金流 / 行业 / 筹码集中度（东财公开字段 + K线近似筹码）
 */

import { toSecId } from '../crawl/eastmoney.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Referer: 'https://quote.eastmoney.com/',
      Accept: 'application/json,text/plain,*/*',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let t = await res.text();
  const m = t.match(/^[a-zA-Z0-9_]+\((.*)\)\s*$/s);
  if (m) t = m[1];
  return JSON.parse(t);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtYi(v) {
  const n = Number(v) || 0;
  const yi = n / 1e8;
  if (Math.abs(yi) >= 0.01) return `${yi >= 0 ? '+' : ''}${yi.toFixed(2)}亿`;
  const wan = n / 1e4;
  return `${wan >= 0 ? '+' : ''}${wan.toFixed(0)}万`;
}

/**
 * 批量补充行业 + 主力净流入占比（ulist 按 secid 批量）
 * @returns {Map<code, { industry, region, concepts, mainNetInflow, mainNetInflowPct }>}
 */
export async function fetchIndustryFundMap(codes = []) {
  const want = [...new Set(codes.map((c) => String(c).padStart(6, '0')))];
  const map = new Map();
  if (!want.length) return map;

  const fields = 'f12,f14,f100,f102,f103,f62,f184,f66,f72';
  for (let i = 0; i < want.length; i += 20) {
    const chunk = want.slice(i, i + 20);
    const secids = chunk.map((c) => toSecId(c)).join(',');
    try {
      const data = await fetchJson(
        `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${encodeURIComponent(secids)}&fields=${fields}`
      );
      for (const item of data?.data?.diff || []) {
        const code = String(item.f12).padStart(6, '0');
        map.set(code, {
          industry: String(item.f100 || '').trim() || '未知行业',
          region: String(item.f102 || '').trim(),
          concepts: String(item.f103 || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 6),
          mainNetInflow: num(item.f62),
          mainNetInflowPct: num(item.f184),
          superNetInflow: num(item.f66),
          bigNetInflow: num(item.f72),
        });
      }
    } catch {
      /* try next chunk */
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  // 行业兜底：ulist 缺行业时用 stock/get 的 f127
  for (const code of want) {
    const cur = map.get(code);
    if (cur?.industry && cur.industry !== '未知行业') continue;
    try {
      const data = await fetchJson(
        `https://push2.eastmoney.com/api/qt/stock/get?secid=${toSecId(code)}&fields=f57,f127,f100`
      );
      const ind = String(data?.data?.f127 || data?.data?.f100 || '').trim();
      if (!ind) continue;
      if (cur) cur.industry = ind;
      else map.set(code, { industry: ind, region: '', concepts: [], mainNetInflow: 0, mainNetInflowPct: 0 });
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 60));
  }

  return map;
}

/**
 * 单票资金流状态文案
 */
export function describeFundFlow({ mainNetInflow = 0, mainNetInflowPct = 0 } = {}) {
  const amt = fmtYi(mainNetInflow);
  const pct = Number(mainNetInflowPct) || 0;
  let status = '平衡';
  let level = 'neutral';
  if (mainNetInflow > 5e7 || pct >= 5) {
    status = '主力大幅流入';
    level = 'strong_in';
  } else if (mainNetInflow > 1e7 || pct >= 2) {
    status = '主力净流入';
    level = 'in';
  } else if (mainNetInflow < -5e7 || pct <= -5) {
    status = '主力大幅流出';
    level = 'strong_out';
  } else if (mainNetInflow < -1e7 || pct <= -2) {
    status = '主力净流出';
    level = 'out';
  } else if (Math.abs(mainNetInflow) < 5e6) {
    status = '资金博弈平衡';
    level = 'neutral';
  }

  return {
    status,
    level,
    text: `${status} ${amt}（占成交 ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%）`,
    mainNetInflow,
    mainNetInflowPct: +pct.toFixed(2),
  };
}

/**
 * 用日K线近似筹码分布，估算集中度（越低越集中）
 * 算法：按换手衰减历史筹码，把当日成交量均匀铺在 [low,high]
 * 集中度90 ≈ (P90高 - P90低) / 均价 * 100
 */
export function estimateChipConcentration(klines, { lookback = 90 } = {}) {
  if (!klines?.length || klines.length < 20) {
    return {
      concentration90: null,
      concentration70: null,
      avgCost: null,
      profitRatio: null,
      status: '数据不足',
      text: '筹码：K线不足',
    };
  }

  const rows = klines.slice(-Math.min(lookback, klines.length));
  const priceMin = Math.min(...rows.map((k) => k.low));
  const priceMax = Math.max(...rows.map((k) => k.high));
  if (!(priceMax > priceMin)) {
    return {
      concentration90: null,
      concentration70: null,
      avgCost: null,
      profitRatio: null,
      status: '数据不足',
      text: '筹码：价格区间无效',
    };
  }

  const bins = 60;
  const step = (priceMax - priceMin) / bins;
  const chip = new Array(bins).fill(0);

  for (const k of rows) {
    const turn = Math.min(Math.max((k.turnover || 0) / 100, 0.001), 0.35);
    // 衰减旧筹码
    for (let i = 0; i < bins; i++) chip[i] *= 1 - turn;

    const lo = Math.max(priceMin, k.low);
    const hi = Math.min(priceMax, k.high);
    const vol = Math.max(k.volume || 0, 1);
    const i0 = Math.max(0, Math.floor((lo - priceMin) / step));
    const i1 = Math.min(bins - 1, Math.floor((hi - priceMin) / step));
    const span = Math.max(1, i1 - i0 + 1);
    const add = vol / span;
    for (let i = i0; i <= i1; i++) chip[i] += add;
  }

  const total = chip.reduce((a, b) => a + b, 0) || 1;
  let cum = 0;
  let p5 = priceMin;
  let p15 = priceMin;
  let p85 = priceMax;
  let p95 = priceMax;
  let avgCost = 0;
  for (let i = 0; i < bins; i++) {
    const mid = priceMin + (i + 0.5) * step;
    avgCost += mid * (chip[i] / total);
    const prev = cum;
    cum += chip[i] / total;
    if (prev < 0.05 && cum >= 0.05) p5 = mid;
    if (prev < 0.15 && cum >= 0.15) p15 = mid;
    if (prev < 0.85 && cum >= 0.85) p85 = mid;
    if (prev < 0.95 && cum >= 0.95) p95 = mid;
  }

  const price = rows[rows.length - 1].close;
  let profit = 0;
  for (let i = 0; i < bins; i++) {
    const mid = priceMin + (i + 0.5) * step;
    if (mid <= price) profit += chip[i];
  }
  const profitRatio = +((profit / total) * 100).toFixed(1);
  const concentration90 = avgCost > 0 ? +(((p95 - p5) / avgCost) * 100).toFixed(1) : null;
  const concentration70 = avgCost > 0 ? +(((p85 - p15) / avgCost) * 100).toFixed(1) : null;

  // 集中度越低越集中（常见口径）
  let status = '分散';
  if (concentration90 != null) {
    if (concentration90 <= 8) status = '高度集中';
    else if (concentration90 <= 12) status = '较集中';
    else if (concentration90 <= 18) status = '中等集中';
    else if (concentration90 <= 25) status = '偏分散';
    else status = '分散';
  }

  return {
    concentration90,
    concentration70,
    avgCost: +avgCost.toFixed(2),
    profitRatio,
    cost90: [+p5.toFixed(2), +p95.toFixed(2)],
    status,
    text:
      concentration90 == null
        ? '筹码：暂无'
        : `筹码${status} 集中度90=${concentration90}%｜获利${profitRatio}%｜成本区 ${p5.toFixed(2)}-${p95.toFixed(2)}`,
  };
}

/**
 * 给候选卡片附加 industry / fundFlow / chips
 */
export async function attachMarketMeta(cards, { codeKlines = {}, onProgress } = {}) {
  if (!cards?.length) return cards;
  const codes = [...new Set(cards.map((c) => String(c.code).padStart(6, '0')))];
  onProgress?.(`补充行业/资金流（${codes.length} 只）...`);
  let map = new Map();
  try {
    map = await fetchIndustryFundMap(codes);
  } catch {
    map = new Map();
  }

  for (const c of cards) {
    const code = String(c.code).padStart(6, '0');
    const info = map.get(code) || {};
    const inflow = info.mainNetInflow ?? c.mainNetInflow ?? 0;
    const pct = info.mainNetInflowPct ?? c.mainNetInflowPct ?? 0;
    const fundFlow = describeFundFlow({
      mainNetInflow: inflow,
      mainNetInflowPct: pct,
    });
    const kl = codeKlines[code] || codeKlines[c.code] || c.klines || [];
    const chips =
      kl.length >= 20
        ? estimateChipConcentration(kl)
        : c.chips || estimateChipConcentration([]);

    c.industry = info.industry || c.industry || '未知行业';
    c.region = (info.region || c.region || '').replace(/^[-—]$/, '');
    c.concepts = info.concepts || c.concepts || [];
    c.mainNetInflow = inflow;
    c.mainNetInflowPct = pct;
    c.fundFlow = fundFlow;
    c.chips = chips;
  }
  return cards;
}

/** 单票东财详情兜底（行业） */
export async function fetchStockIndustry(code) {
  try {
    const secid = toSecId(code);
    const data = await fetchJson(
      `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f57,f58,f127,f100,f62,f184`
    );
    const d = data?.data || {};
    return {
      industry: String(d.f127 || d.f100 || '').trim(),
      mainNetInflow: num(d.f62),
      mainNetInflowPct: num(d.f184),
    };
  } catch {
    return { industry: '', mainNetInflow: 0, mainNetInflowPct: 0 };
  }
}
