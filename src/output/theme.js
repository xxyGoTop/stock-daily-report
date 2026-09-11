/**
 * HTML 报告公共主题：转义/格式化工具 + 基础样式 + 页面骨架
 *
 * 板块强度、尾盘选股、当日复盘三份报告共用，避免各写一份 CSS 后风格漂移。
 */

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function fmtPct(v) {
  if (v == null || Number.isNaN(+v)) return '-';
  const n = +v;
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export function fmtPrice(v) {
  if (v == null || Number.isNaN(+v)) return '-';
  return (+v).toFixed(2);
}

export function fmtYi(v) {
  if (v == null || Number.isNaN(+v)) return '-';
  const yi = +v / 1e8;
  return `${Math.abs(yi) < 1 ? yi.toFixed(2) : yi.toFixed(1)}亿`;
}

export function fmtNetYi(v) {
  if (v == null || Number.isNaN(+v)) return '-';
  return `${+v > 0 ? '+' : ''}${fmtYi(v)}`;
}

/** A股习惯：涨红跌绿 */
export function pctClass(v) {
  if (v == null || Number.isNaN(+v)) return '';
  return +v >= 0 ? 'up' : 'down';
}

export const baseCss = `
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
  .sub { color: var(--muted); font-size: 12px; line-height: 1.5; }
  .badge {
    display: inline-block; margin-top: 10px; margin-right: 6px; padding: 4px 10px; border-radius: 999px;
    background: rgba(61,139,253,.14); color: #9ec1ff; font-size: 12px;
    border: 1px solid rgba(61,139,253,.3);
  }
  .badge.alt { background: rgba(31,170,110,.14); color: #7dffa8; border-color: rgba(31,170,110,.3); }
  .badge.warn { background: rgba(226,85,85,.14); color: #ff9b9b; border-color: rgba(226,85,85,.3); }
  .cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 12px; }
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
  .pill.tao { background: rgba(31,170,110,.16); color: #7dffa8; border-color: rgba(31,170,110,.3); }
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

  /* 指标网格（复盘用） */
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 12px; }
  @media (max-width: 720px) { .kpis { grid-template-columns: repeat(2, 1fr); } }
  .kpi {
    background: #1e2630; border: 1px solid var(--line); border-radius: 10px;
    padding: 10px 12px; text-align: center;
  }
  .kpi span { display: block; font-size: 11px; color: var(--muted); }
  .kpi b { display: block; font-size: 20px; margin: 2px 0; white-space: nowrap; }
  .kpi em { display: block; font-style: normal; font-size: 10px; color: var(--muted); }

  /* 连板梯队 */
  .ladder { display: flex; flex-direction: column; gap: 6px; }
  .ladder-row {
    display: grid; grid-template-columns: 76px 1fr; gap: 8px; align-items: start;
    padding: 8px 10px; border-radius: 8px; background: #141a22; border: 1px solid var(--line);
  }
  .ladder-lv { font-size: 13px; font-weight: 700; color: var(--accent); }
  .ladder-lv em { display: block; font-style: normal; font-size: 10px; color: var(--muted); }
  .ladder-stocks { display: flex; flex-wrap: wrap; gap: 6px; }
  .lstock {
    font-size: 11px; padding: 3px 8px; border-radius: 6px;
    background: rgba(226,85,85,.12); border: 1px solid rgba(226,85,85,.25); color: #ffb3b3;
  }
  .lstock i { font-style: normal; color: var(--muted); margin-left: 4px; }

  /* 板块龙头股 */
  .leaders { margin-top: 10px; border-top: 1px dashed var(--line); padding-top: 8px; }
  .leaders-head {
    display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline;
    font-size: 11px; color: var(--muted); margin-bottom: 6px;
  }
  .leaders-head b { color: #7dffa8; font-size: 12px; }
  .lead-list { display: flex; flex-direction: column; gap: 6px; }
  .lead {
    display: grid; grid-template-columns: 40px 1fr; gap: 8px;
    padding: 7px 9px; border-radius: 8px; background: rgba(30,38,48,.7);
    border: 1px solid var(--line);
  }
  .lead.top { border-color: rgba(226,85,85,.35); background: rgba(226,85,85,.07); }
  .lead-rank {
    font-size: 11px; font-weight: 700; color: var(--muted);
    display: flex; align-items: center; justify-content: center;
  }
  .lead.top .lead-rank { color: #ff8f8f; }
  .lead-top { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; font-size: 12px; }
  .lead-top strong { font-size: 13px; }
  .lead-why { font-size: 11px; color: var(--muted); margin-top: 3px; }

  /* 要点清单 */
  .notes { margin: 0; padding-left: 18px; }
  .notes li { font-size: 12px; margin: 4px 0; line-height: 1.5; color: #d2dbe8; }
  .notes.risk li { color: #ffb3b3; }

  /* 进度漏斗 */
  .funnel { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; font-size: 11px; color: var(--muted); }
  .funnel span { padding: 3px 8px; border-radius: 6px; background: #243041; border: 1px solid var(--line); }

  /* 新闻 */
  .news { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .news li { display: grid; grid-template-columns: 26px 1fr; gap: 6px; }
  .news .ni { color: var(--muted); font-size: 11px; padding-top: 2px; }
  .news .nt { font-size: 12px; }
  .news .nt a { color: #9ec1ff; text-decoration: none; }
  .news .nt a:hover { text-decoration: underline; }
  .news .nm { font-size: 10px; color: var(--muted); margin-top: 2px; }
`;

/**
 * 统一页面骨架
 *
 * @param {{title:string, h1:string, sub:string, badges?:string[], hero?:string, body:string, foot?:string}} o
 */
export function htmlShell({ title, h1, sub, badges = [], hero = '', body, foot }) {
  const badgeHtml = badges
    .filter(Boolean)
    .map((b) =>
      typeof b === 'string'
        ? `<div class="badge">${esc(b)}</div>`
        : `<div class="badge ${esc(b.kind || '')}">${esc(b.text)}</div>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>${baseCss}</style>
</head>
<body>
  <div class="wrap">
    <header class="hero">
      <h1>${esc(h1)}</h1>
      <div class="sub">${sub}</div>
      ${badgeHtml}
      ${hero}
    </header>
    ${body}
    <footer>${esc(foot || '免责声明：公开数据统计工具，不构成投资建议，请自行判断与风控。')}</footer>
  </div>
</body>
</html>`;
}
