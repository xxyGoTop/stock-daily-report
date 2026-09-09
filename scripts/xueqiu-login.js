/**
 * 仅打开雪球浏览器登录并保存会话（不跑全市场筛选）
 *   npm run xueqiu:login
 *
 * 若弹窗里滑块一直「验证失败 / F001」：
 *   1) 关掉窗口，删除项目下 .xueqiu-browser-profile 后再跑本命令，优先扫码
 *   2) 或日常 Chrome 登录雪球后，把 Cookie 贴进 config/xueqiu.local.json
 * 登录成功后，日报会用 cookie 直连 api.xueqiu.com，不再依赖浏览器过滑块。
 */
import { openXueqiuLoginBrowser } from '../src/crawl/xueqiu.js';

const session = await openXueqiuLoginBrowser({
  onProgress: (m) => console.log(' ·', m),
});
console.log('登录会话已保存到 config/xueqiu.local.json');
await session.close();
console.log('可直接 npm start；有效 cookie 将跳过浏览器、直连抓取大V观点');
