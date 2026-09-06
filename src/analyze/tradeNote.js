/**
 * 明日交易便签：一行一条，方便复制到便签
 */

import { fetchKlines } from '../crawl/eastmoney.js';
import { computeIndicators } from './indicators.js';
import { shortTermPrices, eventDrivenPrices } from './pricing.js';
import { buildSignalBoard } from './modules.js';
import { scoreShortTerm } from '../strategy/shortTerm.js';
import { resolveStockTokens } from './resolveNames.js';
import { tradingDayLabels } from '../output/report.js';
import dayjs from 'dayjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function oneLineWatch(card, prices, ind, scored) {
  const bits = [];
  if (scored?.veto?.length) bits.push(scored.veto[0].slice(0, 16));
  else if (scored?.must?.some((m) => m.startsWith('未') || m.includes('不足'))) {
    bits.push(scored.must.find((m) => m.startsWith('未') || m.includes('不足')).slice(0, 16));
  }
  if (card?.fundFlow?.status) bits.push(`资金${card.fundFlow.status}`);
  if (card?.chips?.status) bits.push(`筹码${card.chips.status}`);
  if (card?.industry) bits.push(card.industry);
  if (card?.types?.length) bits.push(card.types.join('/'));
  if (card?.taoTags?.length) bits.push(card.taoTags.join('+'));
  if (ind?.bias5 != null && Math.abs(ind.bias5) >= 5) {
    bits.push(`现价相对MA5已偏高${ind.bias5 >= 0 ? '+' : ''}${Number(ind.bias5).toFixed(1)}%`);
  } else if (ind?.bias5 != null) {
    bits.push(`现价相对MA5 ${ind.bias5 >= 0 ? '+' : ''}${Number(ind.bias5).toFixed(1)}%`);
  }
  if (ind && !ind.aboveMa5) bits.push('未站稳MA5');
  if (card?.nextAction) bits.push(String(card.nextAction).slice(0, 18));
  if (!bits.length && prices?.buyReason) bits.push(String(prices.buyReason).slice(0, 28));
  if (!bits.length) bits.push('盯量能与五日线得失');
  return [...new Set(bits)].slice(0, 3).join('；');
}

function pickAction(card, prices) {
  const a = card?.action || prices?.action || '观察';
  if (/卖出|止损|回避/.test(a)) return '卖出';
  if (/等回踩/.test(a)) return '等回踩';
  if (/回踩买/.test(a)) return '回踩买';
  if (/买入|低吸|关注买入|小仓/.test(a)) return '买入';
  if (/观察|跟踪|观望/.test(a)) return '观察';
  return a.slice(0, 6) || '观察';
}

async function fetchLiteQuote(code) {
  const c = String(code).padStart(6, '0');
  const prefix = c.startsWith('6') || c.startsWith('9') || c.startsWith('5') ? 'sh' : 'sz';
  try {
    const res = await fetch(`https://qt.gtimg.cn/q=${prefix}${c}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const text = await res.text();
    // 51~名称~代码~现价~昨收~...~涨跌~涨跌幅~...~换手~...~量比约在字段中
    const parts = text.split('~');
    if (parts.length < 50) {
      return {
        name: parts[1],
        price: Number(parts[3]) || 0,
        prevClose: Number(parts[4]) || 0,
        changePct: Number(parts[32]) || 0,
        turnover: Number(parts[38]) || 0,
        volumeRatio: Number(parts[49]) || 0,
        amplitude: Number(parts[43]) || 0,
      };
    }
    return {
      name: parts[1],
      price: Number(parts[3]) || 0,
      prevClose: Number(parts[4]) || 0,
      changePct: Number(parts[32]) || 0,
      turnover: Number(parts[38]) || 0,
      volumeRatio: Number(parts[49]) || 0,
      amplitude: Number(parts[43]) || 0,
    };
  } catch {
    return null;
  }
}

async function enrichOne(item) {
  const code = item.code;
  if (!code) {
    return {
      ...item,
      line: `？ ${item.token}｜未能识别股票，请改用代码或完整简称`,
      ok: false,
    };
  }

  let card = item.card ? { ...item.card } : null;
  let ind = null;
  let prices = null;
  let scored = null;

  // 便签始终按最新 K 线重算收窄后的买卖规则（不沿用报告里偏宽的旧价）
  {
    const quote = await fetchLiteQuote(code);
    let klines = [];
    try {
      klines = await fetchKlines(code, { limit: 90 });
    } catch {
      klines = [];
    }
    ind = klines.length >= 30 ? computeIndicators(klines) : null;
    const stock = {
      code,
      name: card?.name || item.name || quote?.name || code,
      price: quote?.price || card?.price || ind?.price || klines.at(-1)?.close || 0,
      changePct: quote?.changePct ?? card?.changePct ?? klines.at(-1)?.changePct ?? 0,
      volumeRatio: quote?.volumeRatio || card?.volumeRatio || 0,
      turnover: quote?.turnover || card?.turnover || ind?.lastTurnover || 0,
      amplitude: quote?.amplitude || card?.amplitude || 0,
      mainNetInflow: card?.mainNetInflow || 0,
    };
    const isST = /ST/i.test(stock.name);
    const hasEvent = !!(card?.types?.length || /转让|收购|重整|重组|摘帽/.test(card?.direction || ''));
    if (isST || hasEvent) {
      prices = eventDrivenPrices(
        { close: stock.price, changePct: stock.changePct },
        stock,
        { isST }
      );
    } else {
      prices = shortTermPrices(stock, ind || { price: stock.price, ma5: stock.price });
      if (ind && !isST) {
        scored = scoreShortTerm(stock, ind);
        if (
          scored.veto?.length ||
          scored.must?.some((m) => m.includes('不足') || m.startsWith('未'))
        ) {
          if (!/卖出|等回踩/.test(prices.action)) {
            // 保留定价模块给出的等回踩/买入，仅在共振明显不足时降为观察
            if (!scored.mustPass && prices.action === '买入') {
              prices = { ...prices, action: '观察' };
            }
          }
        }
      }
    }
    card = {
      ...(card || {}),
      code,
      name: stock.name,
      price: stock.price,
      changePct: stock.changePct,
      buyPrice: prices.buyPrice,
      sellPrice: prices.sellPrice,
      action: prices.action,
      buyReason: prices.buyReason,
      sellReason: prices.sellReason,
      entryMode: prices.entryMode,
      buyTrigger: prices.buyTrigger,
      signalBoard: card?.signalBoard || buildSignalBoard(ind),
    };
  }

  const action = pickAction(card, prices);
  const watch = oneLineWatch(card, prices, ind, scored);
  const px = card.price != null ? Number(card.price).toFixed(2) : '-';
  const chg =
    card.changePct != null && !Number.isNaN(+card.changePct)
      ? `${+card.changePct >= 0 ? '+' : ''}${Number(card.changePct).toFixed(2)}%`
      : '';

  const line =
    `${code} ${card.name}｜现价${px}${chg ? `(${chg})` : ''}｜操作:${action}` +
    `｜买:${card.buyPrice || '-'}` +
    `｜卖:${card.sellPrice || '-'}` +
    `｜注意:${watch}`;

  return {
    token: item.token,
    code,
    name: card.name,
    action,
    buyPrice: card.buyPrice,
    sellPrice: card.sellPrice,
    entryMode: card.entryMode,
    buyTrigger: card.buyTrigger,
    watch,
    line,
    ok: true,
    source: item.source,
  };
}

/**
 * @param {string[]|string} input
 */
export async function buildTradeNotes(input, { onProgress } = {}) {
  const labels = tradingDayLabels(dayjs());
  onProgress?.('解析股票（支持中文名/代码）…');
  const { results } = await resolveStockTokens(input);
  if (!results.length) {
    throw new Error('请输入至少一只股票，例如：npm run note -- 远东股份 英力特 600869');
  }

  const rows = [];
  for (let i = 0; i < results.length; i++) {
    const item = results[i];
    onProgress?.(`[${i + 1}/${results.length}] ${item.token} → ${item.code || '未识别'}`);
    rows.push(await enrichOne(item));
    await sleep(100);
  }

  const header = `【下一交易日 ${labels.tomorrowLabel}】交易便签（可直接复制）`;
  const lines = rows.map((r) => r.line);
  const text = [header, ...lines, ''].join('\n');

  return { labels, rows, text, header, lines };
}
