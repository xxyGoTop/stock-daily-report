import { searchCninfoKeyword } from '../src/crawl/cninfo.js';
import { classifyAnnouncement, aggregateTurnaround, EVENT_RULES, SEARCH_KEYWORDS } from '../src/strategy/turnaround.js';
import { seasonalPriority } from '../src/analyze/progress.js';
import { fetchStStocks } from '../src/crawl/eastmoney.js';

const targets = [
  { code: '000632', name: 'ST三木' },
  { code: '300716', name: '*ST泉为' },
  { code: '300044', name: '*ST赛为' },
  { code: '300385', name: 'ST雪浪' },
  { code: '300338', name: 'ST开元' },
  { code: '000838', name: '*ST发展' },
];

const keywords = [
  '预重整',
  '重整投资人',
  '重整计划',
  '破产重整',
  '裁定受理重整',
  ...SEARCH_KEYWORDS,
];

async function annsForCode(code) {
  const hits = [];
  const seen = new Set();
  for (const kw of ['重整', '预重整', '重整投资人', '破产重整', '撤销风险警示']) {
    const list = await searchCninfoKeyword(kw, { pages: 1, pageSize: 30, stock: code });
    for (const a of list) {
      const c = a.codes[0]?.code;
      if (c && c !== code) continue;
      const key = a.title + a.date;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(a);
    }
  }
  return hits.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 12);
}

console.log('season', seasonalPriority().label, seasonalPriority().order);

const stList = await fetchStStocks({ pages: 3, pageSize: 100 });
const stMap = new Map(stList.map((s) => [s.code, s]));
console.log('ST list size', stList.length);
for (const t of targets) {
  const inSt = stMap.get(t.code);
  console.log('\n====', t.code, t.name, 'inStList=', !!inSt, inSt?.name || '');
  const anns = await annsForCode(t.code);
  console.log('recent anns', anns.length);
  for (const a of anns.slice(0, 6)) {
    const cls = classifyAnnouncement(a.title);
    console.log(' -', (a.date || '').slice(0, 10), cls ? `${cls.type}/${cls.certainty}/${cls.keyword}` : '未分类', a.title.slice(0, 60));
  }
}

// Also check if keyword search with pages=1 would catch them
console.log('\n==== keyword-pool hit check (pages=1, like fast mode) ====');
const pool = [];
const seen = new Set();
for (const kw of SEARCH_KEYWORDS) {
  const list = await searchCninfoKeyword(kw, { pages: 1, pageSize: 30 });
  for (const a of list) {
    const code = a.codes[0]?.code;
    if (!targets.some((t) => t.code === code)) continue;
    const key = code + '|' + a.title;
    if (seen.has(key)) continue;
    seen.add(key);
    pool.push(a);
  }
}
const ranked = aggregateTurnaround(pool, stMap, seasonalPriority());
for (const t of targets) {
  const r = ranked.find((x) => x.code === t.code);
  if (!r) console.log(t.code, t.name, '=> 未进入关键词检索池');
  else
    console.log(
      t.code,
      t.name,
      'score=',
      r.score,
      'cert=',
      r.maxCertainty,
      'types=',
      r.types.join('/'),
      'flags=',
      r.riskFlags.join('|') || '-'
    );
}
