/**
 * 固定技术看板字段 + 三模块拆分工具
 */

/** 从指标或K线计算结果提取固定展示板 */
export function buildSignalBoard(ind) {
  if (!ind) {
    return {
      biasText: '乖离：暂无',
      macdText: 'MACD：暂无',
      bias5: null,
      macdGolden: false,
      macdGreenShrinking: false,
    };
  }
  if (ind.signalBoard) return ind.signalBoard;

  const bias5 = ind.bias5;
  const biasLevel =
    bias5 == null
      ? '未知'
      : bias5 > 8
        ? '严重正乖离(追高风险)'
        : bias5 > 5
          ? '偏大正乖离'
          : bias5 >= 0
            ? '温和正乖离'
            : bias5 >= -3
              ? '贴近均线/小负乖离'
              : bias5 >= -6
                ? '负乖离回撤'
                : '大幅负乖离';

  return {
    bias5: bias5 == null ? null : +Number(bias5).toFixed(2),
    bias10: ind.bias10 == null ? null : +Number(ind.bias10).toFixed(2),
    biasLevel,
    biasText:
      bias5 == null
        ? '乖离：数据不足'
        : `乖离MA5 ${bias5 >= 0 ? '+' : ''}${Number(bias5).toFixed(2)}%（${biasLevel}）`,
    macdGolden: !!ind.macdGolden,
    macdGreenShrinking: !!ind.macdGreenShrinking,
    macdText: ind.macdGolden
      ? 'MACD：金叉确认'
      : ind.macdGreenShrinking
        ? 'MACD：绿柱缩小'
        : ind.hist != null && ind.hist < 0
          ? `MACD：仍处绿柱(${Number(ind.hist).toFixed(3)})`
          : ind.hist != null
            ? `MACD：红柱(${Number(ind.hist).toFixed(3)})`
            : 'MACD：数据不足',
  };
}

const EVENT_TYPES = new Set(['收购', '要约收购', '股权转让', '重整', '重组']);

export function isSTName(name = '') {
  return /ST/i.test(name);
}

export function hasCorporateEvent(card) {
  const types = card.types || [];
  if (types.some((t) => EVENT_TYPES.has(t))) return true;
  const dir = String(card.direction || '');
  return ['收购', '要约收购', '股权转让', '重整', '重组'].some((k) => dir.includes(k));
}

/**
 * 三模块互斥拆分：
 * 1) 正股技术：非ST，且不含收购/转让/重整事件
 * 2) ST：名称含ST（可含事件）
 * 3) 收购股权转让重整：事件驱动且非ST
 */
export function splitThreeModules({ shortCandidates = [], turnCandidates = [], max = 15 } = {}) {
  const byCode = new Map();
  for (const c of [...turnCandidates, ...shortCandidates]) {
    if (!c?.code) continue;
    // 后写入的 short 不覆盖已有 turn 的事件丰富字段：优先保留事件更完整的
    const prev = byCode.get(c.code);
    if (!prev) {
      byCode.set(c.code, c);
      continue;
    }
    const prevEvent = hasCorporateEvent(prev);
    const curEvent = hasCorporateEvent(c);
    if (curEvent && !prevEvent) byCode.set(c.code, c);
    else if (curEvent === prevEvent && (c.score || 0) > (prev.score || 0)) byCode.set(c.code, c);
  }

  const all = [...byCode.values()];
  const st = [];
  const events = [];
  const plain = [];

  for (const c of all) {
    if (isSTName(c.name)) st.push(c);
    else if (hasCorporateEvent(c)) events.push(c);
    else plain.push(c);
  }

  const sortScore = (a, b) => (b.score || 0) - (a.score || 0);
  st.sort(sortScore);
  events.sort(sortScore);
  plain.sort(sortScore);

  return {
    plainStocks: plain.slice(0, max), // 正股（纯技术）
    stStocks: st.slice(0, Math.min(25, max + 10)), // ST 重整季多留席位，减少漏选
    eventStocks: events.slice(0, max), // 收购/股权转让/重整（非ST）
  };
}
