/**
 * 正股炒作预期 + 涨跌归因（基于行业/概念/资金/技术/热点）
 */

function pct(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function hotKeywords(hotNews = [], hotSectors = []) {
  const words = new Set();
  for (const s of hotSectors || []) {
    const name = typeof s === 'string' ? s : s?.name;
    if (name) words.add(String(name).replace(/[（(].*$/, '').trim());
  }
  for (const n of hotNews || []) {
    const t = `${n.title || ''} ${n.summary || ''}`;
    // 粗提常见题材词
    const hits = t.match(
      /人工智能|AI|算力|光模块|光通信|机器人|低空经济|卫星|创新药|存储|芯片|半导体|黄金|消费|新能源|光伏|锂电|军工|重组|并购|股权转让|脑机|折叠屏|高股息|银行|券商|地产|有色|煤炭|石油|航运|传媒|游戏|白酒|中药|固态电池|人形机器人|OpenAI|GPT/g
    );
    for (const h of hits || []) words.add(h === '人工智能' ? 'AI' : h);
  }
  return [...words].filter(Boolean);
}

function matchThemes(concepts = [], industry = '', keys = []) {
  const pool = [...(concepts || []), industry].filter(Boolean).map(String);
  const hits = [];
  for (const p of pool) {
    for (const k of keys) {
      if (!k) continue;
      if (p.includes(k) || k.includes(p.replace(/板块|概念|行业/g, ''))) {
        if (!hits.includes(p)) hits.push(p);
      }
    }
  }
  // 无热点命中时仍返回前几个概念作题材锚点
  if (!hits.length) return pool.slice(0, 3);
  return hits.slice(0, 4);
}

/**
 * 单票：炒作预期文案
 */
export function buildThemeExpect(card, { hotKeys = [], hotSectors = [] } = {}) {
  const industry = card.industry || '';
  const concepts = card.concepts || [];
  const matched = matchThemes(concepts, industry, hotKeys);
  const events = (card.majorEvents || []).slice(0, 2).map((e) => e.title || e).filter(Boolean);
  const dirs = []
    .concat(card.direction || [])
    .concat(card.types || [])
    .flatMap((x) => String(x).split(/[\/,，]/))
    .map((s) => s.trim())
    .filter(Boolean);

  const parts = [];
  if (matched.length) parts.push(`题材：${matched.join('、')}`);
  else if (industry) parts.push(`行业：${industry}`);
  if (dirs.length) parts.push(`策略线：${[...new Set(dirs)].slice(0, 2).join('/')}`);
  if (events.length) parts.push(`事件催化：${events[0].slice(0, 36)}`);

  const sectorHit = (hotSectors || [])
    .map((s) => (typeof s === 'string' ? s : s?.name))
    .filter(Boolean)
    .find((name) => matched.some((m) => m.includes(name) || name.includes(m)));
  if (sectorHit) parts.push(`对接热门板块「${sectorHit}」`);

  if (!parts.length) return '炒作预期：暂无线索，偏纯技术跟踪';
  return `炒作预期：${parts.join(' · ')}`;
}

/**
 * 单票：为何涨 / 为何跌
 */
export function buildMoveReason(card) {
  const chg = pct(card.changePct);
  const side = chg == null ? '平' : chg > 0.3 ? '涨' : chg < -0.3 ? '跌' : '平';
  const reasons = [];

  const fund = card.fundFlow || {};
  if (fund.level === 'strong_in' || fund.level === 'in') {
    reasons.push(side === '跌' ? `主力仍净流入但股价承压（${fund.text || '流入'}）` : `主力资金净流入（${fund.text || '流入'}）`);
  } else if (fund.level === 'strong_out' || fund.level === 'out') {
    reasons.push(side === '涨' ? `资金流出下仍冲高（${fund.text || '流出'}）` : `主力资金净流出（${fund.text || '流出'}）`);
  }

  const sb = card.signalBoard || {};
  if (sb.macdGolden) reasons.push('MACD金叉/多头动能');
  else if (sb.macdGreenShrinking) reasons.push('MACD绿柱缩短、空头减弱');
  if (sb.biasText && /站稳|回踩买|五日线上方/.test(sb.biasText)) reasons.push('价格相对五日线偏强');
  if (sb.biasText && /跌破|偏高|乖离过大/.test(sb.biasText)) reasons.push(sb.biasText.replace(/^乖离[：:]?/, '技术：'));

  const chips = card.chips || {};
  if (chips.status && /集中|锁定/.test(chips.status)) {
    reasons.push(side === '跌' ? `筹码偏${chips.status}，下跌或为洗盘/兑现` : `筹码偏${chips.status}，利于趋势延续`);
  } else if (chips.status && /分散/.test(chips.status)) {
    reasons.push(`筹码偏分散，波动易放大`);
  }

  if ((card.concepts || []).length && side === '涨') {
    reasons.push(`概念联动：${card.concepts.slice(0, 2).join('、')}`);
  }
  if (card.industry && side === '跌') {
    reasons.push(`行业拖累风险：${card.industry}`);
  }
  if (card.taoTags?.includes('每日观察')) reasons.push('命中陶博士每日观察形态');
  if (card.taoTags?.includes('蓝色钻石')) reasons.push('蓝色钻石观察池（勿盲目追涨）');

  if (!reasons.length) {
    if (side === '涨') reasons.push(chg != null ? `短线上涨 ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%，暂无更细资金/技术标签` : '短线偏强');
    else if (side === '跌') reasons.push(chg != null ? `短线下跌 ${chg.toFixed(2)}%，暂无更细资金/技术标签` : '短线偏弱');
    else reasons.push(chg != null ? `今日振幅有限（${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%），多空胶着` : '涨跌幅暂缺');
  }

  const head = side === '涨' ? '为何涨' : side === '跌' ? '为何跌' : '为何平盘';
  return `${head}：${reasons.slice(0, 4).join('；')}`;
}

/**
 * 给正股卡片附加 themeExpect / moveReason
 */
export function attachThemeExpect(cards, { hotNews = [], hotSectors = [] } = {}) {
  if (!cards?.length) return cards;
  const hotKeys = hotKeywords(hotNews, hotSectors);
  for (const c of cards) {
    c.themeExpect = buildThemeExpect(c, { hotKeys, hotSectors });
    c.moveReason = buildMoveReason(c);
  }
  return cards;
}
