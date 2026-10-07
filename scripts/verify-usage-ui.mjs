// Usage-page QA against a real, freshly built Tauri executable. No preview/fake HTTP server.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdir, open, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createUsageFixture, repo } from "./usage-ui-fixture.mjs";
import { addDays, formatDayTitle, formatTokens, monthGroupsFor, monthTitle,
  periodHeatColumns, sumRange } from "../src-tauri/usage-page/usage-core.js";

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  assert.ok(args[index + 1] && !args[index + 1].startsWith("--"), `${name} requires a value`);
  return args[index + 1];
}
if (args.includes("--help")) {
  console.log("node scripts/verify-usage-ui.mjs [--app /absolute/app/Contents/MacOS/codex-credits-view] [--output /absolute/output] [--keep-app] [--chrome /absolute/chrome] [--playwright /absolute/index.mjs]");
  process.exit(0);
}
const executable = path.resolve(option("--app", path.join(repo, "src-tauri/target/release/bundle/macos/QuoDex.app/Contents/MacOS/codex-credits-view")));
const output = path.resolve(option("--output", path.join(repo, "docs/verification/usage-liquid-glass")));
const playwrightFile = option("--playwright", "/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs");
const chrome = option("--chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
const keepApp = args.includes("--keep-app");
const execFileAsync = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [];
const errors = [];
let app, browser, appLog, fixture, base;
let fatal;
let latestPageSnapshot;
const report = { status: "Not built", timestamp: new Date().toISOString(), nodeVersion: process.version,
  executable, output, checks: results, browserErrors: errors,
  viewports: { desktop: { width: 1440, height: 1080 }, mobile: { width: 390, height: 844 } } };

async function until(fn, label, timeout = 30000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
    if (app && (app.exitCode !== null || app.signalCode !== null)) throw new Error(`QA app exited (${app.exitCode ?? app.signalCode}) while ${label}`);
    await delay(150);
  }
  throw new Error(`Timeout: ${label}${last ? `; ${last.message}` : ""}`);
}
async function check(name, fn) {
  try { await fn(); results.push({ name, status: "Verified" }); }
  catch (error) { results.push({ name, status: "Blocked", reason: error.message }); throw error; }
}
async function getSnapshot() {
  const response = await fetch(new URL("api/usage", base), { signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 200);
  return response.json();
}
function assertSnapshot(snapshot) {
  for (const source of ["codex", "zcode"]) {
    assert.equal(snapshot[source].state, "ready", `${source} ready`);
    assert.deepEqual(snapshot[source].daily, fixture.expected.daily[source], `${source} exact daily totals`);
    assert.equal(snapshot[source].requestCount, fixture.expected.requestCount, `${source} replay-safe request count`);
    assert.equal(snapshot[source].collectionStartDay, fixture.expected.today, `${source} fresh collection origin`);
    assert.equal(snapshot[source].earliestDay, fixture.expected.earliest);
    assert.equal(snapshot[source].diagnostic, undefined, `${source} no diagnostic`);
  }
}
async function choose(page, range, view) {
  if (range) await page.locator(`[data-range="${range}"]`).click();
  if (view) await page.locator(`[data-view="${view}"]`).click();
  await page.waitForFunction(({ range, view }) =>
    (!range || document.querySelector(`[data-range="${range}"]`)?.dataset.selected === "true")
    && (!view || document.querySelector(`[data-view="${view}"]`)?.dataset.selected === "true"), { range, view });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function expectTotals(page, range) {
  const expected = fixture.expected.ranges[range];
  assert.equal((await page.locator("#totals-number").innerText()).trim(), formatTokens(expected.merged));
  assert.deepEqual(await page.locator(".source-figure-value").allTextContents(),
    [formatTokens(expected.codex), formatTokens(expected.zcode)]);
}
async function expectDay(page, day) {
  assert.equal(await page.locator("#day-detail .day-detail-title").innerText(), formatDayTitle(day));
  const expected = (fixture.expected.daily.codex[day] ?? 0) + (fixture.expected.daily.zcode[day] ?? 0);
  assert.equal(await page.locator("#day-detail .day-detail-total strong").innerText(), formatTokens(expected));
  const amounts = await page.locator("#day-detail > .day-detail-sources:not(.day-detail-period-totals) .value").allTextContents();
  assert.deepEqual(amounts, [formatTokens(fixture.expected.daily.codex[day]), formatTokens(fixture.expected.daily.zcode[day])]);
}
function monthSelectionDay() {
  const yesterday = addDays(fixture.expected.today, -1);
  return yesterday.slice(0, 7) === fixture.expected.today.slice(0, 7) ? yesterday : fixture.expected.today;
}
async function leaveHeat(page) {
  await page.evaluate(() => document.activeElement?.blur());
  await page.locator("h1").hover();
  await page.waitForFunction(() => !document.querySelector("#day-detail").dataset.previewKind);
}
async function assertNoOverflow(page) {
  const widths = await page.evaluate(() => ({ viewport: innerWidth,
    html: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(widths.html <= widths.viewport + 1 && widths.body <= widths.viewport + 1, `No body overflow: ${JSON.stringify(widths)}`);
}
async function expectWeekHighlight(page, target) {
  const column = await target.getAttribute("data-column");
  const highlight = page.locator(".heat-week-highlight");
  assert.equal(await highlight.getAttribute("data-column"), column);
  assert.equal(await highlight.isVisible(), true);
  const [cellBox, columnBox, highlightBox] = await Promise.all([
    target.boundingBox(), page.locator(".heat-columns").boundingBox(), highlight.boundingBox(),
  ]);
  assert.ok(cellBox && columnBox && highlightBox, "Heat highlight geometry is visible");
  assert.ok(highlightBox.x <= cellBox.x + 1 && highlightBox.x + highlightBox.width >= cellBox.x + cellBox.width - 1,
    "Week highlight covers the hovered cell's column");
  assert.ok(highlightBox.y <= columnBox.y + 1 && highlightBox.y + highlightBox.height >= columnBox.y + columnBox.height - 1,
    "Week highlight spans all seven heat rows");
}

try {
  await access(executable); await access(playwrightFile); await access(chrome);
  await mkdir(output, { recursive: true });
  fixture = await createUsageFixture();
  Object.assign(report, { fixtureRoot: fixture.root, today: fixture.expected.today, timezone: fixture.expected.timezone,
    expectedRanges: fixture.expected.ranges, gaps: fixture.expected.gaps });
  await writeFile(path.join(output, "fixture-expected.json"), `${JSON.stringify(fixture.expected, null, 2)}\n`);
  appLog = await open(path.join(output, "native-app.log"), "w");
  app = spawn(executable, [], { cwd: repo, env: fixture.env, stdio: ["ignore", appLog.fd, appLog.fd] });
  await new Promise((resolve, reject) => { app.once("spawn", resolve); app.once("error", reject); });
  report.appPid = app.pid;
  // Only inspect sockets belonging to the process spawned above; never probe another app's port.
  base = await until(async () => {
    const { stdout } = await execFileAsync("/usr/sbin/lsof", ["-nP", "-a", "-p", String(app.pid), "-iTCP", "-sTCP:LISTEN"]);
    const ports = [...new Set([...stdout.matchAll(/127\.0\.0\.1:(\d+)\s+\(LISTEN\)/g)].map(match => match[1]))];
    assert.equal(ports.length, 1, "Exactly one QA app loopback HTTP listener");
    return `http://127.0.0.1:${ports[0]}/`;
  }, "find own Tauri usage listener");
  report.url = base;
  await check("real Tauri API ready and anonymous exact daily totals", async () => {
    await until(async () => { const snapshot = await getSnapshot(); assertSnapshot(snapshot); return snapshot; }, "both sources ready with fixture daily totals");
  });
  const { chromium } = await import(pathToFileURL(playwrightFile).href);
  browser = await chromium.launch({ headless: true, executablePath: chrome });
  report.browserVersion = await browser.version();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1,
    timezoneId: fixture.expected.timezone });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const listen = target => {
    target.on("pageerror", error => errors.push({ kind: "pageerror", message: error.message }));
    target.on("console", message => { if (message.type() === "error") errors.push({ kind: "console", message: message.text() }); });
    target.on("response", response => {
      if (response.url().startsWith(base) && response.status() >= 400) errors.push({ kind: "http", status: response.status(), path: new URL(response.url()).pathname });
      if (target === page && response.url() === new URL("api/usage", base).href && response.ok()) {
        response.json().then(snapshot => { latestPageSnapshot = snapshot; }).catch(error => errors.push({ kind: "snapshot-json", message: error.message }));
      }
    });
  };
  listen(page);
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(() => [...document.querySelectorAll(".source-figure-time")].length === 2
    && [...document.querySelectorAll(".source-figure-time")].every(element => element.textContent.startsWith("更新于")));
  report.desktopEnvironment = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
    deviceScaleFactor: devicePixelRatio, maxTouchPoints: navigator.maxTouchPoints,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
  report.actualBrowserTimezone = report.desktopEnvironment.timezone;
  assert.equal(report.actualBrowserTimezone, fixture.expected.timezone);
  await check("real WebGL water and glass shaders compile and leave controls interactive", async () => {
    await page.waitForFunction(() => document.documentElement.classList.contains("usage-material-ready")
      && !document.documentElement.classList.contains("usage-material-glass-fallback")
      && document.querySelectorAll('.glass-panel[data-usage-glass="webgl"]').length === 3);
    const glass = await page.locator('.totals .usage-glass-canvas').evaluate(canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let visible = 0;
      for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) visible += 1;
      return {visible, pointerEvents: getComputedStyle(canvas).pointerEvents};
    });
    assert.ok(glass.visible > 0, "Glass shader creates actual visible pixels");
    assert.equal(glass.pointerEvents, "none");
    assert.equal(await page.locator('#refresh-btn').isEnabled(), true);
  });
  await check("actual WEBGL_lose_context water loss uses CSS fallback and restores rendering without changing totals", async () => {
    await expectTotals(page, "30d");
    const before = await page.locator("#totals-number").innerText();
    const extension = await page.locator("#ocean-canvas").evaluateHandle(canvas => canvas.getContext("webgl2").getExtension("WEBGL_lose_context"));
    assert.equal(await extension.evaluate(value => Boolean(value)), true, "Real WebGL context-loss extension is available");
    try {
      await extension.evaluate(value => value.loseContext());
      await page.waitForFunction(() => document.documentElement.classList.contains("usage-material-fallback")
        && document.querySelector("#ocean-canvas").getContext("webgl2").isContextLost());
      const fallback = await page.locator(".ocean-backdrop").evaluate(element => ({
        background: getComputedStyle(element).backgroundImage,
        visibility: getComputedStyle(element).visibility,
        width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height,
        canvasVisibility: getComputedStyle(element.querySelector("#ocean-canvas")).visibility,
      }));
      assert.match(fallback.background, /gradient/);
      assert.equal(fallback.visibility, "visible");
      assert.ok(fallback.width > 0 && fallback.height > 0);
      assert.equal(fallback.canvasVisibility, "hidden");
      assert.equal(await page.locator("#totals-number").innerText(), before);
      await choose(page, "7d", "split"); await expectTotals(page, "7d");
      await choose(page, "30d", "merged"); await expectTotals(page, "30d");
      assertSnapshot(await getSnapshot());
      await extension.evaluate(value => value.restoreContext());
      await page.waitForFunction(() => {
        const canvas = document.querySelector("#ocean-canvas");
        const gl = canvas.getContext("webgl2");
        const program = gl.getParameter(gl.CURRENT_PROGRAM);
        return document.documentElement.classList.contains("usage-material-ready")
          && !document.documentElement.classList.contains("usage-material-fallback")
          && !gl.isContextLost() && canvas.width > 1 && canvas.height > 1 && program && gl.isProgram(program)
          && getComputedStyle(canvas).visibility === "visible";
      });
      assert.equal(await page.locator("#totals-number").innerText(), before);
      await expectTotals(page, "30d"); assertSnapshot(await getSnapshot());
    } finally { await extension.dispose(); }
  });
  await check("six period totals and separate source totals use existing core date boundaries", async () => {
    for (const range of ["7d", "30d", "3m", "6m", "1y", "total"]) {
      await choose(page, range, "merged"); await expectTotals(page, range);
      await choose(page, null, "split"); await expectTotals(page, range);
      assert.equal(await page.locator(".trend-chart").count(), 2, `${range}: independent trend charts`);
    }
  });
  await check("month day selection, unknown and future are not zero", async () => {
    await choose(page, "30d", "merged");
    const day = monthSelectionDay();
    const cell = page.locator(`#calendar button[data-day="${day}"]`);
    await cell.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => scrollY);
    await cell.click();
    assert.equal(await page.evaluate(() => scrollY), before, "Selecting a visible date does not jump vertically");
    await expectDay(page, day);
    const unknown = page.locator('#calendar [data-state="unknown"]').first();
    if (await unknown.count()) {
      assert.equal(await unknown.evaluate(element => element.tagName), "SPAN");
      assert.equal(await unknown.locator(".calendar-amount").count(), 0, "Unknown date is not labeled zero");
      assert.match(await unknown.getAttribute("aria-label"), /无可核对记录/);
    }
    const future = page.locator('#calendar [data-state="future"]');
    const futureCount = await future.count();
    if (futureCount) {
      for (const element of await future.all()) {
        assert.equal(await element.isDisabled(), true);
        assert.match(await element.getAttribute("aria-label"), /尚未到来/);
        assert.equal(await element.locator(".calendar-amount").count(), 0);
      }
    } else assert.equal(addDays(fixture.expected.today, 1).slice(0, 7) === fixture.expected.today.slice(0, 7), false, "Future cells absent only on month's last day");
  });
  await check("3m/6m/1y/total heat hover and click retain full-week highlight with precise day/week/month totals", async () => {
    const selectedDay = addDays(fixture.expected.today, -1);
    const previewDay = addDays(fixture.expected.today, -2);
    for (const key of ["3m", "6m", "1y", "total"]) {
      await choose(page, key, "merged");
      const selected = page.locator(`.heat-cell[data-day="${selectedDay}"]`);
      await selected.click(); await expectWeekHighlight(page, selected);
      await leaveHeat(page); await expectDay(page, selectedDay);
      const target = page.locator(`.heat-cell[data-day="${previewDay}"]`);
      await target.hover();
      await page.waitForFunction(() => document.querySelector("#day-detail").dataset.previewKind === "day");
      await expectDay(page, previewDay); await expectWeekHighlight(page, target);
      const column = Number(await target.getAttribute("data-column"));
      const range = fixture.expected.ranges[key];
      const { columns } = periodHeatColumns(range.start, range.endExclusive);
      const merged = day => (fixture.expected.daily.codex[day] ?? 0) + (fixture.expected.daily.zcode[day] ?? 0);
      const weekTotal = columns[column].reduce((total, day) => total + (day ? merged(day) : 0), 0);
      const monthDays = monthGroupsFor(columns).find(group => group.key === previewDay.slice(0, 7)).days;
      const monthTotal = monthDays.reduce((total, day) => total + merged(day), 0);
      assert.deepEqual(await page.locator(".day-detail-period-totals .value").allTextContents(), [formatTokens(weekTotal), formatTokens(monthTotal)]);
      if (key === "3m") await page.screenshot({ path: path.join(output, "page-desktop-3m-hover.png"), fullPage: true });
      await target.click();
      assert.equal(await target.getAttribute("data-selected"), "true");
      await expectWeekHighlight(page, target); await expectDay(page, previewDay);
      await leaveHeat(page); await expectDay(page, previewDay);
      assert.equal(await page.locator(".heat-week-highlight").isVisible(), false);
      await selected.click(); await leaveHeat(page); await expectDay(page, selectedDay);
      const unknown = page.locator('.heat-cell[data-state="unknown"]').first();
      assert.ok(await unknown.count(), `${key}: missing historical records remain unknown`);
      assert.equal(await unknown.evaluate(element => element.tagName), "SPAN");
      assert.match(await unknown.getAttribute("aria-label"), /无可核对记录/);
    }
  });
  await check("same source snapshot from real polling retains heat/trend DOM, focus, highlight and scroll", async () => {
    await choose(page, "3m", "merged");
    const day = addDays(fixture.expected.today, -1);
    let observedIdentical = false;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const target = page.locator(`.heat-cell[data-day="${day}"]`);
      await target.click(); await target.focus(); await expectWeekHighlight(page, target);
      assert.ok(latestPageSnapshot, "Page has received an actual usage snapshot");
      const previousKey = JSON.stringify([latestPageSnapshot.codex, latestPageSnapshot.zcode]);
      const handles = {
        cell: await target.elementHandle(), columns: await page.locator(".heat-columns").elementHandle(),
        scroll: await page.locator(".heat-scroll").elementHandle(), trend: await page.locator(".trend-chart").elementHandle(),
      };
      const before = await page.evaluate(() => ({ x: document.querySelector(".heat-scroll").scrollLeft, y: scrollY }));
      const response = await page.waitForResponse(value => value.url() === new URL("api/usage", base).href
        && value.request().method() === "GET" && value.ok(), { timeout: 20000 });
      const next = await response.json(); assertSnapshot(next);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const nextKey = JSON.stringify([next.codex, next.zcode]);
      if (nextKey === previousKey) {
        const retained = await page.evaluate(({ cell, columns, scroll, trend }) => ({
          cell: cell.isConnected && document.querySelector(`.heat-cell[data-day="${cell.dataset.day}"]`) === cell,
          columns: columns.isConnected && document.querySelector(".heat-columns") === columns,
          scroll: scroll.isConnected && document.querySelector(".heat-scroll") === scroll,
          trend: trend.isConnected && document.querySelector(".trend-chart") === trend,
          focus: document.activeElement === cell, selected: cell.dataset.selected === "true",
          x: document.querySelector(".heat-scroll").scrollLeft, y: scrollY,
        }), handles);
        for (const name of ["cell", "columns", "scroll", "trend", "focus", "selected"]) assert.equal(retained[name], true, `${name} survives identical source snapshot`);
        assert.ok(Math.abs(retained.x - before.x) <= 1 && Math.abs(retained.y - before.y) <= 1);
        await expectWeekHighlight(page, target); await expectDay(page, day);
        observedIdentical = true; report.sameSnapshotPollingAttempts = attempt;
      }
      for (const handle of Object.values(handles)) await handle.dispose();
      if (observedIdentical) break;
      // A 30-second source refresh may legitimately advance lastSuccessAtMs.
      // Observe the next genuine 15-second poll rather than substituting a fake snapshot.
    }
    assert.equal(observedIdentical, true, "At least one actual poll carries identical source fields");
    await leaveHeat(page); await expectDay(page, day);
  });
  await check("month bar hover uses period month total and restores selected day", async () => {
    const selectedDay = addDays(fixture.expected.today, -1);
    const key = fixture.expected.today.slice(0, 7);
    await page.locator(`.heat-bar[data-month="${key}"]`).hover();
    await page.waitForFunction(() => document.querySelector("#day-detail").dataset.previewKind === "month");
    assert.equal(await page.locator("#day-detail .day-detail-title").innerText(), monthTitle(`${key}-01`));
    const total = ["codex", "zcode"].reduce((sum, source) => sum + sumRange(fixture.expected.daily[source], `${key}-01`, addDays(fixture.expected.today, 1)), 0);
    assert.equal(await page.locator("#day-detail .day-detail-total strong").innerText(), formatTokens(total));
    assert.equal(await page.locator(".heat-week-highlight").isVisible(), false);
    await leaveHeat(page); await expectDay(page, selectedDay);
  });
  await check("trend keyboard gives exact daily source/merged values and clears on Escape", async () => {
    await choose(page, "30d", "merged");
    const chart = page.locator(".trend-chart");
    await chart.focus(); await chart.press("End");
    const tooltip = chart.locator(".trend-tooltip");
    const checkTooltip = async day => {
      const text = await tooltip.innerText();
      assert.ok(text.includes(day.replaceAll("-", ".")));
      for (const [source, label] of [["codex", "Codex"], ["zcode", "ZCode"]]) assert.ok(text.includes(`${label} ${formatTokens(fixture.expected.daily[source][day])}`));
      assert.ok(text.includes(`合计 ${formatTokens(fixture.expected.daily.codex[day] + fixture.expected.daily.zcode[day])}`));
    };
    await checkTooltip(fixture.expected.today);
    await chart.press("ArrowLeft"); await checkTooltip(addDays(fixture.expected.today, -1));
    await chart.press("Home");
    assert.ok((await tooltip.innerText()).includes(fixture.expected.ranges["30d"].start.replaceAll("-", ".")));
    assert.ok((await tooltip.innerText()).includes("无可核对记录"));
    await chart.press("Escape"); assert.equal(await tooltip.isVisible(), false);
    await choose(page, null, "split");
    for (const [index, source, label] of [[0, "codex", "Codex"], [1, "zcode", "ZCode"]]) {
      const split = page.locator(".trend-chart").nth(index); await split.focus(); await split.press("End");
      assert.ok((await split.locator(".trend-tooltip").innerText()).includes(`${label} ${formatTokens(fixture.expected.daily[source][fixture.expected.today])}`));
      await split.press("Escape");
    }
    await page.locator("h1").hover(); await page.evaluate(() => document.activeElement?.blur());
    await page.screenshot({ path: path.join(output, "page-desktop-split.png"), fullPage: true });
  });
  await check("refresh reimports without changing request counts, totals or selected day", async () => {
    await choose(page, "30d", "merged");
    const selectedDay = monthSelectionDay();
    await page.locator(`#calendar button[data-day="${selectedDay}"]`).click();
    const before = await getSnapshot();
    await page.locator("#refresh-btn").click();
    await until(async () => { const snapshot = await getSnapshot(); assertSnapshot(snapshot);
      return snapshot.codex.lastSuccessAtMs > before.codex.lastSuccessAtMs && snapshot.zcode.lastSuccessAtMs > before.zcode.lastSuccessAtMs; }, "refresh success timestamps advance");
    await page.waitForFunction(() => document.querySelector("#refresh-btn").dataset.busy === "false");
    await expectTotals(page, "30d"); await expectDay(page, selectedDay);
  });
  await check("390px touch: no body overflow, real date tap preserves scroll, reduced motion", async () => {
    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 },
      hasTouch: true, isMobile: true, deviceScaleFactor: 1, timezoneId: fixture.expected.timezone,
      reducedMotion: "reduce" });
    const mobile = await mobileContext.newPage(); listen(mobile);
    await mobile.goto(base, { waitUntil: "networkidle" });
    await mobile.waitForFunction(() => document.querySelector("#totals-number").textContent !== "—");
    report.mobileEnvironment = await mobile.evaluate(() => ({ width: innerWidth, height: innerHeight,
      deviceScaleFactor: devicePixelRatio, maxTouchPoints: navigator.maxTouchPoints,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
    assert.equal(report.mobileEnvironment.width, 390);
    assert.ok(report.mobileEnvironment.maxTouchPoints > 0, "Independent mobile context exposes real touch input");
    assert.equal(report.mobileEnvironment.timezone, fixture.expected.timezone);
    await choose(mobile, "1y", "merged"); await expectTotals(mobile, "1y"); await assertNoOverflow(mobile);
    const selectedDay = addDays(fixture.expected.today, -1);
    const target = mobile.locator(`.heat-cell[data-day="${selectedDay}"]`);
    await target.scrollIntoViewIfNeeded();
    // Stay close to the latest known cells while making an actual nonzero horizontal position.
    await mobile.locator(".heat-scroll").evaluate(element => { element.scrollLeft = Math.max(0, element.scrollWidth - element.clientWidth - 4); });
    const before = await mobile.evaluate(() => ({ x: document.querySelector(".heat-scroll").scrollLeft, y: scrollY }));
    assert.ok(before.x > 0, "1-year heat really overflows internally at 390px");
    await target.tap();
    assert.equal(await target.getAttribute("data-selected"), "true", "A real touch tap selects the heat date");
    const after = await mobile.evaluate(() => ({ x: document.querySelector(".heat-scroll").scrollLeft, y: scrollY }));
    assert.ok(Math.abs(after.x - before.x) <= 1 && Math.abs(after.y - before.y) <= 1, `Touch tap keeps scroll: ${JSON.stringify({ before, after })}`);
    await mobile.locator("h1").tap(); await mobile.evaluate(() => document.activeElement?.blur());
    await expectDay(mobile, selectedDay); await assertNoOverflow(mobile);
    assert.equal(await mobile.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), true);
    const activeAnimations = await mobile.evaluate(() => document.getAnimations().filter(animation =>
      animation.playState === "running" && animation.effect?.getComputedTiming().iterations === Infinity).length);
    assert.equal(activeAnimations, 0, "Reduced motion has no infinite CSS animations");
    const canvasFrame = () => mobile.locator("#ocean-canvas").evaluate(canvas => canvas.toDataURL());
    const firstFrame = await canvasFrame();
    await mobile.waitForTimeout(250);
    assert.equal(await canvasFrame(), firstFrame, "Reduced motion keeps the material canvas static");
    await choose(mobile, "30d", "merged"); await expectTotals(mobile, "30d"); await assertNoOverflow(mobile);
    await mobile.locator("h1").tap(); await mobile.evaluate(() => document.activeElement?.blur());
    await mobile.screenshot({ path: path.join(output, "page-390-full.png"), fullPage: true });
    await mobileContext.close();
  });
  await check("no console, page or failed resource errors", async () => assert.deepEqual(errors, []));
  report.status = "Verified";
} catch (error) {
  fatal = error;
  report.status = "Blocked"; report.failure = error.stack;
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page) await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {});
  }
} finally {
  if (browser) await browser.close();
  if (app && !keepApp && app.exitCode === null) {
    // This handle belongs only to the process created by this harness. No pkill or global app cleanup.
    app.kill("SIGTERM");
    await Promise.race([new Promise(resolve => app.once("exit", resolve)), delay(3000)]);
    if (app.exitCode === null && app.signalCode === null) app.kill("SIGKILL");
  }
  if (appLog) await appLog.close();
  report.appKeptRunning = Boolean(keepApp && app && app.exitCode === null && app.signalCode === null);
  report.completedAt = new Date().toISOString();
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "verification.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, output, fixtureRoot: fixture?.root,
    pid: app?.pid, appKeptRunning: report.appKeptRunning, url: base,
    passed: results.filter(result => result.status === "Verified").map(result => result.name),
    failure: fatal?.message, browserErrors: errors }, null, 2));
  if (fatal) process.exitCode = 1;
}
