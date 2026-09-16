/**
 * 封单监控 HTML
 */

import fs from 'node:fs';
import path from 'node:path';
import { esc, fmtPct, fmtPrice, htmlShell, pctClass } from './theme.js';

function actionKind(level = '') {
  if (level === 'hold') return 'alt';
  if (level === 'sell') return 'warn';
  return '';
}

function actionClass(level = '') {
  if (level === 'hold') return 'tag-buy';
  if (level === 'sell') return 'tag-sell';
  return 'tag-watch';
}

function bookSide(rows, kind) {
  return (rows || [])
    .map(
      (r, i) =>
        `<div class="weak-item">
          <span class="wi">${kind}${i + 1}</span>
          <span class="${r.price > 0 ? (kind === '买' ? 'up' : 'down') : 'muted'}">${
            r.price > 0 ? fmtPrice(r.price) : '-'
          }</span>
          <span class="muted">${r.volume > 0 ? `${r.volume >= 10000 ? `${(r.volume / 10000).toFixed(1)}万` : r.volume}手` : '-'}</span>
        </div>`
    )
    .join('');
}

function cardHtml(c) {
  if (c.error) {
    return `<section class="section"><div class="muted">${esc(c.code)} ${esc(c.name)}：${esc(c.error)}</div></section>`;
  }
  return `
  <section class="section">
    <div class="section-head">
      <h2>${esc(c.name)} ${esc(c.code)} · <span class="tag ${actionClass(c.level)}">${esc(c.action)}</span></h2>
      <div class="hint">${esc(c.industry || '')} · 行情 ${esc(c.quoteTime || '-')}${
        c.sealDeltaText ? ` · ${esc(c.sealDeltaText)}` : ''
      }</div>
    </div>
    <div class="kpis">
      <div class="kpi"><span>现价</span><b class="${pctClass(c.changePct)}">${fmtPrice(c.price)}</b><em>${fmtPct(c.changePct)}</em></div>
      <div class="kpi"><span>封单</span><b>${esc(c.sealAmountText)}</b><em>${esc(c.sealHandsText)}</em></div>
      <div class="kpi"><span>封单/成交</span><b>${esc(c.sealRatioText)}</b><em>成交 ${esc(c.amountText)}</em></div>
      <div class="kpi"><span>看法分</span><b>${esc(c.score)}</b><em>${esc(c.atLimit ? `${c.boards || 1}连板 · 开板${c.brokenTimes ?? 0}次` : '未封板')}</em></div>
    </div>
    <p style="margin:10px 0 0;font-size:13px;line-height:1.55;color:#d2dbe8">${esc(c.verdict)}</p>
    <div class="cards" style="margin-top:10px">
      <div class="card">
        <h3>买盘</h3>
        ${bookSide(c.bids, '买')}
      </div>
      <div class="card">
        <h3>卖盘</h3>
        ${bookSide(c.asks, '卖')}
      </div>
    </div>
    <div class="detail">
      <span>买一 ${esc(c.buy1Text)}</span>
      <span>卖一 ${esc(c.sell1Text)}</span>
      <span>换手 ${c.turnover != null ? `${c.turnover.toFixed(2)}%` : '-'}</span>
      <span>量比 ${c.volumeRatio != null ? c.volumeRatio.toFixed(2) : '-'}</span>
      <span>首次封板 ${esc(c.firstSealText)}</span>
      <span>${esc(c.techNote)}</span>
    </div>
    ${(c.reasons || []).length ? `<ul class="notes">${c.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
    ${(c.risks || []).length ? `<ul class="notes risk">${c.risks.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
  </section>`;
}

export function renderSealHtml(result) {
  const phase = result.phase || {};
  const names = (result.cards || []).map((c) => c.name).filter(Boolean).join('、');
  const top = result.cards?.[0];
  const badges = [
    { text: `${phase.label || ''} · ${result.generatedAt}`, kind: '' },
    top?.action ? { text: `${top.name}：${top.action}`, kind: actionKind(top.level) } : null,
  ].filter(Boolean);

  return htmlShell({
    title: `封单监控 · ${names || result.tradeDate}`,
    h1: `封单监控 · ${names || result.tradeDate}`,
    sub: `${esc(phase.note || '')}<br />涨停看买一封单厚薄；没封板就只看买一卖一和五日线，不要硬套打板语言。`,
    badges,
    body: (result.cards || []).map(cardHtml).join('\n'),
    foot: '免责声明：封单会实时变化，本页是快照不是指令。炸板后不要用今天的封单金额自我安慰。',
  });
}

export function saveSealHtml(html, { root, tradeDate, stamp }) {
  const dayDir = path.join(root, 'output', tradeDate);
  fs.mkdirSync(dayDir, { recursive: true });
  const htmlPath = path.join(dayDir, `seal_${stamp}.html`);
  const latestInDay = path.join(dayDir, 'latest-seal.html');
  const latestRoot = path.join(root, 'output', 'latest-seal.html');
  fs.writeFileSync(htmlPath, html, 'utf8');
  fs.writeFileSync(latestInDay, html, 'utf8');
  fs.writeFileSync(latestRoot, html, 'utf8');
  return { htmlPath, latestInDay, latestRoot };
}
