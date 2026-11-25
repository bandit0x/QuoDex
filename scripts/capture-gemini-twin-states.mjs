// Run from a built release checkout with Playwright, Edge and Python/Pillow.
// This supplies controlled native IPC responses to the unmodified dist bundle.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const output = process.argv[2];
assert.ok(output, 'Usage: node scripts/capture-gemini-twin-states.mjs OUTPUT [--verify-twice]');
await fs.mkdir(output, { recursive: true });
const cases = [
  ['standard', 'reading', '正在读取…'], ['standard', 'updated', '6/6 已更新'],
  ['standard', 'failure', '读取失败 · QGM-204'], ['narrow', 'zero', '0%'],
  ['narrow', 'missing', '—'], ['narrow', 'stale', '16%上次']
];

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const script = fileURLToPath(import.meta.url);
if (process.argv.includes('--verify-twice')) {
  const runs = ['run-1','run-2'];
  const results = [];
  for (const run of runs) {
    const folder = path.join(output, run);
    execFileSync(process.execPath, [script, folder], {stdio:'inherit'});
    const read = async name => JSON.parse(await fs.readFile(path.join(folder, name), 'utf8'));
    results.push({release:await read('release.json'), cases:await read('report.json')});
  }
  assert.deepEqual(results[0], results[1], 'Build, environment or decoded pixel values changed between runs');
  const verified = results[0];
  for (const [name,digest] of Object.entries(verified.release.loadedReleaseFiles)) {
    assert.equal(sha256(await fs.readFile(path.join('dist',name))), digest, 'Loaded release file differs: ' + name);
  }
  for (const [layout,scenario] of cases) {
    const name = scenario + '-' + layout;
    assert.equal(verified.cases[name].differentRGBA, 0);
    await fs.copyFile(path.join(output,runs[1],name+'-actual.png'),path.join(output,name+'-actual.png'));
  }
  const report = {...verified.release, runs,
    command:'node <path-to-capture-gemini-twin-states.mjs> OUTPUT --verify-twice',
    workingDirectory:'Built release checkout containing dist/index.html and the approved design.',
    inputs:'Anonymous Tauri IPC. Five-hour/weekly values: AG Gemini 82/16, AG Claude/GPT 24/90, Gemini Web 68/55. Narrow states change only the AG Gemini weekly reading.',
    dimensions:{standard:[300,130],narrow:[260,48]},
    pixelsComparedPerRun:Object.values(verified.cases).reduce((sum, c) => sum + c.pixels, 0),
    cases:verified.cases};
  await fs.writeFile(path.join(output,'states-verified.json'),JSON.stringify(report,null,2)+'\n');
  console.log('Two independent runs,',report.pixelsComparedPerRun,'RGBA pixels per run, zero differing pixels.');
  process.exit(0);
}

function installNativeFixture(scenario) {
  let calls = 0;
  let nextListener = 0;
  window.isTauri = true;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {unregisterListener() {}};
  window.__TAURI_INTERNALS__ = {
    metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
    transformCallback:() => ++nextListener,
    async invoke(command) {
      switch (command) {
        case 'plugin:event|listen': return nextListener;
        case 'load_display_preferences': return {source:'gemini',opacity:.92,reducedMotion:true,x:0,y:0,alwaysOnTop:true};
        case 'read_window_pin_diagnostics': return {snapshot:{enabled:true}};
        case 'read_task_status': {
          const observedAtMs = Date.now();
          const sources = ['codex','zcode'].map(source => ({source,health:'ready',diagnostic:null,observedAtMs}));
          return {tasks:[],sources,diagnostic:null,observedAtMs};
        }
        case 'plugin:window|scale_factor': return 1;
        case 'plugin:window|outer_position': return {x:0,y:0};
        case 'plugin:window|inner_size': return {width:innerWidth,height:innerHeight};
        case 'read_gemini_quota': {
          calls++;
          if (scenario === 'failure') throw Error('Anonymous source unavailable');
          if (scenario === 'reading' && calls > 1) return new Promise(()=>{});
          const missing = scenario === 'missing' || (scenario === 'stale' && calls > 1);
          const pools = [[68,55],[82,scenario === 'zero' ? 0 : 16],[24,90]].map(([five,week],i)=>({
            state:'available', source:'panel', windows:[
              {period:'fiveHour',remainingPercent:five,reset:null},
              ...(missing && i === 1 ? [] : [{period:'weekly',remainingPercent:week,reset:null}])
            ]
          }));
          return {observedAtMs:Date.now(),pools};
        }
        default: return null;
      }
    }
  };
}

async function openApproved(page, origin, narrow, scenario) {
  // The design gallery also mounts two enlarged specimens. Canvas image
  // downsampling can depend on the first size drawn from a shared atlas.
  // Mount only the original-size specimen before its unchanged renderer starts.
  await page.route('**/twin/final.js', async route => {
    const host = page.locator('[data-host="standard"]');
    await host.evaluate((selected, scenario) => {
      for (const other of document.querySelectorAll('[data-host]')) {
        if (other !== selected) other.removeAttribute('data-host');
      }
      selected.classList.remove('enlarged-standard');
      document.body.prepend(selected);
      document.querySelector('main').hidden = true;
      document.documentElement.style.background = 'transparent';
      document.body.style.background = 'transparent';
      if (!['reading', 'updated'].includes(scenario)) document.querySelector('#scenario').value = scenario;
    }, scenario);
    await route.fallback();
  });
  await page.goto(origin + '/docs/design/gemini-quota-windows/liquid/twin/index.html');
  if (narrow) {
    // The release starts at 300 × 130, then its settings action mounts new
    // narrow canvases. Exercise the same two sizes in the approved renderer.
    await page.locator('[data-host="standard"]').evaluate(host => {
      host.dataset.host = 'narrow';
      host.replaceChildren();
      document.querySelector('#scenario').dispatchEvent(new Event('change'));
    });
    await page.setViewportSize({width:260,height:48});
  }
  if (scenario === 'reading' || scenario === 'updated') {
    if (scenario === 'reading') {
      // Hold the in-flight frame independently of machine load; the design's
      // simulated read normally finishes after 850 ms.
      await page.clock.install({time:0});
      await page.clock.pauseAt(60_000);
    }
    await page.locator('.surface [data-action="refresh"]').evaluate(button => button.click());
  }
}

const origin = 'http://quodex.test';
const releaseFiles = new Map();
const mimeTypes = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
async function serveCheckout(route) {
  const name = new URL(route.request().url()).pathname;
  const release = name === '/index.html' || name.startsWith('/assets/');
  if (!release && !name.startsWith('/docs/design/gemini-quota-windows/liquid/') && name !== '/src/gemini-glass.webp') {
    return route.fulfill({status:404,body:'Not found'});
  }
  const body = await fs.readFile(path.join(release ? 'dist' : '.', name));
  if (release) releaseFiles.set(name, sha256(body));
  await route.fulfill({contentType:mimeTypes[path.extname(name)],body});
}
let browser;
try {
  // Capture a fully rasterized frame, including the newly disabled refresh
  // button. The native verifier separately exercises the installed GPU path.
  const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  browser = await chromium.launch({ channel:'msedge',headless:true,
    args:['--disable-gpu','--disable-partial-raster','--run-all-compositor-stages-before-draw'] });
  console.log('Edge', browser.version(), '| CPU full-frame rasterization | DPR 1 | reduced motion');
  for (const [layout, scenario, expected] of cases) {
    const narrow = layout === 'narrow';
    const viewport = narrow ? { width:260,height:48 } : { width:300,height:130 };
    const context = await browser.newContext({ viewport:{width:300,height:130}, deviceScaleFactor:1, reducedMotion:'reduce' });
    await context.route(origin + '/**', serveCheckout);
    const app = await context.newPage(), ref = await context.newPage();
    try {
      await app.addInitScript(installNativeFixture, scenario);
      await app.goto(origin + '/index.html');
      await app.locator('.gemini-twin-surface').waitFor();
      if (scenario === 'reading' || scenario === 'updated' || scenario === 'stale') {
        await app.getByText('6/6 已读取', { exact:true }).waitFor();
        await app.getByRole('button', { name:'刷新',exact:true }).evaluate(e=>e.click());
      }
      if (narrow) {
        if (scenario === 'stale') await app.getByText('含一项上次读数',{exact:true}).waitFor();
        await app.locator('.gemini-twin-surface').dispatchEvent('contextmenu');
        await app.getByRole('button',{name:'收起为窄条'}).evaluate(button => button.click());
        await app.locator('.gemini-twin-surface--narrow').waitFor();
        await app.setViewportSize(viewport);
        // Closing settings repaints the window after the native viewport arrives.
        await app.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
      }
      await app.waitForFunction(()=>document.querySelectorAll('canvas[data-renderer="gemini-glass"]').length === 2);
      for (const [label, page] of [['actual',app],['approved',ref]]) {
        if (label === 'approved') await openApproved(page, origin, narrow, scenario);
        const shell = label === 'actual' ? '.gemini-twin-surface' : '.surface';
        const period = label === 'actual' ? 'weekly' : 'week';
        const target = narrow ? `[data-group="gemini"][data-period="${period}"]` : '[role="status"]';
        await page.waitForFunction(({shell,selector,expected,viewport}) => {
          const surface = document.querySelector(shell);
          const rect = surface?.getBoundingClientRect();
          return rect?.x === 0 && rect.y === 0 && rect.width === viewport.width && rect.height === viewport.height
            && surface.querySelector(selector)?.textContent === expected;
        }, {shell,selector:target,expected,viewport});
        assert.deepEqual(await page.locator(shell).boundingBox(), {x:0,y:0,...viewport}, 'Capture must show the native-size window');
        assert.equal(await page.locator(shell + ' canvas').count(), 2);
        await page.evaluate(()=>document.fonts.ready);
        if (label === 'approved' && scenario === 'reading') await page.clock.runFor(40);
        else await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
        await page.screenshot({path:path.join(output,scenario+'-'+layout+'-'+label+'.png'),omitBackground:true});
      }
      console.log(layout, scenario, expected);
    } finally { await context.close(); }
  }
  assert.ok([...releaseFiles.keys()].some(name => name.endsWith('.js')) && [...releaseFiles.keys()].some(name => name.endsWith('.css')));
  await fs.writeFile(path.join(output,'release.json'), JSON.stringify({
    productionRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    trackedFrontendChanges:execFileSync('git',['diff','HEAD','--name-only','--','src','index.html','package.json','package-lock.json',
      'vite.config.ts','tsconfig*.json','docs/design/gemini-quota-windows/liquid'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean),
    approvedDesignRevision:execFileSync('git',['log','-1','--format=%H','--','docs/design/gemini-quota-windows/liquid'],{encoding:'utf8'}).trim(),
    testScriptSHA256:sha256(await fs.readFile(script)),
    platform:os.type()+' '+os.release(),
    node:process.version,
    pythonAndPillow:execFileSync('python',['-c','import platform, PIL; print(platform.python_version(), PIL.__version__)'],{encoding:'utf8'}).trim(),
    rendering:'Edge '+browser.version()+' | CPU full-frame rasterization | DPR 1 | reduced motion',
    loadedReleaseFiles:Object.fromEntries(releaseFiles)
  }, null, 2) + '\n');
} finally { await browser?.close(); }

// Compare the decoded four-channel images, including partly transparent edge pixels.
execFileSync('python', ['-c', `
import hashlib, json, sys
from pathlib import Path
from PIL import Image, ImageChops
folder = Path(sys.argv[1])
report = {}
for case in sys.argv[2:]:
    with Image.open(folder / f'{case}-actual.png') as a, Image.open(folder / f'{case}-approved.png') as b:
        assert a.size == b.size, f'{case}: viewport sizes differ'
        diff = ImageChops.difference(a.convert('RGBA'), b.convert('RGBA'))
        red, green, blue, alpha = diff.split()
        changed = ImageChops.lighter(ImageChops.lighter(red, green), ImageChops.lighter(blue, alpha))
        report[case] = {'pixels': a.width * a.height,
                        'differentRGBA': a.width * a.height - changed.histogram()[0],
                        'maxChannelDifference': max(high for _, high in diff.getextrema()),
                        'sha256DecodedRGBA': hashlib.sha256(a.convert('RGBA').tobytes()).hexdigest()}
text = json.dumps(report, indent=2)
(folder / 'report.json').write_text(text + chr(10), encoding='utf-8')
print(text)
sys.exit(any(case['differentRGBA'] for case in report.values()))
`,output,...cases.map(([layout,scenario])=>scenario+'-'+layout)], {stdio:'inherit'});
