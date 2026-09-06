/**
 * 巨潮资讯公告检索（摘帽 / 重整 / 股权转让）
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function queryCninfo({
  keyword,
  column = 'szse',
  pageNum = 1,
  pageSize = 30,
  stock = '',
} = {}) {
  const body = new URLSearchParams({
    pageNum: String(pageNum),
    pageSize: String(pageSize),
    column,
    tabName: 'fulltext',
    plate: '',
    stock: stock || '',
    searchkey: keyword,
    secid: '',
    category: '',
    trade: '',
    seDate: '',
    isHLtitle: 'true',
  });

  const res = await fetch('http://www.cninfo.com.cn/new/hisAnnouncement/query', {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: 'http://www.cninfo.com.cn/new/commonUrl?url=disclosure/list/notice',
      Origin: 'http://www.cninfo.com.cn',
    },
    body,
  });
  if (!res.ok) throw new Error(`cninfo HTTP ${res.status}`);
  return res.json();
}

function normalizeAnn(a, matchedKeyword) {
  const code = String(a.secCode || '').trim();
  const name = String(a.secName || '').trim();
  const title = String(a.announcementTitle || '')
    .replace(/<[^>]+>/g, '')
    .trim();
  const ts = a.announcementTime ? Number(a.announcementTime) : NaN;
  const date = Number.isFinite(ts)
    ? new Date(ts).toISOString().slice(0, 19).replace('T', ' ')
    : String(a.announcementTime || '');
  const adjunctUrl = a.adjunctUrl
    ? `http://static.cninfo.com.cn/${a.adjunctUrl}`
    : '';

  return {
    title,
    codes: code ? [{ code, name }] : [],
    date,
    artCode: a.announcementId || '',
    url: adjunctUrl,
    matchedKeyword,
    source: 'cninfo',
  };
}

/**
 * 按关键词在深交所+上交所公告中检索
 */
export async function searchCninfoKeyword(keyword, { pages = 1, pageSize = 30, stock = '' } = {}) {
  const hits = [];
  const columns = ['szse', 'sse'];
  for (const column of columns) {
    for (let pageNum = 1; pageNum <= pages; pageNum++) {
      try {
        const data = await queryCninfo({ keyword, column, pageNum, pageSize, stock });
        const list = data?.announcements || [];
        for (const a of list) hits.push(normalizeAnn(a, keyword));
        if (!list.length) break;
      } catch {
        // 单页失败继续
      }
      await sleep(280);
    }
  }
  return hits;
}

/**
 * 多关键词检索并去重（默认只保留近 lookbackDays 天，避免历史陈旧公告）
 */
export async function fetchTurnaroundAnnouncements(
  keywords,
  { pagesPerKeyword = 1, lookbackDays = 120 } = {}
) {
  const all = [];
  const seen = new Set();
  const cutoff = Date.now() - lookbackDays * 24 * 3600 * 1000;

  for (const kw of keywords) {
    const list = await searchCninfoKeyword(kw, { pages: pagesPerKeyword, pageSize: 30 });
    for (const ann of list) {
      const key = `${ann.codes[0]?.code || ''}|${ann.title}|${ann.date}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // 过滤过旧公告
      const t = Date.parse(String(ann.date).replace(/-/g, '/'));
      if (Number.isFinite(t) && t < cutoff) continue;

      all.push(ann);
    }
  }

  all.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return all;
}
