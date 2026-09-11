/**
 * 尾盘选股 HTML
 */

import fs from 'node:fs';
import path from 'node:path';
import { esc, fmtNetYi, fmtPct, fmtPrice, htmlShell, pctClass } from './theme.js';

function actionClass(action = '') {
  if (/不买|观察|等回踩|观望/.test(action)) return 'tag-watch';
  if (/买入|优先|可买/.test(action)) return 'tag-buy';
  if (/卖出|回避/.test(action)) return 'tag-sell';
  return 'tag-watch';
}

function fundClass(v) {
  if (v == null || Number.isNaN(+v)) return 'fund-flat';
  if (+v > 0) return 'fund-in';
  if (+v < 0) return 'fund-out';
  return 'fund-flat';
}

function boardText(bs) {
  if (!bs) return null;
  if (bs.isMover) {
    return `尾盘异动·${bs.name} ${fmtPct(bs.changePct)}（扩散 ${(Number(bs.breadth || 0) * 100).toFixed(
      0
    )}%、较5日均速加速 ${fmtPct(bs.acceleration)}）`;
  }
  if (bs.isStrong) {
    return `今日最强第${bs.todayRank}·${bs.name} ${fmtPct(bs.changePct)}（扩散 ${(
      Number(bs.breadth || 0) * 100
    ).toFixed(0)}%）`;
  }
  return `${bs.name} ${fmtPct(bs.changePct)}`;
}

function metric(label, value, note, cls = '') {
  return `
      <div class="metric">
        <span>${esc(label)}</span>
        <b class="${cls}">${value}</b>
        <em>${esc(note || '')}</em>
      </div>`;
}

function candidateCard(c, i) {
  const bt = boardText(c.boardSignal);
  return `
      <article class="row">
        <div class="row-idx">${String(i + 1).padStart(2, '0')}</div>
        <div class="row-main">
          <div class="row-top">
            <div class="name">
              <strong>${esc(c.name)}</strong>
              <span class="pill soft">${esc(c.code)}</span>
              <span class="pill soft">${esc(c.industry)}</span>
              <span class="pill">得分 ${esc(c.score)}</span>
            </div>
            <div class="quote">
              <b class="${pctClass(c.changePct)}">${fmtPrice(c.price)}</b>
              <span class="${pctClass(c.changePct)}">${fmtPct(c.changePct)}</span>
              <span class="tag ${actionClass(c.action)}">${esc(c.action)}</span>
            </div>
          </div>
          <div class="metrics">
            ${metric('买入点', esc(c.buyPrice), c.positionPct ? `仓位上限 ${c.positionPct}` : '', 'up')}
            ${metric('止损止盈', esc(c.sellPrice), c.sellReason)}
            ${metric('建议仓位', esc(c.positionPct), c.positionNote)}
            ${metric('五日线', esc(c.ma5Text), c.bias5 != null ? `乖离 ${fmtPct(c.bias5)}` : '')}
            ${metric('量能', esc(c.volumeText), c.projRatio != null ? `折算量比 ${c.projRatio}` : '')}
            ${metric('日内位置', esc(c.dayPosText), `区间 ${fmtPrice(c.low)}~${fmtPrice(c.high)}`)}
            ${metric(
              '主力资金',
              esc(c.fundFlow?.text || '-'),
              `净额 ${fmtNetYi(c.mainNetInflow)}`,
              fundClass(c.mainNetInflow)
            )}
            ${metric('技术信号', esc(c.signalBoard?.macdText || '-'), c.signalBoard?.biasText || '')}
            ${bt ? metric('板块', esc(bt), '') : ''}
          </div>
          ${
            (c.buyReasons || []).length
              ? `<div class="section-head" style="margin-top:10px;padding-bottom:4px"><div class="hint">买入理由</div></div>
                 <ul class="notes">${c.buyReasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
              : ''
          }
          ${
            (c.riskNotes || []).length
              ? `<div class="section-head" style="margin-top:8px;padding-bottom:4px"><div class="hint">风险提示</div></div>
                 <ul class="notes risk">${c.riskNotes.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
              : ''
          }
          <div class="detail">
            <span>操作：${esc(c.buyReason || '-')}</span>
          </div>
        </div>
      </article>`;
}

function watchCard(c, i) {
  const bt = boardText(c.boardSignal);
  return `
      <article class="row">
        <div class="row-idx">${String(i + 1).padStart(2, '0')}</div>
        <div class="row-main">
          <div class="row-top">
            <div class="name">
              <strong>${esc(c.name)}</strong>
              <span class="pill soft">${esc(c.code)}</span>
              <span class="pill soft">${esc(c.industry)}</span>
              <span class="pill">得分 ${esc(c.score)}</span>
            </div>
            <div class="quote">
              <b class="${pctClass(c.changePct)}">${fmtPrice(c.price)}</b>
              <span class="${pctClass(c.changePct)}">${fmtPct(c.changePct)}</span>
              <span class="tag tag-watch">不追</span>
            </div>
          </div>
          <div class="detail">
            <span>MA5 ${fmtPrice(c.ma5)}</span>
            <span>乖离 ${fmtPct(c.bias5)}</span>
            ${bt ? `<span>${esc(bt)}</span>` : ''}
          </div>
          <div class="metrics">
            ${metric('为何不买', esc(c.buyReason || '-'), '')}
            ${metric('回踩后', `${fmtPrice(c.ma5)} 附近再评估`, `止损参考 ${fmtPrice(c.stop)}`)}
          </div>
        </div>
      </article>`;
}

function marketSection(market) {
  if (!market) {
    return `
  <section class="section">
    <div class="section-head"><h2>大盘环境</h2></div>
    <div class="muted">已跳过大盘分析（--no-market）。</div>
  </section>`;
  }
  return `
  <section class="section">
    <div class="section-head">
      <h2>大盘环境 · ${esc(market.marketCanBuy ? '偏可买' : market.marketSignal)}</h2>
      <div class="hint">${esc(market.summary || '')}</div>
    </div>
    <div class="weak-list">
      ${(market.indices || [])
        .slice(0, 6)
        .map(
          (x) => `
      <div class="weak-item">
        <strong>${esc(x.name)}</strong>
        <span class="tag ${
          x.signal === 'buy' ? 'tag-buy' : x.signal === 'avoid' ? 'tag-sell' : 'tag-watch'
        }">${esc(x.signal)}</span>
        <span class="chip">强度 ${esc(x.strength)}</span>
        <span class="muted">${esc((x.reasons || []).slice(0, 2).join('；'))}</span>
      </div>`
        )
        .join('')}
    </div>
    ${
      (market.hotSectors || []).length
        ? `<div class="chips">${market.hotSectors
            .map(
              (s) =>
                `<span class="chip ${pctClass(s.changePct)}">${esc(s.name)} ${fmtPct(s.changePct)}</span>`
            )
            .join('')}</div>`
        : ''
    }
  </section>`;
}

function boardListSection(title, hint, list, emptyText) {
  return `
  <section class="section">
    <div class="section-head">
      <h2>${esc(title)} · ${list.length} 个</h2>
      <div class="hint">${esc(hint)}</div>
    </div>
    ${
      list.length
        ? `<div class="weak-list">${list
            .map(
              (b, i) => `
      <div class="weak-item">
        <span class="wi">${String(i + 1).padStart(2, '0')}</span>
        <strong>${esc(b.name)}</strong>
        <span class="${pctClass(b.changePct)}">${fmtPct(b.changePct)}</span>
        <span class="chip">上涨${esc(b.up)}/下跌${esc(b.down)}</span>
        ${b.acceleration != null ? `<span class="chip">加速 ${fmtPct(b.acceleration)}</span>` : ''}
        <span class="${fundClass(b.mainNetInflow)}">主力 ${fmtNetYi(b.mainNetInflow)}</span>
        ${
          b.leader
            ? `<span class="muted">领涨 ${esc(b.leader)} ${fmtPct(b.leaderChangePct)}</span>`
            : ''
        }
      </div>`
            )
            .join('')}</div>`
        : `<div class="muted">${esc(emptyText)}</div>`
    }
  </section>`;
}

function recommendSection(list = []) {
  if (!list.length) return '';
  return `
  <section class="section">
    <div class="section-head">
      <h2>板块共振推荐 · ${list.length} 只</h2>
      <div class="hint">仅列已通过个股硬门槛、且所属板块今日走强或尾盘异动的标的</div>
    </div>
    <div class="weak-list">
      ${list
        .map(
          (c, i) => `
      <div class="weak-item">
        <span class="wi">${String(i + 1).padStart(2, '0')}</span>
        <strong>${esc(c.name)}</strong>
        <span class="pill soft">${esc(c.code)}</span>
        <span class="chip">${esc(c.boardType)}·${esc(c.industry)} ${fmtPct(c.boardChangePct)}</span>
        <span class="chip">得分 ${esc(c.score)}</span>
        <span class="tag ${actionClass(c.action)}">${esc(c.action)}</span>
        <span class="muted">${esc(c.buyPrice)}</span>
      </div>`
        )
        .join('')}
    </div>
  </section>`;
}

function candidateSection(result) {
  const list = result.candidates || [];
  const stats = Object.entries(result.rejectStats || {}).sort((a, b) => b[1] - a[1]);

  return `
  <section class="section">
    <div class="section-head">
      <h2>尾盘可买 · ${list.length} 只</h2>
      <div class="funnel">
        <span>全市场 ${esc(result.scanned)}</span>
        <span>快照预筛 ${esc(result.prescreened)}</span>
        <span>细算 ${esc(result.detailed)}</span>
        <span>通过 ${esc(result.passedCount)}</span>
        <span>可买 ${list.length}</span>
      </div>
    </div>
    ${
      list.length
        ? `<div class="list">${list.map(candidateCard).join('')}</div>`
        : `<div class="muted">今天尾盘没有符合条件、且当前价位就能买的标的。空仓也是一种决策。</div>
           ${
             stats.length
               ? `<div class="chips">${stats
                   .slice(0, 6)
                   .map(([r, n]) => `<span class="chip">${esc(r)} ${n} 只</span>`)
                   .join('')}</div>`
               : ''
           }`
    }
  </section>`;
}

function watchSection(list = []) {
  if (!list.length) return '';
  return `
  <section class="section">
    <div class="section-head">
      <h2>观察区 · ${list.length} 只</h2>
      <div class="hint">技术面合格，但当前价位不宜追，等回踩到位再评估</div>
    </div>
    <div class="list">${list.map(watchCard).join('')}</div>
  </section>`;
}

function disciplineSection() {
  return `
  <section class="section">
    <div class="section-head"><h2>尾盘纪律</h2></div>
    <ul class="notes">
      <li>买入点是「当场可挂的价位」，收盘前未成交就不追，明天重新评估。</li>
      <li>止损位当天就写进备忘，次日开盘跌破直接执行，不要等反弹。</li>
      <li>大盘为 avoid 时，本表仅供观察，不建议新开仓。</li>
      <li>买入理由只列支持做多的因子，风险提示务必一起看完再决定。</li>
    </ul>
  </section>`;
}

export function renderTailHtml(result) {
  const phase = result.phase || {};
  const market = result.market;
  const fresh = result.freshness;

  const sub =
    `生成 ${esc(result.generatedAt)} · ${esc(phase.label || '')}` +
    `<br />${esc(phase.note || '')}`;

  const badges = [];
  if (market) {
    badges.push({
      text: `大盘：${market.marketCanBuy ? '偏可买' : market.marketSignal} · ${market.summary}`,
      kind: market.marketCanBuy ? 'alt' : '',
    });
  }
  if (!phase.isTail) {
    badges.push({
      text: '当前不在 14:30~15:00 尾盘窗口，本表仅作准备/复盘，下单前请重跑',
      kind: 'warn',
    });
  }
  if (fresh) {
    badges.push({ text: `数据新鲜度：${fresh.text}`, kind: fresh.warn ? 'warn' : '' });
  }

  const body = [
    marketSection(market),
    boardListSection(
      '今天最强板块',
      '今日涨幅 + 上涨扩散 + 资金流三重确认',
      result.strongestBoards || [],
      '暂无同时满足涨幅、扩散度和资金流确认的强势板块。'
    ),
    boardListSection(
      '尾盘异动板块提醒',
      '今日突然加速，且有资金或扩散确认，不因单只涨停股强行定义板块行情',
      result.tailMovingBoards || [],
      '暂无可信的板块异动。'
    ),
    recommendSection(result.boardRecommendations),
    candidateSection(result),
    watchSection(result.watchList),
    disciplineSection(),
  ].join('\n');

  const date = String(result.generatedAt || '').slice(0, 10);
  return htmlShell({
    title: `尾盘选股 · ${date}`,
    h1: '尾盘买入候选',
    sub,
    badges,
    body,
    foot: '免责声明：程序按规则自动筛选，不构成投资建议，请自行风控。',
  });
}

export function saveTailHtml(html, { root, tradeDate, stamp }) {
  const dayDir = path.join(root, 'output', tradeDate);
  fs.mkdirSync(dayDir, { recursive: true });
  const htmlPath = path.join(dayDir, `tail_${stamp}.html`);
  const latestInDay = path.join(dayDir, 'latest-tail.html');
  const latestRoot = path.join(root, 'output', 'latest-tail.html');
  fs.writeFileSync(htmlPath, html, 'utf8');
  fs.writeFileSync(latestInDay, html, 'utf8');
  fs.writeFileSync(latestRoot, html, 'utf8');
  return { htmlPath, latestInDay, latestRoot };
}
