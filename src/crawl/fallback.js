/**
 * 东财断联时的跨平台兜底（新浪 / 腾讯）
 *
 * 日K早已三源轮换；这里补的是「列表 / 实时报价 / 涨跌家数 / 行情时钟」——
 * 这些以前只走东财 push2，节点挂了整条选股链路就空。
 *
 * 降级数据比东财瘦：没有主力净流入、行业分类经常缺，够算技术面与盘面宽度即可。
 */

import { cleanStockName, readResponseText } from './decode.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function marketFlag(code) {
  const c = String(code).padStart(6, '0');
  return /^[695]/.test(c) ? 1 : 0; // 与东财 f13：0深 1沪
}

/** 指数必须显式传 market，否则 000001 会被当成平安银行 */
function toSym(code, market) {
  const c = String(code).padStart(6, '0');
  const m = market || (/^[695]/.test(c) ? 'sh' : 'sz');
  return `${m}${c}`;
}

/** 本次运行用了哪个报价源，供报告标注 */
let lastListSource = 'eastmoney';
let lastQuoteSource = 'eastmoney';

export function getFallbackSources() {
  return { list: lastListSource, quote: lastQuoteSource };
}

export function noteListSource(src) {
  lastListSource = src;
}

export function noteQuoteSource(src) {
  lastQuoteSource = src;
}

/**
 * 新浪全市场行情中心分页（按成交额）
 * https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData
 */
export async function fetchActiveStocksSina({ pages = 8, pageSize = 100 } = {}) {
  const all = [];
  const size = Math.min(100, Math.max(20, pageSize));

  for (let page = 1; page <= pages; page++) {
    const url =
      `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData` +
      `?page=${page}&num=${size}&sort=amount&asc=0&node=hs_a&symbol=&_s_r_a=init`;
    let list = [];
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Referer: 'https://vip.stock.finance.sina.com.cn/',
          Accept: 'application/json,text/plain,*/*',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const data = JSON.parse(text);
      list = Array.isArray(data) ? data : [];
    } catch (err) {
      if (!all.length) throw err;
      break;
    }
    if (!list.length) break;

    for (const item of list) {
      const code = String(item.code || '').padStart(6, '0');
      const name = cleanStockName(item.name);
      if (!code || !name) continue;
      if (/^(4|8|92)/.test(code)) continue;
      const open = num(item.open);
      const high = num(item.high);
      const low = num(item.low);
      const prevClose = num(item.settlement);
      const price = num(item.trade);
      const amplitude =
        prevClose > 0 && high > 0 && low > 0 ? ((high - low) / prevClose) * 100 : 0;
      all.push({
        code,
        market: marketFlag(code),
        name,
        price,
        changePct: num(item.changepercent),
        volume: num(item.volume) / 100, // 新浪是股，东财列表是手
        amount: num(item.amount),
        amplitude,
        turnover: num(item.turnoverratio),
        pe: num(item.per),
        volumeRatio: 0,
        high,
        low,
        open,
        prevClose,
        totalMV: num(item.mktcap) * 10000, // 新浪万元 → 元
        circMV: num(item.nmc) * 10000,
        mainNetInflow: 0,
        mainNetInflowPct: 0,
        industry: '',
        region: '',
        _source: 'sina',
      });
    }
    await sleep(160);
  }

  noteListSource('sina');
  return all;
}

/**
 * 腾讯批量实时报价
 * @param {{code:string,market?:'sh'|'sz'}[]} items
 * @returns {Promise<Map<string, object>>}
 */
export async function fetchTencentBatchQuotes(items = []) {
  const map = new Map();
  if (!items.length) return map;

  const chunkSize = 60;
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const symbols = chunk.map((it) => toSym(it.code, it.market)).join(',');
    try {
      const res = await fetch(`https://qt.gtimg.cn/q=${symbols}`, {
        headers: { 'User-Agent': UA, Referer: 'https://gu.qq.com/' },
      });
      if (!res.ok) continue;
      const text = await readResponseText(res);
      for (const line of text.split(';')) {
        const m = line.match(/v_(\w+)="(.*)"/);
        if (!m) continue;
        const p = m[2].split('~');
        if (p.length < 5) continue;
        const code = String(p[2] || m[1].replace(/^(sh|sz)/, '')).padStart(6, '0');
        const name = cleanStockName(p[1]);
        if (!name) continue;
        const price = num(p[3]);
        const prevClose = num(p[4]);
        const open = num(p[5]);
        const high = num(p[33]);
        const low = num(p[34]);
        map.set(code, {
          code,
          name,
          price,
          prevClose,
          open,
          high,
          low,
          changePct: num(p[32]),
          volume: num(p[6]),
          amount: num(p[37]) * 1e4, // 万元 → 元
          turnover: num(p[38]),
          amplitude: num(p[43]),
          volumeRatio: num(p[49]),
          quoteTime: String(p[30] || ''),
          _source: 'tencent',
        });
      }
    } catch {
      /* 本批失败继续下一批 */
    }
    if (i + chunkSize < items.length) await sleep(80);
  }

  if (map.size) noteQuoteSource('tencent');
  return map;
}

/**
 * 新浪 hq.sinajs 批量报价（字段比腾讯少，作第二兜底）
 */
export async function fetchSinaBatchQuotes(items = []) {
  const map = new Map();
  if (!items.length) return map;

  const chunkSize = 50;
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const symbols = chunk.map((it) => toSym(it.code, it.market)).join(',');
    try {
      const res = await fetch(`https://hq.sinajs.cn/list=${symbols}`, {
        headers: {
          'User-Agent': UA,
          Referer: 'https://finance.sina.com.cn/',
        },
      });
      if (!res.ok) continue;
      const text = await readResponseText(res);
      for (const line of text.split('\n')) {
        const m = line.match(/hq_str_(\w+)="(.*)"/);
        if (!m || !m[2]) continue;
        const p = m[2].split(',');
        if (p.length < 10) continue;
        const code = m[1].replace(/^(sh|sz)/, '').padStart(6, '0');
        const name = cleanStockName(p[0]);
        const open = num(p[1]);
        const prevClose = num(p[2]);
        const price = num(p[3]);
        const high = num(p[4]);
        const low = num(p[5]);
        const changePct = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
        map.set(code, {
          code,
          name,
          price,
          prevClose,
          open,
          high,
          low,
          changePct,
          volume: num(p[8]) / 100,
          amount: num(p[9]),
          turnover: 0,
          amplitude: prevClose ? ((high - low) / prevClose) * 100 : 0,
          volumeRatio: 0,
          quoteTime: `${p[30] || ''} ${p[31] || ''}`.trim(),
          _source: 'sina',
        });
      }
    } catch {
      /* next chunk */
    }
  }

  if (map.size) noteQuoteSource('sina');
  return map;
}

/** 指数/个股实时：腾讯优先，新浪补漏 */
export async function fetchQuotesFallback(items = []) {
  let map = await fetchTencentBatchQuotes(items);
  const missing = items.filter((it) => !map.has(String(it.code).padStart(6, '0')));
  if (missing.length) {
    const sina = await fetchSinaBatchQuotes(missing);
    for (const [k, v] of sina) map.set(k, v);
  }
  return map;
}

/**
 * 用新浪全市场列表估算涨跌家数（东财指数 f104/105/106 不可用时）
 * 翻页扫 hs_a，通常 50+ 页；兜底场景可接受慢一点。
 */
export async function fetchMarketBreadthSina({ maxPages = 60 } = {}) {
  let up = 0;
  let down = 0;
  let flat = 0;
  let scanned = 0;

  for (let page = 1; page <= maxPages; page++) {
    const url =
      `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData` +
      `?page=${page}&num=100&sort=changepercent&asc=0&node=hs_a&symbol=&_s_r_a=init`;
    let list = [];
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Referer: 'https://vip.stock.finance.sina.com.cn/',
        },
      });
      if (!res.ok) break;
      const data = JSON.parse(await res.text());
      list = Array.isArray(data) ? data : [];
    } catch {
      break;
    }
    if (!list.length) break;
    for (const item of list) {
      const name = cleanStockName(item.name);
      if (!name || /ST/i.test(name)) continue;
      const chg = num(item.changepercent);
      scanned += 1;
      if (chg > 0.005) up += 1;
      else if (chg < -0.005) down += 1;
      else flat += 1;
    }
    if (list.length < 100) break;
    await sleep(120);
  }

  const total = up + down + flat;
  if (!total) return null;

  noteQuoteSource('sina');
  return {
    up,
    down,
    flat,
    total,
    upRatio: +(up / total).toFixed(3),
    detail: [{ name: '沪深A股(新浪扫表)', up, down, flat }],
    _source: 'sina',
  };
}

/** 强势股家数：新浪按涨幅翻页，低于阈值即停 */
export async function fetchStrongCountSina({ maxPages = 8 } = {}) {
  let over5 = 0;
  let over7 = 0;
  let scanned = 0;

  for (let page = 1; page <= maxPages; page++) {
    const url =
      `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData` +
      `?page=${page}&num=100&sort=changepercent&asc=0&node=hs_a&symbol=&_s_r_a=init`;
    let list = [];
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Referer: 'https://vip.stock.finance.sina.com.cn/',
        },
      });
      if (!res.ok) break;
      const data = JSON.parse(await res.text());
      list = Array.isArray(data) ? data : [];
    } catch {
      break;
    }
    if (!list.length) break;

    let pageMin = Infinity;
    for (const item of list) {
      const name = cleanStockName(item.name);
      if (!name || /ST/i.test(name)) continue;
      const chg = num(item.changepercent);
      scanned += 1;
      if (chg >= 7) over7 += 1;
      if (chg >= 5) over5 += 1;
      if (chg < pageMin) pageMin = chg;
    }
    if (pageMin < 5) break;
    await sleep(120);
  }

  noteQuoteSource('sina');
  return { over5, over7, scanned, _source: 'sina' };
}

/** 行情时钟：腾讯上证时间字段，如 20260921161400 */
export async function fetchMarketClockFallback() {
  try {
    const map = await fetchTencentBatchQuotes([{ code: '000001', market: 'sh' }]);
    const q = map.get('000001');
    const t = String(q?.quoteTime || '');
    // 20260921161400 或带分隔符
    const m = t.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
    if (m) {
      noteQuoteSource('tencent');
      return {
        date: `${m[1]}-${m[2]}-${m[3]}`,
        time: `${m[4]}:${m[5]}:${m[6]}`,
        _source: 'tencent',
      };
    }
  } catch {
    /* try sina */
  }

  try {
    const map = await fetchSinaBatchQuotes([{ code: '000001', market: 'sh' }]);
    const q = map.get('000001');
    const raw = String(q?.quoteTime || '').trim();
    // "2026-09-21 15:44:00"
    const m = raw.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/);
    if (m) {
      noteQuoteSource('sina');
      return { date: m[1], time: m[2], _source: 'sina' };
    }
  } catch {
    /* ignore */
  }
  return null;
}
