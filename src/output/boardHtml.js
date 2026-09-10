/**
 * 板块强度 HTML 报告
 */

import fs from 'node:fs';
import path from 'node:path';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtPct(v) {
  if (v == null || Number.isNaN(+v)) return '-';
  const n = +v;
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function pctClass(v) {
  if (v == null || Number.isNaN(+v)) return '';
  return +v >= 0 ? 'up' : 'down';
}

function trendClass(label = '') {
  if (label === '走强') return 'tag-buy';
  if (label === '走弱') return 'tag-sell';
  if (label === '冲高分化') return 'tag-warn';
  return 'tag-watch';
}

function divClass(label = '') {
  if (label === '分化') return 'tag-sell';
  if (label === '齐涨') return 'tag-buy';
  return 'tag-watch';
}

function fundClass(level = '') {
  if (level === 'strong_in' || level === 'in') return 'fund-in';
  if (level === 'strong_out' || level === 'out') return 'fund-out';
  return 'fund-flat';
}

function boardRow(b) {
  return `
  <article class="row">
    <div class="row-idx">${String(b.strengthRank).padStart(2, '0')}</div>
    <div class="row-main">
      <div class="row-top">
        <div class="name">
          <strong>${esc(b.name)}</strong>
          <span class="pill soft">${esc(b.kind || '行业')}</span>
          <span class="pill">强度 ${esc(b.strengthScore)}</span>
          <span class="pill soft">今日RPS ${esc(b.todayRps ?? '-')}</span>
        </div>
        <div class="quote">
          <b class="${pctClass(b.changePct)}">${fmtPct(b.changePct)}</b>
          <span class="tag ${trendClass(b.trend?.label)}">${esc(b.trend?.label || '-')}</span>
        </div>
      </div>

      <div class="metrics">
        <div class="metric">
          <span>是否分化</span>
          <b class="tag ${divClass(b.divergence?.label)}">${esc(b.divergence?.label || '-')}</b>
          <em>${esc(b.divergence?.note || '')}</em>
        </div>
        <div class="metric">
          <span>资金情况</span>
          <b class="${fundClass(b.fund?.level)}">${esc(b.fund?.label || '-')}</b>
          <em>${esc(b.fund?.text || '')}</em>
        </div>
        <div class="metric">
          <span>是否走强</span>
          <b class="tag ${trendClass(b.trend?.label)}">${esc(b.trend?.label || '-')}</b>
          <em>${esc(b.trend?.note || '')}</em>
        </div>
      </div>

      <div class="detail">
        <span>上涨扩散 ${(Number(b.breadth || 0) * 100).toFixed(0)}%（涨${esc(b.up)}/跌${esc(b.down)}）</span>
        <span>近5日 ${fmtPct(b.change5)} · 相对加速 ${b.acceleration >= 0 ? '+' : ''}${esc(b.acceleration)}</span>
        ${
          b.leader
            ? `<span>领涨 ${esc(b.leader)}${b.leaderCode ? `(${esc(b.leaderCode)})` : ''} ${fmtPct(b.leaderChangePct)}</span>`
            : ''
        }
      </div>
    </div>
  </article>`;
}

function turnoverClass(level = '') {
  if (level === 'surge' || level === 'up') return 'up';
  if (level === 'shrink' || level === 'down') return 'down';
  return '';
}

function marketStyleHtml(ms) {
  if (!ms) return '';
  const t = ms.turnover;
  const st = ms.styleTilt;
  const bs = ms.boardStyle;

  const indexHtml = (st?.indices || [])
    .map(
      (x) =>
        `<span class="chip ${pctClass(x.changePct)}">${esc(x.name)} ${fmtPct(x.changePct)}</span>`
    )
    .join('');

  const catHtml = (bs?.categories || [])
    .slice(0, 6)
    .map(
      (c) => `
      <div class="cat">
        <b>${esc(c.name)}</b>
        <span class="${pctClass(c.avgChange)}">${fmtPct(c.avgChange)}</span>
        <em>前十${esc(c.topCount)}席 · 上涨${(c.upRatio * 100).toFixed(0)}% · 主力${esc(c.netInflowText)}</em>
      </div>`
    )
    .join('');

  const turnoverBlock = t
    ? `
      <div class="card">
        <h3>量能</h3>
        <div class="big ${turnoverClass(t.level)}">${esc(t.label)}</div>
        <p>
          今日成交 ${esc(t.amountText)}${
            t.intraday ? ` · 折算全天约 ${esc(t.projectedAmountText)}` : ''
          }<br />
          ${t.ratio != null ? `较近5日均量 ${(t.ratio * 100).toFixed(0)}%` : '缺少可比历史量'} · ${esc(t.note)}
        </p>
      </div>`
    : '';

  const styleBlock = st?.available
    ? `
      <div class="card">
        <h3>市场风格</h3>
        <div class="big">${esc(st.label)}</div>
        <p>${esc(st.note)}</p>
      </div>`
    : '';

  const boardStyleBlock = bs?.available
    ? `
      <div class="card">
        <h3>主导方向</h3>
        <div class="big">${esc(bs.dominant || '-')}</div>
        <p>${esc(bs.note)}</p>
      </div>`
    : '';

  if (!turnoverBlock && !styleBlock && !boardStyleBlock) return '';

  return `
    <section class="section">
      <div class="section-head">
        <h2>当前市场风格与量能</h2>
        <div class="hint">宽基指数横向比较 + 两市成交量同比（盘中按已过交易时间折算）</div>
      </div>
      <div class="cards">
        ${styleBlock}
        ${turnoverBlock}
        ${boardStyleBlock}
        ${
          (t?.detail || []).length
            ? `<div class="card">
                 <h3>沪深成交</h3>
                 <p>${t.detail
                   .map((d) => `${esc(d.name)} ${esc(d.amountText)}（${fmtPct(d.changePct)}）`)
                   .join('<br />')}</p>
               </div>`
            : ''
        }
      </div>
      ${indexHtml ? `<div class="chips">${indexHtml}</div>` : ''}
      ${catHtml ? `<div class="cats">${catHtml}</div>` : ''}
    </section>`;
}

function weakRow(b, i) {
  return `
  <div class="weak-item">
    <span class="wi">${String(i + 1).padStart(2, '0')}</span>
    <strong>${esc(b.name)}</strong>
    <span class="${pctClass(b.changePct)}">${fmtPct(b.changePct)}</span>
    <span class="tag ${trendClass(b.trend?.label)}">${esc(b.trend?.label || '-')}</span>
    <span class="muted">${esc(b.fund?.label || '')}</span>
  </div>`;
}

export function renderBoardStrengthHtml(result) {
  const s = result.summary || {};
  const phase = result.phase || {};
  const ms = result.marketStyle || null;
  const topHtml = (result.topBoards || []).map(boardRow).join('') || '<div class="muted">暂无板块数据</div>';
  const weakHtml = (result.weakBoards || []).map(weakRow).join('') || '<div class="muted">-</div>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>板块强度 · ${esc(result.tradeDate)}</title>
<style>
  :root {
    --bg: #0b0f14; --panel: #171d25; --line: #2a3442; --text: #e8eef7;
    --muted: #8b9bb0; --accent: #3d8bfd; --buy: #1faa6e; --sell: #e25555; --watch: #d6a23a;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    background:
      radial-gradient(1200px 600px at 10% -10%, rgba(61,139,253,.18), transparent 55%),
      radial-gradient(900px 500px at 90% 0%, rgba(31,170,110,.12), transparent 50%),
      var(--bg);
    color: var(--text);
  }
  .wrap { max-width: 960px; margin: 0 auto; padding: 20px 14px 48px; }
  .hero {
    background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
    padding: 18px 16px; margin-bottom: 14px;
  }
  h1 { margin: 0 0 6px; font-size: 22px; }
  .sub { color: var(--muted); font-size: 12px; }
  .badge {
    display: inline-block; margin-top: 10px; margin-right: 6px; padding: 4px 10px; border-radius: 999px;
    background: rgba(61,139,253,.14); color: #9ec1ff; font-size: 12px;
    border: 1px solid rgba(61,139,253,.3);
  }
  .badge.alt { background: rgba(31,170,110,.14); color: #7dffa8; border-color: rgba(31,170,110,.3); }
  .cards {
    display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 12px;
  }
  @media (max-width: 720px) { .cards { grid-template-columns: 1fr; } }
  .card {
    background: #1e2630; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px;
  }
  .card h3 { margin: 0 0 6px; font-size: 12px; color: #7dffa8; }
  .card p { margin: 0; font-size: 12px; color: #c9d4e2; line-height: 1.45; }
  .card .big { font-size: 18px; font-weight: 700; color: var(--text); margin-bottom: 4px; }
  .section {
    margin-top: 14px; background: rgba(23,29,37,.85); border: 1px solid var(--line);
    border-radius: 14px; padding: 12px;
  }
  .section-head { margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
  .section-head h2 { margin: 0; font-size: 16px; }
  .section-head .hint { color: var(--muted); font-size: 11px; margin-top: 2px; }
  .list { display: flex; flex-direction: column; gap: 8px; }
  .row {
    display: grid; grid-template-columns: 36px 1fr; gap: 8px;
    background: #141a22; border: 1px solid var(--line); border-radius: 10px; padding: 10px;
  }
  .row-idx {
    font-size: 13px; font-weight: 700; color: var(--accent);
    display: flex; align-items: flex-start; justify-content: center; padding-top: 2px;
  }
  .row-top { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .name { font-size: 14px; }
  .pill {
    font-size: 10px; padding: 1px 6px; border-radius: 999px; margin-left: 4px;
    background: rgba(61,139,253,.14); color: #b7d0ff; border: 1px solid rgba(61,139,253,.25);
    white-space: nowrap;
  }
  .pill.soft { background: #243041; color: #9eb0c5; border-color: var(--line); }
  .quote { font-size: 13px; white-space: nowrap; }
  .quote b { font-size: 16px; }
  .up { color: #ff6b6b; } .down { color: #3dd68c; }
  .tag { font-size: 11px; padding: 2px 7px; border-radius: 6px; font-weight: 600; margin-left: 4px; }
  .tag-buy { background: rgba(31,170,110,.14); color: var(--buy); }
  .tag-sell { background: rgba(226,85,85,.14); color: var(--sell); }
  .tag-watch { background: rgba(214,162,58,.14); color: var(--watch); }
  .tag-warn { background: rgba(255,140,66,.16); color: #ffb070; }
  .metrics { display: grid; grid-template-columns: 1fr; gap: 6px; margin-top: 8px; }
  .metric {
    display: grid; grid-template-columns: 64px auto 1fr; gap: 8px; align-items: baseline;
    font-size: 12px; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--line);
    background: rgba(30,38,48,.7);
  }
  .metric span { color: var(--muted); font-size: 11px; }
  .metric em { color: #a7b4c6; font-style: normal; font-size: 11px; }
  .fund-in { color: #ff6b6b; }
  .fund-out { color: #3dd68c; }
  .fund-flat { color: #c9d4e2; }
  .detail {
    display: flex; flex-wrap: wrap; gap: 8px 14px; margin-top: 8px;
    font-size: 11px; color: var(--muted);
  }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .chip {
    font-size: 11px; padding: 3px 8px; border-radius: 6px;
    background: #243041; border: 1px solid var(--line);
  }
  .cats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin-top: 10px; }
  @media (max-width: 720px) { .cats { grid-template-columns: 1fr; } }
  .cat {
    display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline;
    padding: 7px 10px; border-radius: 8px; background: #141a22;
    border: 1px solid var(--line); font-size: 12px;
  }
  .cat em { color: var(--muted); font-style: normal; font-size: 11px; }
  .weak-list { display: flex; flex-direction: column; gap: 6px; }
  .weak-item {
    display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
    padding: 8px 10px; border-radius: 8px; background: #141a22; border: 1px solid var(--line);
    font-size: 12px;
  }
  .wi { color: var(--accent); font-weight: 700; width: 22px; }
  .muted { color: var(--muted); font-size: 12px; }
  footer { margin-top: 16px; color: var(--muted); font-size: 11px; text-align: center; }
</style>
</head>
<body>
  <div class="wrap">
    <header class="hero">
      <h1>当日板块强度</h1>
      <div class="sub">生成 ${esc(result.generatedAt)} · ${esc(phase.label || '')} · 扫描 ${esc(result.boardCount)} 个板块${
        result.includeConcept ? '（含概念）' : '（行业）'
      }</div>
      <div class="badge">${esc(s.structure || '-')} · ${esc(s.tone || '')}</div>
      ${ms?.headline ? `<div class="badge alt">${esc(ms.headline)}</div>` : ''}
      <div class="cards">
        <div class="card">
          <h3>市场结构</h3>
          <div class="big">${esc(s.structure || '-')}</div>
          <p>${esc(s.structureNote || '')}</p>
        </div>
        <div class="card">
          <h3>前十资金合计</h3>
          <div class="big ${s.topFund >= 0 ? 'up' : 'down'}">${esc(s.topFundText || '-')}</div>
          <p>走强 ${esc(s.strongCount)} / 分化 ${esc(s.divergedCount)} / 资金流入 ${esc(s.fundInCount)} 个</p>
        </div>
        <div class="card">
          <h3>涨跌家数（板块）</h3>
          <div class="big"><span class="up">${esc(s.upCount)}</span> / <span class="down">${esc(s.downCount)}</span></div>
          <p>全市场板块均涨 ${fmtPct(s.avgChange)} · 前十均涨 ${fmtPct(s.avgTopChange)}</p>
        </div>
        <div class="card">
          <h3>怎么读</h3>
          <p>强度综合「今日涨幅 + 上涨扩散 + 主力资金 + 相对近5日加速」。分化=靠少数票硬拉；走强=涨幅、扩散、资金共振。</p>
        </div>
      </div>
    </header>

    ${marketStyleHtml(ms)}

    <section class="section">
      <div class="section-head">
        <h2>前 ${esc(result.top)} 强度板块</h2>
        <div class="hint">按综合强度排序 · 标注是否分化 / 资金 / 是否走强</div>
      </div>
      <div class="list">${topHtml}</div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>偏弱对照（后 5）</h2>
        <div class="hint">便于对比强弱落差，不构成买卖建议</div>
      </div>
      <div class="weak-list">${weakHtml}</div>
    </section>

    <footer>免责声明：公开数据统计工具，不构成投资建议。</footer>
  </div>
</body>
</html>`;
}

export function saveBoardStrengthHtml(html, { root, tradeDate, stamp }) {
  const dayDir = path.join(root, 'output', tradeDate);
  fs.mkdirSync(dayDir, { recursive: true });
  const htmlPath = path.join(dayDir, `boards_${stamp}.html`);
  const latestInDay = path.join(dayDir, 'latest-boards.html');
  const latestRoot = path.join(root, 'output', 'latest-boards.html');
  fs.writeFileSync(htmlPath, html, 'utf8');
  fs.writeFileSync(latestInDay, html, 'utf8');
  fs.writeFileSync(latestRoot, html, 'utf8');
  return { htmlPath, latestInDay, latestRoot };
}
