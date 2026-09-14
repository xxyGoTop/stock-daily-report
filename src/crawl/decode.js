/**
 * 按响应头解码中文文本
 *
 * 腾讯行情（qt.gtimg.cn）声明 charset=GBK，fetch().text() 却一律当 UTF-8，
 * *ST美芝 的 GBK 字节 C3C0 D6A5 会被解成乱码。东财 JSON 是 UTF-8，走默认分支即可。
 */

export function decodeBuffer(buf, contentType = '') {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const charset = String(contentType).toLowerCase().match(/charset=([\w-]+)/)?.[1] || '';
  const label = charset === 'gb2312' ? 'gbk' : charset;

  if (label && !/^utf-?8$/i.test(label)) {
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      /* 不认识的 charset，继续用 utf-8 / gbk 兜底 */
    }
  }

  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (utf8.includes('\uFFFD')) {
    try {
      return new TextDecoder('gbk').decode(bytes);
    } catch {
      return utf8;
    }
  }
  return utf8;
}

export async function readResponseText(res) {
  const buf = await res.arrayBuffer();
  const ct = res.headers.get('content-type') || '';
  const url = res.url || '';
  // 腾讯/新浪经常漏写 charset，但正文是 GBK
  if (!/charset=/i.test(ct) && /gtimg\.cn|sinajs\.cn|finance\.sina\.com/.test(url)) {
    return decodeBuffer(buf, 'text/plain; charset=gbk');
  }
  return decodeBuffer(buf, ct);
}

/** 去掉名称里的空格 / 全角空格，避免 *ST 美芝 和 *ST美芝 对不上 */
export function cleanStockName(name = '') {
  return String(name ?? '')
    .replace(/\u3000/g, '')
    .replace(/\s+/g, '')
    .trim();
}
