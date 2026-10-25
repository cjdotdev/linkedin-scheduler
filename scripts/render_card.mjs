// node scripts/render_card.mjs <card.html> <out.png> [chrome path]   Renders a filled card at exactly 1080x1350.
import { chromium } from "playwright-core";
import { pathToFileURL } from "node:url";

const [html, out, chrome] = process.argv.slice(2);
// A configured Chrome/Chromium path, or the installed Google Chrome found by Playwright.
const browser = await chromium.launch(chrome ? { executablePath: chrome } : { channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
await page.goto(pathToFileURL(html).href, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
// The content must fit its area: fail rather than publish a card with clipped text.
const overflow = await page.evaluate(() => {
  const c = document.querySelector(".content");
  return c.scrollHeight > c.clientHeight + 1;
});
await page.screenshot({ path: out });
await browser.close();
if (overflow) {
  console.error("too much content: the card overflows its area, shorten the title, the text or the code");
  process.exit(2);
}
