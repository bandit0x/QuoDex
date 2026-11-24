const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { createInterface } from 'node:readline';
const browsers=[];
const windows = (a,b) => '<p>Five Hour Limit Remaining '+a+'%</p><p>Weekly Limit Remaining '+b+'%</p>';
try {
  for (const [url,title,body] of [
    ['https://gemini.google.com/app/sample-web','Gemini 匿名网页任务','<button>Stop response</button>'],
    ['https://gemini.google.com/app','Gemini quotas','<section role="dialog" aria-label="Usage Limits">'+windows(72,95)+'</section>'],
    ['https://antigravity.google.com/settings/models','Antigravity quotas','<div role="dialog" aria-label="View Usage"><section><h3>Gemini Models</h3>'+windows(76,46)+'</section><section><h3>Claude and GPT models</h3>'+windows(12,30)+'</section></div>'],
  ]) {
    const browser=await chromium.launch({channel:'msedge',headless:false,args:['--force-renderer-accessibility','--disable-background-networking']});
    browsers.push(browser);
    const page=await browser.newPage({serviceWorkers:'block'});
    await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><title>'+title+'</title><main>'+body+'</main>'}));
    await page.goto(url);
  }
  console.log('READY');
  const input=createInterface({input:process.stdin});
  for await(const line of input){
    if(line==='close-web'){await browsers[0].close();console.log('CLOSED');}
    if(line==='quit')break;
  }
} finally { await Promise.all(browsers.map(browser=>browser.close())); }
