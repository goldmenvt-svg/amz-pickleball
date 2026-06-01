import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const filePath = path.join(__dirname, 'index.html');
const fileUrl = `file:///${filePath.replace(/\/g, '/')}`;

const browser = await chromium.launch();
const page = await browser.newPage();

// Desktop viewport
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(fileUrl, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(__dirname, 'screenshot-desktop.png'), fullPage: false });

// Hero full view
await page.screenshot({ path: path.join(__dirname, 'screenshot-hero.png'), fullPage: false, clip: { x: 0, y: 0, width: 1440, height: 900 } });

// Scroll and capture full page
await page.screenshot({ path: path.join(__dirname, 'screenshot-full.png'), fullPage: true });

// Mobile viewport
await page.setViewportSize({ width: 375, height: 812 });
await page.goto(fileUrl, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.screenshot({ path: path.join(__dirname, 'screenshot-mobile.png'), fullPage: false });

await browser.close();
console.log('Screenshots saved.');
