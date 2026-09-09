/**
 * 正股炒作预期 + 涨跌归因
 *
 * 归因思路：把「资金 / 量能 / 换手 / 相对强度 / 均线乖离 / MACD / 筹码 / 题材」
 * 各算一个显著度（数值越极端越显著），按显著度排序取前几条，
 * 并把具体数值写进文案 —— 避免所有个股都输出同一句话。
 */

const THEME_WORDS = [
  'AI',
  '算力',
  '光模块',
  '光通信',
  'CPO',
  '机器人',
  '人形机器人',
  '低空经济',
  '卫星',
  '创新药',
  '存储',
  '芯片',
  '半导体',
  '光刻机',
  '先进封装',
  '黄金',
  '有色',
  '消费',
  '白酒',
  '新能源',
  '光伏',
  '锂电',
  '固态电池',
  '军工',
  '重组',
  '并购',
  '股权转让',
  '脑机',
  '折叠屏',
  '高股息',
  '银行',
  '券商',
  '地产',
  '煤炭',
  '石油',
  '航运',
  '传媒',
  '游戏',
  '中药',
  '猪肉',
  '农业',
  '数据要素',
  '国企改革',
  '央国企改革',
  '可控核聚变',
  '智能驾驶',
  '虚拟现实',
  '鸿蒙',
  '国产软件',
  '互联网金融',
];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function yi(v) {
  const n = num(v);
  if (n == null) return null;
  const y = n / 1e8;
  if (Math.abs(y) >= 0.01) return `${y >= 0 ? '+' : ''}${y.toFixed(2)}亿`;
  return `${n >= 0 ? '+' : ''}${(n / 1e4).toFixed(0)}万`;
}

function sectorNames(hotSectors = []) {
  return (hotSectors || [])
    .map((s) => (typeof s === 'string' ? s : s?.name))
    .filter(Boolean)
    .map((s) => String(s).replace(/[（(].*$/, '').trim());
}

/**
 * 从热点新闻 + 热门板块提炼题材关键词
 */
export function hotKeywords(hotNews = [], hotSectors = []) {
  const words = new Set(sectorNames(hotSectors));
  for (const n of hotNews || []) {
    const t = `${n.title || ''} ${n.summary || ''}`;
    for (const w of THEME_WORDS) {
      if (t.includes(w)) words.add(w === '人工智能' ? 'AI' : w);
    }
  }
  return [...words].filter(Boolean);
}

/** 概念/行业 与热点关键词的交集 */
function matchHot(pool = [], keys = []) {
  const hits = [];
  for (const p of pool) {
    const clean = String(p).replace(/板块|概念|行业/g, '');
    if (!clean) continue;
    for (const k of keys) {
      const ck = String(k).replace(/板块|概念|行业/g, '');
      if (!ck) continue;
      if (clean.includes(ck) || ck.includes(clean)) {
        if (!hits.includes(p)) hits.push(p);
        break;
      }
    }
  }
  return hits;
}

/** 找出提到该题材的第一条新闻标题 */
function newsFor(themes = [], hotNews = []) {
  for (const n of hotNews || []) {
    const t = `${n.title || ''} ${n.summary || ''}`;
    for (const th of themes) {
      const clean = String(th).replace(/板块|概念|行业/g, '');
      if (clean && t.includes(clean)) return n.title;
    }
  }
  return null;
}

/** 剔除技术面伪事件，只留真正的公告/事件 */
function realEvents(card) {
  return (card.majorEvents || [])
    .filter((e) => {
      const type = String(e?.type || '');
      if (/技术|条件/.test(type)) return false;
      const title = String(e?.title || '');
      return title && !/MACD|KDJ|RSI|MA\d|均线|乖离|换手率|多头排列|站上/.test(title);
    })
    .map((e) => e.title)
    .filter(Boolean);
}

/** 相对强度定位 */
function rpsPosture(rps) {
  if (!rps) return null;
  const r20 = num(rps.rps20);
  const r50 = num(rps.rps50);
  const r120 = num(rps.rps120);
  if (r50 == null) return null;
  if (r50 >= 90 && (r120 ?? 0) >= 70) {
    return { label: '中期强势主升', detail: `RPS50=${r50.toFixed(0)}/RPS120=${(r120 ?? 0).toFixed(0)}，中长期都在前列` };
  }
  if ((r20 ?? 0) >= 75 && (r120 ?? 100) <= 35) {
    return { label: '低位补涨', detail: `RPS20=${(r20 ?? 0).toFixed(0)} 但 RPS120=${(r120 ?? 0).toFixed(0)}，属中期落后股的补涨` };
  }
  if (r50 >= 80) return { label: '中期偏强', detail: `RPS50=${r50.toFixed(0)}` };
  if (r50 <= 30) return { label: '中期偏弱', detail: `RPS50=${r50.toFixed(0)}，跑输多数个股` };
  return { label: '强度中性', detail: `RPS50=${r50.toFixed(0)}` };
}

/**
 * 单票：炒作预期文案
 */
export function buildThemeExpect(card, { hotKeys = [], hotSectors = [], hotNews = [] } = {}) {
  const industry = card.industry && card.industry !== '未知行业' ? card.industry : '';
  const concepts = (card.concepts || []).filter(
    (c) => !/沪股通|深股通|融资融券|富时罗素|MSCI|中证\d+|创业板综|标准普尔|上证\d+/.test(c)
  );
  const pool = [...concepts, industry].filter(Boolean);
  const hot = matchHot(pool, hotKeys);
  const parts = [];

  if (hot.length) {
    parts.push(`热点题材命中：${hot.slice(0, 3).join('、')}`);
  } else if (concepts.length) {
    parts.push(`题材：${concepts.slice(0, 3).join('、')}`);
  } else if (industry) {
    parts.push(`行业：${industry}`);
  }
  if (hot.length && industry && !hot.includes(industry)) parts.push(`所属行业：${industry}`);

  const posture = rpsPosture(card.rps);
  if (posture) parts.push(`${posture.label}（${posture.detail}）`);

  const events = realEvents(card);
  if (events.length) parts.push(`事件催化：${events[0].slice(0, 40)}`);

  const tags = card.taoTags || [];
  if (tags.includes('每日观察')) parts.push('陶博士每日观察形态');
  else if (tags.includes('率先年新高')) parts.push('率先一年新高，主升初段优先');
  else if (tags.includes('深调高RPS回升')) parts.push('高RPS深调后回升，注意基底次数');
  else if (tags.includes('顺向火车轨')) parts.push('顺向火车轨中线强势，偏好10日线下买点');
  else if (tags.includes('蓝色钻石')) parts.push('蓝色钻石观察池，等右侧口袋支点');

  const news = newsFor(hot.length ? hot : pool, hotNews);
  if (news) parts.push(`相关新闻：${news.slice(0, 40)}`);

  if (!parts.length) return '炒作预期：无明确题材线索，按纯技术短线对待';
  return `炒作预期：${parts.join(' · ')}`;
}

/**
 * 单票：为何涨 / 为何跌（多因子按显著度排序）
 */
export function buildMoveReason(card, { hotKeys = [], hotNews = [] } = {}) {
  const chg = num(card.changePct);
  const side = chg == null ? 'flat' : chg >= 0.5 ? 'up' : chg <= -0.5 ? 'down' : 'flat';
  const up = side === 'up';
  const down = side === 'down';

  /** @type {Array<{ w: number, text: string }>} */
  const drivers = [];
  const add = (w, text) => {
    if (text) drivers.push({ w, text });
  };

  // ── 资金流 ──
  const fund = card.fundFlow || {};
  const fpct = num(fund.mainNetInflowPct);
  const famt = num(fund.mainNetInflow);
  if (fund.level === 'unknown') {
    add(5, '主力资金数据本次未取到');
  } else if (fpct != null && Math.abs(fpct) >= 1) {
    const w = 55 + Math.min(42, Math.abs(fpct) * 4);
    const amt = yi(famt);
    const superYi = num(card.superNetInflow);
    // 超大单与主力同向才作为加强，反向则点出分歧
    let tail = '';
    if (superYi != null && Math.abs(superYi) > 1e7) {
      const sameSide = superYi > 0 === fpct > 0;
      tail = sameSide
        ? `，其中超大单 ${yi(superYi)}`
        : `，但超大单 ${yi(superYi)} 反向，机构与大户存在分歧`;
    }
    if (fpct > 0) {
      add(
        w,
        down
          ? `主力仍净流入 ${amt}（占成交 ${fpct.toFixed(1)}%）但股价回落，属高位换手${tail}`
          : `主力资金抢筹 ${amt}，占成交 ${fpct.toFixed(1)}%${tail}`
      );
    } else {
      add(
        w,
        up
          ? `主力净流出 ${amt}（占成交 ${fpct.toFixed(1)}%）却收涨，多为散户/游资推动${tail}`
          : `主力资金离场 ${amt}，占成交 ${fpct.toFixed(1)}%${tail}`
      );
    }
  } else if (fpct != null) {
    add(20, `主力资金基本平衡（净额占成交 ${fpct.toFixed(1)}%）`);
  }

  // ── 量能（量比）──
  const vr = num(card.volumeRatio);
  if (vr != null && vr > 0) {
    const w = 40 + Math.min(38, Math.abs(vr - 1) * 22);
    if (vr >= 2.5) add(w, `量比 ${vr.toFixed(2)}，显著放量，资金关注度骤升`);
    else if (vr >= 1.5) add(w, `量比 ${vr.toFixed(2)}，温和放量配合`);
    else if (vr <= 0.7) add(w, up ? `量比仅 ${vr.toFixed(2)}，缩量上行、承接偏弱` : `量比仅 ${vr.toFixed(2)}，缩量下跌、抛压不重`);
  }

  // ── 换手率 ──
  const to = num(card.turnover);
  if (to != null && to > 0) {
    if (to >= 15) add(78, `换手 ${to.toFixed(1)}%，筹码高速易手，短线情绪过热`);
    else if (to >= 8) add(58, `换手 ${to.toFixed(1)}%，交投活跃`);
    else if (to <= 1.5) add(50, `换手仅 ${to.toFixed(1)}%，筹码沉淀、日内博弈不激烈`);
  }

  // ── 相对强度 RPS ──
  const posture = rpsPosture(card.rps);
  if (posture) {
    const r50 = num(card.rps?.rps50) ?? 50;
    const w = 45 + Math.min(35, Math.abs(r50 - 50) * 0.7);
    if (posture.label === '中期强势主升') add(w + 8, `${posture.detail}，趋势资金持续抱团`);
    else if (posture.label === '低位补涨') add(w + 6, `${posture.detail}，持续性需验证`);
    else if (posture.label === '中期偏弱') add(w, `${posture.detail}，反弹多为超跌修复`);
    else add(w - 12, posture.detail);
  }

  // ── 均线乖离 ──
  const sb = card.signalBoard || {};
  const b5 = num(sb.bias5);
  if (b5 != null) {
    const w = 42 + Math.min(40, Math.abs(b5) * 6);
    if (b5 >= 6) add(w, `已高出五日线 ${b5.toFixed(1)}%，短线透支、回踩概率大`);
    else if (b5 >= 2) add(w - 10, `站上五日线 ${b5.toFixed(1)}%，多头结构完整`);
    else if (b5 <= -4) add(w, `低于五日线 ${b5.toFixed(1)}%，短线走坏需止损纪律`);
    else if (b5 <= -1) add(w - 12, `贴着五日线下方 ${b5.toFixed(1)}%，方向待确认`);
    else add(25, `紧贴五日线（乖离 ${b5.toFixed(1)}%），趋势健康不追高`);
  }

  // ── MACD ──
  const hist = num(sb.macdHist);
  const dif = num(sb.macdDif);
  const dea = num(sb.macdDea);
  if (sb.macdGolden) add(88, `MACD 金叉（DIF ${dif?.toFixed(3)} 上穿 DEA ${dea?.toFixed(3)}），动能转多`);
  else if (sb.macdNearGolden) add(72, 'MACD 临近金叉，动能正在修复');
  else if (sb.macdGreenShrinking) add(66, `MACD 绿柱已缩短 ${sb.greenShrinkDays || 0} 日，空头衰减`);
  else if (hist != null && hist > 0 && dif != null && dif > (dea ?? 0)) {
    add(48, `MACD 零轴上方红柱 ${hist.toFixed(3)} 放大，上涨动能仍在延续`);
  } else if (hist != null && hist < 0) {
    add(52, `MACD 红柱转绿（柱值 ${hist.toFixed(3)}），动能走弱`);
  }

  // ── 筹码 ──
  const chips = card.chips || {};
  const c90 = num(chips.concentration90);
  const profit = num(chips.profitRatio);
  if (profit != null) {
    if (profit >= 92) add(74, `获利盘高达 ${profit.toFixed(0)}%，上方几无套牢盘但兑现压力增大`);
    else if (profit <= 40) add(70, `获利盘仅 ${profit.toFixed(0)}%，上方套牢筹码密集、反弹有压力`);
    else add(34, `获利盘 ${profit.toFixed(0)}%，多空成本分布均衡`);
  }
  if (c90 != null) {
    const w = c90 <= 12 ? 72 : c90 >= 60 ? 62 : 30;
    if (c90 <= 12) add(w, `筹码高度集中（集中度 ${c90.toFixed(0)}%），主力锁仓、拉升成本低`);
    else if (c90 >= 60) add(w, `筹码极度分散（集中度 ${c90.toFixed(0)}%），历史成本跨度大、易反复震荡`);
    else add(w, `筹码集中度 ${c90.toFixed(0)}%，成本区 ${(chips.cost90 || []).join('-') || '-'}`);
  }

  // ── 题材 / 热点 ──
  const concepts = (card.concepts || []).filter(
    (c) => !/沪股通|深股通|融资融券|富时罗素|MSCI|中证\d+|创业板综|标准普尔|上证\d+/.test(c)
  );
  const hot = matchHot([...concepts, card.industry].filter(Boolean), hotKeys);
  if (hot.length) {
    // 具体新闻放在「炒作预期」里，此处只点风口，避免两栏重复
    add(92, `题材站在今日风口「${hot.slice(0, 2).join('、')}」`);
  } else if (concepts.length && up) {
    add(38, `概念联动：${concepts.slice(0, 2).join('、')}`);
  }
  if (card.industry && card.industry !== '未知行业' && down) {
    add(30, `所属「${card.industry}」板块同步走弱`);
  }

  // ── 事件 / 陶博士 ──
  const events = realEvents(card);
  if (events.length) add(90, `事件驱动：${events[0].slice(0, 34)}`);
  if (card.taoTags?.includes('率先年新高')) add(64, '率先创一年新高（241005思路一，需有指数中期信号配合）');
  if (card.taoTags?.includes('深调高RPS回升')) add(58, '高RPS深度调整后开始回升（241005思路二）');
  if (card.taoTags?.includes('主流板块')) add(55, `主流板块${card.board?.name ? `（${card.board.name}）` : ''}，板块RPS5前列`);
  if (card.taoTags?.includes('顺向火车轨')) add(62, '命中顺向火车轨（RPS+均线顺向+回撤可控）');
  if (card.taoTags?.includes('每日观察')) add(60, '命中火车每日观察（高RPS+年高附近）');
  if (card.taoTags?.includes('蓝色钻石')) add(56, '蓝色钻石观察池，须等右侧口袋支点');

  drivers.sort((a, b) => b.w - a.w);
  const picked = drivers.slice(0, 4).map((d) => d.text);

  if (!picked.length) {
    picked.push(
      chg == null
        ? '涨跌幅数据缺失，暂无法归因'
        : `${chg >= 0 ? '上涨' : '下跌'} ${chg.toFixed(2)}%，各项资金/技术指标均无明显异动`
    );
  }

  const head = up ? '为何涨' : down ? '为何跌' : '为何横盘';
  const mag = chg == null ? '' : `（${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%）`;
  return `${head}${mag}：${picked.join('；')}`;
}

/**
 * 给候选卡片附加 themeExpect / moveReason
 */
export function attachThemeExpect(cards, { hotNews = [], hotSectors = [] } = {}) {
  if (!cards?.length) return cards;
  const hotKeys = hotKeywords(hotNews, hotSectors);
  for (const c of cards) {
    c.themeExpect = buildThemeExpect(c, { hotKeys, hotSectors, hotNews });
    c.moveReason = buildMoveReason(c, { hotKeys, hotNews });
  }
  return cards;
}
