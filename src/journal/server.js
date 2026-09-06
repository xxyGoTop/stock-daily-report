/**
 * 本地交易台账服务
 * 用法：npm run journal
 * 打开：http://127.0.0.1:3789
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

import {
  readTrades,
  upsertTrade,
  deleteTrade,
  readInsights,
  listCandidatesFromLatestReport,
} from './store.js';
import {
  analyzeAndOptimize,
  groupTradesByWeek,
  diagnoseWeek,
  reviewMonth,
  monthMeta,
} from './stats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, '../../public/journal');
const PORT = Number(process.env.JOURNAL_PORT || 3789);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function send(res, code, body, type = 'application/json; charset=utf-8') {
  let data;
  if (typeof body === 'string' || Buffer.isBuffer(body) || body instanceof Uint8Array) {
    data = body;
  } else {
    data = JSON.stringify(body);
  }

  res.writeHead(code, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(data);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  const file = path.normalize(path.join(PUBLIC, urlPath.replace(/^\//, '')));
  if (!file.startsWith(path.normalize(PUBLIC)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    send(res, 404, '<h1>页面未找到</h1><p>请打开 <a href="/">首页</a></p>', 'text/html; charset=utf-8');
    return;
  }
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  // html/css/js 一律按文本返回，杜绝 Buffer 被序列化成数字数组
  if (['.html', '.css', '.js', '.json', '.svg', '.txt', '.md'].includes(ext)) {
    send(res, 200, fs.readFileSync(file, 'utf8'), type);
    return;
  }
  send(res, 200, fs.readFileSync(file), type);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    send(res, 204, '');
    return;
  }

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = url.pathname;

  try {
    if (p === '/api/trades' && req.method === 'GET') {
      const trades = readTrades();
      send(res, 200, {
        trades,
        weeks: groupTradesByWeek(trades),
        month: monthMeta(),
      });
      return;
    }
    if (p === '/api/trades' && (req.method === 'POST' || req.method === 'PUT')) {
      const body = await readBody(req);
      const trade = upsertTrade(body);
      const analysis = analyzeAndOptimize();
      send(res, 200, { trade, analysis });
      return;
    }
    if (p.startsWith('/api/trades/') && req.method === 'DELETE') {
      const id = decodeURIComponent(p.slice('/api/trades/'.length));
      deleteTrade(id);
      const analysis = analyzeAndOptimize();
      send(res, 200, { ok: true, analysis });
      return;
    }
    if (p === '/api/stats' && req.method === 'GET') {
      const week = url.searchParams.get('week') || undefined;
      const month = url.searchParams.get('month') || undefined;
      send(res, 200, analyzeAndOptimize({ week, month }));
      return;
    }
    if (p === '/api/insights' && req.method === 'GET') {
      send(res, 200, readInsights());
      return;
    }
    if (p === '/api/candidates' && req.method === 'GET') {
      send(res, 200, listCandidatesFromLatestReport());
      return;
    }
    if (p === '/api/diagnose-week' && req.method === 'POST') {
      const body = await readBody(req);
      const weekOf = body.weekOf;
      if (!weekOf) {
        send(res, 400, { error: '缺少 weekOf' });
        return;
      }
      const report = diagnoseWeek(weekOf);
      send(res, 200, { report, weeks: groupTradesByWeek(), month: monthMeta() });
      return;
    }
    if (p === '/api/review-month' && req.method === 'POST') {
      const body = await readBody(req);
      const monthOf = body.monthOf || monthMeta().monthOf;
      const report = reviewMonth(monthOf);
      send(res, 200, {
        report,
        analysis: analyzeAndOptimize({ month: monthOf }),
        month: monthMeta(),
      });
      return;
    }
    if (p === '/api/month' && req.method === 'GET') {
      send(res, 200, monthMeta());
      return;
    }

    serveStatic(req, res);
  } catch (err) {
    send(res, 500, { error: err.message || String(err) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const link = `http://127.0.0.1:${PORT}/`;
  console.log(`\n交易台账可视化页面：${link}`);
  console.log(`数据文件：data/trades.json`);
  console.log(`策略洞察：data/strategy-insights.json\n`);
  if (!process.argv.includes('--no-open')) {
    exec(`cmd /c start "" "${link}"`);
  }
});
