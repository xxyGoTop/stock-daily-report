/**
 * 个股强弱研判的 HTML / CSS（pick 与 start/stock 日报共用）
 */

import { esc } from './theme.js';

export const strengthCss = `
  .sv { margin-top: 8px; padding: 9px 10px; border-radius: 10px;
    background: #141b24; border: 1px solid var(--line); }
  .sv-h { font-size: 11px; font-weight: 700; color: #9ec1ff; margin: 0 0 7px; letter-spacing: .04em; }
  .sv-row { font-size: 12px; line-height: 1.55; color: #d5deea; margin: 0 0 6px; }
  .sv-row:last-child { margin-bottom: 0; }
  .sv-row b { color: #9eb0c5; font-weight: 600; margin-right: 6px; }
  .sv-row.good b { color: #7dffa8; }
  .sv-row.warn b { color: #ffd27a; }
  .sv-row.bad b { color: #ff9b9b; }
  .sv-note { margin: 3px 0 0 0; padding-left: 1.4em; font-size: 11.5px;
    color: #c5d0de; line-height: 1.5; }
  .sv-split { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
  @media (max-width: 720px) { .sv-split { grid-template-columns: 1fr; } }
  .sv-box { border-radius: 8px; padding: 7px 9px; font-size: 11.5px; line-height: 1.5; }
  .sv-box h5 { margin: 0 0 4px; font-size: 11px; font-weight: 700; }
  .sv-box ul { margin: 0; padding-left: 16px; }
  .sv-box li { margin: 2px 0; }
  .sv-pros { background: rgba(31,170,110,.08); border: 1px solid rgba(31,170,110,.28); color: #c8f5d8; }
  .sv-pros h5 { color: #7dffa8; }
  .sv-cons { background: rgba(214,162,58,.08); border: 1px solid rgba(214,162,58,.32); color: #f3e0b8; }
  .sv-cons h5 { color: #ffd9a0; }
`;

function row(label, block, extra = '') {
  if (!block?.text) return '';
  const tone = block.tone || '';
  return `<div class="sv-row ${esc(tone)}"><b>${esc(label)}</b>${esc(block.text)}${extra}</div>`;
}

function note(text) {
  if (!text) return '';
  return `<div class="sv-note">👉 ${esc(text)}</div>`;
}

export function strengthHtml(v) {
  if (!v?.ma) return '';
  const rsiExtra = v.rsi?.note ? note(v.rsi.note) : '';
  const fundExtra = v.fund?.note ? note(v.fund.note) : '';
  const pros = (v.strengths || []).map((s) => `<li>${esc(s)}</li>`).join('');
  const cons = (v.risks || []).map((s) => `<li>${esc(s)}</li>`).join('');
  return `<div class="sv">
    <div class="sv-h">指标研判 · 综合强弱</div>
    ${row('均线', v.ma)}
    <div class="sv-row ${esc(v.rsi?.tone || '')}"><b>RSI</b>${esc(v.rsi?.text || '-')}${rsiExtra}</div>
    ${row('MACD', v.macd)}
    <div class="sv-row ${esc(v.fund?.tone || '')}"><b>资金面</b>${esc(v.fund?.text || '-')}${fundExtra}</div>
    ${row('支撑', v.support)}
    ${row('量能', v.volume)}
    ${
      pros || cons
        ? `<div class="sv-split">
        <div class="sv-box sv-pros"><h5>✅ 优点（强势点）</h5><ul>${pros || '<li>暂无足够强势点</li>'}</ul></div>
        <div class="sv-box sv-cons"><h5>⚠️ 隐患（需要警惕）</h5><ul>${cons || '<li>暂无明显隐患</li>'}</ul></div>
      </div>`
        : ''
    }
  </div>`;
}
