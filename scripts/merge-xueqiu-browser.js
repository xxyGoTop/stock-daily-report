/**
 * 将浏览器抓取的雪球大V观点合并回当日报告并重写 html/txt/json
 * 用法：node scripts/merge-xueqiu-browser.js [YYYY-MM-DD]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dayjs from 'dayjs';
import { printReport, saveReportFiles } from '../src/output/report.js';
import { renderHtmlReport, saveHtmlReport } from '../src/output/htmlReport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const date = process.argv[2] || dayjs().format('YYYY-MM-DD');
const outDir = path.join(root, 'output');
const dayDir = path.join(outDir, date);
const jsonPath = path.join(dayDir, 'latest.json');
const xqPath = path.join(dayDir, 'xueqiu-browser.json');

if (!fs.existsSync(jsonPath)) {
  console.error('缺少', jsonPath);
  process.exit(1);
}
if (!fs.existsSync(xqPath)) {
  console.error('缺少', xqPath, '请先用浏览器抓取写入');
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const xqMap = JSON.parse(fs.readFileSync(xqPath, 'utf8'));

function apply(list = []) {
  for (const c of list) {
    const hit = xqMap[c.code] || xqMap[String(c.code).padStart(6, '0')];
    if (hit) c.xueqiu = hit;
  }
}

const mods = report.modules || {};
apply(mods.plainStocks);
apply(mods.stStocks);
apply(mods.eventStocks);
apply(report.shortTerm?.candidates);
apply(report.turnaround?.candidates);
apply(report.custom?.candidates);

const filled = Object.values(xqMap).filter((v) => v?.ok && v.opinions?.length).length;
const tried = Object.keys(xqMap).length;
console.log(`合并雪球：${tried} 只已抓，其中 ${filled} 只有大V观点`);

const meta = {
  ...(report.meta || {}),
  generatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
  xueqiuSource: 'browser-session',
};

const payload = {
  meta,
  brief: report.brief,
  shortTerm: report.shortTerm,
  turnaround: report.turnaround,
  modules: mods,
  custom: report.custom,
};

const text = printReport({ modules: mods, meta, turnaround: report.turnaround });
saveReportFiles(text, payload, outDir, { dateFolder: date });
const html = renderHtmlReport(payload);
const htmlSaved = saveHtmlReport(html, outDir, { dateFolder: date });
console.log('已更新', htmlSaved.latestInDay || htmlSaved);
