/**
 * 把「ST / 创新药 / AI端侧」等口语行业名解析成东财板块，并拉成分股代码。
 *
 * 用法示例：
 *   npm run pick -- --board=创新药
 *   npm run pick -- ST
 *   npm start -- --board=消费电子
 */

import {
  fetchBoardMembers,
  fetchBoardRps5,
  fetchClistBoards,
  fetchStStocks,
} from '../crawl/eastmoney.js';

/** 已知东财板块代码（不依赖涨跌幅排名是否进前排） */
export const KNOWN_BOARD_CODES = {
  ST: 'BK0511',
  '*ST': 'BK0511',
  ST股: 'BK0511',
  ST板: 'BK0511',
  ST板块: 'BK0511',
  风险警示: 'BK0511',
  风险警示板: 'BK0511',
  风险警示板块: 'BK0511',
};

/**
 * 口语 → 东财板块名候选（按优先级）
 * 含用户常用：ST、AI端侧、元件、消费电子、消费、创新药
 */
export const BOARD_ALIASES = {
  ST: ['ST股', '风险警示'],
  '*ST': ['ST股', '风险警示'],
  ST股: ['ST股', '风险警示'],
  ST板: ['ST股'],
  ST板块: ['ST股'],
  风险警示: ['ST股', '风险警示'],
  风险警示板: ['ST股'],
  风险警示板块: ['ST股'],
  AI端侧: ['AI端侧', '端侧AI', 'AI手机', 'AI PC', '人工智能'],
  端侧AI: ['AI端侧', '端侧AI', 'AI手机', '人工智能'],
  端侧: ['AI端侧', '端侧AI', 'AI手机'],
  元件: ['元件', '电子元件', '被动元件'],
  消费电子: ['消费电子'],
  消费: ['消费电子', '食品饮料', '商贸零售', '美容护理', '白酒'],
  创新药: ['创新药', '化学制药', '生物制品', '医药'],
  半导体: ['半导体', '芯片', '集成电路'],
  芯片: ['半导体', '芯片', '集成电路'],
  新能源: ['新能源', '光伏', '锂电', '储能'],
  光伏: ['光伏', '新能源'],
  锂电: ['锂电', '锂电池', '新能源'],
  军工: ['军工', '航天航空', '国防军工'],
  医药: ['化学制药', '生物制品', '中药', '创新药', '医药'],
  中药: ['中药'],
  白酒: ['白酒', '食品饮料'],
  银行: ['银行'],
  券商: ['证券', '券商'],
  证券: ['证券', '券商'],
};

export function cleanBoardHint(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^--+/, '').trim();
  for (const suf of ['板块', '概念', '行业', '题材']) {
    if (s.endsWith(suf) && s.length > suf.length) s = s.slice(0, -suf.length);
  }
  return s.trim();
}

export function isRiskBoardHint(hint) {
  const h = cleanBoardHint(hint).toUpperCase();
  return (
    h === 'ST' ||
    h.includes('ST') ||
    String(hint).includes('风险警示') ||
    String(hint).includes('ST股')
  );
}

function aliasCandidates(hint) {
  const h = cleanBoardHint(hint);
  if (!h) return [];
  const out = [h];
  const extra = BOARD_ALIASES[h] || BOARD_ALIASES[h.toUpperCase()];
  if (extra) out.push(...extra);
  for (const [k, vals] of Object.entries(BOARD_ALIASES)) {
    if (h === k || h.includes(k) || k.includes(h)) {
      out.push(k, ...vals);
    }
  }
  const seen = new Set();
  return out.filter((x) => {
    const t = String(x || '').trim();
    if (!t || seen.has(t)) return false;
    seen.add(t);
    return true;
  });
}

function scoreNameMatch(boardName, alias) {
  if (!boardName || !alias) return 0;
  if (boardName === alias) return 100;
  if (boardName.includes(alias) || alias.includes(boardName)) {
    return 80 + Math.min(alias.length, boardName.length);
  }
  // 至少 2 字公共子串
  const a = [...alias];
  let best = 0;
  for (let n = Math.min(a.length, 4); n >= 2; n--) {
    for (let i = 0; i + n <= a.length; i++) {
      const sub = a.slice(i, i + n).join('');
      if (boardName.includes(sub)) best = Math.max(best, n * 10);
    }
  }
  return best;
}

/**
 * 解析板块名 → { code, name, kind, allowST }
 */
export async function resolveBoard(hint, { onProgress } = {}) {
  const cleaned = cleanBoardHint(hint);
  if (!cleaned) return null;

  const known =
    KNOWN_BOARD_CODES[cleaned] ||
    KNOWN_BOARD_CODES[cleaned.toUpperCase()] ||
    KNOWN_BOARD_CODES[`${cleaned}板块`];
  if (known) {
    onProgress?.(`命中已知板块 ${cleaned} → ${known}`);
    return {
      code: known,
      name: cleaned.includes('风险') ? 'ST股' : cleaned === 'ST' || /ST/i.test(cleaned) ? 'ST股' : cleaned,
      kind: '概念',
      allowST: true,
      hint: cleaned,
    };
  }

  const aliases = aliasCandidates(cleaned);
  onProgress?.(`匹配板块「${cleaned}」…`);

  let boards = [];
  try {
    boards = await fetchClistBoards({ includeNoise: true, pages: 6 });
  } catch (e) {
    onProgress?.(`板块列表拉取失败：${e.message || e}`);
  }

  // 回退：RPS 列表（不含 ST 噪声板，但覆盖常规行业/概念）
  if (!boards.length) {
    try {
      const idx = await fetchBoardRps5({ includeConcept: true });
      boards = (idx.boards || []).map((b) => ({
        code: b.code,
        name: b.name,
        kind: b.kind,
        changePct: b.changePct,
      }));
    } catch {
      /* ignore */
    }
  }

  let best = null;
  let bestScore = 0;
  for (const b of boards) {
    for (const a of aliases) {
      const sc = scoreNameMatch(b.name, a);
      if (sc > bestScore) {
        bestScore = sc;
        best = b;
      }
    }
  }

  if (!best || bestScore < 20) {
    return null;
  }

  return {
    code: String(best.code || '').toUpperCase(),
    name: best.name,
    kind: best.kind || '',
    allowST: isRiskBoardHint(cleaned) || /ST/i.test(best.name),
    hint: cleaned,
    matchScore: bestScore,
  };
}

/**
 * 解析后拉成分股代码（最多 limit 只，按涨幅）
 */
export async function resolveBoardUniverse(hint, { limit = 80, onProgress } = {}) {
  const board = await resolveBoard(hint, { onProgress });
  if (!board?.code) {
    return { board: null, codes: [], members: [] };
  }

  onProgress?.(`拉取「${board.name}」(${board.code}) 成分股…`);
  let members = await fetchBoardMembers(board.code, {
    limit: Math.min(100, Math.max(20, limit)),
    allowST: board.allowST,
  });

  // ST 板成分接口偶发空：再试 raw fs，仍空则回退全市场 ST 名称列表
  if (!members.length && board.allowST) {
    members = await fetchBoardMembers(board.code, {
      limit: 100,
      allowST: true,
      rawFs: true,
    });
  }
  if (!members.length && board.allowST) {
    onProgress?.('ST 成分接口为空，回退全市场 ST 列表…');
    const stList = await fetchStStocks({ pages: 6, pageSize: 100 });
    const arr = Array.isArray(stList) ? stList : stList?.stocks || [];
    members = arr.slice(0, Math.min(100, limit)).map((s) => ({
      code: String(s.code || '').padStart(6, '0'),
      name: s.name,
      price: s.price,
      changePct: s.changePct,
      amount: s.amount,
      turnover: s.turnover,
      volumeRatio: s.volumeRatio,
    }));
  }

  const codes = [...new Set(members.map((m) => m.code).filter((c) => /^\d{6}$/.test(c)))];
  onProgress?.(`「${board.name}」成分 ${codes.length} 只`);
  return { board, codes, members };
}

function looksLikeBoardToken(raw) {
  const a = String(raw || '').trim();
  if (!a) return false;
  const c = cleanBoardHint(a);
  if (/^(ST|\*ST)$/i.test(c)) return true;
  if (/(板块|概念|行业|题材)$/.test(a)) return true;
  if (KNOWN_BOARD_CODES[c] || KNOWN_BOARD_CODES[c.toUpperCase()]) return true;
  if (BOARD_ALIASES[c] || BOARD_ALIASES[c.toUpperCase()]) return true;
  for (const k of Object.keys(BOARD_ALIASES)) {
    if (c === k || (c.length >= 2 && (c.includes(k) || k.includes(c)))) return true;
  }
  return false;
}

/**
 * 从 argv 抽出行业参数，返回 { boardHint, rest }
 *
 * 支持：
 *   --board=创新药  --sector=消费电子  --行业=元件
 *   --board 创新药
 *   --ST / --st
 *   位置参数里「像板块」的词：ST、创新药、AI端侧、消费电子板块
 *   （个股中文名如「贵州茅台」不会被当成板块）
 */
export function extractBoardArg(argv) {
  const rest = [];
  let boardHint = '';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--board' || a === '--sector' || a === '--行业' || a === '--板块') {
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        boardHint = cleanBoardHint(next);
        i += 1;
      }
      continue;
    }
    if (a.startsWith('--board=') || a.startsWith('--sector=') || a.startsWith('--行业=') || a.startsWith('--板块=')) {
      boardHint = cleanBoardHint(a.slice(a.indexOf('=') + 1));
      continue;
    }
    if (a === '--ST' || a === '--st' || a === '--风险警示') {
      boardHint = a === '--风险警示' ? '风险警示' : 'ST';
      continue;
    }
    if (a.startsWith('--') && !a.includes('=') && a.length > 2) {
      const body = a.slice(2);
      if (
        !/^(fast|help|h|no-open|no-xueqiu|short-only|turnaround-only|concept)$/i.test(body) &&
        !/^(limit|top|detail|pages|max|codes)=/i.test(body) &&
        looksLikeBoardToken(body)
      ) {
        boardHint = cleanBoardHint(body);
        continue;
      }
    }
    rest.push(a);
  }

  if (!boardHint) {
    const kept = [];
    for (const a of rest) {
      if (a.startsWith('-')) {
        kept.push(a);
        continue;
      }
      if (/^\d{6}$/.test(a) || /\d{6}/.test(a)) {
        kept.push(a);
        continue;
      }
      if (looksLikeBoardToken(a)) {
        boardHint = cleanBoardHint(a);
        continue;
      }
      kept.push(a);
    }
    return { boardHint, rest: kept };
  }
  return { boardHint, rest };
}
