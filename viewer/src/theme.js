/** ダーク/ライトテーマ切替。CSS変数とThree.js背景色を同期する */
import { setSceneBackground } from './viewer.js';

const COLORS = { dark: 0x111118, light: 0xf2f3f5 };
let current = 'dark';

export function getTheme() { return current; }

export function setTheme(mode) {
  current = mode === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = current;
  setSceneBackground(COLORS[current]);
}

export function toggleTheme() { setTheme(current === 'dark' ? 'light' : 'dark'); }
