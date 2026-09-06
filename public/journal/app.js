const $ = (s, el = document) => el.querySelector(s);

const state = {
  weeks: [],
  analysis: null,
  candidates: [],
  month: null,
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function statusLabel(s) {
  return { holding: '持仓', win: '盈利', loss: '亏损', breakeven: '持平' }[s] || s;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

function field(form, n) {
  return form.elements.namedItem(n);
}

function fillForm(data = {}) {
  const form = $('#tradeForm');
  field(form, 'id').value = data.id || '';
  field(form, 'code').value = data.code || '';
  field(form, 'name').value = data.name || '';
  field(form, 'module').value = data.module || '正股';
  field(form, 'buyDate').value = data.buyDate || today();
  field(form, 'buyPrice').value = data.buyPrice ?? data.price ?? '';
  field(form, 'shares').value = data.shares || 100;
  field(form, 'sellDate').value = data.sellDate || '';
  field(form, 'sellPrice').value = data.sellPrice ?? '';
  field(form, 'status').value = data.status || 'holding';
  field(form, 'successReason').value = data.successReason || '';
  field(form, 'failReason').value = data.failReason || '';
  field(form, 'biasAtBuy').value = data.biasAtBuy || '';
  field(form, 'macdAtBuy').value = data.macdAtBuy || '';
  field(form, 'notes').value = data.notes || '';
  field(form, 'sourceReportDate').value = data.sourceReportDate || data.reportDate || '';
}

function renderMonthBtn(month) {
  const btn = $('#btnMonthReview');
  if (!month) {
    btn.disabled = true;
    btn.title = '加载中…';
    btn.textContent = '本月分期';
    return;
  }
  const can = !!month.canReview;
  btn.disabled = !can;
  if (month.done) {
    btn.textContent = `${month.monthOf} 已分期`;
    btn.title = can ? '可重新分期（月末）' : `已于月末完成分期；仅每月最后一天可点`;
  } else if (can) {
    btn.textContent = `${month.monthOf} 分期`;
    btn.title = '今天是月末，点击生成本月复盘';
  } else {
    btn.textContent = `${month.monthOf} 分期`;
    btn.title = `仅每月最后一天（${month.monthOf}-${String(month.lastDay).padStart(2, '0')}）可点击，今天是 ${month.today} 号`;
  }
}

function renderStats(a) {
  const w = a?.weekly || {};
  const m = a?.monthly || {};
  $('#statsGrid').innerHTML = `
    <div class="stat"><div class="k">本周胜率</div><div class="v">${w.winRate ?? 0}%</div><div class="s">${w.weekOf || '-'} · 盈${w.wins || 0}/亏${w.losses || 0}/持${w.holding || 0}</div></div>
    <div class="stat"><div class="k">本周平均收益</div><div class="v ${Number(w.avgReturn) >= 0 ? 'up' : 'down'}">${w.avgReturn ?? 0}%</div><div class="s">合计 ${w.totalReturnPct ?? 0}%</div></div>
    <div class="stat"><div class="k">本月胜率</div><div class="v">${m.winRate ?? 0}%</div><div class="s">${m.monthOf || '-'} · 盈${m.wins || 0}/亏${m.losses || 0}</div></div>
    <div class="stat"><div class="k">本月平均收益</div><div class="v ${Number(m.avgReturn) >= 0 ? 'up' : 'down'}">${m.avgReturn ?? 0}%</div><div class="s">合计 ${m.totalReturnPct ?? 0}%</div></div>
  `;

  const tips = a?.tips || [];
  $('#tipsList').innerHTML = tips.map((t) => `<li>${escapeHtml(t)}</li>`).join('') || '<li class="muted">暂无建议，先录入几笔交易</li>';
  $('#checklist').innerHTML = (a?.checklistPatch || [])
    .map((c) => `<span class="chip">${escapeHtml(c)}</span>`)
    .join('');
}

function renderWeeks(weeks) {
  const board = $('#weeksBoard');
  if (!weeks.length) {
    board.innerHTML = '<div class="muted" style="padding:12px">还没有记录。从左侧录入，或从日报候选一键带入。</div>';
    return;
  }
  board.innerHTML = weeks
    .map((w) => {
      const s = w.stats || {};
      const showDiagnose = w.canDiagnose === true;
      const diag = w.diagnosed;
      const diagNote = diag
        ? `<div class="diag-note">已诊断 ${escapeHtml(diag.diagnosedAt || '')} · 胜率 ${diag.winRate ?? '-'}% · ${(diag.tips || []).slice(0, 1).map(escapeHtml).join('')}</div>`
        : '';
      return `
      <div class="week-col ${w.expired ? 'expired' : ''}">
        <header>
          <div class="head-row">
            <div>
              <div class="title">${escapeHtml(w.weekLabel)}</div>
              <div class="meta">胜率 ${s.winRate || 0}% · 均收益 ${s.avgReturn || 0}% · ${w.trades.length} 笔${w.expired ? ' · 已过期' : ''}</div>
            </div>
            ${
              showDiagnose
                ? `<button type="button" class="btn tiny diagnose" data-diagnose="${escapeHtml(w.weekOf)}">${diag ? '再诊断' : '诊断'}</button>`
                : ''
            }
          </div>
          ${diagNote}
        </header>
        <div class="body">
          ${w.trades
            .map((t) => {
              const ret =
                t.returnPct == null ? '-' : `${t.returnPct >= 0 ? '+' : ''}${t.returnPct}%`;
              return `
              <div class="trade-card">
                <div class="row1">
                  <div><span class="code">${escapeHtml(t.code)}</span> ${escapeHtml(t.name || '')}</div>
                  <span class="badge ${escapeHtml(t.status)}">${statusLabel(t.status)}</span>
                </div>
                <div class="muted">${escapeHtml(t.module)} · 买 ${t.buyPrice} → 卖 ${t.sellPrice ?? '持仓'} · ${ret}</div>
                <div class="muted">${escapeHtml(t.buyDate)}${t.sellDate ? ' ~ ' + escapeHtml(t.sellDate) : ''}</div>
                ${t.failReason ? `<div class="muted">失败：${escapeHtml(t.failReason)}</div>` : ''}
                ${t.successReason ? `<div class="muted">成功：${escapeHtml(t.successReason)}</div>` : ''}
                <div class="ops">
                  <button class="btn tiny ghost" data-edit='${escapeHtml(JSON.stringify(t))}'>编辑</button>
                  <button class="btn tiny danger" data-del="${escapeHtml(t.id)}">删除</button>
                </div>
              </div>`;
            })
            .join('')}
        </div>
      </div>`;
    })
    .join('');
}

function renderCandidates(payload) {
  $('#candDate').textContent = payload.reportDate ? `日报 ${payload.reportDate}` : '暂无日报';
  const list = payload.candidates || [];
  $('#candList').innerHTML = list.length
    ? list
        .slice(0, 40)
        .map(
          (c) => `
      <div class="cand">
        <div>
          <b>${escapeHtml(c.code)}</b> ${escapeHtml(c.name || '')}
          <div class="muted">${escapeHtml(c.module)} · ${c.price ?? '-'}</div>
        </div>
        <button class="btn tiny" data-cand='${escapeHtml(JSON.stringify(c))}'>录入</button>
      </div>`
        )
        .join('')
    : '<div class="muted">请先运行 npm start 生成日报</div>';
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function refreshAll() {
  const [tradesRes, statsRes, candRes] = await Promise.all([
    api('/api/trades'),
    api('/api/stats'),
    api('/api/candidates'),
  ]);
  state.weeks = tradesRes.weeks || [];
  state.month = tradesRes.month || null;
  state.analysis = statsRes;
  state.candidates = candRes;
  renderWeeks(state.weeks);
  renderStats(statsRes);
  renderCandidates(candRes);
  renderMonthBtn(state.month);
}

function bind() {
  $('#tradeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    if (!body.sellPrice) delete body.sellPrice;
    if (!body.sellDate) delete body.sellDate;
    if (!body.id) delete body.id;
    await api('/api/trades', { method: 'POST', body: JSON.stringify(body) });
    fillForm({ buyDate: today(), shares: 100, module: body.module });
    await refreshAll();
  });

  $('#btnReset').onclick = () => fillForm({ buyDate: today(), shares: 100 });
  $('#btnRefresh').onclick = () => refreshAll();
  $('#btnAnalyze').onclick = async () => {
    const a = await api('/api/stats');
    state.analysis = a;
    renderStats(a);
    alert('已更新周/月统计，并写入 data/strategy-insights.json');
  };

  $('#btnMonthReview').onclick = async () => {
    if ($('#btnMonthReview').disabled) return;
    try {
      const res = await api('/api/review-month', {
        method: 'POST',
        body: JSON.stringify({ monthOf: state.month?.monthOf }),
      });
      state.month = res.month;
      if (res.analysis) {
        state.analysis = res.analysis;
        renderStats(res.analysis);
      }
      renderMonthBtn(state.month);
      const tips = (res.report?.tips || []).slice(0, 3).join('\n') || '已完成月末分期';
      alert(`月末分期完成\n胜率 ${res.report?.winRate ?? '-'}% · 均收益 ${res.report?.avgReturn ?? '-'}%\n\n${tips}`);
    } catch (err) {
      alert(err.message);
    }
  };

  $('#weeksBoard').addEventListener('click', async (e) => {
    const diagnose = e.target.closest('[data-diagnose]');
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (diagnose) {
      const weekOf = diagnose.getAttribute('data-diagnose');
      try {
        diagnose.disabled = true;
        const res = await api('/api/diagnose-week', {
          method: 'POST',
          body: JSON.stringify({ weekOf }),
        });
        state.weeks = res.weeks || state.weeks;
        if (res.month) state.month = res.month;
        renderWeeks(state.weeks);
        const tips = (res.report?.tips || []).slice(0, 3).join('\n') || '诊断完成';
        alert(`周诊断 ${weekOf}\n胜率 ${res.report?.winRate ?? '-'}% · 均收益 ${res.report?.avgReturn ?? '-'}%\n\n${tips}`);
        const a = await api('/api/stats');
        state.analysis = a;
        renderStats(a);
      } catch (err) {
        alert(err.message);
        diagnose.disabled = false;
      }
      return;
    }
    if (edit) {
      const t = JSON.parse(edit.getAttribute('data-edit'));
      fillForm(t);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    if (del) {
      if (!confirm('确认删除这笔记录？')) return;
      await api(`/api/trades/${encodeURIComponent(del.getAttribute('data-del'))}`, {
        method: 'DELETE',
      });
      await refreshAll();
    }
  });

  $('#candList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cand]');
    if (!btn) return;
    const c = JSON.parse(btn.getAttribute('data-cand'));
    let buyPrice = c.price;
    const hint = String(c.buyPriceHint || '');
    const m = hint.match(/([\d.]+)\s*~\s*([\d.]+)/);
    if (m) buyPrice = ((+m[1] + +m[2]) / 2).toFixed(2);
    fillForm({
      code: c.code,
      name: c.name,
      module: c.module,
      buyDate: today(),
      buyPrice,
      shares: 100,
      biasAtBuy: c.biasAtBuy,
      macdAtBuy: c.macdAtBuy,
      sourceReportDate: c.reportDate,
      status: 'holding',
    });
  });
}

fillForm({ buyDate: today(), shares: 100 });
bind();
refreshAll().catch((err) => {
  console.error(err);
  alert('加载失败：' + err.message);
});
