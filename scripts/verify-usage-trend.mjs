// Windows smoke test: built executable + anonymous on-disk ledger + real HTTP page.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createUsageFixture, repo } from "./usage-ui-fixture.mjs";
import { addDays } from "../src-tauri/usage-page/usage-core.js";

const [executable, playwrightPath, chrome, outputArg] = process.argv.slice(2);
assert.ok(outputArg, "Usage: node scripts/verify-usage-trend.mjs <exe> <playwright/index.mjs> <chrome.exe> <output>");
const output = path.resolve(outputArg);
await mkdir(output, { recursive: true });
const fixture = await createUsageFixture({ continuous: !process.argv.includes("--gaps") });
const app = spawn(path.resolve(executable), [], { env: fixture.env, cwd: repo, windowsHide: true, stdio: "ignore" });
let browser;
const errors = [];
const report = { status: "Blocked", fixtureRoot: fixture.root, executable: path.resolve(executable), checks: [], errors };
const delay = ms => new Promise(r => setTimeout(r, ms));
try {
  let base;
  for (let i = 0; i < 40 && !base; i++) {
    await delay(500);
    const ports = execFileSync("pwsh", ["-NoProfile", "-Command", `Get-NetTCPConnection -State Listen -OwningProcess ${app.pid} -ErrorAction SilentlyContinue | Where-Object LocalAddress -eq '127.0.0.1' | Select-Object -ExpandProperty LocalPort`], { encoding: "utf8", windowsHide: true }).trim().split(/\s+/).filter(Boolean);
    if (ports.length === 1) base = `http://127.0.0.1:${ports[0]}/`;
  }
  assert.ok(base, "Own native HTTP listener starts");
  report.url = base;
  let snapshot;
  for (let i = 0; i < 60; i++) {
    snapshot = await (await fetch(base + "api/usage")).json();
    if (snapshot.codex.state === "ready" && snapshot.zcode.state === "ready") break;
    await delay(500);
  }
  assert.deepEqual(snapshot.codex.daily, fixture.expected.daily.codex);
  assert.deepEqual(snapshot.zcode.daily, fixture.expected.daily.zcode);
  report.checks.push("native source ingestion matches anonymous fixture exactly");
  const { chromium } = await import(pathToFileURL(path.resolve(playwrightPath)).href);
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  report.browser = browser.version();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, timezoneId: "Asia/Shanghai" });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base);
  await page.locator(".trend-chart").waitFor();
  const section = page.locator(".trend-section");
  await page.locator("#scope-all").click();
  const lastCompleteDay = addDays(fixture.expected.today, -1);
  assert.ok(await page.locator(`[data-trend-line="ZCode"][data-trend-kind="daily"][data-end-day="${lastCompleteDay}"]`).count() > 0,
    "all-devices ZCode daily line reaches yesterday even without an average");
  if (process.argv.includes("--gaps")) {
    assert.equal(await page.locator(`[data-trend-line="ZCode"][data-trend-kind="average"][data-end-day="${lastCompleteDay}"]`).count(), 0);
    report.checks.push("all-devices: recent ZCode actuals remain visible when complete average window is missing");
  }
  await section.scrollIntoViewIfNeeded();
  assert.ok(await page.locator('[data-trend-kind="daily"]').count() >= 2, "daily actual lines render for both sources");
  assert.equal(await page.locator('[data-trend-point="today"]').count(), 2, "today cumulative remains visible for both sources");
  assert.equal(await page.locator('[data-trend-point="daily"]').count(), 0, "continuous daily series does not add a scatter wall");
  const idlePlot = await page.locator(".trend-chart svg").boundingBox();
  const cardBounds = await page.locator(".trend-chart").boundingBox();
  assert.ok(idlePlot.y - cardBounds.y < 130, "compact header: no large empty readout slab");
  await section.screenshot({ path: path.join(output, "desktop-success.png") });
  const chart = page.locator(".trend-chart");
  await chart.focus();
  await chart.press("ArrowLeft");
  assert.match(await page.locator(".trend-tooltip").innerText(), /当日实际.*7日平均/s);
  const plotY = await page.locator(".trend-chart svg").boundingBox();
  assert.ok(Math.abs(plotY.y - idlePlot.y) < 1, "readout must not move the plot on desktop");
  const tipY = await page.locator(".trend-tooltip").boundingBox();
  assert.ok(tipY.y + tipY.height <= plotY.y, "desktop readings outside plot");
  report.checks.push("daily actual lines plus today markers; no scatter wall; compact stable header");
  await section.screenshot({ path: path.join(output, "desktop-operation.png") });
  await chart.press("Escape");
  assert.ok(await page.locator(".trend-tooltip").isHidden());
  await page.locator('[data-range="7d"]').click();
  assert.match(await page.locator(".trend-head").first().evaluate(node => getComputedStyle(node, "::after").content), /3日平均/);
  await page.locator('[data-view="split"]').click();
  assert.equal(await page.locator(".trend-chart").count(), 2);
  report.checks.push("7/30 day windows, same-axis/split, keyboard readings and Escape");
  await page.locator('[data-view="merged"]').click();
  await page.locator('[data-range="30d"]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await section.scrollIntoViewIfNeeded();
  await chart.focus();
  await chart.press("ArrowLeft");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "390px no horizontal overflow");
  const mobilePlot = await page.locator(".trend-chart svg").boundingBox();
  const mobileTip = await page.locator(".trend-tooltip").boundingBox();
  assert.ok(mobileTip.y >= mobilePlot.y + mobilePlot.height, "mobile readings below plot");
  await section.screenshot({ path: path.join(output, "narrow-operation.png") });
  report.checks.push("390px: no overflow, exact readings below chart");
  await page.setViewportSize({ width: 1440, height: 1080 });
  const linesBefore = await page.locator("[data-trend-line]").evaluateAll(nodes => nodes.map(n => n.getAttribute("d")));
  await page.route("**/api/usage", route => route.abort());
  await page.locator("#refresh-btn").click();
  await page.locator('.trend-status[data-state="failed"]').waitFor();
  assert.match(await section.innerText(), /QDU-708/);
  assert.deepEqual(await page.locator("[data-trend-line]").evaluateAll(nodes => nodes.map(n => n.getAttribute("d"))), linesBefore);
  await section.screenshot({ path: path.join(output, "desktop-failure.png") });
  await page.unroute("**/api/usage");
  await page.locator(".trend-status button").click();
  await page.locator('.trend-status[data-state="failed"]').waitFor({ state: "detached" });
  report.checks.push("real network failure retains curve; QDU-708; retry recovers");
  assert.deepEqual(errors, []);
  report.status = "Verified";
} finally {
  await browser?.close();
  app.kill();
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
}
