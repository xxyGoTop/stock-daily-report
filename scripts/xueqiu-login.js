/**
 * 仅打开雪球浏览器登录并保存会话（不跑全市场筛选）
 *   npm run xueqiu:login
 */
import { openXueqiuLoginBrowser } from '../src/crawl/xueqiu.js';

const session = await openXueqiuLoginBrowser({
  onProgress: (m) => console.log(' ·', m),
});
console.log('登录会话已保存到 config/xueqiu.local.json');
await session.close();
console.log('可直接 npm start，若资料目录仍有效将自动复用登录态');
