/**
 * 控制台 / JSON 报告输出
 */

import dayjs from 'dayjs';
import fs from 'node:fs';
import path from 'node:path';

function line(char = '─', n = 64) {
  return char.repeat(n);
}

function fmtPct(v) {
  if (v == null || Number.isNaN(+v)) return '-';
  const n = +v;
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function fmtPrice(v) {
  if (v == null || Number.isNaN(+v)) return '-';
  return (+v).toFixed(2);
}

function printCard(p, c, i) {
  const sb = c.signalBoard || {};
  p(
    `  ${String(i + 1).padStart(2, '0')}. ${c.code} ${c.name}  [${c.direction || c.types?.join('/') || '-'}]  ` +
      `得分${c.score ?? '-'}  价${fmtPrice(c.price)} ${fmtPct(c.changePct)}`
  );
  p(`      固定指标：${sb.biasText || '乖离:-'} ｜ ${sb.macdText || 'MACD:-'}`);
  if (c.techEntry || c.techEntryText) {
    p(`      技术建仓：${c.techEntry || '-'}${c.techEntryText ? `｜${c.techEntryText}` : ''}`);
  }
  p(`      行业板块：${c.industry || '未知行业'}${c.region ? ` · ${c.region}` : ''}`);
  p(`      资金流入：${c.fundFlow?.text || '-'}`);
  p(`      筹码集中：${c.chips?.text || '-'}`);
  if (c.themeExpect) p(`      ${c.themeExpect}`);
  if (c.moveReason) p(`      ${c.moveReason}`);
  p(`      操作：${c.action || '-'}`);
  p(`      买入参考：${c.buyPrice || '-'} ｜ 卖出参考：${c.sellPrice || '-'}`);
  p(`      买入原因：${(c.buyReason || c.reason || '-').slice(0, 100)}`);
  p(`      卖出原因：${(c.sellReason || '-').slice(0, 100)}`);
  p(`      进展：${c.progress || '-'} ｜ 下一窗口：${c.expectWindow || '-'}`);
  if (c.majorEvents?.length) {
    p(`      大事：${c.majorEvents.slice(0, 2).map((e) => e.title).join('；').slice(0, 90)}`);
  }
  if (c.xueqiu?.opinions?.length) {
    const o = c.xueqiu.opinions[0];
    p(`      雪球大V：${o.user}(${o.followers}粉) ${o.stance}｜${o.summary.slice(0, 60)}`);
  } else if (c.xueqiu?.reason) {
    p(`      雪球大V：${c.xueqiu.reason}`);
  }
  if (c.taoTags?.length) {
    p(
      `      陶博士：${c.taoTags.join('、')}${
        c.rps
          ? ` · RPS50=${c.rps.rps50} RPS120=${c.rps.rps120} RPS250=${c.rps.rps250}`
          : ''
      }`
    );
  }
  if (c.board?.rps5 != null) {
    p(`      板块：${c.board.name} RPS5=${c.board.rps5.toFixed(0)}（5日${c.board.change5}%）`);
  }
  if (c.observeRank) {
    p(`      每日观察：当日涨幅榜第一版第 ${c.observeRank} 名`);
  }
}

export function printReport({ modules, meta, turnaround, indexSignals, brief, shortTerm }) {
  const now = meta.generatedAt;
  const out = [];
  const p = (s = '') => out.push(s);
  const plain = modules?.plainStocks || [];
  const st = modules?.stStocks || [];
  const events = modules?.eventStocks || [];
  const hotNews = brief?.hotNews || [];

  p('');
  p('╔══════════════════════════════════════════════════════════════╗');
  p('║  A股日报：正股 / ST / 收购转让重整 · 陶博士公式 · 指数信号   ║');
  p('╚══════════════════════════════════════════════════════════════╝');
  p(`生成时间：${now}`);
  p(`交易日参考：今日=${meta.todayLabel}  下一交易日=${meta.tomorrowLabel}`);
  if (meta.freshness) {
    p(`${meta.freshness.warn ? '⚠ 数据新鲜度' : '数据新鲜度'}：${meta.freshness.text}`);
  }
  if (meta.season?.label) p(`季节策略：${meta.season.label}`);
  p(`免责声明：技术框架自动筛选，不构成投资建议。请自行风控。`);
  p('');

  p(line('═'));
  p('【今日热点新闻】（分析前必读 · 15条）');
  p(line('═'));
  if (hotNews.length) {
    hotNews.slice(0, 15).forEach((n, i) => {
      p(`  ${String(i + 1).padStart(2, '0')}. ${n.title}`);
      if (n.summary) p(`      ${n.summary.slice(0, 90)}${n.source ? ` · ${n.source}` : ''}`);
    });
  } else {
    p('  （暂无热点新闻数据）');
  }
  p('');

  if (indexSignals) {
    p(line('═'));
    p('【指数是否可买 · 中期信号】');
    p(line('═'));
    p(`结论：${indexSignals.marketCanBuy ? '偏可买' : indexSignals.marketSignal} · ${indexSignals.summary}`);
    for (const x of indexSignals.indices || []) {
      p(
        `  ${x.name}  ${x.signal}  强度${x.strength}  价${fmtPrice(x.price)}  ${(x.reasons || []).slice(0, 2).join('；')}`
      );
    }
    if (indexSignals.etfs?.length) {
      p('');
      p('【重点 ETF 技术线 · 买卖】');
      for (const e of indexSignals.etfs) {
        p(`  ${e.code} ${e.name}  [${e.action || e.signal}]  价${fmtPrice(e.price)} ${fmtPct(e.changePct)}`);
        p(`      技术线：${e.techLine || '-'}`);
        p(`      买入：${e.buyPrice || '-'} ｜ ${e.buyReason || ''}`);
        p(`      卖出：${e.sellPrice || '-'} ｜ ${e.sellReason || ''}`);
      }
    }
    p('');
  }

  const hotBoards = shortTerm?.hotBoards || [];
  if (hotBoards.length) {
    p(line('═'));
    p('【主流板块】板块指数 RPS5 前列（先选板块，再选个股）');
    p(line('═'));
    p(hotBoards.map((b) => `${b.name}(${b.rps5.toFixed(0)})`).join(' · '));
    p('');
  }

  const observeFirstPage = shortTerm?.observeFirstPage || [];
  if (observeFirstPage.length) {
    p(line('═'));
    p('【每日观察·当日涨幅榜第一版】率先年新高 / 深调高RPS回升');
    p(line('═'));
    p(`当日命中 ${shortTerm.observeHitCount} 只，只看第一版 ${observeFirstPage.length} 只（挤不进第一版的不够优秀）`);
    observeFirstPage.forEach((c, i) => {
      p(
        `  ${String(i + 1).padStart(2)}. ${c.code} ${c.name}  ${fmtPct(c.changePct)}  ` +
          `${(c.taoTags || []).join('/') || '-'}${c.board?.name ? ` ｜${c.board.name}` : ''}`
      );
    });
    p('');
  }

  p(line('═'));
  p('【模块一】正股（纯技术 + 顺向火车轨/火车每日观察/蓝色钻石）');
  p(line('═'));
  p(`候选：${plain.length}`);
  plain.slice(0, 15).forEach((c, i) => printCard(p, c, i));

  p('');
  p(line('═'));
  p('【模块二】ST股（不含正股）');
  p(line('═'));
  p(`候选：${st.length}  公告命中：${turnaround?.announcementHits ?? '-'}`);
  st.slice(0, 15).forEach((c, i) => printCard(p, c, i));

  p('');
  p(line('═'));
  p('【模块三】收购 / 股权转让 / 重整（不含ST）');
  p(line('═'));
  p(`候选：${events.length}`);
  events.slice(0, 15).forEach((c, i) => printCard(p, c, i));

  p('');
  p(line('═'));
  p('仓位提示：短线单票建议≤20%~30%；ST/事件驱动高风险，建议更低仓位。');
  p('顺向火车轨偏中线：偏好形成初期、右侧年高、10日线下买点；跌破20日线无勾头建议止损。');
  p('蓝色钻石为观察池信号，建议等右侧口袋支点再买，勿见信号就追。');
  p('完整可视化请打开当日目录 latest.html');
  p('');

  const text = out.join('\n');
  console.log(text);
  return text;
}

export function saveReportFiles(text, payload, outDir, { dateFolder } = {}) {
  const dayDir = dateFolder || dayjs().format('YYYY-MM-DD');
  const targetDir = path.join(outDir, dayDir);
  fs.mkdirSync(targetDir, { recursive: true });
  const stamp = dayjs().format('HHmmss');
  const txtPath = path.join(targetDir, `report_${stamp}.txt`);
  const jsonPath = path.join(targetDir, `report_${stamp}.json`);
  const latestTxt = path.join(targetDir, 'latest.txt');
  const latestJson = path.join(targetDir, 'latest.json');
  const rootLatestTxt = path.join(outDir, 'latest.txt');
  const rootLatestJson = path.join(outDir, 'latest.json');
  fs.writeFileSync(txtPath, text, 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.writeFileSync(latestTxt, text, 'utf8');
  fs.writeFileSync(latestJson, JSON.stringify(payload, null, 2), 'utf8');
  fs.writeFileSync(rootLatestTxt, text, 'utf8');
  fs.writeFileSync(rootLatestJson, JSON.stringify(payload, null, 2), 'utf8');
  return { txtPath, jsonPath, latestTxt, latestJson, dayDir: targetDir };
}

export function tradingDayLabels(now = dayjs()) {
  const dow = now.day();
  let todayLabel = now.format('YYYY-MM-DD');

  if (dow === 0 || dow === 6) {
    todayLabel = `${todayLabel}(周末非交易日·沿用上一日收盘逻辑)`;
  }
  let t = now.add(1, 'day');
  while (t.day() === 0 || t.day() === 6) t = t.add(1, 'day');
  const tomorrowLabel = `${t.format('YYYY-MM-DD')}(下一交易日)`;

  return { todayLabel, tomorrowLabel };
}
