/**
 * 个股强弱研判：均线 / RSI / MACD / 资金 / 支撑量能 / 筹码
 * 输出给 pick / start / stock 共用的结构化文案
 */

import { computeIndicators } from './indicators.js';
import { estimateChipConcentration } from './marketMeta.js';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n) {
  const v = num(n);
  return v == null ? null : Math.round(v * 100) / 100;
}

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function fmtMoney(n) {
  const v = num(n);
  if (v == null) return '-';
  const abs = Math.abs(v);
  if (abs >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${(v / 1e4).toFixed(2)}万`;
  return `${v.toFixed(0)}元`;
}

function fmtPrice(n) {
  const v = num(n);
  return v == null ? '-' : v.toFixed(2);
}

function lastHist(ind) {
  return num(ind?.hist);
}

/**
 * 动能转弱：RSI 跌破 50、MACD 绿柱、红柱缩短或 DIF 在 DEA 下方
 * pick / start / stock 入选列表直接剔除
 */
export function momentumFade(ind) {
  if (!ind) return { fade: false, reason: '' };
  const rsi14 = num(ind.rsi14);
  const hist = lastHist(ind);
  const dif = num(ind.dif);
  const dea = num(ind.dea);
  if (rsi14 == null && hist == null && dif == null) return { fade: false, reason: '' };

  const reasons = [];
  if (rsi14 != null && rsi14 < 50) {
    reasons.push(`RSI14 ${rsi14.toFixed(1)}＜50，短期动能转弱`);
  }
  if (hist != null && hist < 0) {
    reasons.push('MACD仍处绿柱，空头动能占优');
  } else if (hist != null && hist > 0 && !ind.macdHistExpanding && !ind.macdGolden) {
    reasons.push('MACD红柱未继续拉长，多头动能转弱');
  }
  if (dif != null && dea != null && dif < dea) {
    reasons.push('DIF在DEA下方，多头动能未确认');
  }
  return { fade: reasons.length > 0, reason: reasons[0] || '', reasons };
}

export function keepMomentum(ind) {
  return !momentumFade(ind).fade;
}

/** 近 20 日（不含当日）低点作为核心支撑 */
function keySupport(klines) {
  const rows = (klines || []).slice(-21, -1);
  if (rows.length < 5) return null;
  let low = Infinity;
  for (const k of rows) {
    if (num(k.low) != null && k.low < low) low = k.low;
  }
  return Number.isFinite(low) ? round2(low) : null;
}

function highN(klines, n) {
  const rows = (klines || []).slice(-n);
  if (!rows.length) return null;
  return Math.max(...rows.map((k) => num(k.high) || 0)) || null;
}

function consecutiveLongBears(klines) {
  let streak = 0;
  let maxStreak = 0;
  for (const k of (klines || []).slice(-12)) {
    const open = num(k.open);
    const close = num(k.close);
    if (!(open > 0) || close == null) {
      streak = 0;
      continue;
    }
    const body = (open - close) / open;
    if (close < open && body >= 0.03) {
      streak += 1;
      maxStreak = Math.max(maxStreak, streak);
    } else {
      streak = 0;
    }
  }
  return maxStreak;
}

function volumePattern(klines) {
  const recent = (klines || []).slice(-8);
  const up = [];
  const down = [];
  for (const k of recent) {
    const vol = num(k.volume);
    if (!(vol > 0)) continue;
    if ((num(k.close) ?? 0) >= (num(k.open) ?? 0)) up.push(vol);
    else down.push(vol);
  }
  const avgUp = mean(up);
  const avgDown = mean(down);
  return {
    shrinkOnPullback: avgUp != null && avgDown != null && avgDown < avgUp * 0.88,
    expandOnRally: avgUp != null && avgDown != null && avgUp > avgDown * 1.08,
    avgUp,
    avgDown,
  };
}

function supportHeld(klines, support) {
  if (!(support > 0) || !klines?.length) return { held: null, broke: false };
  const recent = klines.slice(-10);
  let wickBroke = false;
  let closeBroke = false;
  for (const k of recent) {
    if (num(k.close) != null && k.close < support * 0.997) closeBroke = true;
    if (num(k.low) != null && k.low < support * 0.99) wickBroke = true;
  }
  const last = klines[klines.length - 1];
  const lastHeld = num(last.close) != null && last.close >= support * 0.997;
  return {
    held: lastHeld && !closeBroke,
    broke: closeBroke,
    wickBroke,
  };
}

function buildMa(ind, price) {
  if (!ind || num(ind.ma5) == null) {
    return { tone: 'muted', text: '均线数据不足，暂不判断多空排列。' };
  }
  const ma5 = ind.ma5;
  const ma10 = ind.ma10;
  const ma20 = ind.ma20;
  const allUp = !!(ind.ma5Rising && ind.ma10Rising && ind.ma20Rising);
  const aboveAll =
    price >= ma5 && (ma10 == null || price >= ma10) && (ma20 == null || price >= ma20);
  const bull = !!(ind.bullAlign && allUp && aboveAll);

  if (bull) {
    return {
      tone: 'good',
      text: '5/10/20 日线全部向上，股价稳稳站在全部短期均线上方，均线多头形态完好。',
    };
  }
  if (aboveAll && ind.bullAlign) {
    return {
      tone: 'good',
      text: '股价站在 5/10/20 日线上方，均线多头排列，部分均线斜率一般，整体仍偏强。',
    };
  }
  if (aboveAll && !allUp) {
    return {
      tone: 'warn',
      text: '股价还在短期均线上方，但 5/10/20 并未全部向上，多头尚未完全确认。',
    };
  }
  if (ind.bullAlign && !aboveAll) {
    return {
      tone: 'warn',
      text: `均线仍多头排列，但现价 ${fmtPrice(price)} 已跌破部分均线，回踩是否有效要看 ${fmtPrice(ma5)} 一线承接。`,
    };
  }
  if (ind.aboveMa5) {
    return {
      tone: 'warn',
      text: '仅站上五日线，10/20 日线尚未形成多头，只能当短线，跌破五日线就要走。',
    };
  }
  return {
    tone: 'bad',
    text: '短期均线未形成多头，或股价已跌破关键均线，回调不是健康回踩。',
  };
}

function buildRsi(rsi14) {
  const v = num(rsi14);
  if (v == null) {
    return { value: null, tone: 'muted', text: 'RSI14 数据不足。', note: '' };
  }
  if (v > 70) {
    return {
      value: round2(v),
      tone: 'warn',
      text: `RSI14 ≈${v.toFixed(2)}`,
      note: '已经进入超买区间（＞70），代表短期多头力量很强，但同时提示：短期有回调风险，不宜追高。',
    };
  }
  if (v >= 50) {
    return {
      value: round2(v),
      tone: 'good',
      text: `RSI14 ≈${v.toFixed(2)}`,
      note: '维持在 50 以上，多头占优，尚未进入超买，短线仍可沿均线持有。',
    };
  }
  return {
    value: round2(v),
    tone: 'bad',
    text: `RSI14 ≈${v.toFixed(2)}`,
    note: '跌破 50，短期动能转弱，需要先观察能否重新站回 50 再谈加仓。',
  };
}

function buildMacd(ind) {
  const hist = lastHist(ind);
  const dif = num(ind?.dif);
  const dea = num(ind?.dea);
  if (hist == null || dif == null || dea == null) {
    return { tone: 'muted', text: 'MACD 数据不足。' };
  }
  const above = dif > dea;
  if (hist > 0 && above) {
    if (ind.macdHistExpanding) {
      return {
        tone: 'good',
        text: '红柱继续拉长，DIF 在 DEA 上方，多头趋势，动能仍在增强。',
      };
    }
    return {
      tone: 'warn',
      text: '红柱继续，DIF 在 DEA 上方，多头趋势，但红柱没有继续大幅拉长，多头动能有放缓迹象。',
    };
  }
  if (hist < 0 && ind.macdGreenShrinking) {
    return {
      tone: 'warn',
      text: `仍处绿柱但绿柱缩短（${ind.greenShrinkDays || 1}日），DIF 向 DEA 收敛，空头动能减弱。`,
    };
  }
  if (ind.macdGolden) {
    return { tone: 'good', text: 'MACD 金叉确认，DIF 上穿 DEA，多头刚切换。' };
  }
  if (hist < 0) {
    return { tone: 'bad', text: '绿柱运行，DIF 在 DEA 下方，空头仍占优。' };
  }
  return { tone: 'warn', text: '红柱刚翻正或贴近零轴，多头刚起步，还要看能否延续。' };
}

function buildFund(stock, fundFlow) {
  const inflow = num(stock?.mainNetInflow ?? fundFlow?.mainNetInflow);
  const change = num(stock?.changePct);
  if (inflow == null) {
    return { tone: 'muted', text: '资金数据不足。', note: '' };
  }
  const dir = inflow >= 0 ? '净流入' : '净流出';
  const text = `当日主力资金${dir} ${fmtMoney(Math.abs(inflow))}`;
  if (change != null && change >= 2 && inflow < -1e6) {
    return {
      tone: 'warn',
      text,
      note: '股价大涨，但主力小幅流出，属于拉涨过程中有资金逢高兑现，属于要留意的小隐患，不是纯粹资金单边进攻行情。',
    };
  }
  if (change != null && change >= 1 && inflow > 1e6) {
    return {
      tone: 'good',
      text,
      note: '价涨且主力净流入，资金与走势同向，比单纯拉涨更健康。',
    };
  }
  if (change != null && change <= -1 && inflow < -1e6) {
    return {
      tone: 'bad',
      text,
      note: '股价下跌且主力净流出，资金与走势同向走弱。',
    };
  }
  if (change != null && change <= -0.5 && inflow > 1e6) {
    return {
      tone: 'warn',
      text,
      note: '股价回落但主力净流入，更像逢低吸筹，要看回踩是否站稳。',
    };
  }
  return {
    tone: inflow >= 0 ? 'good' : 'warn',
    text,
    note: fundFlow?.text ? `${fundFlow.status || ''}，占成交 ${num(fundFlow.mainNetInflowPct) ?? '-'}%。` : '',
  };
}

function buildChips(chips, klines, nearHigh) {
  const bears = consecutiveLongBears(klines);
  const status = chips?.status || '';
  if (bears >= 2 && nearHigh) {
    return {
      tone: 'bad',
      text: `高位出现连续 ${bears} 根长阴砸盘，筹码有快速松动迹象。`,
      loosening: true,
    };
  }
  if (bears >= 2) {
    return {
      tone: 'warn',
      text: `近端连续 ${bears} 根长阴，要注意筹码是否开始松动。`,
      loosening: true,
    };
  }
  if (nearHigh) {
    return {
      tone: 'good',
      text: chips?.text
        ? `${chips.text}。高位震荡未见连续长阴砸盘，筹码没有快速大面积松动。`
        : '高位震荡时筹码未快速大面积松动，没有连续长阴砸盘。',
      loosening: false,
    };
  }
  return {
    tone: status.includes('集中') ? 'good' : 'muted',
    text: chips?.text || '筹码：暂无足够K线。',
    loosening: false,
  };
}

/**
 * @returns {{
 *   ma: object, rsi: object, macd: object, fund: object, chips: object,
 *   support: object, volume: object,
 *   strengths: string[], risks: string[],
 *   supportPrice: number|null, rsi14: number|null
 * }}
 */
export function buildStrengthVerdict({
  klines = [],
  ind = null,
  stock = {},
  chips = null,
  fundFlow = null,
} = {}) {
  const computed =
    ind?.rsi14 != null || ind?.hist != null
      ? ind
      : klines.length >= 30
        ? computeIndicators(klines)
        : ind;
  const price = num(stock.price) ?? num(computed?.price) ?? num(klines.at?.(-1)?.close);
  const chip = chips || (klines.length >= 20 ? estimateChipConcentration(klines) : null);
  const support = keySupport(klines);
  const high60 = highN(klines, 60);
  const high250 = highN(klines, 250);
  const near60High = high60 > 0 && price != null && price >= high60 * 0.985;
  const nearHistHigh = high250 > 0 && price != null && price >= high250 * 0.97;
  const vol = volumePattern(klines);
  const hold = supportHeld(klines, support);
  const turn = num(stock.turnover) ?? num(computed?.lastTurnover);
  const change = num(stock.changePct);

  const ma = buildMa(computed, price);
  const rsiBlock = buildRsi(computed?.rsi14);
  const macd = buildMacd(computed);
  const fund = buildFund({ ...stock, changePct: change, mainNetInflow: stock.mainNetInflow }, fundFlow);
  const chipBlock = buildChips(chip, klines, near60High || nearHistHigh);

  let supportText = '支撑：K线不足，暂不判断回踩是否有效。';
  let supportTone = 'muted';
  if (support != null) {
    if (hold.broke) {
      supportText = `回踩已有效跌破核心支撑 ${fmtPrice(support)}，低点承接失败。`;
      supportTone = 'bad';
    } else if (hold.held) {
      supportText = `股价站稳关键支撑 ${fmtPrice(support)}，回踩不有效跌破，低点承接有力。`;
      supportTone = 'good';
    } else if (hold.wickBroke && !hold.broke) {
      supportText = `盘中刺破支撑 ${fmtPrice(support)} 但收盘收回，暂算回踩未有效跌破，仍要盯下一根。`;
      supportTone = 'warn';
    } else {
      supportText = `核心支撑看 ${fmtPrice(support)}，当前尚未确认是否站稳。`;
      supportTone = 'warn';
    }
  }

  let volumeText = '量能：近端涨跌日成交对比不足。';
  let volumeTone = 'muted';
  if (vol.shrinkOnPullback && vol.expandOnRally) {
    volumeText = '回调缩量，拉升放量，量价配合健康。';
    volumeTone = 'good';
  } else if (vol.expandOnRally && !vol.shrinkOnPullback) {
    volumeText = '拉升放量，但回调并未明显缩量，回撤时抛压仍在。';
    volumeTone = 'warn';
  } else if (vol.shrinkOnPullback) {
    volumeText = '回调缩量，抛压不大，但拉升放量还不充分。';
    volumeTone = 'warn';
  } else if (vol.avgUp != null && vol.avgDown != null && vol.avgDown > vol.avgUp * 1.15) {
    volumeText = '下跌放量、上涨缩量，量价背离，不宜当强势看待。';
    volumeTone = 'bad';
  }

  const strengths = [];
  const risks = [];

  if (supportTone === 'good' && (volumeTone === 'good' || change != null && change > 0)) {
    strengths.push(
      `${volumeTone === 'good' ? '放量上涨，' : ''}回踩不击穿核心支撑 ${fmtPrice(support)}，低点承接有力`
    );
  } else if (supportTone === 'good') {
    strengths.push(`回踩不击穿核心支撑 ${fmtPrice(support)}，低点承接有力`);
  }

  if (ma.tone === 'good' && near60High) {
    strengths.push('短期均线多头，盘中创出 60 日新高');
  } else if (ma.tone === 'good') {
    strengths.push('短期均线多头，股价站在 5/10/20 日线上方');
  }

  if (turn != null && turn >= 7 && turn <= 13) {
    strengths.push('换手维持在 7~13% 健康活跃区间，没有爆量到 18% 以上疯狂派发');
  } else if (turn != null && turn >= 3 && turn < 7 && turn < 18) {
    strengths.push(`换手 ${turn.toFixed(1)}%，活跃度一般，未见疯狂派发`);
  }

  if (rsiBlock.tone === 'good') strengths.push('RSI 维持 50 以上且未进超买');
  if (chipBlock.tone === 'good' && !chipBlock.loosening) {
    strengths.push(
      near60High || nearHistHigh
        ? '高位震荡时筹码未快速大面积松动，没有连续长阴砸盘'
        : '未见连续长阴砸盘，筹码没有快速松动'
    );
  }
  if (fund.tone === 'good') strengths.push(fund.text);

  if (rsiBlock.tone === 'warn' && (rsiBlock.value ?? 0) > 70) {
    risks.push('RSI 进入超买区，短期获利盘丰厚');
  }
  if (fund.note.includes('逢高兑现') || (change != null && change >= 2 && num(stock.mainNetInflow) < -1e6)) {
    risks.push('股价上涨，但主力资金小幅流出，边拉边卖');
  }
  if (nearHistHigh) {
    risks.push(`上方靠近历史波段高点 ${fmtPrice(high250)}，压力区临近`);
  } else if (near60High && high60 != null && high250 != null && high60 < high250 * 0.97) {
    risks.push(`靠近 60 日高点 ${fmtPrice(high60)}，上方仍有更长周期压力`);
  }
  if (turn != null && turn >= 18) {
    risks.push(`换手 ${turn.toFixed(1)}%，超过 18%，有疯狂派发嫌疑`);
  }
  if (chipBlock.loosening) risks.push(chipBlock.text.replace(/。$/, ''));
  if (supportTone === 'bad') risks.push(supportText.replace(/。$/, ''));
  if (volumeTone === 'bad') risks.push(volumeText.replace(/。$/, ''));
  if (ma.tone === 'bad') risks.push('短期均线多头破坏，回调不是沿均线的健康回踩');
  if (rsiBlock.tone === 'bad') risks.push('RSI 跌破 50，短期动能转弱');

  if (!strengths.length && ma.tone !== 'bad') {
    strengths.push(ma.text.replace(/。$/, ''));
  }
  if (!risks.length && rsiBlock.note) {
    /* 不强行凑隐患 */
  }

  return {
    ma,
    rsi: rsiBlock,
    macd,
    fund,
    chips: chipBlock,
    support: { tone: supportTone, text: supportText, price: support },
    volume: { tone: volumeTone, text: volumeText },
    strengths: [...new Set(strengths)].slice(0, 5),
    risks: [...new Set(risks)].slice(0, 5),
    supportPrice: support,
    rsi14: rsiBlock.value,
  };
}

export function attachStrengthVerdict(cards = [], codeKlines = {}) {
  for (const c of cards || []) {
    if (!c) continue;
    const code = String(c.code || '').padStart(6, '0');
    const kl = codeKlines[code] || codeKlines[c.code] || c.klines || [];
    if (kl.length < 20 && c.strength) continue;
    c.strength = buildStrengthVerdict({
      klines: kl,
      stock: c,
      chips: c.chips,
      fundFlow: c.fundFlow,
    });
  }
  return cards;
}

export function formatStrengthLines(v) {
  if (!v?.ma) return [];
  const lines = [
    `均线：${v.ma.text}`,
    `${v.rsi.text}${v.rsi.note ? `  👉 ${v.rsi.note}` : ''}`,
    `MACD：${v.macd.text}`,
    `资金面：${v.fund.text}${v.fund.note ? `  👉 ${v.fund.note}` : ''}`,
    `支撑/量能：${v.support.text} ${v.volume.text}`,
  ];
  if (v.strengths?.length) lines.push(`✅ 优点：${v.strengths.join('；')}`);
  if (v.risks?.length) lines.push(`⚠️ 隐患：${v.risks.join('；')}`);
  return lines;
}
