/**
 * 接收浏览器 POST 的雪球观点 JSON
 * node scripts/xq-receiver.js
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dayjs from 'dayjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const date = process.argv[2] || dayjs().format('YYYY-MM-DD');
const outFile = path.join(root, 'output', date, 'xueqiu-browser.json');
const PORT = 3790;

fs.mkdirSync(path.dirname(outFile), { recursive: true });

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS,GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === 'GET' && req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, outFile }));
    return;
  }
  if (req.method === 'POST') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString('utf8');
    JSON.parse(body); // validate
    fs.writeFileSync(outFile, body, 'utf8');
    const n = Object.keys(JSON.parse(body)).length;
    console.log(`已写入 ${outFile} · ${n} 只`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, n, outFile }));
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`xq-receiver http://127.0.0.1:${PORT}/  → ${outFile}`);
});
