/**
 * 今日热点新闻（东财重要快讯）
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function newsUrl(code) {
  const c = String(code || '').trim();
  if (!c) return '';
  return `https://finance.eastmoney.com/a/${c}.html`;
}

function fmtTime(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '';
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<Array<{ title, summary, source, time, tag, url, code }>>}
 */
export async function fetchTodayHotNews({ limit = 15 } = {}) {
  const res = await fetch('https://eminfo.eastmoney.com/pc_news/FastNews/GetImportantNewsList', {
    headers: {
      'User-Agent': UA,
      Referer: 'https://finance.eastmoney.com/',
      Accept: 'application/json,text/plain,*/*',
    },
  });
  if (!res.ok) throw new Error(`热点新闻 HTTP ${res.status}`);
  const data = await res.json();
  const items = Array.isArray(data?.items) ? data.items : [];

  // 优先 A 股相关，再补全球/其他，去重后取 limit
  const rank = (tag) => {
    if (tag === 'SHSZ_STOCK') return 0;
    if (tag === 'HK_STOCK') return 1;
    if (tag === 'US_STOCK') return 2;
    return 3;
  };
  const sorted = [...items].sort((a, b) => {
    const dr = rank(a.articleTagMarket) - rank(b.articleTagMarket);
    if (dr !== 0) return dr;
    return (Number(b.updateTime) || 0) - (Number(a.updateTime) || 0);
  });

  const seen = new Set();
  const out = [];
  for (const it of sorted) {
    const title = String(it.title || '').trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    const code = String(it.code || '').trim();
    out.push({
      title,
      summary: String(it.digest || '')
        .replace(/^【[^】]*】/, '')
        .trim()
        .slice(0, 120),
      source: String(it.source || '').trim() || '东财',
      time: fmtTime(it.updateTime),
      tag: String(it.articleTagMarket || ''),
      url: newsUrl(code),
      code,
    });
    if (out.length >= limit) break;
  }
  return out;
}
