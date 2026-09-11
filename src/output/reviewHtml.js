/**
 * 当日复盘 HTML
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  esc,
  fmtNetYi,
  fmtPct,
  fmtPrice,
  htmlShell,
  pctClass,
} from './theme.js';
import { fmtSealTime } from '../analyze/review.js';

function sentimentKind(level = '') {
  if (level === 'hot') return 'tag-warn';
  if (level === 'warm') return 'tag-buy';
  if (level === 'neutral') return 'tag-watch';
  return 'tag-sell';
}

function kpiHtml(r) {
  const b = r.breadth;
  const p = r.pools;
  const t = r.boards?.marketStyle?.turnover;
  const s = r.sentiment;

  return `
  <div class="kpis">
    <div class="kpi">
      <span>情绪</span>
      <b class="${s.level === 'hot' || s.level === 'warm' ? 'up' : 'down'}">${esc(s.score)}</b>
      <em>${esc(s.label)}</em>
    </div>
    <div class="kpi">
      <span>涨 / 跌</span>
      <b><span class="up">${esc(b?.up ?? '-')}</span> / <span class="down">${esc(b?.down ?? '-')}</span></b>
      <em>${b?.upRatio != null ? `上涨占比 ${(b.upRatio * 100).toFixed(0)}%` : '-'}</em>
    </div>
    <div class="kpi">
      <span>涨停 / 跌停</span>
      <b><span class="up">${esc(p?.limitUpCount ?? '-')}</span> / <span class="down">${esc(p?.limitDownCount ?? '-')}</span></b>
      <em>${
        s.sealRate != null ? `封板率 ${(s.sealRate * 100).toFixed(0)}%（炸板${esc(p?.brokenCount ?? 0)}）` : '-'
      }</em>
    </div>
    <div class="kpi">
      <span>两市成交</span>
      <b>${esc(t?.amountText || '-')}</b>
      <em>${esc(t?.label || '-')}</em>
    </div>
  </div>`;
}

function indexHtml(list = []) {
  if (!list.length) return '';
  return `<div class="chips">${list
    .map(
      (x) =>
        `<span class="chip ${pctClass(x.changePct)}">${esc(x.name)} ${fmtPrice(x.price)} ${fmtPct(
          x.changePct
        )}</span>`
    )
    .join('')}</div>`;
}

function sentimentSection(r) {
  const s = r.sentiment;
  return `
  <section class="section">
    <div class="section-head">
      <h2>市场情绪 ${esc(s.score)} 分 · <span class="tag ${sentimentKind(s.level)}">${esc(s.label)}</span></h2>
      <div class="hint">涨停家数、封板率、连板高度、赚钱效应、跌停压力五项加权</div>
    </div>
    <div class="metrics">
      ${s.parts
        .map(
          (p) => `
      <div class="metric">
        <span>${esc(p.name)}</span>
        <b class="${p.score >= 60 ? 'up' : p.score >= 42 ? '' : 'down'}">${esc(p.score)}</b>
        <em>${esc(p.text)}</em>
      </div>`
        )
        .join('')}
    </div>
    <div class="detail"><span>结论：${esc(s.advice)}</span></div>
  </section>`;
}

function ladderSection(r) {
  const ladder = r.ladder || [];
  if (!ladder.length) {
    return `
  <section class="section">
    <div class="section-head"><h2>连板梯队</h2></div>
    <div class="muted">今日没有涨停股，或涨停池暂无数据。</div>
  </section>`;
  }

  return `
  <section class="section">
    <div class="section-head">
      <h2>连板梯队 · 最高 ${esc(ladder[0].boards)} 板</h2>
      <div class="hint">按连板数分层，同层按封板资金排序；括号内为首次封板时间</div>
    </div>
    <div class="ladder">
      ${ladder
        .map(
          (lv) => `
      <div class="ladder-row">
        <div class="ladder-lv">${esc(lv.boards)} 板<em>${esc(lv.count)} 只</em></div>
        <div class="ladder-stocks">
          ${lv.stocks
            .slice(0, lv.boards >= 2 ? 30 : 24)
            .map(
              (s) =>
                `<span class="lstock">${esc(s.name)}<i>${esc(s.industry || '-')} ${esc(
                  fmtSealTime(s.firstSealTime)
                )}</i></span>`
            )
            .join('')}
          ${lv.stocks.length > (lv.boards >= 2 ? 30 : 24) ? `<span class="chip">…另 ${lv.stocks.length - (lv.boards >= 2 ? 30 : 24)} 只</span>` : ''}
        </div>
      </div>`
        )
        .join('')}
    </div>
  </section>`;
}

function mainLineSection(r) {
  const lines = r.mainLines || [];
  if (!lines.length) {
    return `
  <section class="section">
    <div class="section-head"><h2>今日主线</h2></div>
    <div class="muted">今日涨停未形成板块聚集，无可认定的主线。</div>
  </section>`;
  }

  return `
  <section class="section">
    <div class="section-head">
      <h2>今日主线与题材</h2>
      <div class="hint">涨停行业聚集 + 板块指数是否同步走强，两者都满足才算「已确认」</div>
    </div>
    <div class="list">
      ${lines
        .slice(0, 8)
        .map(
          (l, i) => `
      <article class="row">
        <div class="row-idx">${String(i + 1).padStart(2, '0')}</div>
        <div class="row-main">
          <div class="row-top">
            <div class="name">
              <strong>${esc(l.name)}</strong>
              <span class="pill soft">涨停 ${esc(l.limitUpCount)} 家</span>
              <span class="pill soft">最高 ${esc(l.maxBoards)} 板</span>
              ${l.boardStrength != null ? `<span class="pill">板块强度 ${esc(l.boardStrength)}</span>` : ''}
            </div>
            <div class="quote">
              ${l.boardChangePct != null ? `<b class="${pctClass(l.boardChangePct)}">${fmtPct(l.boardChangePct)}</b>` : ''}
              <span class="tag ${l.confirmed ? 'tag-buy' : 'tag-watch'}">${l.confirmed ? '已确认' : '待确认'}</span>
            </div>
          </div>
          <div class="detail"><span>${esc(l.note)}</span></div>
          <div class="ladder-stocks">
            ${l.leaders
              .map((s) => `<span class="lstock">${esc(s.name)}<i>${esc(s.boards)}板</i></span>`)
              .join('')}
          </div>
        </div>
      </article>`
        )
        .join('')}
    </div>
  </section>`;
}

function boardSection(r) {
  const top = r.boards?.topBoards || [];
  if (!top.length) return '';
  return `
  <section class="section">
    <div class="section-head">
      <h2>板块强度前 ${esc(top.length)}</h2>
      <div class="hint">涨幅 + 上涨扩散 + 主力资金 + 相对近5日加速</div>
    </div>
    <div class="weak-list">
      ${top
        .map(
          (b) => `
      <div class="weak-item">
        <span class="wi">${String(b.strengthRank).padStart(2, '0')}</span>
        <strong>${esc(b.name)}</strong>
        <span class="${pctClass(b.changePct)}">${fmtPct(b.changePct)}</span>
        <span class="chip">强度 ${esc(b.strengthScore)}</span>
        <span class="tag ${b.trend?.label === '走强' ? 'tag-buy' : b.trend?.label === '走弱' ? 'tag-sell' : 'tag-watch'}">${esc(
          b.trend?.label || '-'
        )}</span>
        <span class="tag ${b.diverged ? 'tag-sell' : 'tag-buy'}">${esc(b.divergence?.label || '-')}</span>
        <span class="muted">主力 ${esc(fmtNetYi(b.mainNetInflow))} · 扩散 ${(
          Number(b.breadth || 0) * 100
        ).toFixed(0)}%</span>
      </div>`
        )
        .join('')}
    </div>
  </section>`;
}

function styleSection(r) {
  const ms = r.boards?.marketStyle;
  if (!ms) return '';
  const t = ms.turnover;
  const st = ms.styleTilt;
  const bs = ms.boardStyle;

  return `
  <section class="section">
    <div class="section-head">
      <h2>风格与量能</h2>
      <div class="hint">宽基指数横向比较 + 两市成交量同比</div>
    </div>
    <div class="cards">
      ${
        st?.available
          ? `<div class="card"><h3>市场风格</h3><div class="big">${esc(st.label)}</div><p>${esc(st.note)}</p></div>`
          : ''
      }
      ${
        t && t.level !== 'unknown'
          ? `<div class="card"><h3>量能</h3><div class="big ${
              t.level === 'surge' || t.level === 'up' ? 'up' : t.level === 'flat' ? '' : 'down'
            }">${esc(t.label)}</div><p>成交 ${esc(t.amountText)}${
              t.ratio != null ? ` · 为近5日均量 ${(t.ratio * 100).toFixed(0)}%` : ''
            }<br />${esc(t.note)}</p></div>`
          : ''
      }
      ${
        bs?.available
          ? `<div class="card"><h3>资金主导</h3><div class="big">${esc(
              bs.dominant || '无明确主导'
            )}</div><p>${esc(bs.note)}</p></div>`
          : ''
      }
      ${
        r.strong
          ? `<div class="card"><h3>赚钱效应</h3><div class="big">${esc(r.strong.over5)} 家</div><p>涨幅超 5% 共 ${esc(
              r.strong.over5
            )} 家，其中超 7% 有 ${esc(r.strong.over7)} 家</p></div>`
          : ''
      }
    </div>
    ${
      (bs?.categories || []).length
        ? `<div class="cats">${bs.categories
            .slice(0, 6)
            .map(
              (c) => `
      <div class="cat">
        <b>${esc(c.name)}</b>
        <span class="${pctClass(c.avgChange)}">${fmtPct(c.avgChange)}</span>
        <em>前十${esc(c.topCount)}席 · 上涨${(c.upRatio * 100).toFixed(0)}% · 主力${esc(c.netInflowText)}</em>
      </div>`
            )
            .join('')}</div>`
        : ''
    }
  </section>`;
}

function limitDownSection(r) {
  const list = r.pools?.limitDown || [];
  if (!list.length) return '';
  return `
  <section class="section">
    <div class="section-head">
      <h2>跌停 ${esc(r.pools.limitDownCount)} 家</h2>
      <div class="hint">连续跌停与所属行业，用来识别需要回避的方向</div>
    </div>
    <div class="ladder-stocks">
      ${list
        .map(
          (s) =>
            `<span class="chip down">${esc(s.name)} ${esc(s.industry || '-')}${
              s.days > 1 ? ` ${esc(s.days)}连跌停` : ''
            }</span>`
        )
        .join('')}
    </div>
  </section>`;
}

function tomorrowSection(r) {
  const { focus = [], risks = [] } = r.tomorrow || {};
  if (!focus.length && !risks.length) return '';
  return `
  <section class="section">
    <div class="section-head">
      <h2>明日关注</h2>
      <div class="hint">由今日情绪等级、主线确认情况与量能推导，不是买卖建议</div>
    </div>
    ${focus.length ? `<ul class="notes">${focus.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    ${
      risks.length
        ? `<div class="section-head" style="margin-top:10px"><div class="hint">需要提防</div></div>
           <ul class="notes risk">${risks.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`
        : ''
    }
  </section>`;
}

function newsSection(r) {
  const list = r.hotNews || [];
  if (!list.length) return '';
  return `
  <section class="section">
    <div class="section-head">
      <h2>今日热点新闻</h2>
      <div class="hint">东财重要快讯，先看宏观再看个股</div>
    </div>
    <ul class="news">
      ${list
        .map(
          (n, i) => `
      <li>
        <span class="ni">${String(i + 1).padStart(2, '0')}</span>
        <div>
          <div class="nt">${
            n.url ? `<a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a>` : esc(n.title)
          }</div>
          <div class="nm">${esc(n.time || '')}${n.source ? ` · ${esc(n.source)}` : ''}</div>
        </div>
      </li>`
        )
        .join('')}
    </ul>
  </section>`;
}

export function renderReviewHtml(result) {
  const s = result.sentiment;
  const phase = result.phase || {};
  const sub =
    `生成 ${esc(result.generatedAt)} · ${esc(phase.label || '')}` +
    `<br />${esc(phase.note || '')}`;

  const badges = [
    { text: result.headline, kind: 'alt' },
    { text: s.advice, kind: s.level === 'cold' || s.level === 'freezing' ? 'warn' : '' },
  ];
  if (phase.live) {
    badges.push({ text: '注意：当前未收盘，以下为盘中快照，收盘后请重跑', kind: 'warn' });
  }

  const body = [
    sentimentSection(result),
    ladderSection(result),
    mainLineSection(result),
    styleSection(result),
    boardSection(result),
    limitDownSection(result),
    tomorrowSection(result),
    newsSection(result),
  ].join('\n');

  return htmlShell({
    title: `当日复盘 · ${result.tradeDate}`,
    h1: `当日复盘 · ${result.tradeDate}`,
    sub,
    badges,
    hero: kpiHtml(result) + indexHtml(result.indices),
    body,
  });
}

export function saveReviewHtml(html, { root, tradeDate, stamp }) {
  const dayDir = path.join(root, 'output', tradeDate);
  fs.mkdirSync(dayDir, { recursive: true });
  const htmlPath = path.join(dayDir, `review_${stamp}.html`);
  const latestInDay = path.join(dayDir, 'latest-review.html');
  const latestRoot = path.join(root, 'output', 'latest-review.html');
  fs.writeFileSync(htmlPath, html, 'utf8');
  fs.writeFileSync(latestInDay, html, 'utf8');
  fs.writeFileSync(latestRoot, html, 'utf8');
  return { htmlPath, latestInDay, latestRoot };
}
