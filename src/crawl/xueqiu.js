/**
 * 雪球大V观点（粉丝≥4000）
 *
 * 登录方式（仅此一种）：
 *   弹出本机 Chrome/Edge → 你在浏览器里手动登录 → 检测到会话后直接抓取
 * 已移除：本地账号密码、匿名弱 cookie 尝试
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIN_FOLLOWERS = 4000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const LOCAL_CFG = path.join(ROOT, 'config/xueqiu.local.json');
const PROFILE_DIR = path.join(ROOT, '.xueqiu-browser-profile');

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

/**
 * 打开浏览器，等待你手动登录雪球，返回 { browser, context, page, cookies, close }
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
  await page.goto('https://xueqiu.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });

  let cookies = await context.cookies('https://xueqiu.com');
  if (!hasXueqiuSession(cookies)) {
    onProgress?.('未检测到登录态：请在弹出的浏览器完成登录（扫码/验证码均可）');
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
  onProgress?.('雪球登录已确认，开始抓取大V观点…');

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

async function fetchOpinionsInPage(page, code, { pages = 1, pageSize = 30, minFollowers = MIN_FOLLOWERS } = {}) {
  const symbol = toSymbol(code);
  const raw = await page.evaluate(
    async ({ symbol, pages, pageSize }) => {
      const out = [];
      for (let pageNo = 1; pageNo <= pages; pageNo++) {
        const url =
          `/query/v1/symbol/search/status?count=${pageSize}&comment=0&symbol=${symbol}` +
          `&hl=0&source=all&sort=time&page=${pageNo}&q_type=&type=11`;
        let data = null;
        try {
          const res = await fetch(url, {
            credentials: 'include',
            headers: { Accept: 'application/json, text/plain, */*' },
          });
          const text = await res.text();
          if (text.trim().startsWith('<')) {
            return { ok: false, reason: 'waf_html', list: out };
          }
          data = JSON.parse(text);
        } catch (e) {
          try {
            const alt =
              `/statuses/search.json?symbol=${symbol}&count=${pageSize}&page=${pageNo}` +
              `&comment=0&hl=0&source=all&sort=time`;
            const res = await fetch(alt, {
              credentials: 'include',
              headers: { Accept: 'application/json, text/plain, */*' },
            });
            data = await res.json();
          } catch {
            return { ok: false, reason: String(e?.message || e), list: out };
          }
        }
        if (data?.error_code || data?.code === 400016) {
          return {
            ok: false,
            reason: data?.error_description || data?.message || 'auth',
            list: out,
          };
        }
        const list = data?.list || data?.statuses || [];
        out.push(...list);
        if (!list.length) break;
      }
      return { ok: true, reason: '', list: out };
    },
    { symbol, pages, pageSize }
  );

  if (!raw?.ok) {
    return {
      ok: false,
      reason: `雪球抓取失败：${raw?.reason || 'unknown'}（可重新登录后再试）`,
      opinions: [],
    };
  }

  const opinions = [];
  const seen = new Set();
  for (const post of raw.list || []) {
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
  return {
    ok: true,
    reason: opinions.length ? '' : '近期暂无粉丝≥4000的相关讨论',
    opinions: opinions.slice(0, 5),
  };
}

/** 单票：临时开浏览器抓一只 */
export async function fetchXueqiuBigVOpinions(code, opts = {}) {
  const session = await openXueqiuLoginBrowser({ onProgress: opts.onProgress });
  try {
    return await fetchOpinionsInPage(session.page, code, opts);
  } finally {
    await session.close();
  }
}

/**
 * 批量为卡片附加雪球观点：一次登录，浏览器内直接爬
 */
export async function attachXueqiuOpinions(cards, { onProgress, concurrencyGap = 400 } = {}) {
  if (!cards?.length) return cards;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let session;
  try {
    session = await openXueqiuLoginBrowser({ onProgress });
  } catch (err) {
    const reason = err.message || '雪球浏览器登录失败';
    onProgress?.(reason);
    for (const c of cards) {
      c.xueqiu = { ok: false, reason, opinions: [] };
    }
    return cards;
  }

  try {
    if (!/xueqiu\.com/.test(session.page.url())) {
      await session.page.goto('https://xueqiu.com/', { waitUntil: 'domcontentloaded' });
    }

    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      onProgress?.(`雪球大V ${i + 1}/${cards.length} ${c.code} ${c.name || ''}`);
      try {
        c.xueqiu = await fetchOpinionsInPage(session.page, c.code, {
          pages: 1,
          pageSize: 30,
        });
      } catch (err) {
        c.xueqiu = {
          ok: false,
          reason: `抓取异常：${err.message || err}`,
          opinions: [],
        };
      }
      await sleep(concurrencyGap);
    }
  } finally {
    await session.close();
  }

  return cards;
}
