/**
 * 板块强度 HTML 报告
 */

import fs from 'node:fs';
import path from 'node:path';
import { baseCss, esc, fmtPct, pctClass } from './theme.js';

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

function leaderRow(s) {
  return `
        <div class="lead${s.leaderRank === 1 ? ' top' : ''}">
          <div class="lead-rank">${s.leaderRank === 1 ? '龙头' : `龙${s.leaderRank}`}</div>
          <div>
            <div class="lead-top">
              <strong>${esc(s.name)}</strong>
              <span class="pill soft">${esc(s.code)}</span>
              <span class="${pctClass(s.changePct)}">${fmtPct(s.changePct)}</span>
              ${s.boards >= 2 ? `<span class="tag tag-sell">${esc(s.boards)}连板</span>` : ''}
              ${s.boards === 1 && s.atLimit ? '<span class="tag tag-sell">涨停</span>' : ''}
              <span class="chip">额 ${esc(s.amountText)}</span>
              <span class="chip ${s.mainNetInflow >= 0 ? 'fund-in' : 'fund-out'}">主力 ${esc(
                s.mainNetInflowText
              )}</span>
              <span class="chip">流值 ${esc(s.circMVText)}</span>
              <span class="pill soft">龙头分 ${esc(s.leaderScore)}</span>
            </div>
            ${s.reasons?.length ? `<div class="lead-why">${esc(s.reasons.join(' · '))}</div>` : ''}
          </div>
        </div>`;
}

function leadersHtml(b) {
  if (!b.leaders) return '';
  if (!b.leaders.length) {
    return `
      <div class="leaders">
        <div class="leaders-head"><b>龙头股</b><span>${esc(b.leaderNote || '无')}</span></div>
      </div>`;
  }
  return `
      <div class="leaders">
        <div class="leaders-head">
          <b>龙头股</b>
          <span class="tag ${b.leaderConfident ? 'tag-buy' : 'tag-watch'}">${
            b.leaderConfident ? '龙头明确' : '龙头待定'
          }</span>
          <span>${esc(b.leaderNote || '')}（成分股 ${esc(b.leaderPool)} 只中选出）</span>
        </div>
        <div class="lead-list">${b.leaders.map(leaderRow).join('')}</div>
      </div>`;
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
            ? `<span>东财领涨 ${esc(b.leader)}${b.leaderCode ? `(${esc(b.leaderCode)})` : ''} ${fmtPct(b.leaderChangePct)}</span>`
            : ''
        }
      </div>

      ${leadersHtml(b)}
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
<style>${baseCss}</style>
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
