import { webkit } from 'playwright';
import { createServer } from 'node:http';
const cases = JSON.parse(process.argv[2]);
const parent = createServer((_q, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<body style="margin:0"><iframe id="f" style="width:520px;height:200px;border:0" sandbox="allow-scripts allow-same-origin allow-forms"></iframe><script>
window.log=[]; const f=document.getElementById('f');
addEventListener('message',(e)=>{ if(e.source!==f.contentWindow) return; log.push(e.data); if(e.data.beluga==='size') f.style.height=e.data.height+'px'; if(e.data.beluga==='ready') f.contentWindow.postMessage({beluga:'props',props:window.props||{}},'*'); });
</script></body>`); }).listen(0, '127.0.0.1');
await new Promise((r) => parent.once('listening', r));
const b = await webkit.launch();
for (const c of cases) {
  const p = await b.newPage({ viewport: { width: 560, height: 520 } });
  await p.goto(`http://localhost:${parent.address().port}/`);
  await p.evaluate(([u, props]) => { window.props = props; document.getElementById('f').src = u; }, [c.url, c.props]);
  await p.waitForTimeout(4000);
  const fr = p.frameLocator('#f');
  if (c.click) { await fr.locator(c.click).first().click().catch((e) => console.log('click failed', String(e).slice(0, 80))); await p.waitForTimeout(300); }
  if (c.tools) {
    const f = p.locator('#f');
    for (const m of c.tools) { await p.evaluate((m) => document.getElementById('f').contentWindow.postMessage(m, '*'), m); await p.waitForTimeout(700); }
  }
  if (c.hover) { await fr.locator(c.hover).first().hover({ timeout: 3000 }).catch((e) => console.log('hover failed')); await p.waitForTimeout(300); }
  const log = await p.evaluate(() => window.log.map((m) => m.beluga === 'snapshot' ? { beluga: 'snapshot', png: m.png ? m.png.length : 0, failed: m.failed } : m));
  const info = c.probe ? await fr.locator(c.probe).first().evaluate((e) => getComputedStyle(e).backgroundColor).catch(() => 'n/a') : '';
  console.log(`== ${c.name}`, info, JSON.stringify(log.filter((m) => m.beluga !== 'ready')).slice(0, 700));
  await p.screenshot({ path: `../../.beluga/scratch/4x-${c.name}.png` });
  await p.close();
}
await b.close(); parent.close();
