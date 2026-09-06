/**
 * 东方财富公开接口爬取（行情 / K线）
 * 公告关键词检索见 cninfo.js（巨潮更稳）
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const CLIST_HOSTS = [
  'https://push2delay.eastmoney.com',
  'https://push2.eastmoney.com',
  'https://82.push2.eastmoney.com',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, { retries = 3, delay = 400, referer } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Referer: referer || 'https://quote.eastmoney.com/',
          Accept: 'application/json,text/plain,*/*',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      const text = await res.text();
      // 部分接口可能带 JSONP 包裹
      const cleaned = text.replace(/^[a-zA-Z0-9_]+\(/, '').replace(/\);?\s*$/, '');
      return JSON.parse(cleaned);
    } catch (err) {
      lastErr = err;
      await sleep(delay * (i + 1));
    }
  }
  throw lastErr;
}

async function fetchClist(query) {
  let lastErr;
  for (const host of CLIST_HOSTS) {
    try {
      return await fetchJson(`${host}/api/qt/clist/get?${query}`, { retries: 2 });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/** secid: 沪市 1.xxxxxx / 深市 0.xxxxxx（含 5xxxxx 沪市ETF） */
export function toSecId(code) {
  const c = String(code).padStart(6, '0');
  if (c.startsWith('6') || c.startsWith('9') || c.startsWith('5')) return `1.${c}`;
  return `0.${c}`;
}

/** 新浪/腾讯行情前缀 */
export function toMarketSymbol(code) {
  const c = String(code).padStart(6, '0');
  if (c.startsWith('6') || c.startsWith('9') || c.startsWith('5')) return `sh${c}`;
  return `sz${c}`;
}

/**
 * 拉取活跃正股列表（排除退市整理、债券等）
 * fields: 代码/名称/最新价/涨跌幅/量比/换手/成交额/振幅/市值 等
 */
export async function fetchActiveStocks({ pages = 8, pageSize = 100 } = {}) {
  const fields =
    'f12,f13,f14,f2,f3,f4,f5,f6,f7,f8,f9,f10,f15,f16,f17,f18,f20,f21,f22,f23,f62,f100,f102,f184';
  // A股：沪深主板+创业板+科创板
  const fs = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048';
  const all = [];

  for (let pn = 1; pn <= pages; pn++) {
    const query =
      `pn=${pn}&pz=${pageSize}&po=1&np=1&fltt=2&invt=2&fid=f6` +
      `&fs=${encodeURIComponent(fs)}&fields=${fields}`;
    const data = await fetchClist(query);
    const list = data?.data?.diff || [];
    if (!list.length) break;
    for (const item of list) {
      const code = String(item.f12);
      const name = String(item.f14 || '');
      // 过滤 ST、退市、债券、基金等非正股短线标的（短线策略用）
      if (!code || !name) continue;
      all.push({
        code,
        market: item.f13, // 0深 1沪
        name,
        price: num(item.f2),
        changePct: num(item.f3),
        volume: num(item.f5),
        amount: num(item.f6),
        amplitude: num(item.f7),
        turnover: num(item.f8),
        pe: num(item.f9),
        volumeRatio: num(item.f10),
        high: num(item.f15),
        low: num(item.f16),
        open: num(item.f17),
        prevClose: num(item.f18),
        totalMV: num(item.f20),
        circMV: num(item.f21),
        mainNetInflow: num(item.f62),
        mainNetInflowPct: num(item.f184),
        industry: String(item.f100 || '').trim(),
        region: String(item.f102 || '').trim(),
      });
    }
    await sleep(200);
  }
  return all;
}

/** ST / *ST 列表（风险警示板 + 全市场名称过滤） */
export async function fetchStStocks({ pages = 8, pageSize = 100 } = {}) {
  const fields = 'f12,f13,f14,f2,f3,f8,f10,f6,f20,f62,f100,f102,f184';
  // 风险警示板优先；再扫全市场按代码排序尽量覆盖
  const fsList = [
    'm:0+t:7,m:1+t:3',
    'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048',
  ];
  const all = [];
  try {
    for (const fs of fsList) {
      const maxPn = fs.includes('t:7') ? Math.max(pages, 5) : Math.max(pages, 12);
      for (let pn = 1; pn <= maxPn; pn++) {
        const query =
          `pn=${pn}&pz=${pageSize}&po=1&np=1&fltt=2&invt=2&fid=f12` +
          `&fs=${encodeURIComponent(fs)}&fields=${fields}`;
        const data = await fetchClist(query);
        const list = data?.data?.diff || [];
        if (!list.length) break;
        for (const item of list) {
          const name = String(item.f14 || '');
          if (!/ST/i.test(name)) continue;
          const code = String(item.f12);
          if (/^(200|900)/.test(code)) continue;
          all.push({
            code,
            market: item.f13,
            name,
            price: num(item.f2),
            changePct: num(item.f3),
            turnover: num(item.f8),
            volumeRatio: num(item.f10),
            amount: num(item.f6),
            totalMV: num(item.f20),
            mainNetInflow: num(item.f62),
            mainNetInflowPct: num(item.f184),
            industry: String(item.f100 || '').trim(),
            region: String(item.f102 || '').trim(),
          });
        }
        await sleep(160);
      }
    }
  } catch {
    return [];
  }
  const map = new Map();
  for (const s of all) map.set(s.code, s);
  return [...map.values()];
}

/**
 * 日K线（优先新浪，失败回退腾讯；东财 his 节点在部分网络下不可用）
 * 返回 [{ date, open, close, high, low, volume, amount, amplitude, changePct, turnover }]
 */
export async function fetchKlines(code, { limit = 120 } = {}) {
  const c = String(code).padStart(6, '0');
  const sinaSymbol = toMarketSymbol(c);

  try {
    const kl = await fetchKlinesSina(sinaSymbol, limit);
    if (kl.length >= 10) return kl;
  } catch {
    /* fall through */
  }

  try {
    const kl = await fetchKlinesTencent(sinaSymbol, limit);
    if (kl.length) return kl;
  } catch {
    /* fall through */
  }

  // 最后尝试东财
  try {
    const secid = toSecId(code);
    const path =
      `/api/qt/stock/kline/get?secid=${secid}` +
      `&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61` +
      `&klt=101&fqt=1&end=20500101&lmt=${limit}`;
    for (const host of ['https://push2delay.eastmoney.com', 'https://push2his.eastmoney.com']) {
      try {
        const data = await fetchJson(host + path, { retries: 1 });
        const raw = data?.data?.klines || [];
        if (!raw.length) continue;
        return raw.map((line) => {
          const p = line.split(',');
          return {
            date: p[0],
            open: +p[1],
            close: +p[2],
            high: +p[3],
            low: +p[4],
            volume: +p[5],
            amount: +p[6],
            amplitude: +p[7],
            changePct: +p[8],
            turnover: +p[9],
          };
        });
      } catch {
        /* next host */
      }
    }
  } catch {
    /* ignore */
  }

  return [];
}

async function fetchKlinesSina(symbol, limit) {
  const url =
    `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData` +
    `?symbol=${symbol}&scale=240&ma=5&datalen=${limit}`;
  const data = await fetchJson(url, {
    retries: 2,
    referer: 'https://finance.sina.com.cn/',
  });
  if (!Array.isArray(data)) return [];
  const rows = data.map((d, i, arr) => {
    const open = +d.open;
    const close = +d.close;
    const high = +d.high;
    const low = +d.low;
    const volume = +d.volume;
    const prev = i > 0 ? +arr[i - 1].close : open;
    const changePct = prev ? ((close - prev) / prev) * 100 : 0;
    const amplitude = prev ? ((high - low) / prev) * 100 : 0;
    return {
      date: d.day,
      open,
      close,
      high,
      low,
      volume,
      amount: 0,
      amplitude,
      changePct,
      turnover: 0,
    };
  });
  return rows;
}

async function fetchKlinesTencent(symbol, limit) {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,${limit},qfq`;
  const data = await fetchJson(url, { retries: 2, referer: 'https://gu.qq.com/' });
  const node = data?.data?.[symbol];
  const raw = node?.qfqday || node?.day || [];
  return raw.map((p, i, arr) => {
    const open = +p[1];
    const close = +p[2];
    const high = +p[3];
    const low = +p[4];
    const volume = +p[5];
    const prev = i > 0 ? +arr[i - 1][2] : open;
    const changePct = prev ? ((close - prev) / prev) * 100 : 0;
    const amplitude = prev ? ((high - low) / prev) * 100 : 0;
    return {
      date: p[0],
      open,
      close,
      high,
      low,
      volume,
      amount: 0,
      amplitude,
      changePct,
      turnover: 0,
    };
  });
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
