/**
 * 综合选股页面（单页：盘面分析 + 指数 + 板块 + 前30只分页列表）
 *
 * 布局约定：上半部分全部走 .split 两栏（左数据右结论），
 * 下半部分是选股列表，靠页内脚本做策略筛选和分页，不依赖任何外部资源。
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  esc,
  fmtPct,
  fmtPrice,
  fmtYi,
  fmtNetYi,
  pctClass,
  htmlShell,
} from './theme.js';
import { strengthCss, strengthHtml } from './strengthHtml.js';

const extraCss = `
  /* 综合选股页比日报宽：指数+板块左右并排才读得开 */
  .wrap { max-width: 1180px; }

  /* 左右两栏：窄屏自动堆叠 */
  .split { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .split.wide-left { grid-template-columns: 1.15fr .85fr; }
  @media (max-width: 980px) { .split, .split.wide-left { grid-template-columns: 1fr; } }

  /* 板块卡片左右两列 */
  .board-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
  @media (max-width: 1100px) { .board-grid { grid-template-columns: 1fr; } }
  .pane {
    background: rgba(20,26,34,.75); border: 1px solid var(--line);
    border-radius: 12px; padding: 11px 12px;
  }
  .pane > h3 {
    margin: 0 0 8px; font-size: 13px; color: #9ec1ff;
    padding-bottom: 6px; border-bottom: 1px solid var(--line);
  }
  .pane > h3 em { float: right; font-style: normal; font-size: 11px; color: var(--muted); }

  .verdict {
    padding: 10px 12px; border-radius: 10px; font-size: 13px; line-height: 1.6;
    border: 1px solid rgba(61,139,253,.35); background: rgba(61,139,253,.1); color: #d6e6ff;
  }
  .verdict.warn { border-color: rgba(214,162,58,.45); background: rgba(214,162,58,.12); color: #ffd9a0; }
  .verdict.bad { border-color: rgba(226,85,85,.45); background: rgba(226,85,85,.12); color: #ffc0c0; }

  /* 指数 / 板块行 */
  .irow {
    display: grid; grid-template-columns: 1fr auto; gap: 6px 10px; align-items: baseline;
    padding: 7px 9px; border-radius: 8px; background: #141a22;
    border: 1px solid var(--line); margin-bottom: 6px;
  }
  .irow:last-child { margin-bottom: 0; }
  .irow .iname { font-size: 13px; }
  .irow .iwhy { grid-column: 1 / -1; font-size: 11px; color: var(--muted); line-height: 1.5; }
  .sig { font-size: 10px; padding: 1px 7px; border-radius: 999px; margin-left: 5px; white-space: nowrap; }
  .sig-buy { background: rgba(31,170,110,.16); color: #7dffa8; border: 1px solid rgba(31,170,110,.35); }
  .sig-watch { background: rgba(214,162,58,.16); color: #ffd9a0; border: 1px solid rgba(214,162,58,.35); }
  .sig-avoid { background: rgba(226,85,85,.16); color: #ff9b9b; border: 1px solid rgba(226,85,85,.35); }
  .sig-none { background: #243041; color: #9eb0c5; border: 1px solid var(--line); }

  /* 策略权重表 */
  .stra {
    display: grid; grid-template-columns: 22px 1fr auto; gap: 8px; align-items: center;
    padding: 8px 10px; border-radius: 8px; background: #141a22;
    border: 1px solid var(--line); margin-bottom: 6px;
  }
  .stra .ord {
    font-size: 12px; font-weight: 700; color: var(--accent); text-align: center;
  }
  .stra .sname { font-size: 13px; }
  .stra .snote { font-size: 11px; color: var(--muted); margin-top: 2px; line-height: 1.45; }
  .stra .swt { font-size: 11px; text-align: right; white-space: nowrap; }
  .stra .swt b { display: block; font-size: 14px; }
  .wt-up { color: #7dffa8; } .wt-down { color: #ff9b9b; } .wt-flat { color: #c9d4e2; }

  /* 选股工具条 */
  .toolbar {
    display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
    margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--line);
  }
  .fbtn {
    font-size: 11px; padding: 4px 10px; border-radius: 999px; cursor: pointer;
    background: #243041; color: #c9d4e2; border: 1px solid var(--line);
  }
  .fbtn:hover { border-color: var(--accent); }
  .fbtn.on { background: rgba(61,139,253,.2); color: #9ec1ff; border-color: rgba(61,139,253,.5); }
  .toolbar .spacer { flex: 1; }
  #pageInfo { font-size: 11px; color: var(--muted); }

  /* 个股卡片 */
  .pick {
    background: #141a22; border: 1px solid var(--line); border-radius: 11px;
    padding: 11px 12px; margin-bottom: 9px;
  }
  .pick.top { border-color: rgba(61,139,253,.4); background: rgba(61,139,253,.06); }
  .pick-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
  .pick-rank {
    font-size: 15px; font-weight: 700; color: var(--accent);
    min-width: 30px;
  }
  .pick-name { font-size: 15px; font-weight: 600; }
  .pick-code { font-size: 11px; color: var(--muted); }
  .pick-quote { font-size: 13px; margin-left: auto; white-space: nowrap; }
  .pick-quote b { font-size: 16px; }
  .score {
    font-size: 11px; padding: 2px 9px; border-radius: 999px; white-space: nowrap;
    background: rgba(61,139,253,.16); color: #9ec1ff; border: 1px solid rgba(61,139,253,.35);
  }
  .score b { font-size: 14px; }
  .score.hi { background: rgba(31,170,110,.18); color: #7dffa8; border-color: rgba(31,170,110,.4); }
  .pick-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
  .base-tag { font-size: 10px; padding: 1px 7px; border-radius: 999px; white-space: nowrap; }
  .base-good { background: rgba(31,170,110,.16); color: #7dffa8; border: 1px solid rgba(31,170,110,.35); }
  .base-caution { background: rgba(214,162,58,.16); color: #ffd9a0; border: 1px solid rgba(214,162,58,.4); }
  .base-risky { background: rgba(226,85,85,.16); color: #ff9b9b; border: 1px solid rgba(226,85,85,.4); }
  .base-unknown { background: #243041; color: #9eb0c5; border: 1px solid var(--line); }
  .act { font-size: 11px; padding: 2px 9px; border-radius: 6px; font-weight: 600; white-space: nowrap; }
  .act-buy { background: rgba(31,170,110,.18); color: #7dffa8; border: 1px solid rgba(31,170,110,.4); }
  .act-wait { background: rgba(214,162,58,.16); color: #ffd9a0; border: 1px solid rgba(214,162,58,.4); }
  .act-watch { background: #243041; color: #9eb0c5; border: 1px solid var(--line); }

  .pick-body { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
  @media (max-width: 900px) { .pick-body { grid-template-columns: 1fr; } }
  .plan {
    padding: 8px 10px; border-radius: 8px; background: rgba(31,170,110,.07);
    border: 1px solid rgba(31,170,110,.25);
  }
  .plan h4, .why h4 {
    margin: 0 0 6px; font-size: 11px; color: #7dffa8; font-weight: 600;
  }
  .why h4 { color: #9ec1ff; }
  .plan-grid { display: grid; grid-template-columns: auto 1fr; gap: 3px 8px; font-size: 12px; }
  .plan-grid span { color: var(--muted); font-size: 11px; }
  .plan-note { font-size: 11px; color: #c9d4e2; margin-top: 6px; line-height: 1.5; }
  .why { padding: 8px 10px; border-radius: 8px; background: rgba(61,139,253,.06); border: 1px solid rgba(61,139,253,.2); }
  .why ul { margin: 0; padding-left: 16px; }
  .why li { font-size: 11.5px; line-height: 1.55; margin: 3px 0; color: #d2dbe8; }
  .why ul.risk li { color: #ffb3b3; }
  .why .rh { margin-top: 8px; }
  .pick-meta {
    display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 8px;
    padding-top: 7px; border-top: 1px dashed var(--line);
    font-size: 11px; color: var(--muted);
  }

  .pager { display: flex; flex-wrap: wrap; gap: 5px; justify-content: center; margin-top: 12px; }
  .pager button {
    font-size: 12px; padding: 5px 11px; border-radius: 7px; cursor: pointer;
    background: #243041; color: #c9d4e2; border: 1px solid var(--line);
  }
  .pager button:hover:not(:disabled) { border-color: var(--accent); }
  .pager button.on { background: rgba(61,139,253,.22); color: #9ec1ff; border-color: rgba(61,139,253,.5); }
  .pager button:disabled { opacity: .4; cursor: default; }
  ${strengthCss}
  .pick .sv { margin-top: 10px; }
  .pill.cap-inst { background: rgba(61,139,253,.18); color: #9ec1ff; border-color: rgba(61,139,253,.45); }
  .pill.cap-hot { background: rgba(226,85,85,.16); color: #ffb0b0; border-color: rgba(226,85,85,.4); }
  .pill.cap-mixed { background: rgba(214,162,58,.14); color: #ffd9a0; border-color: rgba(214,162,58,.35); }
  .cap-line {
    display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: baseline;
    margin-top: 8px; padding: 6px 9px; border-radius: 8px; font-size: 12px;
    border: 1px solid var(--line); background: #141a22; color: #d5deea;
  }
  .cap-line b { font-weight: 700; }
  .cap-line em { font-style: normal; color: var(--muted); font-size: 11px; }
  .cap-line.cap-inst { border-color: rgba(61,139,253,.35); background: rgba(61,139,253,.08); }
  .cap-line.cap-hot { border-color: rgba(226,85,85,.35); background: rgba(226,85,85,.08); }
  .cap-line.cap-mixed { border-color: rgba(214,162,58,.3); background: rgba(214,162,58,.07); }
`;

// 页内脚本：策略筛选 + 分页。刻意不用模板字符串，避免与外层模板语法冲突。
const pageScript = `
(function () {
  var PER = 10;
  var page = 1;
  var filter = 'all';
  var cards = [].slice.call(document.querySelectorAll('#picks .pick'));
  var pager = document.getElementById('pager');
  var info = document.getElementById('pageInfo');
  var btns = [].slice.call(document.querySelectorAll('.fbtn'));

  function match(card) {
    if (filter === 'all') return true;
    if (filter === 'buy') return card.getAttribute('data-action') === 'buy';
    return (card.getAttribute('data-keys') || '').split(',').indexOf(filter) >= 0;
  }

  function render() {
    var vis = cards.filter(match);
    var pages = Math.max(1, Math.ceil(vis.length / PER));
    if (page > pages) page = pages;
    if (page < 1) page = 1;

    for (var i = 0; i < cards.length; i++) cards[i].style.display = 'none';
    var start = (page - 1) * PER;
    var shown = vis.slice(start, start + PER);
    for (var j = 0; j < shown.length; j++) shown[j].style.display = '';

    info.textContent = '符合 ' + vis.length + ' 只 · 第 ' + page + '/' + pages + ' 页';

    pager.innerHTML = '';
    if (pages <= 1) return;
    var prev = document.createElement('button');
    prev.textContent = '上一页';
    prev.disabled = page === 1;
    prev.onclick = function () { page--; render(); };
    pager.appendChild(prev);
    for (var p = 1; p <= pages; p++) {
      var b = document.createElement('button');
      b.textContent = String(p);
      if (p === page) b.className = 'on';
      b.onclick = (function (n) { return function () { page = n; render(); }; })(p);
      pager.appendChild(b);
    }
    var next = document.createElement('button');
    next.textContent = '下一页';
    next.disabled = page === pages;
    next.onclick = function () { page++; render(); };
    pager.appendChild(next);
  }

  for (var k = 0; k < btns.length; k++) {
    btns[k].onclick = (function (el) {
      return function () {
        for (var m = 0; m < btns.length; m++) btns[m].className = 'fbtn';
        el.className = 'fbtn on';
        filter = el.getAttribute('data-filter');
        page = 1;
        render();
      };
    })(btns[k]);
  }

  render();
})();
`;

function sigClass(signal) {
  if (signal === 'buy') return 'sig-buy';
  if (signal === 'watch') return 'sig-watch';
  if (signal === 'avoid' || signal === 'sell') return 'sig-avoid';
  return 'sig-none';
}

function sigText(signal) {
  return (
    { buy: '可买', watch: '观察', avoid: '回避', sell: '卖出', none: '无信号' }[signal] || signal || '-'
  );
}

/** 盘面数据面板：涨跌家数、涨停、情绪、量能 + 宽基指数快照 */
function tapeDataPane(tape) {
  const b = tape.breadth;
  const p = tape.pools;
  const s = tape.sentiment || {};
  const t = tape.turnover;

  const kpis = [
    {
      label: '涨跌家数',
      value: b ? `${b.up}/${b.down}` : '-',
      note: b ? `上涨占比 ${(b.upRatio * 100).toFixed(0)}%` : '数据不可用',
    },
    {
      label: '涨停/跌停',
      value: p ? `${p.limitUpCount}/${p.limitDownCount}` : '-',
      note: p ? `炸板 ${p.brokenCount} 家` : '涨停池不可用',
    },
    {
      label: '情绪分',
      value: s.score != null ? String(s.score) : '-',
      note: s.label || '-',
    },
    {
      label: '两市成交',
      value: t?.amountText || '-',
      note: t && t.level !== 'unknown' ? t.label : '量能未知',
    },
  ];

  const kpiHtml = kpis
    .map(
      (k) => `<div class="kpi">
        <span>${esc(k.label)}</span>
        <b>${esc(k.value)}</b>
        <em>${esc(k.note)}</em>
      </div>`
    )
    .join('');

  const idxHtml = (tape.indices || [])
    .map(
      (x) => `<div class="irow">
        <div class="iname">${esc(x.name)}</div>
        <div class="quote">
          <b>${fmtPrice(x.price)}</b>
          <span class="${pctClass(x.changePct)}">${fmtPct(x.changePct)}</span>
          <span class="pill soft">${esc(x.amountText)}</span>
        </div>
      </div>`
    )
    .join('');

  const ladder = (tape.ladder || [])
    .filter((l) => l.level >= 2)
    .slice(0, 4)
    .map((l) => `${l.level}板 ${l.stocks.length}家`)
    .join('　·　');

  return `<div class="pane">
    <h3>盘面数据<em>${esc(tape.phase?.label || '')}</em></h3>
    <div class="kpis" style="margin-top:0">${kpiHtml}</div>
    ${ladder ? `<div class="detail"><span>连板梯队：${esc(ladder)}</span></div>` : ''}
    <div style="margin-top:10px">${idxHtml || '<div class="muted">指数行情不可用</div>'}</div>
  </div>`;
}

/** 盘面分析面板：结论 + 要点 + 风险 */
function tapeAnalysisPane(tape) {
  const a = tape.analysis || {};
  const overall = tape.bias?.overall;
  const kind = overall === 'standby' ? 'bad' : overall === 'defensive' ? 'warn' : '';

  const points = (a.points || []).map((x) => `<li>${esc(x)}</li>`).join('');
  const risks = (a.risks || []).map((x) => `<li>${esc(x)}</li>`).join('');
  const biasNotes = (tape.bias?.notes || []).map((x) => `<li>${esc(x)}</li>`).join('');

  return `<div class="pane">
    <h3>盘面分析与出手力度</h3>
    <div class="verdict ${kind}">${esc(a.conclusion || '-')}</div>
    ${points ? `<h4 style="margin:10px 0 4px;font-size:11px;color:#9ec1ff">盘面要点</h4><ul class="notes">${points}</ul>` : ''}
    ${risks ? `<h4 style="margin:10px 0 4px;font-size:11px;color:#ffb3b3">风险</h4><ul class="notes risk">${risks}</ul>` : ''}
    ${
      biasNotes
        ? `<h4 style="margin:10px 0 4px;font-size:11px;color:#7dffa8">这些盘面因素如何影响选股权重</h4><ul class="notes">${biasNotes}</ul>`
        : ''
    }
  </div>`;
}

/** 指数中期信号面板 */
function indexPane(indexSignals) {
  if (!indexSignals) {
    return '<div class="pane"><h3>指数中期信号</h3><div class="muted">未启用指数分析</div></div>';
  }
  const rows = (indexSignals.indices || [])
    .map(
      (x) => `<div class="irow">
        <div class="iname">${esc(x.name)}<span class="sig ${sigClass(x.signal)}">${esc(sigText(x.signal))}</span></div>
        <div class="quote">
          <b>${fmtPrice(x.price)}</b>
          <span class="${pctClass(x.changePct)}">${fmtPct(x.changePct)}</span>
        </div>
        <div class="iwhy">MA10 ${fmtPrice(x.ma10)}　MA50(10周) ${fmtPrice(x.ma50)}　强度 ${
          x.strength ?? '-'
        }｜${esc((x.reasons || []).slice(0, 2).join('；') || '-')}</div>
      </div>`
    )
    .join('');

  const etfs = (indexSignals.etfs || [])
    .slice(0, 4)
    .map(
      (e) => `<div class="irow">
        <div class="iname">${esc(e.name)}<span class="sig ${sigClass(e.signal)}">${esc(e.action || sigText(e.signal))}</span></div>
        <div class="quote"><b>${fmtPrice(e.price)}</b> <span class="${pctClass(e.changePct)}">${fmtPct(
          e.changePct
        )}</span></div>
        <div class="iwhy">${esc(e.techLine || '-')}</div>
      </div>`
    )
    .join('');

  return `<div class="pane">
    <h3>指数中期信号<em>${esc(indexSignals.marketSignal || '')}</em></h3>
    <div class="verdict ${
      indexSignals.marketSignal === 'avoid' ? 'bad' : indexSignals.marketSignal === 'watch' ? 'warn' : ''
    }">${esc(indexSignals.summary || '-')}</div>
    <div style="margin-top:10px">${rows || '<div class="muted">指数数据不可用</div>'}</div>
    ${etfs ? `<h4 style="margin:10px 0 6px;font-size:11px;color:var(--muted)">ETF 技术线</h4>${etfs}` : ''}
    <div class="detail"><span>${esc(indexSignals.ruleNote || '')}</span></div>
  </div>`;
}

/** 板块强度面板（含龙头） */
function boardPane(boards, topN = 8) {
  if (!boards) {
    return '<div class="pane"><h3>板块强度</h3><div class="muted">未启用板块分析</div></div>';
  }
  const s = boards.summary || {};
  const ms = boards.marketStyle || {};

  const rows = (boards.topBoards || [])
    .slice(0, topN)
    .map((b) => {
      const leaders = (b.leaders || [])
        .slice(0, 2)
        .map(
          (x) =>
            `${x.leaderRank === 1 ? '龙头' : `龙${x.leaderRank}`} ${esc(x.name)} ${fmtPct(x.changePct)}`
        )
        .join('　·　');
      return `<div class="irow">
        <div class="iname">${String(b.strengthRank).padStart(2, '0')}. ${esc(b.name)}
          <span class="pill soft">强度${b.strengthScore}</span>
        </div>
        <div class="quote"><span class="${pctClass(b.changePct)}">${fmtPct(b.changePct)}</span></div>
        <div class="iwhy">扩散 ${((b.breadth || 0) * 100).toFixed(0)}%　资金 ${fmtNetYi(
          b.mainNetInflow
        )}　${esc(b.trend?.label || '')} · ${esc(b.divergence?.label || '')}${
          leaders ? `<br>${leaders}` : ''
        }</div>
      </div>`;
    })
    .join('');

  return `<div class="pane">
    <h3>板块强度前 ${topN}<em>${esc(ms.headline || '')}</em></h3>
    <div class="verdict">${esc(s.structure || '-')}：${esc(s.structureNote || s.tone || '-')}</div>
    <div class="detail">
      <span>板块涨/跌 ${s.upCount ?? '-'}/${s.downCount ?? '-'}</span>
      <span>前十均涨 ${fmtPct(s.avgTopChange)}</span>
      <span>前十资金 ${esc(s.topFundText || '-')}</span>
    </div>
    <div class="board-grid">${rows || '<div class="muted">板块数据不可用</div>'}</div>
  </div>`;
}

/** 五套算法今日权重 */
function strategyPane(strategies, result) {
  const counts = result.strategyCount || {};
  const weights = result.weights || {};

  const rows = strategies
    .map((st) => {
      const w = weights[st.key] ?? 1;
      const cls = w >= 1.15 ? 'wt-up' : w <= 0.85 ? 'wt-down' : 'wt-flat';
      return `<div class="stra">
        <div class="ord">${st.order}</div>
        <div>
          <div class="sname">${esc(st.name)}<span class="pill soft">命中 ${counts[st.key] || 0}</span></div>
          <div class="snote">${esc(st.note)}　基准分 ${st.base}</div>
        </div>
        <div class="swt"><b class="${cls}">×${w}</b>今日权重</div>
      </div>`;
    })
    .join('');

  return `<div class="pane">
    <h3>五套算法与今日权重<em>盘面系数 ×${result.marketFactor}</em></h3>
    ${rows}
    <div class="detail"><span>
      评分 =（最高优先级算法基准分 + 其余命中 ×45% + 各算法质量加分）× 盘面系数 ${result.marketFactor}。
      权重与系数都由盘面分析给出，所以同一只股票在不同盘面下的排名会变。
    </span></div>
  </div>`;
}

/** 单只个股卡片 */
function pickCard(p, rank) {
  const keys = p.strategies.map((s) => s.key).join(',');

  const tags = p.strategies
    .map((s) => `<span class="pill tao">${esc(s.short)}</span>`)
    .join('');
  const baseCls = `base-${p.baseLevel || 'unknown'}`;
  const baseTag = `<span class="base-tag ${baseCls}">${esc(p.baseLabel)}${
    p.inBase && p.baseDrop ? `（回撤${(p.baseDrop * 100).toFixed(0)}%）` : ''
  }</span>`;
  const extraTags = [
    p.inTopBoard ? '<span class="pill">强度前十板块</span>' : '',
    p.inFirstPage ? `<span class="pill">涨幅榜第一版#${p.observeRank}</span>` : '',
    p.board?.rps5 != null ? `<span class="pill soft">${esc(p.board.name)} RPS5 ${p.board.rps5.toFixed(0)}</span>` : '',
  ].join('');

  const e = p.entry;
  const reasons = (p.buyReasons || []).map((r) => `<li>${esc(r)}</li>`).join('');
  const risks = (p.riskNotes || []).map((r) => `<li>${esc(r)}</li>`).join('');

  const rps = p.rps || {};

  return `<div class="pick ${rank <= 3 ? 'top' : ''}" data-keys="${esc(keys)}" data-action="${esc(p.actionLevel)}">
    <div class="pick-head">
      <div class="pick-rank">${rank}</div>
      <div>
        <span class="pick-name">${esc(p.name)}</span>
        <span class="pick-code">${esc(p.code)}</span>
      </div>
      <span class="score ${p.score >= 70 ? 'hi' : ''}"><b>${p.score}</b> 分</span>
      <span class="act act-${esc(p.actionLevel)}" title="${esc(p.actionNote || '')}">${esc(p.action)}</span>
      <div class="pick-quote">
        <b>${fmtPrice(p.price)}</b>
        <span class="${pctClass(p.changePct)}">${fmtPct(p.changePct)}</span>
      </div>
    </div>

    <div class="pick-tags">
      <span class="pill">主策略：${esc(p.primaryName)}</span>
      ${tags}${baseTag}${extraTags}
      ${
        p.capital
          ? `<span class="pill cap-${esc(p.capital.kind)}">${esc(p.capital.kindLabel)}</span>`
          : ''
      }
    </div>
    ${
      p.capital
        ? `<div class="cap-line cap-${esc(p.capital.kind)}"><b>${esc(p.capital.instText)}</b>${
            p.capital.mainText ? `<span>${esc(p.capital.mainText)}</span>` : ''
          }${p.capital.bigText ? `<span>${esc(p.capital.bigText)}</span>` : ''}${
            p.capital.note ? `<em>${esc(p.capital.note)}</em>` : ''
          }</div>`
        : ''
    }

    <div class="pick-body">
      <div class="plan">
        <h4>买入计划（${esc(e.entryType)}）</h4>
        <div class="plan-grid">
          <span>买入区间</span><div>${fmtPrice(e.buyLow)} ~ ${fmtPrice(e.buyHigh)}（${esc(e.entryMode)}）</div>
          <span>止损</span><div>${fmtPrice(e.stop)}　<em style="font-style:normal;color:var(--muted)">空间 ${
            e.riskPct != null ? `${e.riskPct.toFixed(1)}%` : '-'
          }</em></div>
          <span>止盈价</span><div>${fmtPrice(e.target1)}　<em style="font-style:normal;color:var(--muted)">买入后先减半</em></div>
          <span>目标价</span><div>${fmtPrice(e.target2)}　<em style="font-style:normal;color:var(--muted)">余仓盈利卖出　盈亏比 ${
            e.rr != null ? e.rr.toFixed(2) : '-'
          }</em></div>
        </div>
        <div class="plan-note">${esc(e.note)}</div>
      </div>
      <div class="why">
        <h4>可买入理由</h4>
        <ul>${reasons || '<li>-</li>'}</ul>
        ${risks ? `<h4 class="rh" style="color:#ffb3b3">风险与注意</h4><ul class="risk">${risks}</ul>` : ''}
      </div>
    </div>

    <div class="pick-meta">
      <span>${esc(p.industry)}</span>
      <span>RPS120 ${rps.rps120 != null ? rps.rps120.toFixed(0) : '-'} / RPS250 ${
        rps.rps250 != null ? rps.rps250.toFixed(0) : '-'
      }</span>
      ${p.yearHighRatio != null ? `<span>年高位置 ${(p.yearHighRatio * 100).toFixed(0)}%</span>` : ''}
      <span>换手 ${p.turnover != null ? `${p.turnover.toFixed(1)}%` : '-'}</span>
      <span>量比 ${p.volumeRatio != null ? p.volumeRatio.toFixed(2) : '-'}</span>
      <span>成交 ${fmtYi(p.amount)}</span>
      <span>主力 ${fmtNetYi(p.mainNetInflow)}</span>
      <span>MA5 ${fmtPrice(p.ma5)} / MA10 ${fmtPrice(p.ma10)} / MA20 ${fmtPrice(p.ma20)}</span>
      ${p.bias5 != null ? `<span>乖离 ${p.bias5 >= 0 ? '+' : ''}${p.bias5.toFixed(1)}%</span>` : ''}
    </div>
    ${strengthHtml(p.strength)}
  </div>`;
}

/** 选股列表（含筛选工具条与分页） */
function picksSection(result, strategies, limit) {
  const picks = result.picks || [];
  if (!picks.length) {
    return `<section class="section">
      <div class="section-head"><h2>综合选股</h2></div>
      <div class="muted">今日没有个股同时满足任一算法的硬条件，属于正常结果——没有符合的标的就不该硬凑。</div>
    </section>`;
  }

  const counts = result.strategyCount || {};
  const buyN = picks.filter((p) => p.actionLevel === 'buy').length;
  const filters = [
    `<button class="fbtn on" data-filter="all">全部 ${picks.length}</button>`,
    buyN ? `<button class="fbtn" data-filter="buy">现价可买 ${buyN}</button>` : '',
  ]
    .filter(Boolean)
    .concat(
      strategies
        .filter((st) => picks.some((p) => p.strategies.some((s) => s.key === st.key)))
        .map(
          (st) =>
            `<button class="fbtn" data-filter="${esc(st.key)}">${esc(st.short)} ${
              picks.filter((p) => p.strategies.some((s) => s.key === st.key)).length
            }</button>`
        )
    )
    .join('');

  const cards = picks.map((p, i) => pickCard(p, i + 1)).join('');

  return `<section class="section">
    <div class="section-head">
      <h2>综合选股 · 前 ${Math.min(limit, picks.length)} 只</h2>
      <div class="hint">
        全池满足算法硬条件的共 ${result.qualified} 只，按综合评分取前 ${Math.min(limit, picks.length)}：
        其中现价就在买入区间内的 ${result.buyCount} 只、需等价格回到区间的 ${result.waitCount} 只，其余仅作观察。
        ${result.excludedCrash ? `另有 ${result.excludedCrash} 只因当日跌幅过大已剔除。` : ''}
        ${result.excludedFade ? `动能转弱（RSI＜50 / MACD绿柱或红柱缩短）已剔除 ${result.excludedFade} 只。` : ''}
        点策略标签可只看该算法命中的标的；每页 10 只。
      </div>
    </div>
    <div class="toolbar">
      ${filters}
      <div class="spacer"></div>
      <div id="pageInfo"></div>
    </div>
    <div id="picks">${cards}</div>
    <div class="pager" id="pager"></div>
    <div class="detail" style="margin-top:10px">
      <span>命中分布：${strategies
        .map((st) => `${st.short} ${counts[st.key] || 0}`)
        .join('　·　')}</span>
    </div>
  </section>`;
}

/**
 * 渲染综合选股页面
 *
 * @param {{ tape, indexSignals, boards, result, strategies, meta }} data
 */
export function renderPickHtml({ tape, indexSignals, boards, result, strategies, meta }) {
  const bias = tape?.bias || {};
  const overallText = {
    aggressive: '出手力度：积极',
    normal: '出手力度：常规',
    defensive: '出手力度：保守',
    standby: '出手力度：观望',
  }[bias.overall];

  const badges = [
    tape?.headline,
    overallText ? { text: overallText, kind: bias.overall === 'standby' ? 'warn' : 'alt' } : null,
    bias.positionHint,
  ].filter(Boolean);

  const sub = [
    `生成时间 ${esc(meta.generatedAt)}`,
    `交易日 ${esc(tape?.tradeDate || '-')}`,
    esc(tape?.phase?.label || ''),
  ].join(' · ');

  const hero = meta.freshness
    ? `<div class="freshness-box" style="margin-top:10px;padding:7px 10px;border-radius:8px;font-size:12px;border:1px solid ${
        meta.freshness.warn ? 'rgba(214,162,58,.45)' : 'rgba(31,170,110,.28)'
      };background:${
        meta.freshness.warn ? 'rgba(214,162,58,.12)' : 'rgba(31,170,110,.08)'
      };color:${meta.freshness.warn ? '#ffd9a0' : 'var(--muted)'}">
        <b style="margin-right:6px">${meta.freshness.warn ? '⚠ 数据新鲜度' : '数据新鲜度'}</b>${esc(
          meta.freshness.text
        )}
      </div>`
    : '';

  const body = `
    <section class="section">
      <div class="section-head">
        <h2>当日盘面总结与分析</h2>
        <div class="hint">左侧是盘面数据，右侧是由此推出的出手力度——它同时决定了下方五套算法的权重。</div>
      </div>
      <div class="split wide-left">
        ${tapeDataPane(tape)}
        ${tapeAnalysisPane(tape)}
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>指数与板块</h2>
        <div class="hint">左：指数中期可买信号（决定是否该做右侧突破）。右：当日板块强度与龙头（决定在哪个方向里选）。</div>
      </div>
      <div class="split">
        ${indexPane(indexSignals)}
        ${boardPane(boards)}
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>算法权重</h2>
        <div class="hint">五套算法按给定优先级排序，权重已按今日盘面调整。</div>
      </div>
      ${strategyPane(strategies, result)}
    </section>

    ${picksSection(result, strategies, meta.limit || 30)}
  `;

  return htmlShell({
    title: `综合选股 ${tape?.tradeDate || ''}`,
    h1: `A股综合选股 · 盘面 + 五算法前${meta.limit || 30}`,
    sub,
    badges,
    hero,
    body,
    extraCss,
    script: pageScript,
    foot: '免责声明：公开数据统计工具，不构成投资建议。算法命中≠买入信号，请自行判断与风控。',
  });
}

export function savePickHtml(html, { root, tradeDate, stamp }) {
  const dayDir = path.join(root, 'output', tradeDate);
  fs.mkdirSync(dayDir, { recursive: true });
  const htmlPath = path.join(dayDir, `pick_${stamp}.html`);
  const latestInDay = path.join(dayDir, 'latest-pick.html');
  const latestRoot = path.join(root, 'output', 'latest-pick.html');
  fs.writeFileSync(htmlPath, html, 'utf8');
  fs.writeFileSync(latestInDay, html, 'utf8');
  fs.writeFileSync(latestRoot, html, 'utf8');
  return { htmlPath, latestInDay, latestRoot };
}
