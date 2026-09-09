/**
 * 可视化 HTML 日报（竖向紧凑列表）
 */

import dayjs from 'dayjs';
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
  const cls = n >= 0 ? 'up' : 'down';
  return `<span class="${cls}">${n >= 0 ? '+' : ''}${n.toFixed(2)}%</span>`;
}

function fmtPrice(v) {
  if (v == null || Number.isNaN(+v)) return '-';
  return (+v).toFixed(2);
}

function actionClass(action = '') {
  if (/卖出|止损|回避/.test(action)) return 'tag-sell';
  if (/等五日线|等回踩|观望|不买/.test(action)) return 'tag-watch';
  if (/买入|低吸|博弈|关注/.test(action)) return 'tag-buy';
  return 'tag-watch';
}

function timelineHtml(timeline = []) {
  if (!timeline?.length) return '';
  return `<div class="timeline">${timeline
    .map(
      (t) =>
        `<span class="tl ${esc(t.status)}">${esc(t.label)}</span>`
    )
    .join('<span class="tl-sep">→</span>')}</div>`;
}

function eventsHtml(events = []) {
  if (!events?.length) return '<span class="muted">暂无重大事项</span>';
  return events
    .slice(0, 4)
    .map(
      (e) =>
        `<div class="ev"><i>${esc((e.date || '').slice(0, 10))}</i> <b>${esc(e.type || '')}</b> ${esc(e.title)}</div>`
    )
    .join('');
}

/** 竖向单行紧凑卡片 */
function rowHtml(c, idx, board) {
  const dir = c.direction || c.types?.join('/') || board;
  const sb = c.signalBoard || {};
  const tao = (c.taoTags || []).map((t) => `<span class="pill tao">${esc(t)}</span>`).join('');
  const rps =
    c.rps != null
      ? `<span class="pill soft">RPS50 ${esc(c.rps.rps50)} / 120 ${esc(c.rps.rps120)} / 250 ${esc(c.rps.rps250)}</span>`
      : '';
  const xq = c.xueqiu;
  const xqHtml = !xq
    ? ''
    : `<div class="row-xq">
        <b>雪球大V</b>
        ${
          xq.opinions?.length
            ? xq.opinions
                .slice(0, 3)
                .map(
                  (o) =>
                    `<div class="xq-item"><span class="xq-user">${esc(o.user)}</span><span class="xq-fans">${esc(o.followers)}粉</span><span class="xq-stance">${esc(o.stance)}</span> ${esc(o.summary)}</div>`
                )
                .join('')
            : `<span class="muted">${esc(xq.reason || '暂无大V观点')}</span>`
        }
      </div>`;

  return `
  <article class="row">
    <div class="row-idx">${String(idx + 1).padStart(2, '0')}</div>
    <div class="row-main">
      <div class="row-top">
        <div class="name">
          <strong>${esc(c.code)}</strong> ${esc(c.name)}
          <span class="pill">${esc(dir)}</span>
          ${tao}${rps}
          ${c.category ? `<span class="pill soft">${esc(c.category)}</span>` : ''}
          ${c.certainty != null ? `<span class="pill soft">确定${esc(c.certainty)}/5</span>` : ''}
          ${
            c.techEntry
              ? `<span class="pill ${
                  c.techSuitable === true ? 'tao' : c.techSuitable === 'wait' ? 'soft' : ''
                }">${esc(c.techEntry)}</span>`
              : ''
          }
          <span class="pill soft">分${esc(c.score ?? '-')}</span>
        </div>
        <div class="quote">
          <b>${fmtPrice(c.price)}</b> ${fmtPct(c.changePct)}
          <span class="tag ${actionClass(c.action)}">${esc(c.action || '跟踪')}</span>
        </div>
      </div>

      <div class="signal-board">
        <div class="sig bias">${esc(sb.biasText || '乖离：-')}</div>
        <div class="sig macd ${sb.macdGolden ? 'hot' : sb.macdGreenShrinking ? 'warm' : ''}">${esc(sb.macdText || 'MACD：-')}</div>
        ${
          c.techEntryText
            ? `<div class="sig tech">技术建仓：${esc(c.techEntryText)}</div>`
            : ''
        }
      </div>

      <div class="meta-board">
        <div class="meta ind"><b>行业</b> ${esc(c.industry || '未知行业')}${c.region ? ` · ${esc(c.region)}` : ''}</div>
        <div class="meta fund ${esc(c.fundFlow?.level || '')}"><b>资金</b> ${esc(c.fundFlow?.text || '资金：-')}</div>
        <div class="meta chip"><b>筹码</b> ${esc(c.chips?.text || '筹码：-')}</div>
      </div>
      ${
        c.themeExpect || c.moveReason
          ? `<div class="theme-board">
        ${c.themeExpect ? `<div class="theme expect"><b>预期</b> ${esc(c.themeExpect.replace(/^炒作预期[：:]/, ''))}</div>` : ''}
        ${c.moveReason ? `<div class="theme move"><b>涨跌</b> ${esc(c.moveReason)}</div>` : ''}
      </div>`
          : ''
      }

      <div class="row-prices">
        <div class="p buy"><span>买</span><b>${esc(c.buyPrice || '-')}</b><em>${esc((c.buyReason || '').slice(0, 72))}</em></div>
        <div class="p sell"><span>卖</span><b>${esc(c.sellPrice || '-')}</b><em>${esc((c.sellReason || '').slice(0, 72))}</em></div>
      </div>

      <div class="row-prog">
        <span><b>进展</b> ${esc(c.progress || c.stageLabel || '-')}</span>
        <span><b>下一步</b> ${esc(c.nextAction || '-')}</span>
        <span><b>窗口</b> ${esc(c.expectWindow || '-')}</span>
      </div>
      ${timelineHtml(c.timeline)}
      <div class="row-ev">
        <b>大事</b>
        ${eventsHtml(c.majorEvents)}
      </div>
      ${xqHtml}
    </div>
  </article>`;
}

function indexSignalsHtml(ix) {
  if (!ix) return '';
  const sigCls =
    ix.marketSignal === 'buy' ? 'ix-buy' : ix.marketSignal === 'avoid' ? 'ix-avoid' : 'ix-watch';
  const rows = (ix.indices || [])
    .map((x) => {
      const cls =
        x.signal === 'buy' ? 'ix-buy' : x.signal === 'avoid' ? 'ix-avoid' : 'ix-watch';
      const label =
        x.signal === 'buy' ? '可买' : x.signal === 'watch' ? '观察' : x.signal === 'avoid' ? '回避' : '-';
      return `<div class="ix-row ${cls}">
        <b>${esc(x.name)}</b>
        <span>${fmtPrice(x.price)} ${fmtPct(x.changePct)}</span>
        <span class="ix-tag">${label}</span>
        <span class="muted">强度${esc(x.strength)} · ${esc((x.reasons || []).slice(0, 2).join('；'))}</span>
      </div>`;
    })
    .join('');

  const etfRows = (ix.etfs || [])
    .map((e) => {
      const cls =
        e.signal === 'buy' || (e.action || '').includes('买入')
          ? 'ix-buy'
          : e.signal === 'sell' || (e.action || '').includes('卖出')
            ? 'ix-avoid'
            : e.signal === 'avoid'
              ? 'ix-avoid'
              : 'ix-watch';
      return `<div class="etf-card ${cls}">
        <div class="etf-top">
          <div><strong>${esc(e.code)}</strong> ${esc(e.name)} <span class="pill soft">${esc(e.theme || 'ETF')}</span></div>
          <div class="quote"><b>${fmtPrice(e.price)}</b> ${fmtPct(e.changePct)} <span class="ix-tag">${esc(e.action || e.signal)}</span></div>
        </div>
        <div class="etf-line"><b>技术线</b> ${esc(e.techLine || '-')}</div>
        <div class="signal-board">
          <div class="sig bias">${esc(e.biasText || `MA5 ${esc(e.ma5)} / MA10 ${esc(e.ma10)} / MA20 ${esc(e.ma20)}`)}</div>
          <div class="sig macd">${esc(e.macdText || (e.reasons || []).slice(0, 2).join(' · ') || '-')}</div>
        </div>
        <div class="row-prices">
          <div class="p buy"><span>买</span><b>${esc(e.buyPrice || '-')}</b><em>${esc((e.buyReason || '').slice(0, 80))}</em></div>
          <div class="p sell"><span>卖</span><b>${esc(e.sellPrice || '-')}</b><em>${esc((e.sellReason || '').slice(0, 80))}</em></div>
        </div>
      </div>`;
    })
    .join('');

  return `
  <section class="section ix-box">
    <div class="section-head">
      <h2>指数是否可买 · 中期信号</h2>
      <div class="hint">${esc(ix.ruleNote || '')}</div>
    </div>
    <div class="ix-summary ${sigCls}">
      <div class="ix-verdict">${ix.marketCanBuy ? '✓ 指数偏可买' : ix.marketSignal === 'avoid' ? '✕ 指数偏谨慎' : '○ 指数观望'}</div>
      <p>${esc(ix.summary || '')}</p>
    </div>
    <div class="ix-list">${rows || '<div class="muted">暂无指数数据</div>'}</div>
    ${
      ix.etfs?.length
        ? `<div class="section-head" style="margin-top:14px">
            <h2>重点 ETF 技术线 · 买卖</h2>
            <div class="hint">510300 沪深300 · 159516 半导体设备 · 517120 创新药</div>
          </div>
          <div class="etf-list">${etfRows}</div>`
        : ''
    }
  </section>`;
}

function sectorChips(sectors = []) {
  if (!sectors.length) return '<span class="muted">暂无板块数据</span>';
  return sectors
    .slice(0, 8)
    .map((s) => {
      const cls = s.changePct >= 0 ? 'up' : 'down';
      return `<span class="chip ${cls}">${esc(s.name)} ${s.changePct >= 0 ? '+' : ''}${s.changePct.toFixed(1)}%</span>`;
    })
    .join('');
}

function hotNewsHtml(list = []) {
  if (!list.length) {
    return `<div class="brief-card hot-news"><h3>今日热点新闻</h3><p class="muted">暂无热点新闻</p></div>`;
  }
  const items = list
    .slice(0, 15)
    .map((n, i) => {
      const title = n.url
        ? `<a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a>`
        : esc(n.title);
      const meta = [n.time, n.source].filter(Boolean).join(' · ');
      return `<li><span class="hn-idx">${String(i + 1).padStart(2, '0')}</span>
        <div class="hn-body"><div class="hn-title">${title}</div>
        ${n.summary ? `<div class="hn-sum">${esc(n.summary)}</div>` : ''}
        ${meta ? `<div class="hn-meta">${esc(meta)}</div>` : ''}
        </div></li>`;
    })
    .join('');
  return `<div class="brief-card hot-news">
    <h3>今日热点新闻 · ${Math.min(15, list.length)}条</h3>
    <ol class="hot-list">${items}</ol>
  </div>`;
}

/** 241005：主流板块 RPS5 + 当天涨幅榜第一版 */
function taoPickHtml(shortTerm) {
  const boards = shortTerm?.hotBoards || [];
  const firstPage = shortTerm?.observeFirstPage || [];
  if (!boards.length && !firstPage.length) return '';

  const boardHtml = boards.length
    ? `<div class="tao-boards">${boards
        .map(
          (b) =>
            `<span class="pill tao">${esc(b.name)} <b>${esc(b.rps5.toFixed(0))}</b></span>`
        )
        .join('')}</div>`
    : '';

  const listHtml = firstPage.length
    ? `<div class="tao-list">${firstPage
        .map(
          (c, i) => `<div class="tao-row">
            <i>${String(i + 1).padStart(2, '0')}</i>
            <b>${esc(c.code)}</b> ${esc(c.name)}
            <span class="${(c.changePct ?? 0) >= 0 ? 'up' : 'down'}">${fmtPct(c.changePct)}</span>
            <span class="pill soft">${esc((c.taoTags || []).join('/') || '-')}</span>
            ${c.board?.name ? `<span class="pill soft">${esc(c.board.name)}</span>` : ''}
          </div>`
        )
        .join('')}</div>`
    : '';

  return `
    <section class="section">
      <div class="section-head">
        <h2>陶博士241005择股 · 当天交易日</h2>
        <div class="hint">先选主流板块(板块RPS5) → 每日观察命中 ${esc(
          shortTerm?.observeHitCount ?? 0
        )} 只 → 只看当日涨幅榜第一版 ${esc(firstPage.length)} 只</div>
      </div>
      ${boardHtml}
      ${listHtml}
      <div class="muted" style="margin-top:8px">挤不进第一版说明不够优秀；不向后续版面扩散。</div>
    </section>`;
}

export function renderHtmlReport({ meta, brief, modules, shortTerm, turnaround, custom, indexSignals }) {
  const season = brief?.season || turnaround?.season || custom?.season || modules?.season || {};
  const plain = modules?.plainStocks || shortTerm?.candidates || [];
  const stList = modules?.stStocks || [];
  const eventList = modules?.eventStocks || [];
  const customCards = custom?.candidates || [];
  const isCustom = !!customCards.length && meta?.mode === 'custom';
  const ix = indexSignals || brief?.indexSignals;

  const section = (title, hint, cards, board) => `
    <section class="section">
      <div class="section-head">
        <h2>${esc(title)}</h2>
        <div class="hint">${esc(hint)}</div>
      </div>
      <div class="list">
        ${cards.length ? cards.map((c, i) => rowHtml(c, i, board)).join('') : '<div class="muted">暂无候选</div>'}
      </div>
    </section>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${isCustom ? '自选股分析' : 'A股双策略日报'} ${esc(meta.generatedAt)}</title>
<style>
  :root {
    --bg: #0f1419;
    --panel: #171d25;
    --line: #2a3441;
    --text: #e7eef7;
    --muted: #8b9bb0;
    --buy: #1faa6e;
    --sell: #e25555;
    --watch: #d6a23a;
    --accent: #3d8bfd;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    color: var(--text);
    background:
      radial-gradient(900px 420px at 8% -8%, rgba(61,139,253,.16), transparent 50%),
      var(--bg);
    line-height: 1.45;
  }
  .wrap { max-width: 920px; margin: 0 auto; padding: 20px 14px 48px; }
  .hero {
    background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
    padding: 18px 16px; margin-bottom: 14px;
  }
  h1 { margin: 0 0 6px; font-size: 22px; }
  .sub { color: var(--muted); font-size: 12px; }
  .badge {
    display: inline-block; margin-top: 10px; padding: 4px 10px; border-radius: 999px;
    background: rgba(61,139,253,.14); color: #9ec1ff; font-size: 12px;
    border: 1px solid rgba(61,139,253,.3);
  }
  .brief {
    display: grid; grid-template-columns: 1fr; gap: 8px; margin-top: 12px;
  }
  .brief-card {
    background: #1e2630; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px;
  }
  .brief-card h3 { margin: 0 0 6px; font-size: 13px; color: #7dffa8; }
  .brief-card p { margin: 0; font-size: 12px; color: #c9d4e2; }
  .hot-news h3 { color: #ffd27a; }
  .hot-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .hot-list li { display: grid; grid-template-columns: 28px 1fr; gap: 6px; align-items: start; }
  .hn-idx { color: var(--muted); font-size: 11px; padding-top: 2px; }
  .hn-title { font-size: 12px; color: #e7eef7; }
  .hn-title a { color: #9ec1ff; text-decoration: none; }
  .hn-title a:hover { text-decoration: underline; }
  .hn-sum { font-size: 11px; color: #a7b4c6; margin-top: 2px; }
  .hn-meta { font-size: 10px; color: var(--muted); margin-top: 2px; }
  .theme-board { display: flex; flex-direction: column; gap: 4px; margin: 6px 0 4px; }
  .theme { font-size: 11px; color: #d2dbe8; line-height: 1.4; }
  .theme b { color: #ffd27a; margin-right: 4px; }
  .theme.move b { color: #9ec1ff; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
  .chip { font-size: 11px; padding: 2px 7px; border-radius: 6px; background: #243041; border: 1px solid var(--line); }
  .chip.up { color: #ff6b6b; } .chip.down { color: #3dd68c; }
  .recommend { margin: 4px 0 0; padding-left: 16px; } .recommend li { font-size: 12px; margin: 2px 0; }
  .section {
    margin-top: 14px; background: rgba(23,29,37,.85); border: 1px solid var(--line);
    border-radius: 14px; padding: 12px;
  }
  .section-head { margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
  .section-head h2 { margin: 0; font-size: 16px; }
  .section-head .hint { color: var(--muted); font-size: 11px; margin-top: 2px; }

  /* 竖向列表 */
  .list { display: flex; flex-direction: column; gap: 8px; }
  .row {
    display: grid; grid-template-columns: 36px 1fr; gap: 8px;
    background: #141a22; border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px;
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
  .quote b { font-size: 15px; }
  .up { color: #ff6b6b; } .down { color: #3dd68c; }
  .tag { font-size: 11px; padding: 2px 7px; border-radius: 6px; font-weight: 600; margin-left: 6px; }
  .tag-buy { background: rgba(31,170,110,.14); color: var(--buy); }
  .tag-sell { background: rgba(226,85,85,.14); color: var(--sell); }
  .tag-watch { background: rgba(214,162,58,.14); color: var(--watch); }

  .row-prices { display: grid; grid-template-columns: 1fr; gap: 4px; margin-top: 6px; }
  .p {
    display: grid; grid-template-columns: 22px auto 1fr; gap: 6px; align-items: baseline;
    font-size: 12px; padding: 5px 8px; border-radius: 8px; border: 1px solid var(--line);
  }
  .p.buy { background: rgba(31,170,110,.08); }
  .p.sell { background: rgba(226,85,85,.08); }
  .p span { color: var(--muted); font-size: 11px; }
  .p b { color: var(--text); }
  .p em { color: #a9b7c8; font-style: normal; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .signal-board { display: grid; grid-template-columns: 1fr; gap: 4px; margin-top: 6px; }
  .sig {
    font-size: 12px; padding: 5px 8px; border-radius: 8px;
    background: #1a222c; border: 1px solid var(--line); color: #d5deea;
  }
  .meta-board { display: grid; grid-template-columns: 1fr; gap: 4px; margin-top: 6px; }
  .meta {
    font-size: 12px; padding: 5px 8px; border-radius: 8px;
    background: #1a222c; border: 1px solid var(--line); color: #d5deea;
  }
  .meta b { color: #9eb0c5; margin-right: 4px; font-weight: 600; }
  .meta.fund.strong_in, .meta.fund.in { border-color: rgba(31,170,110,.35); color: #9dffc7; }
  .meta.fund.strong_out, .meta.fund.out { border-color: rgba(226,85,85,.35); color: #ffb0b0; }
  .sig.hot { border-color: rgba(31,170,110,.4); }
  .sig.warm { border-color: rgba(214,162,58,.35); }
  .sig.macd.hot { border-color: rgba(31,170,110,.45); color: #7dffa8; }
  .sig.macd.warm { border-color: rgba(214,162,58,.45); color: #ffd27a; }
  .row-xq { margin-top: 6px; font-size: 11px; }
  .row-xq > b { color: var(--muted); margin-right: 6px; }
  .xq-item { margin-top: 3px; color: #c5d0de; }
  .xq-user { color: #9ec1ff; margin-right: 6px; }
  .xq-fans { color: var(--muted); margin-right: 6px; }
  .xq-stance { color: #ffd27a; margin-right: 6px; }

  .row-prog {
    display: flex; flex-direction: column; gap: 2px; margin-top: 6px;
    font-size: 12px; color: #d2dbe8;
  }
  .row-prog b { color: var(--muted); font-weight: 600; margin-right: 4px; }
  .timeline { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 4px; }
  .tl { font-size: 10px; color: var(--muted); background: #222b36; padding: 2px 6px; border-radius: 999px; }
  .tl.done { color: #7dffa8; }
  .tl.current { color: #9ec1ff; box-shadow: inset 0 0 0 1px rgba(61,139,253,.45); }
  .tl-sep { color: #445261; font-size: 10px; }
  .row-ev { margin-top: 6px; font-size: 11px; }
  .row-ev > b { color: var(--muted); margin-right: 6px; }
  .ev { color: #c5d0de; margin-top: 2px; }
  .ev i { color: var(--muted); font-style: normal; margin-right: 4px; }
  .ev b { color: #9ec1ff; font-weight: 600; margin-right: 4px; }
  .muted { color: var(--muted); font-size: 11px; }
  .pill.tao { background: rgba(90,140,255,.18); color: #9ec1ff; border: 1px solid rgba(90,140,255,.35); }
  .ix-box { margin-bottom: 14px; }
  .ix-summary { border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; border: 1px solid var(--line); background: #171d24; }
  .ix-summary.ix-buy { border-color: rgba(61,214,140,.4); }
  .ix-summary.ix-avoid { border-color: rgba(255,107,107,.35); }
  .ix-verdict { font-weight: 700; font-size: 15px; margin-bottom: 4px; }
  .ix-list { display: flex; flex-direction: column; gap: 6px; }
  .ix-row { display: grid; grid-template-columns: 90px 110px 48px 1fr; gap: 8px; align-items: center;
    background: #121820; border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font-size: 12px; }
  .ix-tag { font-size: 11px; font-weight: 600; }
  .ix-row.ix-buy .ix-tag { color: #7dffa8; }
  .ix-row.ix-watch .ix-tag { color: #ffd27a; }
  .ix-row.ix-avoid .ix-tag { color: #ff8e8e; }
  .tao-boards { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .tao-list { display: flex; flex-direction: column; gap: 5px; }
  .tao-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px;
    background: #121820; border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; }
  .tao-row i { color: var(--accent); font-style: normal; font-weight: 700; }
  .etf-list { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }
  .etf-card {
    background: #121820; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px;
  }
  .etf-card.ix-buy { border-color: rgba(61,214,140,.35); }
  .etf-card.ix-avoid { border-color: rgba(255,107,107,.3); }
  .etf-top { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; margin-bottom: 6px; }
  .etf-line { font-size: 12px; color: #d2dbe8; margin-bottom: 6px; }
  .etf-line b { color: var(--muted); margin-right: 4px; }
  @media (max-width: 720px) {
    .ix-row { grid-template-columns: 1fr 1fr; }
  }
  .foot { margin-top: 14px; color: var(--muted); font-size: 11px; text-align: center; }
  .freshness {
    margin-top: 10px; padding: 7px 10px; border-radius: 8px;
    font-size: 12px; border: 1px solid var(--line);
  }
  .freshness b { margin-right: 6px; }
  .freshness.ok { color: var(--muted); background: rgba(31,170,110,.08); border-color: rgba(31,170,110,.28); }
  .freshness.stale { color: #ffd9a0; background: rgba(214,162,58,.12); border-color: rgba(214,162,58,.45); }
</style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>${isCustom ? '自选股分析' : 'A股双策略日报'}</h1>
      <div class="sub">生成时间 ${esc(meta.generatedAt)} · ${esc(meta.todayLabel)} · 下一交易日 ${esc(meta.tomorrowLabel)}</div>
      <div class="badge">${esc(season.label || (isCustom ? '自选模式' : '季节性策略'))}</div>
      ${
        meta.freshness
          ? `<div class="freshness ${meta.freshness.warn ? 'stale' : 'ok'}">
        <b>${meta.freshness.warn ? '⚠ 数据新鲜度' : '数据新鲜度'}</b>${esc(meta.freshness.text)}
      </div>`
          : ''
      }

      ${
        isCustom
          ? `<div class="brief">
        ${hotNewsHtml(brief?.hotNews)}
        <div class="brief-card"><h3>自选代码</h3><p>${esc((custom.codes || []).join('、'))}</p></div>
      </div>`
          : `<div class="brief">
        ${hotNewsHtml(brief?.hotNews)}
        <div class="brief-card">
          <h3>${esc(brief?.prevTradingDay?.title || '上个交易日主流方向')}</h3>
          <p>${esc(brief?.prevTradingDay?.summary || '-')}</p>
          <div class="chips">${sectorChips(brief?.prevTradingDay?.sectors)}</div>
        </div>
        <div class="brief-card">
          <h3>${esc(brief?.currentSession?.title || '本交易日主线')}</h3>
          <p>${esc(brief?.currentSession?.summary || '-')}</p>
        </div>
        <div class="brief-card">
          <h3>${esc(brief?.recommend?.title || '推荐方向')}</h3>
          <ul class="recommend">
            ${(brief?.recommend?.items || []).map((i) => `<li>${esc(i)}</li>`).join('') || '<li class="muted">暂无</li>'}
          </ul>
        </div>
      </div>
      ${(brief?.riskNotes || []).map((n) => `<div class="muted" style="margin-top:8px">⚠ ${esc(n)}</div>`).join('')}`
      }
    </section>

    ${
      isCustom
        ? section(`自选股明细（${customCards.length}）`, '含乖离/MACD固定指标 · 雪球大V(粉丝≥4000)', customCards, '自选')
        : [
            indexSignalsHtml(ix),
            taoPickHtml(shortTerm),
            section(
              '模块一 · 正股（纯技术 + 顺向火车轨/火车每日观察/蓝色钻石）',
              `候选 ${plain.length}/15 · 乖离/MACD + 陶博士RPS选股`,
              plain,
              '正股'
            ),
            section(
              '模块二 · ST股（不含正股）',
              `候选 ${stList.length}/15 · 含进展/买卖价/乖离/MACD/雪球大V`,
              stList,
              'ST'
            ),
            section(
              '模块三 · 收购 / 股权转让 / 重整（不含ST）',
              `候选 ${eventList.length}/15 · 事件驱动正股`,
              eventList,
              '事件'
            ),
          ].join('\n')
    }

    <div class="foot">免责声明：自动分析结果不构成投资建议。雪球观点需配置 XUEQIU_COOKIE 时更完整。事件时间窗为粗估，请以交易所公告为准。</div>
  </div>
</body>
</html>`;
}

/**
 * 保存到 output/YYYY-MM-DD/ 日期目录，并同步 latest 快捷方式文件到 output/
 */
export function saveHtmlReport(html, outDir, { dateFolder } = {}) {
  const dayDir = dateFolder || dayjs().format('YYYY-MM-DD');
  const targetDir = path.join(outDir, dayDir);
  fs.mkdirSync(targetDir, { recursive: true });
  const stamp = dayjs().format('HHmmss');
  const htmlPath = path.join(targetDir, `report_${stamp}.html`);
  const latestInDay = path.join(targetDir, 'latest.html');
  const latestRoot = path.join(outDir, 'latest.html');
  fs.writeFileSync(htmlPath, html, 'utf8');
  fs.writeFileSync(latestInDay, html, 'utf8');
  fs.writeFileSync(latestRoot, html, 'utf8');
  return { htmlPath, latestInDay, latestRoot, dayDir: targetDir };
}
