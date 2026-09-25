// Run against the production-built runtime.html verification entry, not the design mock.
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const base = process.env.PRO_UI_URL || "http://127.0.0.1:4175";
const output = "docs/verification/pro-ui";
await mkdir(output, { recursive: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 300, height: 160 }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(5000);
  page.on("pageerror", error => errors.push(error.message));
  for (const state of ["normal", "low", "stale", "failed", "loading", "expanded", "collapsed", "empty", "full", "unavailable", "blocked"]) {
    await page.goto(`${base}/runtime.html?state=${state}`);
    await page.waitForTimeout(state === "blocked" ? 2300 : 400);
    await page.screenshot({ path: `${output}/${state}.png` });
  }
  // Pointer capture must not retarget a click to MAIN; dragging must not restore.
  for (const mode of ["pro", "dual"]) {
    await page.goto(`${base}/runtime.html?state=collapsed&mode=${mode}`);
    await page.getByRole("button", { name: "恢复标准视图" }).click();
    await page.getByRole("button", { name: "展开重置详情" }).waitFor();
    await page.goto(`${base}/runtime.html?state=collapsed&mode=${mode}`);
    await page.getByRole("button", { name: "恢复标准视图" }).waitFor();
    await page.mouse.move(100, 24);
    await page.mouse.down();
    await page.mouse.move(140, 24, { steps: 5 });
    await page.mouse.up();
    await page.getByRole("button", { name: "恢复标准视图" }).waitFor();
  }
  await page.goto(`${base}/runtime.html`);
  await page.getByRole("button", { name: "展开重置详情" }).click();
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.getByRole("button", { name: "收起为窄条" }).click();
  await page.getByRole("button", { name: "恢复标准视图" }).click();
  await page.getByRole("button", { name: "展开重置详情" }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("dialog", { name: "显示设置" }).waitFor();
  await page.getByRole("button", { name: "关闭设置" }).click();
  await page.goto(`${base}/runtime.html?state=refreshing`);
  await page.getByText("正在刷新", { exact: true }).waitFor({ timeout: 7000 });
  await page.getByText("68%", { exact: true }).waitFor();
  await page.screenshot({ path: `${output}/refreshing.png` });
  if (errors.length) throw new Error(errors.join("\n"));
  const result = { environment: "Chrome headless, production App verification entry, synthetic services", screenshots: 12, errors, checks: ["Pro and dual click restore", "Pro and dual drag without restore", "expand", "refresh", "collapse", "settings open/close", "retain quota during refresh"] };
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
