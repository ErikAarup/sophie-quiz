// Render the eight reference artboards (design/reference/*.dc.html) to PNG and compose them side by
// side with the built screens captured by `npm run proof` (proof/screens/*.png).
//   node scripts/proof-artboards.mjs
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outArt = resolve(root, 'proof', 'artboards');
const outPairs = resolve(root, 'proof', 'pairs');
mkdirSync(outArt, { recursive: true });
mkdirSync(outPairs, { recursive: true });

const SCREENS = [
  ['1-main', 'Main', 'Välj lag'],
  ['2-lobby', 'Lobby', 'Väntar'],
  ['3-question', 'Question', 'Fråga + timer'],
  ['4-locked', 'Locked', 'Tiden är ute'],
  ['5-reveal', 'Reveal', 'Avslöjande'],
  ['6-leaderboard', 'Leaderboard', 'Ställning'],
  ['7-admin', 'Admin', 'Admin: fråga öppen'],
  ['8-admin-reveal', 'AdminReveal', 'Admin: avslöjande'],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
for (const [name, file] of SCREENS) {
  await page.goto(pathToFileURL(resolve(root, 'design', 'reference', `${file}.dc.html`)).href);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.locator('.phone').screenshot({ path: resolve(outArt, `${name}.png`) });
  console.log(`artboard ${file} -> proof/artboards/${name}.png`);
}

// Side-by-side pairs and one overview.
const dataUri = (p) => (existsSync(p) ? `data:image/png;base64,${readFileSync(p).toString('base64')}` : null);
const pair = (name, file, title) => {
  const a = dataUri(resolve(outArt, `${name}.png`));
  const b = dataUri(resolve(root, 'proof', 'screens', `${name}.png`));
  return `<figure><figcaption>${title} — <span>artboard ${file}.dc.html</span> vs <span>as built</span></figcaption>
    <div class="pair">${a ? `<img src="${a}">` : '<div class="missing">artboard missing</div>'}${b ? `<img src="${b}">` : '<div class="missing">screen missing (run npm run proof)</div>'}</div></figure>`;
};
const css = `body{margin:0;background:#0a0b10;color:#f2f3f7;font-family:'IBM Plex Sans','Segoe UI',Arial,sans-serif;padding:24px}
figure{margin:0 0 28px}figcaption{font-size:14px;margin-bottom:8px;color:#c9cddb}figcaption span{color:#d8ff3d}
.pair{display:flex;gap:16px}.pair img{width:390px;height:844px;border:1px solid #2a2f44;border-radius:12px}
.missing{width:390px;height:844px;display:flex;align-items:center;justify-content:center;border:1px dashed #4a1f30;color:#ff6b8a}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px 40px}h1{font-family:'Bebas Neue','Arial Narrow',Impact,sans-serif;font-weight:400;font-size:40px;margin:0 0 16px}`;
for (const [name, file, title] of SCREENS) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${pair(name, file, title)}</body></html>`;
  const tmp = resolve(outPairs, `${name}.html`);
  writeFileSync(tmp, html);
  await page.goto(pathToFileURL(tmp).href);
  await page.locator('figure').screenshot({ path: resolve(outPairs, `${name}.png`) });
}
const overview = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><h1>Sophies topp tio — artboard vs as built</h1><div class="grid">${SCREENS.map(([n, f, t]) => pair(n, f, t)).join('')}</div></body></html>`;
const overviewPath = resolve(outPairs, 'overview.html');
writeFileSync(overviewPath, overview);
await page.setViewportSize({ width: 1700, height: 1000 });
await page.goto(pathToFileURL(overviewPath).href);
await page.screenshot({ path: resolve(root, 'proof', 'side-by-side.png'), fullPage: true });
console.log('proof/side-by-side.png written');
await browser.close();
