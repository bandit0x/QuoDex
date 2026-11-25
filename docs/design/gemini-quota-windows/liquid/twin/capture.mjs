// Run with Node. PLAYWRIGHT_MODULE may point to an installed Playwright ESM entry.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const directory = fileURLToPath(new URL('.', import.meta.url));
const browser = await chromium.launch({channel:'msedge',headless:true});
try {
  const page = await browser.newPage({viewport:{width:1170,height:720},deviceScaleFactor:1.5,reducedMotion:'reduce'});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => errors.push(request.url()));
  await page.goto(pathToFileURL(path.join(directory,'index.html')).href,{waitUntil:'load'});
  await page.evaluate(() => document.fonts.ready);
  const standard = page.locator('[data-host="standard"] .surface');
  const narrow = page.locator('#native-strip .surface');
  assert.equal(await narrow.locator('.q-value').count(),6);
  assert.deepEqual(await narrow.evaluate(el => [el.offsetWidth,el.offsetHeight]),[260,48]);
  await page.locator('#proof').screenshot({path:path.join(directory,'review.png')});

  // Use the native component sizes for each state on the contact sheet.
  await page.addStyleTag({content:'.enlarged-standard{zoom:1}'});
  const samples = [];
  async function record(label, loc, expected) {
    assert.ok((await loc.innerText()).replace(/\s/g,'').includes(expected));
    const pixels = await loc.screenshot();
    const size = await loc.boundingBox();
    samples.push({label,width:size.width,height:size.height,pixels:pixels.toString('base64')});
  }
  await standard.getByRole('button',{name:'刷新',exact:true}).click();
  await record('正在读取',standard,'正在读取');
  await page.getByText('6/6 已更新',{exact:true}).waitFor();
  await record('刷新完成',standard,'6/6已更新');
  await page.locator('#scenario').selectOption('failure');
  await record('首次读取失败',standard,'QGM-204');
  for (const [state,label,expected] of [
    ['zero','周额度用尽','0%'],['missing','周额度未读','—'],['stale','保留上次读数','16%上次']
  ]) {
    await page.locator('#scenario').selectOption(state);
    await record(label,narrow,expected);
  }
  const sheet = await browser.newPage({viewport:{width:1040,height:580},deviceScaleFactor:1.5});
  await sheet.setContent(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;color:#20363a;background:#f3f1ea;font-family:"Segoe UI","Microsoft YaHei UI",sans-serif}
    main{padding:22px 22px 26px}header{display:flex;align-items:baseline;justify-content:space-between;border-bottom:1px solid #8e9c97;padding-bottom:12px}
    h1{font-size:25px;margin:0}header span{font-size:12px;color:#56605c}
    section{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:15px}
    h2{font-size:14px;margin:0 0 7px}figure{margin:0}figure div{display:grid;place-items:center;padding:13px 0;background:linear-gradient(124deg,#dce3db,#c6d0cd)}
    img{display:block}
  </style><main><header><h1>双舷窗 · 状态对照</h1><span>示例来源为 AG Gemini</span></header><section>` +
    samples.map(item => '<figure><h2>' + item.label + '</h2><div><img width="' + item.width + '" height="' + item.height + '" src="data:image/png;base64,' + item.pixels + '"></div></figure>').join('') + '</section></main>');
  await sheet.locator('main').screenshot({path:path.join(directory,'states.png')});
  assert.deepEqual(errors,[]);
  console.log('Captured the default design and six sample states in Edge ' + browser.version());
} finally {
  await browser.close();
}
