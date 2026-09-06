/**
 * 中文名 / 代码 → 6位代码解析
 * 优先：当日筛选报告 → 腾讯联想 → 东财联想
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dayjs from 'dayjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36';

function loadLatestReport() {
  const candidates = [
    path.join(ROOT, 'output', 'latest.json'),
    path.join(ROOT, 'output', dayjs().format('YYYY-MM-DD'), 'latest.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** 从最新报告收集 code/name → card */
export function indexReportCards(report) {
  const map = new Map();
  if (!report) return map;
  const lists = [
    report.modules?.plainStocks,
    report.modules?.stStocks,
    report.modules?.eventStocks,
    report.shortTerm?.candidates,
    report.turnaround?.candidates,
    report.custom?.candidates,
  ];
  for (const list of lists) {
    for (const c of list || []) {
      if (!c?.code) continue;
      const code = String(c.code).padStart(6, '0');
      const prev = map.get(code);
      if (!prev || (c.score || 0) > (prev.score || 0)) map.set(code, c);
      const name = String(c.name || '').replace(/\s+/g, '');
      if (name) map.set(`name:${name}`, c);
    }
  }
  return map;
}

function parseTokens(input) {
  const raw = Array.isArray(input) ? input.join(' ') : String(input || '');
  return raw
    .split(/[\s,，;；|、]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function suggestGtimg(keyword) {
  const url = `https://smartbox.gtimg.cn/s3/?v=2&q=${encodeURIComponent(keyword)}&t=gp`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://gu.qq.com/' } });
  const text = await res.text();
  const m = text.match(/="([^"]*)"/);
  if (!m || !m[1]) return [];
  // 腾讯返回 \uXXXX 转义
  const decoded = m[1].replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16))
  );
  const rows = decoded.split('^').filter(Boolean);
  const out = [];
  for (const row of rows) {
    const parts = row.split('~');
    // sh~600869~远东股份~ydgf~GP-A
    if (parts.length < 3) continue;
    const market = parts[0];
    const code = parts[1];
    const name = parts[2];
    if (!/^\d{6}$/.test(code)) continue;
    if (!/^(sh|sz)$/i.test(market)) continue;
    // 只要 A 股
    if (parts[4] && !/GP-A/i.test(parts[4]) && /GP-/i.test(parts[4])) continue;
    out.push({ code, name, market: market.toLowerCase() });
  }
  return out;
}

async function suggestSina(keyword) {
  const url =
    'https://suggest3.sinajs.cn/suggest/type=11,12,13,14,15&key=' + encodeURIComponent(keyword);
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://finance.sina.com.cn' } });
  const buf = await res.arrayBuffer();
  let text;
  try {
    text = new TextDecoder('gbk').decode(buf);
  } catch {
    text = Buffer.from(buf).toString('latin1');
  }
  // var suggestvalue="远东股份,11,600869,sh600869,..."
  const m = text.match(/="([^"]*)"/);
  if (!m || !m[1]) return [];
  const out = [];
  for (const row of m[1].split(';').filter(Boolean)) {
    const p = row.split(',');
    if (p.length < 4) continue;
    const code = p[2];
    const name = p[0] || p[4];
    if (!/^\d{6}$/.test(code)) continue;
    out.push({ code, name });
  }
  return out;
}

async function suggestEastmoney(keyword) {
  // 备用：推送搜索
  const url =
    'https://search-api-web.eastmoney.com/search/suggest?q=' +
    encodeURIComponent(keyword) +
    '&type=stock&count=8';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Referer: 'https://www.eastmoney.com/' },
    });
    const j = await res.json();
    const list = j?.result || j?.data || j?.suggest || [];
    const arr = Array.isArray(list) ? list : list?.stock || [];
    return arr
      .map((x) => ({
        code: String(x.code || x.Code || x.securityCode || '').replace(/\D/g, '').slice(-6),
        name: String(x.name || x.Name || x.securityName || ''),
      }))
      .filter((x) => /^\d{6}$/.test(x.code));
  } catch {
    return [];
  }
}

/**
 * @param {string[]|string} input 支持：600869 远东股份 英力特
 * @returns {Promise<Array<{ token, code, name, card|null, source }>>}
 */
export async function resolveStockTokens(input) {
  const tokens = parseTokens(input);
  const report = loadLatestReport();
  const cardIndex = indexReportCards(report);
  const results = [];
  const seen = new Set();

  for (const token of tokens) {
    const codeMatch = token.match(/(\d{6})/);
    if (codeMatch) {
      const code = codeMatch[1];
      if (seen.has(code)) continue;
      seen.add(code);
      const card = cardIndex.get(code) || null;
      results.push({
        token,
        code,
        name: card?.name || code,
        card,
        source: card ? 'report' : 'code',
      });
      continue;
    }

    const compact = token.replace(/\s+/g, '');
    let card =
      cardIndex.get(`name:${compact}`) ||
      [...cardIndex.values()].find(
        (c) => c && typeof c === 'object' && c.name && String(c.name).replace(/\s+/g, '').includes(compact)
      );

    // 报告里按简称模糊（去掉 ST/*）
    if (!card) {
      card = [...cardIndex.entries()]
        .filter(([k]) => k.startsWith('name:'))
        .map(([, c]) => c)
        .find((c) => {
          const n = String(c.name || '').replace(/\s+/g, '').replace(/^\*?ST/i, '');
          return n.includes(compact) || compact.includes(n);
        });
    }

    if (card?.code) {
      const code = String(card.code).padStart(6, '0');
      if (seen.has(code)) continue;
      seen.add(code);
      results.push({ token, code, name: card.name, card, source: 'report' });
      continue;
    }

    let hits = [];
    try {
      hits = await suggestGtimg(compact);
    } catch {
      hits = [];
    }
    if (!hits.length) {
      try {
        hits = await suggestSina(compact);
      } catch {
        hits = [];
      }
    }
    if (!hits.length) {
      try {
        hits = await suggestEastmoney(compact);
      } catch {
        hits = [];
      }
    }
    const hit =
      hits.find((h) => String(h.name).replace(/\s+/g, '').includes(compact)) ||
      hits.find((h) => compact.includes(String(h.name).replace(/\s+/g, ''))) ||
      hits[0];
    if (!hit) {
      results.push({ token, code: null, name: token, card: null, source: 'unresolved' });
      continue;
    }
    const code = hit.code;
    if (seen.has(code)) continue;
    seen.add(code);
    const fromReport = cardIndex.get(code) || null;
    results.push({
      token,
      code,
      name: fromReport?.name || hit.name,
      card: fromReport,
      source: fromReport ? 'report+suggest' : 'suggest',
    });
  }

  return { results, report };
}

export { loadLatestReport };
