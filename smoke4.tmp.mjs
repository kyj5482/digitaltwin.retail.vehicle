import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const server = spawn('node', ['server.js', '--port', '8801'], { cwd: process.cwd() });
const base = await new Promise((res, rej) => {
  let buf=''; server.stdout.on('data', d=>{ buf+=d; const m=buf.match(/http:\/\/localhost:(\d+)/); if(m) res(`http://localhost:${m[1]}`); });
  setTimeout(()=>rej(new Error('timeout')), 8000);
});
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:1600,height:900} });
const errors=[];
page.on('pageerror', e=>errors.push('pageerror: '+e.message));
page.on('console', m=>{ if(m.type()==='error') errors.push('console: '+m.text()); });
await page.addInitScript(()=>localStorage.setItem('v10_intro_seen','1'));

async function suite(url, waitFn, svgSel, name){
  await page.goto(base+url);
  await page.waitForFunction(waitFn);
  await page.waitForTimeout(200);
  const box = await page.locator(svgSel).boundingBox();
  const vbOf=()=>page.evaluate(sel=>document.querySelector(sel).getAttribute('viewBox'), svgSel);
  const cx=box.x+box.width*0.5, cy=box.y+box.height*0.5;
  console.log(`\n=== ${name} ===`);
  // 1) 기본 배율: 드래그해도 그래프 고정
  const vb0 = await vbOf();
  await page.mouse.move(cx,cy); await page.mouse.down();
  await page.mouse.move(cx+80,cy+20); await page.mouse.move(cx+160,cy-10); await page.mouse.up();
  console.log('기본 배율 드래그 → 그래프 고정:', (await vbOf())===vb0);
  // 2) 휠 확대 후 드래그 = 이동 동작
  await page.mouse.move(cx,cy);
  await page.mouse.wheel(0,-360); await page.waitForTimeout(100);
  const vbZ = await vbOf();
  await page.mouse.down(); await page.mouse.move(cx-60,cy); await page.mouse.up();
  const vbP = await vbOf();
  console.log('확대 후 드래그 → 이동 동작:', vbZ!==vbP);
  // 3) 극단 드래그 → 콘텐츠 영역 밖으로 못 나감 (클램프)
  await page.mouse.move(cx,cy); await page.mouse.down();
  await page.mouse.move(cx+1200,cy+800); await page.mouse.up();
  const [x,y,w,h] = (await vbOf()).split(' ').map(Number);
  const [W,H] = await page.evaluate(sel=>{ const s=document.querySelector(sel); return [s.viewBox.baseVal.width,s.viewBox.baseVal.height]; }, svgSel).then(()=>vb0.split(' ').slice(2).map(Number));
  console.log('클램프 (x,y ≥ 0, 우하단 ≤ 기준):', x>=0 && y>=0 && x+w<=W+0.5 && y+h<=H+0.5, `(vb: ${x.toFixed(0)},${y.toFixed(0)},${w.toFixed(0)},${h.toFixed(0)} / 기준 ${W}×${H})`);
  // 4) 더블클릭 리셋
  await page.mouse.dblclick(cx,cy); await page.waitForTimeout(100);
  console.log('더블클릭 리셋:', (await vbOf())===vb0);
}
await suite('/prototypes/v10-opex-sim.html',"() => typeof window._vo==='object'",'#simChart','오피스 관리비 — 차트');
// 기본 배율 클릭=월 이동 여전히 동작
const box = await page.locator('#simChart').boundingBox();
const c0 = await page.evaluate(()=>window._vo.cursor());
await page.mouse.click(box.x+box.width*0.3, box.y+box.height*0.5);
await page.waitForTimeout(100);
console.log('기본 배율 클릭=월 이동:', c0, '→', await page.evaluate(()=>window._vo.cursor()));

await suite('/prototypes/v10-vehicle-sim.html',"() => typeof window._vv==='object'",'#simChart','차량 데이터 — 차트');
await suite('/prototypes/v10-twin-world.html',"() => typeof window._v10==='object'",'#graphSvg','디지털 트윈 — 포커스 그래프');
console.log('\nJS 오류:', errors.length?errors:'없음');
await browser.close(); server.kill();
