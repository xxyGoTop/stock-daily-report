/**
 * 早盘热点 / 竞价选股 HTML
 */

import fs from 'node:fs';
import path from 'node:path';
import { esc, fmtPct, fmtPrice, htmlShell, pctClass } from './theme.js';

function actionClass(action = '') {
  if (/可关注|买入/.test(action)) return 'tag-buy';
  if (/回避|不买/.test(action)) return 'tag-sell';
  return 'tag-watch';
}

function boardRow(b, i) {
  return `
      <article class="row">
        <div class="row-idx">${String(i + 1).padStart(2, '0')}</div>
        <div class="row-main">
          <div class="row-top">
            <div class="name">
              <strong>${esc(b.name)}</strong>
              <span class="pill soft">高开 ${esc(b.count)} 家</span>
              ${b.limitUp ? `<span class="pill">顶板 ${esc(b.limitUp)}</span>` : ''}
              ${b.amount ? `<span class="chip">额 ${esc(b.amountText)}</span>` : ''}
            </div>
            <div class="quote">
              <b class="${pctClass(b.avgChange)}">${fmtPct(b.avgChange)}</b>
              <span class="tag ${b.confirmed ? 'tag-buy' : 'tag-watch'}">${
                b.confirmed ? '板块共振' : '个股行为'
              }</span>
            </div>
          </div>
          <div class="detail"><span>${esc(b.note)}</span></div>
          <div class="chips">
            ${(b.leaders || [])
              .map(
                (s) =>
                  `<span class="chip ${pctClass(s.changePct)}">${esc(s.name)} ${fmtPct(s.changePct)}${
                    s.atLimit ? ' 顶板' : ''
                  }</span>`
              )
              .join('')}
          </div>
        </div>
      </article>`;
}

function stockRow(c, i) {
  return `
      <article class="row">
        <div class="row-idx">${String(i + 1).padStart(2, '0')}</div>
        <div class="row-main">
          <div class="row-top">
            <div class="name">
              <strong>${esc(c.name)}</strong>
              <span class="pill soft">${esc(c.code)}</span>
              <span class="pill soft">${esc(c.industry)}</span>
              <span class="pill">分 ${esc(c.score)}</span>
              ${c.atLimit ? '<span class="tag tag-sell">竞价顶板</span>' : ''}
            </div>
            <div class="quote">
              <b class="${pctClass(c.changePct)}">${fmtPrice(c.price)}</b>
              <span class="${pctClass(c.changePct)}">${fmtPct(c.changePct)}</span>
              <span class="tag ${actionClass(c.action)}">${esc(c.action)}</span>
            </div>
          </div>
          <div class="metrics">
            <div class="metric">
              <span>挂单区间</span>
              <b>${esc(c.buyPrice)}</b>
              <em>${esc(c.entryMode || '')}${c.stop ? ` · 止损参考 ${fmtPrice(c.stop)}` : ''}</em>
            </div>
            <div class="metric">
              <span>竞价额</span>
              <b>${esc(c.amountText || '-')}</b>
              <em>流通 ${esc(c.circMVText)}</em>
            </div>
            ${
              c.techNote
                ? `<div class="metric"><span>五日线</span><b>${esc(
                    c.ma5 != null ? fmtPrice(c.ma5) : '-'
                  )}</b><em>${esc(c.techNote)}</em></div>`
                : ''
            }
          </div>
          ${
            (c.reasons || []).length
              ? `<ul class="notes">${c.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
              : ''
          }
          ${
            (c.risks || []).length
              ? `<ul class="notes risk">${c.risks.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
              : ''
          }
        </div>
      </article>`;
}

export function renderMorningHtml(result) {
  const phase = result.phase || {};
  const sub = `生成 ${esc(result.generatedAt)} · ${esc(phase.label || '')}<br />${esc(result.note || phase.note || '')}`;
  const badges = [
    { text: result.headline, kind: 'alt' },
    result.hasAmount
      ? { text: '竞价额已出，9:25 后结果更可靠' }
      : { text: '竞价额未出，先看高开分布和板块聚集', kind: 'warn' },
  ];
  if (!phase.isAuction && phase.phase !== 'pre') {
    badges.push({ text: '已过 9:30，以下按开盘价回看竞价，不是盘中实时', kind: 'warn' });
  }

  const body = `
  <section class="section">
    <div class="section-head">
      <h2>早盘热点板块 · ${esc((result.hotBoards || []).length)}</h2>
      <div class="hint">由竞价高开个股自下而上聚集；9:30 前板块指数经常还是昨收，所以不用板块指数排名</div>
    </div>
    ${
      (result.hotBoards || []).length
        ? `<div class="list">${result.hotBoards.map(boardRow).join('')}</div>`
        : '<div class="muted">还没有形成高开聚集，等竞价再走几分钟。</div>'
    }
  </section>
  <section class="section">
    <div class="section-head">
      <h2>早盘选股 · ${esc((result.candidates || []).length)} 只</h2>
      <div class="funnel">
        <span>扫描 ${esc(result.scanned)}</span>
        <span>高开 ${esc(result.upCount)}</span>
        <span>入选 ${esc((result.candidates || []).length)}</span>
      </div>
      <div class="hint">优先：板块共振 + 高开未顶死 + 竞价额（若已出）+ 站上向上五日线。一字板默认不追。</div>
    </div>
    ${
      (result.candidates || []).length
        ? `<div class="list">${result.candidates.map(stockRow).join('')}</div>`
        : '<div class="muted">今天竞价里没有符合「板块共振且还能挂上价格」的标的。</div>'
    }
  </section>
  ${
    (result.watch || []).length
      ? `<section class="section">
    <div class="section-head">
      <h2>观察 / 回避 · ${esc(result.watch.length)} 只</h2>
      <div class="hint">顶板或孤立大高开，开盘不要去接</div>
    </div>
    <div class="list">${result.watch.map(stockRow).join('')}</div>
  </section>`
      : ''
  }
  <section class="section">
    <div class="section-head"><h2>早盘纪律</h2></div>
    <ul class="notes">
      <li>9:15–9:20 可撤单，涨幅会跳，只定板块方向，不提前排队打板。</li>
      <li>9:25 撮合后开盘价锁定，这是做计划的窗口；9:30 开出来前 3 分钟站不住竞价价就放弃。</li>
      <li>没有板块跟风的高开，按孤立脉冲处理，不因为单票涨幅大就追。</li>
      <li>顶板只观察能否开板，不在竞价阶段去摸一字。</li>
    </ul>
  </section>`;

  return htmlShell({
    title: `早盘竞价 · ${result.tradeDate}`,
    h1: `早盘热点与竞价选股 · ${result.tradeDate}`,
    sub,
    badges,
    body,
    foot: '免责声明：集合竞价公开数据统计，不构成投资建议。开盘走势可能迅速改变结论。',
  });
}

export function saveMorningHtml(html, { root, tradeDate, stamp }) {
  const dayDir = path.join(root, 'output', tradeDate);
  fs.mkdirSync(dayDir, { recursive: true });
  const htmlPath = path.join(dayDir, `morning_${stamp}.html`);
  const latestInDay = path.join(dayDir, 'latest-morning.html');
  const latestRoot = path.join(root, 'output', 'latest-morning.html');
  fs.writeFileSync(htmlPath, html, 'utf8');
  fs.writeFileSync(latestInDay, html, 'utf8');
  fs.writeFileSync(latestRoot, html, 'utf8');
  return { htmlPath, latestInDay, latestRoot };
}
