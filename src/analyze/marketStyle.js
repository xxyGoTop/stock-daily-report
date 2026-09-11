/**
 * 当前市场风格 + 两市量能
 *
 * 风格用「宽基指数横向比较」判断，不依赖个股筛选结果：
 *   大小盘  = (上证50+沪深300) vs (中证1000+国证2000)
 *   成长价值 = (创业板指+科创50) vs (上证50+中证红利)
 * 行业风格则把当日板块归入科技/周期/消费等大类后取主导方向。
 *
 * 量能用成交量（手）做同比，因为历史K线源（新浪/腾讯）只给成交量；
 * 成交额只有实时接口有，仅用于展示绝对值。
 */

import { fetchIndexRealtime, fetchKlines } from '../crawl/eastmoney.js';

/** 参与风格判断的宽基指数 */
const STYLE_INDICES = [
  { code: '000001', name: '上证指数', market: 'sh', tags: ['综合'] },
  { code: '399001', name: '深证成指', market: 'sz', tags: ['综合'] },
  { code: '000300', name: '沪深300', market: 'sh', tags: ['大盘'] },
  { code: '000016', name: '上证50', market: 'sh', tags: ['大盘', '价值'] },
  { code: '000905', name: '中证500', market: 'sh', tags: ['中盘'] },
  { code: '000852', name: '中证1000', market: 'sh', tags: ['小盘'] },
  { code: '399303', name: '国证2000', market: 'sz', tags: ['小盘'] },
  { code: '399006', name: '创业板指', market: 'sz', tags: ['成长'] },
  { code: '000688', name: '科创50', market: 'sh', tags: ['成长'] },
  { code: '000922', name: '中证红利', market: 'sh', tags: ['价值'] },
];

/** 两市量能口径：沪市全量 + 深市全量 */
const TURNOVER_INDICES = [
  { code: '000001', name: '上证指数', market: 'sh' },
  { code: '399001', name: '深证成指', market: 'sz' },
];

/**
 * 行业名 → 风格大类
 *
 * 东财的三级行业名很细（如「城商行Ⅲ」「印制电路板」「水力发电」），
 * 规则按顺序匹配，靠前的优先，避免「光伏设备」被「发电」抢走这类误判。
 */
const CATEGORY_RULES = [
  [
    '医药',
    /医药|生物制品|医疗|中药|制药|疫苗|医美|原料药|血液制品|体外诊断|诊断服务|化学制剂|动物保健|药店|保健品|医院|研发外包/,
  ],
  [
    '科技',
    /半导体|集成电路|芯片|分立器件|元件|光学|光电子|面板|LED|消费电子|电子|印制电路板|线缆|计算机|软件|IT服务|信息服务|游戏|传媒|媒体|出版|影视|院线|广告|营销|通信|电信运营商|互联网|电商|门户网站|数字|安防设备|磁性材料|电视广播/,
  ],
  [
    '金融地产',
    /银行|商行|证券|保险|信托|租赁|期货|多元金融|非银金融|金融控股|资产管理|房地产|地产|住宅开发|物业|房产租赁/,
  ],
  [
    '高端制造',
    /电池|锂电|光伏加工设备|光伏设备|光伏主材|光伏辅材|硅料硅片|逆变器|风电|电网|输变电|配电设备|电力设备|综合电力设备商|电机|火电设备|其他电源设备|汽车|乘用车|商用车|商用载|摩托车|轮胎|底盘|车身|专用设备|通用设备|自动化设备|工控设备|工程机械|机械|机床|仪器仪表|激光设备|机器人|军工|兵装|航天装备|航空装备|航海装备|船舶|轨交|运输设备|楼宇设备|照明设备|印刷包装机械|纺织服装设备|农用机械|能源及重型设备|制冷空调设备|民爆|磨具磨料/,
  ],
  [
    '消费',
    /食品|饮料|白酒|啤酒|酒类|软饮|乳品|肉|零食|烘焙|熟食|调味|预加工|果蔬|粮|家电|冰洗|彩电|空调|厨房|厨卫|卫浴|家居|家纺|服装|服饰|纺织|鞋|棉纺|印染|辅料|珠宝|饰品|钟表|化妆品|个护|洗护|美容护理|用纸|造纸|包装|印刷|文化用品|文娱|娱乐用品|轻工|超市|百货|零售|商贸|贸易Ⅱ|贸易Ⅲ|专业连锁|酒店|餐饮|旅游|景区|教育|培训|体育|会展|人力资源|专业服务|检测服务|社会服务|宠物|养殖|种植|饲料|渔|捕捞|林业|农林牧渔|农业综合|农产品|畜禽|生猪|肉鸡|水产|食用菌|种子/,
  ],
  [
    '周期资源',
    /煤|焦炭|石油|石化|油气|油服|油田|炼化|炼油|有色|金属|钢|铜|铝|铅锌|镍|钴|锂|钨|钼|稀土|黄金|白银|化工|化学|化纤|涤纶|锦纶|氨纶|粘胶|橡胶|塑料|树脂|聚氨酯|有机硅|氟化工|氯碱|纯碱|无机盐|磷肥|氮肥|钾肥|复合肥|农药|农化|水泥|玻璃|玻纤|建材|建筑材料|管材|耐火材料|防水材料|涂料|胶黏剂|炭黑|膜材料|非金属材料|冶钢|长材|板材|普钢|特钢|铁矿石|瓷砖地板/,
  ],
  [
    '基建公用',
    /电力|电能|发电|燃气|水务|水治理|环保|环境治理|固废|大气治理|热力|公用事业|公路|铁路|机场|航空运输|物流|快递|仓储|供应链|交通运输|公交|航运|港口|基础建设|基建|工程|装修装饰|建筑装饰|钢结构|园林|房屋建设/,
  ],
];

function categoryOf(name = '') {
  for (const [cat, re] of CATEGORY_RULES) {
    if (re.test(name)) return cat;
  }
  return '其他';
}

function avg(list) {
  const nums = list.filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function fmtYi(n) {
  if (!Number.isFinite(n)) return '-';
  const yi = n / 1e8;
  return `${Math.abs(yi) < 1 ? yi.toFixed(2) : yi.toFixed(0)}亿`;
}

/** 净流入带符号，避免「主力11亿」看不出方向 */
function fmtNetYi(n) {
  if (!Number.isFinite(n)) return '-';
  return `${n > 0 ? '+' : ''}${fmtYi(n)}`;
}

function fmtWanYi(n) {
  if (!Number.isFinite(n)) return '-';
  const w = n / 1e12;
  return w >= 1 ? `${w.toFixed(2)}万亿` : fmtYi(n);
}

/** 两边强弱倾斜：diff 为正表示前者占优 */
function tilt(aVal, bVal, aLabel, bLabel) {
  if (!Number.isFinite(aVal) || !Number.isFinite(bVal)) {
    return { label: '数据不足', diff: null, a: aVal, b: bVal, strong: false };
  }
  const diff = +(aVal - bVal).toFixed(2);
  const abs = Math.abs(diff);
  if (abs < 0.3) {
    return { label: '势均力敌', diff, a: +aVal.toFixed(2), b: +bVal.toFixed(2), strong: false };
  }
  const winner = diff > 0 ? aLabel : bLabel;
  return {
    label: `${winner}占优`,
    winner,
    diff,
    a: +aVal.toFixed(2),
    b: +bVal.toFixed(2),
    strong: abs >= 0.8,
  };
}

/** 当日量能：与近5日均量比较，盘中按已过交易时间折算全天 */
export async function analyzeTurnover({ phase, tradeDate, onProgress } = {}) {
  onProgress?.('统计两市量能...');

  const live = await fetchIndexRealtime(TURNOVER_INDICES).catch(() => []);
  const amount = live.reduce((s, x) => s + (x.amount || 0), 0) || null;
  const liveVolume = live.reduce((s, x) => s + (x.volume || 0), 0) || 0;

  // 历史成交量：沪深两市逐日相加
  const raw = new Map();
  for (const idx of TURNOVER_INDICES) {
    let kl = [];
    try {
      kl = await fetchKlines(idx.code, { limit: 30, market: idx.market });
    } catch {
      kl = [];
    }
    for (const k of kl) {
      const d = String(k.date).slice(0, 10);
      raw.set(d, (raw.get(d) || 0) + (k.volume || 0));
    }
  }

  const rawDays = [...raw.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const today = tradeDate || null;
  const lastDay = rawDays.length ? rawDays[rawDays.length - 1][0] : null;

  // 日K的成交量单位随数据源变：新浪/腾讯给「股」，东财给「手」，而实时 f5 固定是「手」。
  // 哪个源应答是不确定的，所以不能写死倍数——拿K线里最近一根和实时量对齐，自己校准。
  const refBar = liveVolume ? raw.get(lastDay) || null : null;
  const volumeScale = volumeScaleOf(refBar, liveVolume);
  const days = rawDays.map(([d, v]) => [d, v / volumeScale]);
  const series = new Map(days);

  // 今天这根不能进自己的对比基准：盘中它不完整，收盘后它就是被比较的那一天
  const history = today ? days.filter(([d]) => d < today) : days.slice(0, -1);
  const prev5 = history.slice(-5).map(([, v]) => v);
  const avgVolume5 = prev5.length ? prev5.reduce((s, v) => s + v, 0) / prev5.length : null;

  const todayBar = today && lastDay && lastDay >= today ? series.get(lastDay) : null;
  const rawVolume = liveVolume || todayBar || days.at(-1)?.[1] || 0;
  const elapsed = phase?.live ? Math.max(0.15, Number(phase.ratio) || 0) : 1;
  const projectedVolume = phase?.live ? rawVolume / elapsed : rawVolume;
  const projectedAmount = amount != null && phase?.live ? amount / elapsed : amount;

  const ratio =
    avgVolume5 && projectedVolume ? +(projectedVolume / avgVolume5).toFixed(3) : null;

  let level = 'unknown';
  let label = '量能数据不足';
  let note = '未能取到可比的历史成交量';
  if (ratio != null) {
    const pct = ((ratio - 1) * 100).toFixed(0);
    if (ratio >= 1.2) {
      level = 'surge';
      label = '显著放量';
      note = `${phase?.live ? '折算全天量' : '今日量'}较近5日均量放大 ${pct}%`;
    } else if (ratio >= 1.05) {
      level = 'up';
      label = '温和放量';
      note = `较近5日均量放大 ${pct}%，增量温和`;
    } else if (ratio >= 0.95) {
      level = 'flat';
      label = '量能持平';
      note = `与近5日均量基本持平（${pct}%）`;
    } else if (ratio >= 0.8) {
      level = 'down';
      label = '小幅缩量';
      note = `较近5日均量减少 ${Math.abs(+pct)}%`;
    } else {
      level = 'shrink';
      label = '显著缩量';
      note = `较近5日均量减少 ${Math.abs(+pct)}%，承接明显不足`;
    }
  }

  return {
    amount,
    amountText: fmtWanYi(amount),
    projectedAmount,
    projectedAmountText: fmtWanYi(projectedAmount),
    volume: rawVolume,
    projectedVolume,
    avgVolume5,
    ratio,
    level,
    label,
    note,
    intraday: !!phase?.live,
    elapsedRatio: +elapsed.toFixed(3),
    detail: live.map((x) => ({
      name: x.name,
      changePct: x.changePct,
      amount: x.amount,
      amountText: fmtYi(x.amount),
    })),
  };
}

/**
 * K线成交量相对实时成交量的单位倍数
 *
 * 只在 1（同为「手」）和 100（K线是「股」）之间选：
 * 相邻交易日的量能波动远到不了 30 倍，所以这个量级差只可能是单位问题。
 */
export function volumeScaleOf(klineVolume, liveVolume) {
  if (!klineVolume || !liveVolume) return 1;
  const r = klineVolume / liveVolume;
  if (r > 30) return 100;
  if (r < 1 / 30) return 1 / 100;
  return 1;
}

/** 宽基指数横向比较出的风格倾向 */
export async function analyzeStyleTilt({ onProgress } = {}) {
  onProgress?.('比较宽基指数判断市场风格...');
  const rows = await fetchIndexRealtime(STYLE_INDICES).catch(() => []);
  if (!rows.length) {
    return {
      available: false,
      label: '风格数据不足',
      note: '指数实时行情不可用',
      indices: [],
    };
  }

  const pick = (code) => rows.find((r) => r.code === code)?.changePct;
  const large = avg([pick('000016'), pick('000300')]);
  const small = avg([pick('000852'), pick('399303')]);
  const growth = avg([pick('399006'), pick('000688')]);
  const value = avg([pick('000016'), pick('000922')]);

  const size = tilt(small, large, '小盘', '大盘');
  const flavor = tilt(growth, value, '成长', '价值');

  const parts = [];
  if (size.winner) parts.push(size.winner);
  if (flavor.winner) parts.push(flavor.winner);
  const label = parts.length ? `${parts.join('')}占优` : '风格均衡';

  const noteBits = [];
  if (Number.isFinite(small) && Number.isFinite(large)) {
    noteBits.push(`小盘 ${small.toFixed(2)}% vs 大盘 ${large.toFixed(2)}%`);
  }
  if (Number.isFinite(growth) && Number.isFinite(value)) {
    noteBits.push(`成长 ${growth.toFixed(2)}% vs 价值 ${value.toFixed(2)}%`);
  }

  return {
    available: true,
    label,
    note: noteBits.join('　·　') || '指数涨跌接近，未见明显风格偏移',
    size,
    flavor,
    indices: rows.map((r) => ({
      code: r.code,
      name: r.name,
      changePct: r.changePct,
      tags: r.tags || [],
    })),
  };
}

/** 行业风格：把板块归入大类后看谁在主导 */
export function summarizeBoardStyle(allBoards = [], topBoards = []) {
  if (!allBoards.length) {
    return { available: false, dominant: null, note: '暂无板块数据', categories: [] };
  }

  const topNames = new Set(topBoards.map((b) => b.name));
  const map = new Map();
  for (const b of allBoards) {
    const cat = categoryOf(b.name);
    const cur = map.get(cat) || {
      name: cat,
      count: 0,
      upCount: 0,
      topCount: 0,
      sumChange: 0,
      netInflow: 0,
    };
    cur.count += 1;
    if (b.changePct > 0) cur.upCount += 1;
    if (topNames.has(b.name)) cur.topCount += 1;
    cur.sumChange += Number(b.changePct) || 0;
    cur.netInflow += Number(b.mainNetInflow) || 0;
    map.set(cat, cur);
  }

  const marketAvg =
    allBoards.reduce((s, b) => s + (Number(b.changePct) || 0), 0) / allBoards.length;
  const marketUpRatio =
    allBoards.filter((b) => b.changePct > 0).length / allBoards.length;
  const topSize = Math.max(1, topBoards.length);

  // 主导度看「相对」而非绝对：前十占位是否超出该大类应有的比例、
  // 平均涨幅是否跑赢全市场。否则普跌日会把板块数量最多的大类误判成主线。
  const categories = [...map.values()]
    .map((c) => {
      const avgChange = c.sumChange / c.count;
      const upRatio = c.upCount / c.count;
      const concentration = c.topCount / topSize - c.count / allBoards.length;
      const leadScore =
        concentration * 60 + (avgChange - marketAvg) * 8 + (upRatio - marketUpRatio) * 20;
      return {
        name: c.name,
        count: c.count,
        upCount: c.upCount,
        topCount: c.topCount,
        avgChange: +avgChange.toFixed(2),
        upRatio: +upRatio.toFixed(3),
        excessChange: +(avgChange - marketAvg).toFixed(2),
        netInflow: c.netInflow,
        netInflowText: fmtNetYi(c.netInflow),
        leadScore: +leadScore.toFixed(2),
      };
    })
    .sort((a, b) => b.leadScore - a.leadScore);

  const first = categories[0];
  const second = categories[1];
  // 既没跑赢大盘、又没在前十超配，就不硬造主线
  const qualified = first && first.leadScore >= 6 && (first.topCount >= 2 || first.excessChange > 0);
  const clear = qualified && (!second || first.leadScore - second.leadScore >= 6);

  return {
    available: true,
    dominant: qualified ? first.name : null,
    clear: !!clear,
    note: qualified
      ? `${first.name}占前十 ${first.topCount}/${topSize} 席，均涨 ${first.avgChange.toFixed(
          2
        )}%（跑赢全市场 ${first.excessChange >= 0 ? '+' : ''}${first.excessChange.toFixed(2)}pt）${
          clear ? '，主导方向较清晰' : `，与${second?.name || '次强'}强度接近`
        }`
      : '各大类强度接近，今日没有明确主导方向',
    categories,
  };
}

/**
 * 汇总当前市场风格与量能
 */
export async function analyzeMarketStyle({ phase, tradeDate, onProgress } = {}) {
  const [turnover, styleTilt] = await Promise.all([
    analyzeTurnover({ phase, tradeDate, onProgress }),
    analyzeStyleTilt({ onProgress }),
  ]);
  return { turnover, styleTilt };
}
