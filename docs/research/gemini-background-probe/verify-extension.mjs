// Offline transport feasibility check: node verify-extension.mjs
// Requires Playwright + its Chromium browser. Set PLAYWRIGHT_MODULE to the
// Playwright module's file URL if it lives outside the project.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = await mkdtemp(path.join(tmpdir(), "quodex-extension-fixture-"));
const extension = path.join(root, "extension");
const syntheticSession = randomUUID();
let valid = true;
const site = createServer((request, response) => {
  response.setHeader("Cache-Control", "no-store");
  if (request.url === "/login") {
    response.setHeader("Set-Cookie", `synthetic=${syntheticSession}; Path=/; HttpOnly; SameSite=Strict`);
    return response.end("Signed in to local fixture");
  }
  if (request.url === "/quota" && valid && request.headers.cookie === `synthetic=${syntheticSession}`) {
    return response.end(JSON.stringify({ fiveHour: 67, weekly: 89 }));
  }
  response.writeHead(401);
  response.end();
});
let context;
try {
  await new Promise((resolve, reject) => site.once("error", reject).listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${site.address().port}`;
  await mkdir(extension);
  await writeFile(path.join(extension, "manifest.json"), JSON.stringify({
    manifest_version: 3, name: "QuoDex loopback test", version: "1.0",
    background: { service_worker: "worker.js" }, host_permissions: ["http://127.0.0.1/*"],
  }));
  await writeFile(path.join(extension, "worker.js"), `
    async function probe() {
      const response = await fetch(${JSON.stringify(origin + "/quota")}, { credentials: "include", cache: "no-store" });
      return response.ok ? await response.json() : { status: response.status };
    }
    chrome.runtime.onInstalled.addListener(() => {});
  `);
  context = await chromium.launchPersistentContext(path.join(root, "profile"), {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--disable-background-networking"],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker", { timeout: 10000 });
  const probe = () => worker.evaluate(() => probe()); // The callback runs inside the extension.
  assert.equal(await worker.evaluate(() => typeof chrome.cookies), "undefined");
  assert.deepEqual(await probe(), { status: 401 });
  const loginPage = await context.newPage();
  await loginPage.goto(origin + "/login");
  await loginPage.close();
  assert.equal(context.pages().filter(page => page.url().startsWith(origin)).length, 0);
  assert.deepEqual(await probe(), { fiveHour: 67, weekly: 89 });
  valid = false;
  assert.deepEqual(await probe(), { status: 401 });
  console.log(JSON.stringify({ browser: context.browser().version(), siteTabs: 0, cookiesApi: false,
    signedOut: 401, authenticatedQuota: [67, 89], revoked: 401 }));
} finally {
  await context?.close();
  await new Promise(resolve => site.close(resolve));
  await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 });
}
