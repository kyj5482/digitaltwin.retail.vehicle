// =============================================================================
// v9-lifecycle.test.mjs — V9 라이프사이클 트윈 (연간 업무 사이클 + DoS 주문 로직 + 드릴 뷰)
// server.js(정적 HTTP)를 띄워 실제 배포 경로로 검증.
// =============================================================================
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let server, base, browser, page;
const errors = [];

before(async () => {
  server = spawn('node', ['server.js', '--port', '8792'], { cwd: ROOT });
  base = await new Promise((res, rej) => {
    let buf = '';
    server.stdout.on('data', d => {
      buf += d;
      const m = buf.match(/http:\/\/localhost:(\d+)/);
      if (m) res(`http://localhost:${m[1]}`);
    });
    server.on('error', rej);
    setTimeout(() => rej(new Error('server start timeout: ' + buf)), 8000);
  });
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(base + '/prototypes/v9-lifecycle-twin.html');
  await page.waitForFunction(() => typeof window._v9 === 'object');
  await page.waitForTimeout(400);
});

after(async () => {
  await browser?.close();
  server?.kill();
});

// ── L1. 씬 구조 — 3레인 폐루프 (계획/실행/피드백) ────────────────────────────
test('L1 씬 — 노드 11 · 직교 엣지 15 · 레인 라벨 3 · 피드백 폐루프 존재', async () => {
  const st = await page.evaluate(() => ({
    nodes: document.querySelectorAll('#Lnodes .node').length,
    edges: document.querySelectorAll('#Ledges path').length,
    lanes: [...document.querySelectorAll('.laneLbl')].map(t => t.textContent),
    fb: window._v9.EDGES.filter(e => e.kind === 'fb').map(e => e.id),
    particles: document.querySelectorAll('#Lparts circle').length,
  }));
  assert.equal(st.nodes, 11, '라이프사이클 노드 11개');
  assert.equal(st.edges, 15, '직교 엣지 15개');
  assert.equal(st.lanes.length, 3, '계획/실행/피드백 레인 라벨');
  assert.ok(st.fb.includes('dlr-ord'), 'Retail·재고 실적 → 주문(DoS) 폐루프');
  assert.ok(st.fb.includes('voc-prd'), 'VoC → 차기 상품 반영 폐루프');
  assert.ok(st.fb.includes('qac-rtl'), 'TSB·OTA → 고객 차량 S/W 업데이트');
  assert.ok(st.particles > 10, '파티클 흐름 동작');
  assert.deepEqual(errors, [], 'JS 오류 없음');
});

// ── L2. 주문 로직 — DoS Weight 배분이 트윈 안에서 실행됨 ────────────────────
test('L2 주문 로직 — 차종 합계 정합 + Weight 범위 + 색상 이상(A2) 보정', async () => {
  const st = await page.evaluate(() => {
    const D = window.TWIN_DATA, NOW = D.meta.now;
    const out = {};
    for (const md of D.models) {
      const op = window._v9.orderPlan(md.id, NOW);
      const lead = D.plants.find(p => p.id === md.plant).lead_m;
      const expect = D.actual[Math.min(NOW + lead, NOW)].models[md.id].ws;
      const sum = op.cells.reduce((s, c) => s + c.qty, 0);
      out[md.id] = { total: op.total, expect, sum, wmin: Math.min(...op.cells.map(c => c.w)), wmax: Math.max(...op.cells.map(c => c.w)) };
    }
    // A2 색상 이상: LUM west — 스노우 화이트(과잉) vs 스틸 그레이(부족)
    const lum = window._v9.orderPlan('LUM', NOW);
    const wi = D.zones.findIndex(z => z.id === 'west');
    const white = lum.cells.find(c => c.zi === wi && c.ci === 0 && c.ti === 0);
    const gray = lum.cells.find(c => c.zi === wi && c.ci === 2 && c.ti === 0);
    return { out, white: { ds: white.ds, w: white.w }, gray: { ds: gray.ds, w: gray.w } };
  });
  for (const [mid, o] of Object.entries(st.out)) {
    assert.equal(Math.round(o.total), Math.round(o.expect), `${mid} 총주문 = 도매 계획`);
    assert.ok(Math.abs(o.sum - o.total) < 1, `${mid} 셀 배분 합 = 총주문 (${o.sum.toFixed(1)} vs ${o.total})`);
    assert.ok(o.wmin >= 0.6 && o.wmax <= 1.6, `${mid} Weight 클램프 0.6~1.6`);
  }
  assert.ok(st.white.ds > st.gray.ds + 10, `화이트 DS(${st.white.ds.toFixed(0)}) > 그레이 DS(${st.gray.ds.toFixed(0)}) — 재고 믹스 괴리`);
  assert.ok(st.white.w < 0.95 && st.gray.w > 1.05, `Weight 보정: 화이트 ${st.white.w.toFixed(2)} 감산 · 그레이 ${st.gray.w.toFixed(2)} 증산`);
});

// ── L3. 라이프사이클 데이터 실체 ─────────────────────────────────────────────
test('L3 데이터 — product_plan·bp_trim_mix(SOL 신차)·quality_actions·parts 번들 수록', async () => {
  const st = await page.evaluate(() => {
    const L = window.TWIN_DATA.lifecycle;
    const tmCols = L.trim_mix.cols;
    const r27 = L.trim_mix.rows[2027];
    const acts = L.actions.rows.filter(r => r[0] === '2026-08');
    return {
      keys: Object.keys(L),
      my27: L.product_plan.filter(p => p.my === 2027).length,
      newModel: L.product_plan.find(p => p.typ === 'new_model')?.name || '',
      sol: r27.filter(r => r[tmCols.indexOf('model_id')] === 'SOL').length,
      st27: r27[0][tmCols.indexOf('status')],
      st26: L.trim_mix.rows[2026][0][tmCols.indexOf('status')],
      acts: acts.map(r => [r[1], r[L.actions.cols.indexOf('status')]]),
      partsCats: new Set(L.parts.rows.map(r => r[1])).size,
      vocCats: new Set(L.voc.rows.map(r => r[2])).size,
      calendar: L.calendar.length,
    };
  });
  for (const k of ['calendar', 'product_plan', 'trim_mix', 'media', 'voc', 'actions', 'parts'])
    assert.ok(st.keys.includes(k), `lifecycle.${k} 존재`);
  assert.equal(st.my27, 6, 'MY2027 상품 아이템 6건');
  assert.match(st.newModel, /Solara/, '신차 Solara EV');
  assert.equal(st.sol, 2, 'MY2027 트림믹스에 SOL 신차 트림 2종');
  assert.match(st.st27, /수립 중/, 'MY2027 = 수립 중 (NOW=2026-08)');
  assert.equal(st.st26, 'FOB 확정', 'MY2026 = FOB 확정');
  assert.ok(st.acts.some(([id, s]) => id === 'OTA-2606-LUM' && s === '완결'), 'OTA 완결');
  assert.ok(st.acts.some(([id, s]) => id === 'INV-2608-VST' && s === '원인 조사중'), 'VST 신규 이슈 조사중');
  assert.equal(st.partsCats, 6, 'Parts 카테고리 6종');
  assert.equal(st.vocCats, 9, 'VoC 카테고리 9종');
  assert.equal(st.calendar, 15, '연간 캘린더 활동 15건');
});

// ── L4. 씬 상태 — 이벤트가 노드 램프에 나타남 ────────────────────────────────
test('L4 씬 상태 — 캠페인월 안전 이슈 · KR-1 설비 이상 · OTA 조치', async () => {
  const st = await page.evaluate(() => ({
    voc26: window._v9.nodeInfo('VOC', 26),     // 2026-03 AUR 캠페인
    plt18: window._v9.nodeInfo('PLT', 18),     // 2025-07 KR-1 설비 이상
    qac30: window._v9.nodeInfo('QAC', 30),     // 2026-07 OTA 진행
    ord31: window._v9.nodeInfo('ORD', 31),
  }));
  assert.equal(st.voc26.lamp, 'crit', '캠페인월 VoC 노드 = 안전 이슈 램프');
  assert.equal(st.plt18.lamp, 'crit', 'KR-1 설비 이상 램프');
  assert.match(st.plt18.lampLbl, /KR-1/, 'KR-1 라벨');
  assert.match(st.qac30.cnt, /진행/, 'OTA 조치 진행 중');
  assert.match(st.ord31.cnt, /주문 [\d,]+대/, '주문 노드 라이브 카운터');
});

// ── L5. 연간 캘린더 — 업무 실행 창 판정 ─────────────────────────────────────
test('L5 캘린더 — BP 수립(8~10월)·FOB(11월)·월 주문(매월)·연말 프로그램(11~12월)', async () => {
  const st = await page.evaluate(() => {
    const cal = Object.fromEntries(window.TWIN_DATA.lifecycle.calendar.map(a => [a.id, a]));
    const s = (id, i) => window._v9.actState(cal[id], i);
    return {
      bp1_aug: s('BP-1', 31), bp1_mar: s('BP-1', 26),
      bp3_nov: s('BP-3', 22), bp3_aug: s('BP-3', 31),
      ord_any: s('ORD-1', 5), sls2_dec: s('SLS-2', 23), sls2_jun: s('SLS-2', 29),
      ctx_ord: window._v9.actContext(cal['ORD-1'], 31),
    };
  });
  assert.equal(st.bp1_aug, 'active', 'BP-1: 8월 활성');
  assert.notEqual(st.bp1_mar, 'active', 'BP-1: 3월 비활성');
  assert.equal(st.bp3_nov, 'active', 'BP-3 FOB: 11월 활성');
  assert.notEqual(st.bp3_aug, 'active', 'BP-3: 8월 비활성');
  assert.equal(st.ord_any, 'active', 'ORD-1: 매월 활성');
  assert.equal(st.sls2_dec, 'active', '연말 프로그램: 12월 활성');
  assert.notEqual(st.sls2_jun, 'active', '연말 프로그램: 6월 비활성');
  assert.match(st.ctx_ord, /DoS Weight/, '주문 컨텍스트에 DoS Weight 명시');
});

// ── L6. 실행 업무 피드 + 연간 링 ─────────────────────────────────────────────
test('L6 피드·링 — 15개 활동 카드, 활성 우선 정렬, HIGH 경보, 링 아크·마커', async () => {
  await page.evaluate(() => window._v9.seek(31));
  const st = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.feedCard')];
    return {
      n: cards.length,
      firstDim: cards.findIndex(c => c.classList.contains('dim')),
      anyDimBeforeActive: cards.some((c, k) => c.classList.contains('dim') && cards.slice(k).some(d => !d.classList.contains('dim'))),
      high: cards.some(c => c.querySelector('.st.crit')),
      inv: cards.some(c => c.querySelector('.st.warn')?.textContent === '조사중'),
      arcs: document.querySelectorAll('.ringArc').length,
      needle: !!document.getElementById('ringNeedle'),
      ringYm: document.getElementById('ringYm').textContent,
    };
  });
  assert.equal(st.n, 15, '활동 카드 15개');
  assert.equal(st.anyDimBeforeActive, false, '활성 카드가 비활성보다 앞');
  assert.ok(st.high, 'VoC HIGH 경보 칩 (VST 샤시/조향)');
  assert.ok(st.inv, 'TSB·OTA 조사중 칩');
  assert.equal(st.arcs, 15, '링 아크 15개');
  assert.ok(st.needle, '월 마커 존재');
  assert.equal(st.ringYm, '2026-08', '링 중앙 = 커서 월');
});

// ── L7. 드릴 데이터 뷰 — 7단계 전환·내용 ────────────────────────────────────
test('L7 드릴 — 주문 히트맵 40셀 · BP 트림믹스 20행 · 품질 히트맵 · Parts 6행 · ESC', async () => {
  await page.evaluate(() => { window._v9.seek(31); window._v9.openDrill('order'); });
  let st = await page.evaluate(() => ({
    open: document.getElementById('drill').classList.contains('open'),
    heat: document.querySelectorAll('#drillBody table.heat td').length,
    note: document.querySelector('#drillBody .dNote').textContent,
  }));
  assert.ok(st.open, '드릴 열림');
  assert.equal(st.heat, 40, '주문 히트맵 5지역 × 8색상');
  assert.match(st.note, /Weight = clamp/, '주문 수식 명시');

  await page.evaluate(() => { window._v9.drillSel.my = 2027; window._v9.openDrill('bp'); });
  st = await page.evaluate(() => ({
    rows: document.querySelectorAll('#drillBody table.dt tr').length - 1,
    steps: document.querySelectorAll('#drillBody .step').length,
    ttl: document.getElementById('drillTtl').textContent,
  }));
  assert.equal(st.rows, 20, 'MY2027 트림믹스 20행 (6차종×3 + SOL 2)');
  assert.equal(st.steps, 3, 'BP-1/2/3 스텝퍼');

  await page.evaluate(() => window._v9.openDrill('quality'));
  st = await page.evaluate(() => ({
    heatRows: document.querySelectorAll('#drillBody table.heat tr').length - 1,
    acts: document.querySelectorAll('#drillBody table.dt tr').length - 1,
  }));
  assert.equal(st.heatRows, 6, '품질 히트맵 차종 6행');
  assert.ok(st.acts >= 2, '조치 원장 2건 이상 (OTA + 조사)');

  await page.evaluate(() => window._v9.openDrill('service'));
  st = await page.evaluate(() => ({
    rows: document.querySelectorAll('#drillBody table.dt tr').length - 1,
    note: document.querySelector('#drillBody .dNote').textContent,
  }));
  assert.equal(st.rows, 6, 'Parts 카테고리 6행');
  assert.match(st.note, /Dealer Net과 Factory/, 'DN/Factory 균형 원칙 명시');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  const open = await page.evaluate(() => document.getElementById('drill').classList.contains('open'));
  assert.equal(open, false, 'ESC로 드릴 닫힘');
});

// ── L8. Play·seek 파이프라인 + 인덱스 링크 ──────────────────────────────────
test('L8 타임라인 — seek 재렌더 · 슬라이더 범위 = 실적 32개월 · 인덱스에 V9 카드', async () => {
  const st = await page.evaluate(() => {
    window._v9.seek(0);
    const first = document.getElementById('ymLbl').textContent;
    window._v9.seek(31);
    return { first, last: document.getElementById('ymLbl').textContent, max: document.getElementById('tl').max };
  });
  assert.equal(st.first, '2024-01');
  assert.equal(st.last, '2026-08');
  assert.equal(st.max, '31', '슬라이더 = 실적 구간');
  const idx = await page.evaluate(async b => (await fetch(b + '/')).text(), base);
  assert.match(idx, /v9-lifecycle-twin\.html/, '인덱스에 V9 링크');
  assert.deepEqual(errors, [], '전 과정 JS 오류 없음');
});
