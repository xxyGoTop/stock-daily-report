/**
 * 雪球大V观点（粉丝≥4000）
 *
 * 抓取优先顺序：
 *   1) config/xueqiu.local.json 里的 cookie → Node 直连 api.xueqiu.com（避开浏览器滑块）
 *   2) cookie 失效时再弹浏览器手动登录，写回 cookie
 *
 * 说明：Playwright 控制的浏览器常被阿里云验证码 F001 拒绝；
 * 讨论接口走 xueqiu.com 主站也易触发 WAF，改用 api.xueqiu.com。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIN_FOLLOWERS = 4000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const LOCAL_CFG = path.join(ROOT, 'config/xueqiu.local.json');
const PROFILE_DIR = path.join(ROOT, '.xueqiu-browser-profile');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function toSymbol(code) {
  const c = String(code).padStart(6, '0');
  if (c.startsWith('6') || c.startsWith('9')) return `SH${c}`;
  return `SZ${c}`;
}

function stripHtml(html = '') {
  return String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function summarizeStance(text) {
  const t = text || '';
  if (/买入|加仓|看多|看好|低吸|布局|底仓|低估/.test(t)) return '偏多';
  if (/卖出|减仓|看空|清仓|止损|高估|风险大/.test(t)) return '偏空';
  if (/观望|等待|谨慎|震荡/.test(t)) return '中性/观望';
  return '中性';
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    throw new Error('未安装 playwright。请先执行：npm i playwright');
  }
}

function cookieHeaderFrom(cookies = []) {
  return cookies
    .filter((c) => c?.name && c.value != null)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

function hasXueqiuSession(cookies = []) {
  return cookies.some((c) => c.name === 'xq_a_token' && String(c.value || '').length > 8);
}

function cookieLooksValid(cookieStr = '') {
  return /(?:^|;\s*)xq_a_token=[^;\s]{8,}/.test(String(cookieStr));
}

export function loadSavedCookie() {
  try {
    if (!fs.existsSync(LOCAL_CFG)) return '';
    const cfg = JSON.parse(fs.readFileSync(LOCAL_CFG, 'utf8'));
    const cookie = String(cfg.cookie || '').trim();
    return cookieLooksValid(cookie) ? cookie : '';
  } catch {
    return '';
  }
}

function saveSessionCookie(cookieStr) {
  try {
    fs.mkdirSync(path.dirname(LOCAL_CFG), { recursive: true });
    let cfg = {};
    if (fs.existsSync(LOCAL_CFG)) {
      try {
        cfg = JSON.parse(fs.readFileSync(LOCAL_CFG, 'utf8'));
      } catch {
        cfg = {};
      }
    }
    delete cfg.username;
    delete cfg.password;
    cfg.cookie = cookieStr;
    cfg.updatedAt = new Date().toISOString();
    cfg._说明 = '由浏览器手动登录自动写入，勿再填账号密码';
    fs.writeFileSync(LOCAL_CFG, JSON.stringify(cfg, null, 2), 'utf8');
  } catch {
    /* ignore */
  }
}

function xueqiuHeaders(cookieStr, symbol) {
  return {
    Cookie: cookieStr,
    Accept: 'application/json, text/plain, */*',
    'User-Agent': UA,
    Referer: symbol ? `https://xueqiu.com/S/${symbol}` : 'https://xueqiu.com/',
    Origin: 'https://xueqiu.com',
  };
}

function isWafHtml(text = '') {
  return /aliyun_waf|访问验证|VerifyResult|_waf_|aliyun_waf_aa/.test(text);
}

function isAuthError(data) {
  if (!data || typeof data !== 'object') return false;
  const code = data.error_code ?? data.code;
  return code === 400016 || code === '400016' || /登录|login|auth/i.test(String(data.error_description || data.message || ''));
}

/**
 * 校验 cookie：能拉到当前用户即视为有效
 */
export async function probeXueqiuCookie(cookieStr) {
  if (!cookieLooksValid(cookieStr)) return { ok: false, reason: '缺少 xq_a_token' };
  try {
    const res = await fetch('https://api.xueqiu.com/user/show.json', {
      headers: xueqiuHeaders(cookieStr),
    });
    const text = await res.text();
    if (isWafHtml(text)) return { ok: false, reason: 'waf' };
    const data = JSON.parse(text);
    if (data?.id || data?.user_id) return { ok: true, userId: data.id || data.user_id };
    if (isAuthError(data)) return { ok: false, reason: 'auth' };
    return { ok: false, reason: data?.error_description || 'unknown' };
  } catch (err) {
    return { ok: false, reason: String(err.message || err) };
  }
}

/**
 * 打开浏览器，等待你手动登录雪球，返回 { browser, context, page, cookies, cookieStr, close }
 * 滑块若反复 F001：请关掉窗口，删除 .xueqiu-browser-profile 后改用扫码，或在日常 Chrome 登录后把 cookie 贴进 config。
 */
export async function openXueqiuLoginBrowser({ onProgress, timeoutMs = 5 * 60 * 1000 } = {}) {
  const { chromium } = await loadPlaywright();
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  let context;
  let browser = null;
  const launchErrors = [];

  for (const channel of ['chrome', 'msedge', undefined]) {
    try {
      context = await chromium.launchPersistentContext(PROFILE_DIR, {
        headless: false,
        channel,
        viewport: { width: 1280, height: 860 },
        locale: 'zh-CN',
        args: ['--disable-blink-features=AutomationControlled'],
      });
      break;
    } catch (err) {
      launchErrors.push(`${channel || 'chromium'}: ${err.message}`);
    }
  }

  if (!context) {
    try {
      browser = await chromium.launch({ headless: false, channel: 'chrome' });
    } catch {
      try {
        browser = await chromium.launch({ headless: false });
      } catch (err) {
        throw new Error(
          `无法启动浏览器（${launchErrors.join(' | ') || err.message}）。请确认已安装 Chrome/Edge，并执行 npm i playwright`
        );
      }
    }
    context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 860 } });
  }

  const page = context.pages()[0] || (await context.newPage());
  onProgress?.('正在打开雪球，请在浏览器中登录…');
  onProgress?.('若滑块一直「验证失败」：优先用 App 扫码；或关掉后删除 .xueqiu-browser-profile 再试');
  await page.goto('https://xueqiu.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });

  let cookies = await context.cookies('https://xueqiu.com');
  if (!hasXueqiuSession(cookies)) {
    onProgress?.('未检测到登录态：请完成登录（扫码优先，少用滑块）');
    onProgress?.('检测到 xq_a_token 后将自动继续（最长约 5 分钟）…');
    const start = Date.now();
    while (!hasXueqiuSession(cookies) && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 1500));
      cookies = await context.cookies('https://xueqiu.com');
    }
  }

  cookies = await context.cookies('https://xueqiu.com');
  if (!hasXueqiuSession(cookies)) {
    await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    throw new Error('未检测到雪球登录（缺少 xq_a_token）。请重新运行并完成浏览器登录');
  }

  const cookieStr = cookieHeaderFrom(cookies);
  saveSessionCookie(cookieStr);
  onProgress?.('雪球登录已确认，cookie 已写入 config/xueqiu.local.json');

  return {
    browser,
    context,
    page,
    cookies,
    cookieStr,
    async close() {
      try {
        await context.close();
      } catch {
        /* ignore */
      }
      if (browser) {
        try {
          await browser.close();
        } catch {
          /* ignore */
        }
      }
    },
  };
}

function normalizeOpinions(list, symbol, minFollowers) {
  const opinions = [];
  const seen = new Set();
  for (const post of list || []) {
    const user = post.user || post.author || {};
    const followers = Number(user.followers_count ?? user.followersCount ?? 0);
    if (followers < minFollowers) continue;
    const id = String(post.id || post.status_id || `${user.id}-${post.created_at}`);
    if (seen.has(id)) continue;
    seen.add(id);
    const text = stripHtml(post.text || post.description || post.title || '');
    if (!text || text.length < 8) continue;
    opinions.push({
      user: user.screen_name || user.name || '雪球用户',
      followers,
      stance: summarizeStance(text),
      summary: text.slice(0, 120),
      likeCount: post.like_count || post.fav_count || 0,
      replyCount: post.reply_count || 0,
      time: post.created_at
        ? new Date(post.created_at).toISOString().slice(0, 16).replace('T', ' ')
        : '',
      url: post.target
        ? `https://xueqiu.com${post.target}`
        : user.id && post.id
          ? `https://xueqiu.com/${user.id}/${post.id}`
          : `https://xueqiu.com/S/${symbol}`,
    });
  }
  opinions.sort((a, b) => b.followers - a.followers || b.likeCount - a.likeCount);
  return opinions.slice(0, 5);
}

/**
 * 用 cookie 直连 api.xueqiu.com 拉讨论（不走浏览器，避开滑块/WAF）
 */
export async function fetchOpinionsByCookie(
  cookieStr,
  code,
  { pages = 1, pageSize = 30, minFollowers = MIN_FOLLOWERS } = {}
) {
  const symbol = toSymbol(code);
  const out = [];

  for (let pageNo = 1; pageNo <= pages; pageNo++) {
    const url =
      `https://api.xueqiu.com/query/v1/symbol/search/status?count=${pageSize}&comment=0&symbol=${symbol}` +
      `&hl=0&source=all&sort=time&page=${pageNo}&q_type=&type=11`;
    let text;
    try {
      const res = await fetch(url, { headers: xueqiuHeaders(cookieStr, symbol) });
      text = await res.text();
    } catch (err) {
      return { ok: false, reason: String(err.message || err), opinions: [] };
    }

    if (isWafHtml(text) || text.trim().startsWith('<')) {
      return { ok: false, reason: 'waf', opinions: [] };
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, reason: 'bad_json', opinions: [] };
    }

    if (isAuthError(data)) {
      return { ok: false, reason: 'auth', opinions: [] };
    }
    if (data?.error_code && data.error_code !== 0) {
      return {
        ok: false,
        reason: data.error_description || String(data.error_code),
        opinions: [],
      };
    }

    const list = data?.list || data?.statuses || [];
    out.push(...list);
    if (!list.length) break;
  }

  const opinions = normalizeOpinions(out, symbol, minFollowers);
  return {
    ok: true,
    reason: opinions.length ? '' : '近期暂无粉丝≥4000的相关讨论',
    opinions,
  };
}

async function ensureCookie({ onProgress, forceLogin = false } = {}) {
  if (!forceLogin) {
    const saved = loadSavedCookie();
    if (saved) {
      onProgress?.('检测到本地雪球 cookie，正在校验…');
      const probe = await probeXueqiuCookie(saved);
      if (probe.ok) {
        onProgress?.('cookie 有效，跳过浏览器登录（直连 api.xueqiu.com）');
        return saved;
      }
      onProgress?.(`本地 cookie 不可用（${probe.reason}），将打开浏览器重新登录…`);
    }
  }

  const session = await openXueqiuLoginBrowser({ onProgress });
  const cookieStr = session.cookieStr;
  await session.close();
  return cookieStr;
}

/** 单票：cookie 直连 */
export async function fetchXueqiuBigVOpinions(code, opts = {}) {
  const cookieStr = await ensureCookie({ onProgress: opts.onProgress });
  return fetchOpinionsByCookie(cookieStr, code, opts);
}

/**
 * 批量为卡片附加雪球观点：优先 cookie HTTP，不再依赖 Playwright 页面抓取
 */
export async function attachXueqiuOpinions(cards, { onProgress, concurrencyGap = 400 } = {}) {
  if (!cards?.length) return cards;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let cookieStr;
  try {
    cookieStr = await ensureCookie({ onProgress });
  } catch (err) {
    const reason = err.message || '雪球登录失败';
    onProgress?.(reason);
    for (const c of cards) {
      c.xueqiu = { ok: false, reason, opinions: [] };
    }
    return cards;
  }

  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    onProgress?.(`雪球大V ${i + 1}/${cards.length} ${c.code} ${c.name || ''}`);
    try {
      let result = await fetchOpinionsByCookie(cookieStr, c.code, {
        pages: 1,
        pageSize: 30,
      });
      if (!result.ok && (result.reason === 'auth' || result.reason === 'waf')) {
        onProgress?.(`雪球接口异常（${result.reason}），尝试重新登录…`);
        cookieStr = await ensureCookie({ onProgress, forceLogin: true });
        result = await fetchOpinionsByCookie(cookieStr, c.code, { pages: 1, pageSize: 30 });
      }
      if (!result.ok) {
        c.xueqiu = {
          ok: false,
          reason: `雪球抓取失败：${result.reason}（可 npm run xueqiu:login 后重试）`,
          opinions: [],
        };
      } else {
        c.xueqiu = result;
      }
    } catch (err) {
      c.xueqiu = {
        ok: false,
        reason: `抓取异常：${err.message || err}`,
        opinions: [],
      };
    }
    await sleep(concurrencyGap);
  }

  return cards;
}
