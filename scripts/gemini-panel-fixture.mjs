/** Offline Windows UI Automation fixture. All browser requests are fulfilled locally. */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browsers = [];
const pages = [];
const input = createInterface({ input: stdin, output: stdout });

function windows(fiveHour, weekly) {
  return `<p>Five Hour Limit Remaining <span>${fiveHour}%</span></p>
    <p>Weekly Limit Remaining <span>${weekly}%</span></p>`;
}

async function openPanel(index, host, product, content) {
  const browser = await chromium.launch({ channel: "msedge", headless: false,
    args: ["--force-renderer-accessibility", "--disable-background-networking"] });
  browsers.push(browser);
  const context = await browser.newContext({ serviceWorkers: "block" });
  // Do not access accounts, login pages or remote resources.
  await context.route("**/*", route => route.fulfill({
    contentType: "text/html; charset=utf-8",
    body: `<!doctype html><title>${product} · offline fixture</title><main>${content}</main>`,
  }));
  const page = await context.newPage();
  await page.goto(`https://${host}/app`);
  pages[index] = page;
}

const web = inner => `<section role="dialog" aria-label="Usage Limits"><h2>Usage Limits</h2>${inner}</section>`;
const ag = (gemini, partner) => `<section role="dialog" aria-label="View Usage"><h2>View Usage</h2>
  <section><h3>Gemini Models</h3>${gemini}</section>
  <section><h3>Claude and GPT models</h3>${partner}</section></section>`;
try {
  await openPanel(0, "gemini.google.com", "Gemini", web(windows(72, 95)));
  await openPanel(1, "antigravity.google.com", "Antigravity", ag(windows(76, 46), windows(12, 30)));
  stdout.write("Expected 72 / 46 / 12. Choose mixed, close-web, chat, duplicate-ag, close-extra or quit.\n");
  for await (const line of input) {
    const command = line.trim();
    if (command === "quit") break;
    if (command === "mixed" && !pages[0].isClosed()) {
      await pages[0].locator("main").evaluate((el, html) => { el.innerHTML = html; }, web(windows(0, 28)));
      await pages[1].locator("main").evaluate((el, html) => { el.innerHTML = html; },
        ag(windows(100, 100), "<p>Weekly limit 40%</p>"));
      stdout.write("Expected 0 / 100 / unknown.\n");
    } else if (command === "close-web" && !pages[0].isClosed()) {
      await pages[0].close();
      stdout.write("The Web pool now has only its last observation.\n");
    } else if (command === "chat") {
      await pages[1].locator("main").evaluate((el, html) => { el.innerHTML = html; },
        "<article><h3>Gemini Models</h3>" + windows(8, 4) + "</article>");
      stdout.write("Model headings outside a usage panel do not supply quota.\n");
    } else if (command === "duplicate-ag" && (!pages[2] || pages[2].isClosed())) {
      await openPanel(2, "antigravity.google.com", "Antigravity", ag(windows(64, 80), windows(80, 90)));
      stdout.write("Two visible Antigravity quota panels make both AG pools ambiguous.\n");
    } else if (command === "close-extra" && pages[2] && !pages[2].isClosed()) {
      await pages[2].close();
    }
  }
} finally {
  input.close();
  await Promise.all(browsers.map(browser => browser.close()));
}
