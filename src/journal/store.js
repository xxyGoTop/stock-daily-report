/**
 * 本地交易台账读写
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';

dayjs.extend(isoWeek);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');
const TRADES_FILE = path.join(DATA_DIR, 'trades.json');
const INSIGHTS_FILE = path.join(DATA_DIR, 'strategy-insights.json');

function ensureFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(TRADES_FILE)) {
    fs.writeFileSync(TRADES_FILE, JSON.stringify({ trades: [], updatedAt: null }, null, 2));
  }
  if (!fs.existsSync(INSIGHTS_FILE)) {
    fs.writeFileSync(
      INSIGHTS_FILE,
      JSON.stringify(
        { updatedAt: null, weekly: null, monthly: null, tips: [], checklistPatch: [] },
        null,
        2
      )
    );
  }
}

export function weekKey(dateStr) {
  return dayjs(dateStr).startOf('isoWeek').format('YYYY-MM-DD');
}

export function monthKey(dateStr) {
  return dayjs(dateStr).format('YYYY-MM');
}

export function readTrades() {
  ensureFiles();
  const raw = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
  return Array.isArray(raw.trades) ? raw.trades : [];
}

export function writeTrades(trades) {
  ensureFiles();
  const payload = { trades, updatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss') };
  fs.writeFileSync(TRADES_FILE, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

export function readInsights() {
  ensureFiles();
  const raw = JSON.parse(fs.readFileSync(INSIGHTS_FILE, 'utf8'));
  return {
    weekDiagnoses: {},
    monthReviews: {},
    ...raw,
  };
}

export function writeInsights(insights) {
  ensureFiles();
  const prev = readInsights();
  const payload = {
    ...prev,
    ...insights,
    weekDiagnoses: insights.weekDiagnoses || prev.weekDiagnoses || {},
    monthReviews: insights.monthReviews || prev.monthReviews || {},
    updatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
  };
  fs.writeFileSync(INSIGHTS_FILE, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

/** 保存某一周诊断结果 */
export function saveWeekDiagnosis(weekOf, report) {
  const insights = readInsights();
  insights.weekDiagnoses = insights.weekDiagnoses || {};
  insights.weekDiagnoses[weekOf] = {
    ...report,
    diagnosedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
  };
  return writeInsights(insights);
}

/** 保存某月分期/复盘结果 */
export function saveMonthReview(monthOf, report) {
  const insights = readInsights();
  insights.monthReviews = insights.monthReviews || {};
  insights.monthReviews[monthOf] = {
    ...report,
    reviewedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
  };
  return writeInsights(insights);
}

export function upsertTrade(input) {
  const trades = readTrades();
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  const buyDate = input.buyDate || dayjs().format('YYYY-MM-DD');
  const buyPrice = Number(input.buyPrice);
  const sellPrice =
    input.sellPrice === '' || input.sellPrice == null ? null : Number(input.sellPrice);
  const shares = Number(input.shares || 100);

  let returnPct = null;
  let status = input.status || 'holding';
  if (sellPrice != null && buyPrice > 0) {
    returnPct = +(((sellPrice - buyPrice) / buyPrice) * 100).toFixed(2);
    if (!input.status || input.status === 'holding') {
      status = returnPct > 0.3 ? 'win' : returnPct < -0.3 ? 'loss' : 'breakeven';
    }
  }

  const record = {
    id: input.id || `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    weekOf: weekKey(buyDate),
    monthOf: monthKey(buyDate),
    buyDate,
    sellDate: input.sellDate || null,
    code: String(input.code || '').replace(/\D/g, '').padStart(6, '0'),
    name: input.name || '',
    module: input.module || '正股',
    buyPrice,
    sellPrice,
    shares,
    amount: +(buyPrice * shares).toFixed(2),
    returnPct,
    status,
    failReason: input.failReason || '',
    successReason: input.successReason || '',
    notes: input.notes || '',
    sourceReportDate: input.sourceReportDate || '',
    biasAtBuy: input.biasAtBuy || '',
    macdAtBuy: input.macdAtBuy || '',
    updatedAt: now,
    createdAt: input.createdAt || now,
  };

  const idx = trades.findIndex((t) => t.id === record.id);
  if (idx >= 0) {
    record.createdAt = trades[idx].createdAt || now;
    trades[idx] = record;
  } else {
    trades.unshift(record);
  }
  writeTrades(trades);
  return record;
}

export function deleteTrade(id) {
  writeTrades(readTrades().filter((t) => t.id !== id));
  return true;
}

export function listCandidatesFromLatestReport() {
  const outputRoot = path.resolve(__dirname, '../../output');
  if (!fs.existsSync(outputRoot)) return { reportDate: null, candidates: [] };
  const days = fs
    .readdirSync(outputRoot)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse();

  for (const day of days) {
    const p = path.join(outputRoot, day, 'latest.json');
    if (!fs.existsSync(p)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      const mods = j.modules || {};
      const rows = [];
      for (const [mod, list] of [
        ['正股', mods.plainStocks || []],
        ['ST', mods.stStocks || []],
        ['事件', mods.eventStocks || []],
      ]) {
        for (const c of list) {
          rows.push({
            code: c.code,
            name: c.name,
            module: mod,
            price: c.price,
            buyPriceHint: c.buyPrice,
            sellPriceHint: c.sellPrice,
            biasAtBuy: c.signalBoard?.biasText || '',
            macdAtBuy: c.signalBoard?.macdText || '',
            reportDate: day,
          });
        }
      }
      if (rows.length) return { reportDate: day, candidates: rows };
    } catch {
      /* next */
    }
  }
  return { reportDate: null, candidates: [] };
}
