/**
 * 东方财富公开接口爬取（行情 / K线）
 * 公告关键词检索见 cninfo.js（巨潮更稳）
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// push2delay 是延时节点，只作兜底
const CLIST_HOSTS = [
  'https://push2.eastmoney.com',
  'https://82.push2.eastmoney.com',
  'https://push2delay.eastmoney.com',
];

// push2delay 对 kline 接口返回空数组，必须排在 push2his 之后
const KLINE_HOSTS = ['https://push2his.eastmoney.com', 'https://push2delay.eastmoney.com'];

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

// 某个节点不通时（如被代理拦截），逐页重试代价极高，故记住上次成功的节点优先用
let preferredClistHost = null;

async function fetchClist(query) {
  const hosts = preferredClistHost
    ? [preferredClistHost, ...CLIST_HOSTS.filter((h) => h !== preferredClistHost)]
    : CLIST_HOSTS;

  let lastErr;
  for (const host of hosts) {
    try {
      const data = await fetchJson(`${host}/api/qt/clist/get?${query}`, { retries: 2 });
      preferredClistHost = host;
      return data;
    } catch (err) {
      lastErr = err;
      if (preferredClistHost === host) preferredClistHost = null;
    }
  }
  throw lastErr;
}

/**
 * 按代码首位猜市场：6/9/5 → 沪，其余 → 深
 * 注意：沪市指数（000001 上证、000300 沪深300、000016 上证50）也以 0 开头，
 * 会被误判成深市个股（sz000001 是平安银行），所以指数必须由调用方显式传 market
 */
function guessMarket(code) {
  const c = String(code).padStart(6, '0');
  return /^[695]/.test(c) ? 'sh' : 'sz';
}

/** secid: 沪市 1.xxxxxx / 深市 0.xxxxxx（含 5xxxxx 沪市ETF） */
export function toSecId(code, market) {
  const c = String(code).padStart(6, '0');
  const m = market || guessMarket(c);
  return m === 'sh' ? `1.${c}` : `0.${c}`;
}

/** 新浪/腾讯行情前缀 */
export function toMarketSymbol(code, market) {
  const c = String(code).padStart(6, '0');
  return `${market || guessMarket(c)}${c}`;
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
 * 全市场周期涨幅（用于按欧奈尔口径做全市场 RPS 排名）
 * f109=5日 / f24=60日 / f25=年初至今，均为交易所口径，无需逐只拉K线
 */
export async function fetchMarketReturns({ maxPages = 70 } = {}) {
  const fields = 'f12,f14,f3,f109,f24,f25';
  const fs = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048';
  const rows = [];

  for (let pn = 1; pn <= maxPages; pn++) {
    let list = [];
    try {
      const query =
        `pn=${pn}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f12` +
        `&fs=${encodeURIComponent(fs)}&fields=${fields}`;
      const data = await fetchClist(query);
      list = data?.data?.diff || [];
    } catch {
      break;
    }
    if (!list.length) break;
    for (const item of list) {
      const code = String(item.f12 || '');
      const name = String(item.f14 || '');
      if (!code || !name || /ST/i.test(name)) continue;
      rows.push({
        code,
        name,
        change5: num(item.f109),
        change60: num(item.f24),
        changeYtd: num(item.f25),
      });
    }
    if (list.length < 100) break;
  }
  return rows;
}

/** 情绪/属性类伪板块，不能代表主流方向，排除出 RPS5 排名 */
const NOISE_BOARD =
  /连板|涨停|跌停|昨日|次新|st板块|风险警示|退市|融资融券|标准普尔|富时|msci|沪股通|深股通|中字头|破净|预盈|预亏|高送转|参股|机构重仓|基金重仓|QFII|社保|举牌|大盘|中盘|小盘|微盘/i;

/**
 * 板块指数 RPS5（陶博士 241005「先看主流板块」）
 * f109 = 5日涨跌幅，用全板块横向百分位排名近似板块 RPS5
 */
export async function fetchBoardRps5({ includeConcept = true } = {}) {
  const fields = 'f12,f14,f3,f109';
  const groups = [{ fs: 'm:90+t:2', kind: '行业' }];
  if (includeConcept) groups.push({ fs: 'm:90+t:3', kind: '概念' });

  const boards = [];
  for (const { fs, kind } of groups) {
    for (let pn = 1; pn <= 6; pn++) {
      let list = [];
      try {
        const query =
          `pn=${pn}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3` +
          `&fs=${encodeURIComponent(fs)}&fields=${fields}`;
        const data = await fetchClist(query);
        list = data?.data?.diff || [];
      } catch {
        break; // 单组失败不影响整体
      }
      if (!list.length) break;
      for (const item of list) {
        const name = String(item.f14 || '').trim();
        if (!name || NOISE_BOARD.test(name)) continue;
        boards.push({
          code: String(item.f12 || ''),
          name,
          kind,
          changePct: num(item.f3),
          change5: num(item.f109),
        });
      }
      if (list.length < 100) break;
      await sleep(180);
    }
  }

  // 行业与概念分开排名，避免概念板块数量压制行业分位
  const byName = new Map();
  for (const kind of ['行业', '概念']) {
    const group = boards.filter((b) => b.kind === kind && Number.isFinite(b.change5));
    group.sort((a, b) => a.change5 - b.change5);
    const n = group.length;
    group.forEach((b, i) => {
      b.rps5 = n <= 1 ? 100 : +((i / (n - 1)) * 100).toFixed(2);
      if (!byName.has(b.name)) byName.set(b.name, b);
    });
  }

  const ranked = [...byName.values()].sort((a, b) => (b.rps5 ?? 0) - (a.rps5 ?? 0));
  return { boards: ranked, byName };
}

/**
 * 尾盘板块快照：
 * - strongestToday：今日涨幅、上涨家数占比与资金流共同确认的最强行业
 * - tailMovers：今日强度明显高于近5日平均、且有扩散度/资金确认的异动行业
 *
 * 东财字段：f3今日涨幅、f109近5日涨幅、f62主力净流入、
 * f104/f105上涨/下跌家数、f128/f140/f136领涨股名称/代码/涨幅。
 */
export async function fetchTailBoardSignals({ limit = 10 } = {}) {
  const fields = 'f12,f14,f3,f109,f62,f184,f104,f105,f128,f136,f140';
  const boards = [];

  for (let pn = 1; pn <= 6; pn++) {
    let list = [];
    try {
      const query =
        `pn=${pn}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3` +
        `&fs=${encodeURIComponent('m:90+t:2')}&fields=${fields}`;
      const data = await fetchClist(query);
      list = data?.data?.diff || [];
    } catch {
      break;
    }
    if (!list.length) break;
    for (const item of list) {
      const name = String(item.f14 || '').trim();
      if (!name || NOISE_BOARD.test(name)) continue;
      const up = num(item.f104);
      const down = num(item.f105);
      const breadth = up + down > 0 ? up / (up + down) : 0;
      const changePct = num(item.f3);
      const change5 = num(item.f109);
      const acceleration = changePct - change5 / 5;
      const mainNetInflow = num(item.f62);
      const mainNetInflowPct = num(item.f184);
      boards.push({
        code: String(item.f12 || ''),
        name,
        changePct,
        change5,
        acceleration: +acceleration.toFixed(2),
        up,
        down,
        breadth: +breadth.toFixed(3),
        mainNetInflow,
        mainNetInflowPct,
        leader: String(item.f128 || '').trim(),
        leaderCode: String(item.f140 || ''),
        leaderChangePct: num(item.f136),
      });
    }
    if (list.length < 100) break;
  }

  const sortedByChange = [...boards].sort(
    (a, b) =>
      b.changePct - a.changePct ||
      b.breadth - a.breadth ||
      b.mainNetInflow - a.mainNetInflow
  );
  const n = sortedByChange.length;
  sortedByChange.forEach((b, i) => {
    b.todayRank = i + 1;
    b.todayRps = n <= 1 ? 100 : +(((n - 1 - i) / (n - 1)) * 100).toFixed(2);
  });

  // 东财行业分级可能出现成分完全相同的 II/III 级板块，避免重复提醒。
  const dedupeSimilar = (list) => {
    const seen = new Set();
    return list.filter((b) => {
      const key = `${b.leaderCode}|${b.up}|${b.down}|${b.changePct.toFixed(1)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  // “最强”要求板块不是只靠一两只票硬拉：至少半数上涨，且资金不为明显流出。
  const strongestToday = dedupeSimilar(
    sortedByChange.filter(
      (b) => b.changePct > 0 && b.breadth >= 0.5 && b.mainNetInflow >= 0
    )
  ).slice(0, limit);

  // “异动”强调相对近5日均速突然加速，并要求上涨扩散和资金确认。
  const tailMovers = dedupeSimilar(
    boards
    .filter(
      (b) =>
        b.changePct >= 1.5 &&
        b.acceleration >= 1.2 &&
        b.breadth >= 0.6 &&
        b.mainNetInflow > 0
    )
    .map((b) => ({
      ...b,
      moveScore:
        b.changePct * 4 +
        b.acceleration * 3 +
        b.breadth * 15 +
        Math.min(10, Math.max(0, b.mainNetInflowPct)),
    }))
    .sort((a, b) => b.moveScore - a.moveScore)
  ).slice(0, limit);

  return {
    boards,
    byName: new Map(boards.map((b) => [b.name, b])),
    strongestToday,
    tailMovers,
  };
}

async function fetchKlinesEm(code, limit, market) {
  const secid = toSecId(code, market);
  const path =
    `/api/qt/stock/kline/get?secid=${secid}` +
    `&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61` +
    `&klt=101&fqt=1&end=20500101&lmt=${limit}`;
  for (const host of KLINE_HOSTS) {
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
  return [];
}

const lastDate = (kl) => (kl.length ? String(kl[kl.length - 1].date).slice(0, 10) : '');

const KLINE_SOURCES = {
  sina: (code, limit, market) => fetchKlinesSina(toMarketSymbol(code, market), limit),
  tencent: (code, limit, market) => fetchKlinesTencent(toMarketSymbol(code, market), limit),
  em: (code, limit, market) => fetchKlinesEm(code, limit, market),
};

/**
 * 实时行情时钟：判断市场行情已经走到哪一天。
 *
 * 走的是 push2 的单只行情接口，和三个K线接口都不是同一条链路——
 * K线源集体降级时它通常还活着，用来交叉验证K线是不是真的滞后了。
 */
export async function fetchMarketClock() {
  for (const host of CLIST_HOSTS) {
    try {
      const data = await fetchJson(`${host}/api/qt/stock/get?secid=1.000001&fields=f43,f86,f58`, {
        retries: 1,
      });
      const ts = Number(data?.data?.f86);
      if (!Number.isFinite(ts) || ts <= 0) continue;
      const d = new Date(ts * 1000);
      const pad = (n) => String(n).padStart(2, '0');
      return {
        date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
      };
    } catch {
      /* next host */
    }
  }
  return null;
}

/**
 * 本次运行的取数策略：哪个源最新、按什么顺序试。
 *
 * 新浪的日K在盘中不含当天那根（收盘后才补），腾讯/东财盘中就有；
 * 但腾讯有 WAF 限流、东财节点时有不可用。所以不写死顺序，
 * 而是拿上证指数在三个源各探一次，按「日期新→响应快」排序。
 */
let probeState = null;
let probePromise = null;
const failStreak = { sina: 0, tencent: 0, em: 0 };
const deadSources = new Set();

const MAX_FAIL_STREAK = 4;

async function resolveProbe() {
  if (probeState) return probeState;
  if (probePromise) return probePromise;

  probePromise = (async () => {
    const results = [];
    for (const [name, load] of Object.entries(KLINE_SOURCES)) {
      const t0 = Date.now();
      try {
        const kl = await load('000001', 5, 'sh');
        const d = lastDate(kl);
        if (d) results.push({ name, date: d, ms: Date.now() - t0 });
        else results.push({ name, date: '', ms: Date.now() - t0 });
      } catch {
        results.push({ name, date: '', ms: Date.now() - t0 });
      }
    }

    // 日期新的优先，同日期比响应速度；探测失败的排最后
    results.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.ms - b.ms;
    });

    const dates = results.map((r) => r.date).filter(Boolean);
    const klineDate = dates.length ? dates.sort()[dates.length - 1] : '';
    const clock = await fetchMarketClock();

    probeState = {
      klineDate,
      quoteDate: clock?.date || '',
      quoteTime: clock?.time || '',
      order: results.map((r) => r.name),
      sources: results,
    };
    return probeState;
  })();

  return probePromise;
}

/** 供诊断/测试重置探测缓存 */
export function resetKlineProbe() {
  probeState = null;
  probePromise = null;
  deadSources.clear();
  for (const k of Object.keys(failStreak)) failStreak[k] = 0;
}

/** 报告用：K线基准交易日 + 实时行情日期（两条独立链路） */
export async function getDataFreshness() {
  const p = await resolveProbe();
  return {
    klineDate: p.klineDate,
    quoteDate: p.quoteDate,
    quoteTime: p.quoteTime,
    sources: p.sources,
  };
}

export async function getKlineBaselineDate() {
  return (await resolveProbe()).klineDate;
}

/**
 * 日K线：多源取「最新」而非「最先成功」
 *
 * @param {string} code 6位代码
 * @param {object} opts
 * @param {number} opts.limit  取多少根
 * @param {'sh'|'sz'} opts.market  指数必须显式指定，否则 000001 会被当成平安银行
 * @returns [{ date, open, close, high, low, volume, amount, amplitude, changePct, turnover }]
 */
export async function fetchKlines(code, { limit = 120, market } = {}) {
  const c = String(code).padStart(6, '0');
  const { klineDate, order } = await resolveProbe();

  // 拿不到达标数据时，保留各源里最新的那份兜底，而不是直接返回空
  let best = [];
  for (const name of order) {
    if (deadSources.has(name)) continue;
    let kl = [];
    try {
      kl = await KLINE_SOURCES[name](c, limit, market);
      failStreak[name] = 0;
    } catch {
      // 某个源连续挂掉就本次运行内不再尝试，否则每只票都要白等它重试
      if (++failStreak[name] >= MAX_FAIL_STREAK) deadSources.add(name);
      continue;
    }
    if (kl.length < 10) continue;
    const d = lastDate(kl);
    if (!klineDate || d >= klineDate) return kl;
    if (d > lastDate(best)) best = kl;
  }
  return best;
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
