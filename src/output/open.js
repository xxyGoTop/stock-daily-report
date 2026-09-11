/**
 * 在默认浏览器里打开生成的报告
 */

import { exec } from 'node:child_process';

export function openInBrowser(filePath) {
  if (process.platform === 'darwin') exec(`open "${filePath}"`);
  else if (process.platform === 'win32') exec(`cmd /c start "" "${filePath}"`);
  else exec(`xdg-open "${filePath}"`);
}
