/**
 * 事件进展阶段推断 & 下一节点时间预期
 * （基于公告标题启发式，非官方时间表）
 */

import dayjs from 'dayjs';

/** 各事件链的阶段定义（靠后 = 更接近落地） */
const STAGE_CHAINS = {
  重整: [
    { id: 'apply', label: '重整申请/预重整', patterns: [/预重整/, /申请重整/, /被申请重整/], nextHint: '等待法院是否裁定受理', days: [15, 45] },
    { id: 'accept', label: '法院裁定受理', patterns: [/裁定受理/, /受理重整申请/, /决定受理/], nextHint: '指定管理人、债权申报', days: [7, 20] },
    { id: 'admin', label: '指定管理人', patterns: [/指定管理人/, /管理人/], nextHint: '招募重整投资人 / 债权申报', days: [15, 40] },
    { id: 'investor', label: '重整投资人/投资协议', patterns: [/重整投资人/, /重整投资协议/, /战投/, /意向投资/], nextHint: '债权人会议表决', days: [20, 60] },
    { id: 'creditor', label: '债权人会议', patterns: [/债权人会议/, /表决通过/], nextHint: '法院裁定批准重整计划', days: [10, 30] },
    { id: 'approve', label: '法院批准重整计划', patterns: [/裁定批准重整/, /批准重整计划/], nextHint: '执行重整计划（转增/偿债）', days: [30, 90] },
    { id: 'execute', label: '重整计划执行中', patterns: [/重整计划执行/, /股份划转/, /资本公积转增/], nextHint: '执行完毕公告', days: [30, 120] },
    { id: 'done', label: '重整执行完毕', patterns: [/重整计划执行完毕/, /重整完成/], nextHint: '关注后续整合与摘帽资格', days: [60, 180] },
  ],
  重组: [
    { id: 'intent', label: '筹划/意向重组', patterns: [/筹划重大资产重组/, /意向性协议/, /停牌筹划/], nextHint: '正式方案或终止公告', days: [15, 60] },
    { id: 'plan', label: '重组预案/草案', patterns: [/重组预案/, /重组报告书/, /重大资产重组/], nextHint: '股东大会 / 监管审核', days: [20, 60] },
    { id: 'vote', label: '股东会通过', patterns: [/股东大会.*通过/, /审议通过.*重组/], nextHint: '证监会/交易所审核', days: [30, 90] },
    { id: 'approve', label: '监管核准/注册', patterns: [/核准/, /注册生效/, /无异议函/], nextHint: '交割与实施', days: [15, 45] },
    { id: 'done', label: '重组实施完成', patterns: [/实施完成/, /过户完成/, /交割完毕/], nextHint: '关注整合与业绩兑现', days: [30, 90] },
  ],
  股权转让: [
    { id: 'intent', label: '意向性协议', patterns: [/意向性协议/, /框架协议/, /拟转让/], nextHint: '正式股份转让协议', days: [15, 45] },
    { id: 'formal', label: '正式转让协议', patterns: [/股份转让协议/, /签署.*转让协议/, /协议转让/], nextHint: '监管审批 / 权益变动披露', days: [20, 60] },
    { id: 'filing', label: '权益变动报告', patterns: [/权益变动报告书/, /详式权益变动/], nextHint: '审批与过户', days: [15, 45] },
    { id: 'approve', label: '审批进展', patterns: [/国资委/, /反垄断/, /证监会.*批复/, /取得.*批准/], nextHint: '股份过户登记', days: [10, 40] },
    { id: 'transfer', label: '过户完成', patterns: [/过户.*完成/, /完成过户登记/, /控制权变更完成/, /实控人变更/], nextHint: '后续资产注入/管理层变动', days: [30, 90] },
  ],
  要约收购: [
    { id: 'hint', label: '收购传闻/筹划', patterns: [/筹划收购/, /可能触发要约/], nextHint: '要约收购报告书', days: [10, 30] },
    { id: 'report', label: '要约收购报告书', patterns: [/要约收购报告书/, /要约收购提示性/], nextHint: '要约期开始 / 价格确认', days: [7, 20] },
    { id: 'period', label: '要约期进行中', patterns: [/要约期/, /要约收购结果/], nextHint: '要约结果与过户', days: [15, 40] },
    { id: 'done', label: '要约完成', patterns: [/要约收购完成/, /要约结果.*成功/], nextHint: '整合与后续资本运作', days: [30, 90] },
  ],
  摘帽: [
    { id: 'report', label: '年报披露达标', patterns: [/年度报告/, /年报/], nextHint: '披露拟撤销风险警示说明', days: [1, 5] },
    { id: 'intent', label: '拟撤销风险警示', patterns: [/拟撤销风险警示/, /拟申请撤销/], nextHint: '正式提交撤销申请', days: [3, 15] },
    { id: 'apply', label: '正式申请撤销', patterns: [/申请撤销.*风险警示/, /关于撤销.*申请/], nextHint: '交易所审核（约10~15交易日）', days: [10, 20] },
    { id: 'inquiry', label: '问询/补充材料', patterns: [/问询函/, /补充材料/], nextHint: '回复问询后继续审核', days: [5, 20] },
    { id: 'approve', label: '审核通过/摘帽落地', patterns: [/撤销退市风险警示/, /撤销其他风险警示/, /摘帽/], nextHint: '注意利好兑现抛压，观察是否保留ST', days: [1, 5] },
  ],
};

/**
 * 从公告列表推断主方向与当前阶段
 */
export function inferProgress(events = [], types = []) {
  const primaryType = pickPrimaryType(types, events);
  const chain = STAGE_CHAINS[primaryType] || STAGE_CHAINS.股权转让;

  let best = null;
  let bestIdx = -1;
  for (let i = 0; i < chain.length; i++) {
    const stage = chain[i];
    for (const ev of events) {
      const title = ev.title || '';
      if (stage.patterns.some((p) => p.test(title))) {
        if (i >= bestIdx) {
          bestIdx = i;
          best = { stage, event: ev, index: i };
        }
      }
    }
  }

  // 若无精确匹配，用类型默认起点
  if (!best) {
    const fallback = chain[Math.min(1, chain.length - 1)];
    return buildProgressResult(primaryType, fallback, 1, events[0], chain);
  }

  return buildProgressResult(primaryType, best.stage, best.index, best.event, chain);
}

function pickPrimaryType(types, events) {
  const priority = ['重整', '重组', '要约收购', '股权转让', '摘帽'];
  for (const p of priority) {
    if (types.includes(p)) return p;
    if (events.some((e) => e.type === p)) return p;
  }
  return types[0] || events[0]?.type || '股权转让';
}

function buildProgressResult(direction, stage, index, event, chain) {
  const nextStage = chain[index + 1] || null;
  const [dMin, dMax] = stage.days || [15, 45];
  const baseDate = event?.date ? dayjs(event.date) : dayjs();
  const expectStart = baseDate.add(dMin, 'day');
  const expectEnd = baseDate.add(dMax, 'day');

  const timeline = chain.map((s, i) => ({
    label: s.label,
    status: i < index ? 'done' : i === index ? 'current' : 'pending',
  }));

  return {
    direction,
    stageId: stage.id,
    stageLabel: stage.label,
    progressText: `${direction} · 当前处于「${stage.label}」`,
    nextAction: stage.nextHint || (nextStage ? `迈向「${nextStage.label}」` : '跟踪后续公告'),
    nextStageLabel: nextStage?.label || '事件收尾/整合观察',
    expectWindow: `${expectStart.format('MM-DD')} ~ ${expectEnd.format('MM-DD')}`,
    expectNote: `按常规节奏粗估，下一敏感窗口约 ${dMin}~${dMax} 天内（非承诺）`,
    relatedAnnouncement: event?.title || '',
    relatedDate: event?.date || '',
    timeline,
  };
}

/** 整理重大事项列表（去重标题） */
export function listMajorEvents(events = [], limit = 6) {
  const seen = new Set();
  const out = [];
  for (const e of events) {
    const t = (e.title || '').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push({
      date: e.date || '',
      title: t,
      type: e.type || '',
      certainty: e.certainty,
      url: e.url || '',
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 季节性优先级：11月前侧重重整/重组/转让/要约；11月起侧重摘帽
 */
export function seasonalPriority(now = dayjs()) {
  const beforeNov = now.month() < 10; // dayjs month 0-11, Nov=10
  if (beforeNov) {
    return {
      beforeNov: true,
      label: '11月前优先：重整 / 重组 / 股权转让 / 要约收购',
      order: ['重整', '重组', '要约收购', '股权转让', '摘帽'],
      boost: { 重整: 25, 重组: 22, 要约收购: 20, 股权转让: 18, 摘帽: 0 },
      focusNote: '年底前摘帽窗口尚未打开，优先跟踪重整重组与控制权变更的确定性节点',
    };
  }
  return {
    beforeNov: false,
    label: '11月后优先：摘帽预期',
    order: ['摘帽', '重整', '重组', '要约收购', '股权转让'],
    boost: { 摘帽: 30, 重整: 12, 重组: 10, 要约收购: 10, 股权转让: 8 },
    focusNote: '进入年报与摘帽审核窗口，优先跟踪撤销风险警示申请与审核进度',
  };
}
