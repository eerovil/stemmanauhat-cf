// Draws the home-screen icons from public/icon.svg with Playwright's Chromium:
//
//   ./scripts/run.sh node scripts/make-pwa-icons.mjs
//
// The PNGs are committed (public/icon-*.png, public/apple-touch-icon.png).
// Run this again after changing icon.svg.
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const svg = await readFile(new URL("../public/icon.svg", import.meta.url), "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["icon-maskable-512.png", 512],
  ["apple-touch-icon.png", 180],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: new URL(`../public/${name}`, import.meta.url).pathname, omitBackground: true });
  console.log(name);
}
await browser.close();
