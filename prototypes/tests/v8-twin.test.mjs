// =============================================================================
// v8-twin.test.mjs — v8 전략 트윈 (생산/판매 2층 + 온톨로지 연동) & 텔레매틱스 지도
// server.js(정적 HTTP)를 띄워 실제 배포 경로로 검증 — maplibre ESM은 http 필요.
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
  server = spawn('node', ['server.js', '--port', '8791'], { cwd: ROOT });
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
  page.on('console', m => {
    const t = m.text();
    // 오프라인 베이스맵 등 네트워크 실패는 정상 폴백 경로 — JS 오류만 수집
    if (m.type() === 'error' && !/Failed to load resource|net::|AJAXError|Failed to fetch/i.test(t))
      errors.push('console: ' + t);
  });
  await page.goto(base + '/prototypes/v8-strategy-sim-twin.html');
  await page.waitForFunction(() => typeof NODE_META === 'object' && window._v8);
  await page.waitForTimeout(600);
  await page.evaluate(() => { try { closeBrief(); } catch {} try { closeWar(); } catch {} });
});

after(async () => {
  await browser?.close();
  server?.kill();
});

// ── V1. 2층 구조 — 판매 레이어(상단) / 생산 레이어(하단) ─────────────────────
test('V1 v8 씬 — 판매 노드가 전부 생산 노드보다 위(2층 분리), 층 라벨 존재', async () => {
  const st = await page.evaluate(() => {
    // 판매 레이어 + 옆의 고객 레이어(CUST·VEH·SVC)는 같은 층 — 전부 생산 레이어보다 위
    const salesIds = ['HQ', 'PORT', 'west', 'central', 'northeast', 'southeast', 'south', 'CUST', 'VEH', 'SVC'];
    const prodIds = ['KR-1', 'KR-2', 'PYT', 'US-GA', 'US-SV', 'MX-MT'];
    const y = id => NODE_META[id].anchor[1];
    return {
      salesMaxY: Math.max(...salesIds.map(y)),
      prodMinY: Math.min(...prodIds.map(y)),
      labels: [...document.querySelectorAll('#Lground text')].map(t => t.textContent),
      nodes: Object.keys(NODE_META).length,
    };
  });
  assert.ok(st.salesMaxY < st.prodMinY,
    `판매·고객 레이어(최하단 y=${st.salesMaxY.toFixed(0)})가 생산 레이어(최상단 y=${st.prodMinY.toFixed(0)})보다 위`);
  assert.equal(st.nodes, 16, '노드 16개 전부 배치 (고객 레이어 VEH·SVC 포함)');
  // 씬 링크는 생산·배분·판매 물류 흐름(실선)만 — 업무 연결(지시·피드백 점선)은 온톨로지 담당
  const flows = await page.evaluate(() => ({
    kinds: [...new Set(FLOWS.map(f => f.kind))],
    dashed: document.querySelectorAll('#Ledges .cmdEdge, #Ledges .fbEdge').length,
  }));
  assert.deepEqual(flows.kinds, ['mat'], '물류(mat) 흐름만 존재');
  assert.equal(flows.dashed, 0, '업무 연결 점선(cmd/fb) 없음');
  assert.deepEqual(errors, [], 'JS 오류 없음');
});

// ── V1b. 레이어 라벨 가독성 — 최상위 라벨 레이어 + 헤일로 ────────────────────
test('V1b 레이어 라벨 — 최상위 레이어(Llabels)에 헤일로와 함께, 가려지지 않음', async () => {
  const st = await page.evaluate(() => {
    const lbls = [...document.querySelectorAll('.layerLbl')];
    return {
      n: lbls.length,
      texts: lbls.map(t => t.textContent),
      onTop: lbls.every(t => t.closest('g')?.id === 'Llabels'),
      halo: lbls.length && getComputedStyle(lbls[0]).strokeWidth !== '0px',
    };
  });
  assert.equal(st.n, 4, '레이어 라벨 4개 (판매 1 + 고객 1 + 생산 2)');
  assert.ok(st.texts.some(t => t.includes('판매 레이어')), '판매 레이어 라벨');
  assert.ok(st.texts.some(t => t.includes('고객 레이어')), '고객 레이어 라벨');
  assert.equal(st.texts.filter(t => t.includes('생산 레이어')).length, 2, '생산 레이어 라벨 (한국·북미)');
  assert.ok(st.onTop, '라벨이 최상위 레이어(Llabels)에 있어 노드·기둥에 가려지지 않음');
  assert.ok(st.halo, '텍스트 헤일로(외곽선)로 배경 위에서도 판독 가능');
});

// ── V1c. KPI 온톨로지 연계 — 모든 KPI 타일이 metric 계보 표기 ─────────────────
test('V1c KPI 타일 — 온톨로지 metric(twinKpi) 경유 표출, 계보 배지·툴팁', async () => {
  const st = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll('.kpi')];
    return {
      metricOf: Object.fromEntries(Object.entries(window._onto.metricOf).map(([k, m]) => [k, m.id])),
      ontoVer: window._onto.ver,
      tags: tiles.map(t => t.querySelector('.ontoTag')?.textContent || ''),
      titles: tiles.map(t => t.title),
    };
  });
  assert.deepEqual(st.metricOf,
    { retail: 'retailQty', op: 'opProfit', csi: 'csiExternal', ds: 'daysSupply' },
    'KPI 4종 전부 온톨로지 metric에 바인딩');
  assert.equal(st.tags.length, 4, 'KPI 타일 4개');
  st.tags.forEach(t => assert.match(t, /⛁ \w+ ← \w+/, `계보 배지 표기 (${t})`));
  st.titles.forEach(t => assert.ok(t.includes('온톨로지 metric') && t.includes('소스:'), 'metric 산식·소스 툴팁'));
});

// ── V2. 온톨로지 버튼 — 상시 활성 (상세분석과 동일), HQ 선택 시 판매법인 관계 뷰 ─
test('V2 온톨로지 버튼 — 상시 활성, HQ 선택 후 클릭 시 관계 뷰(iframe) 진입, ESC 복귀', async () => {
  let btn = await page.evaluate(() => ({
    disabled: document.getElementById('btnOnto').disabled,
    on: document.getElementById('btnOnto').classList.contains('ontoOn'),
  }));
  assert.equal(btn.disabled, false, '온톨로지 버튼은 상세분석처럼 항상 활성');
  assert.equal(btn.on, false, '미선택 시 매핑 강조 없음');
  await page.evaluate(() => {   // HQ 노드 클릭 (씬 줌/팬과 무관하게 노드 이벤트로)
    NODE_META.HQ.g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  btn = await page.evaluate(() => ({
    disabled: document.getElementById('btnOnto').disabled,
    on: document.getElementById('btnOnto').classList.contains('ontoOn'),
  }));
  assert.equal(btn.disabled, false, 'HQ 선택 시에도 활성 유지');
  assert.ok(btn.on, '매핑 객체(HQ→판매법인) 선택 강조');
  await page.click('#btnOnto');
  await page.waitForFunction(() => document.getElementById('ontoOverlay').classList.contains('on'));
  const src = await page.evaluate(() => document.getElementById('ontoFrame').src);
  assert.ok(src.includes('v7-ontology-explorer.html?embed=1#focus:salesCompany'),
    '관계 뷰 딥링크 + 임베드 모드로 진입');
  // 팝업이 아니라 씬 영역 통합 — 하단 Play/타임라인은 계속 보이고 조작 가능
  const layout = await page.evaluate(() => ({
    inCenter: !!document.getElementById('ontoOverlay').closest('#center'),
    fixed: getComputedStyle(document.getElementById('ontoOverlay')).position,
    ovH: document.getElementById('ontoOverlay').offsetHeight,
    sceneH: document.getElementById('sceneWrap').offsetHeight,
    centerH: document.getElementById('center').offsetHeight,
    tlVisible: document.getElementById('tl').offsetParent !== null,
    playVisible: document.getElementById('playBtn').offsetParent !== null,
  }));
  assert.ok(layout.inCenter && layout.fixed === 'absolute', '온톨로지는 씬 영역 통합 (전체화면 팝업 아님)');
  assert.ok(layout.ovH > layout.sceneH + 100 && Math.abs(layout.ovH - layout.centerH) < 4,
    `온톨로지가 씬 + 하단 그래프 밴드 전체를 사용 (${layout.ovH}px ≈ center ${layout.centerH}px)`);
  assert.ok(layout.tlVisible && layout.playVisible, '온톨로지 표시 중에도 Play·타임라인 사용 가능');
  // iframe 내부: 온톨로지 로드 + 판매법인 관계 뷰 자동 진입 + 탐색기 크롬(헤더·탭) 숨김
  const frame = page.frames().find(f => f.url().includes('v7-ontology-explorer'));
  assert.ok(frame, 'iframe 프레임 존재');
  await frame.waitForFunction(() => window._cy && window._focusDebug);
  await frame.waitForFunction(() => window._focusDebug.focusOn === 'salesCompany', null, { timeout: 8000 });
  const inner = await frame.evaluate(() => ({
    focusOn: window._focusDebug.focusOn,
    visible: window._cy.nodes('.focus').length,
    ver: window.ONTOLOGY.meta.version,
    embed: document.body.classList.contains('embed'),
    headerHidden: getComputedStyle(document.querySelector('header')).display === 'none',
  }));
  assert.equal(inner.focusOn, 'salesCompany', '판매법인 관계 뷰 활성');
  assert.ok(inner.visible >= 3, '링크된 객체 카드 표시');
  assert.ok(inner.embed && inner.headerHidden, '온톨로지 HTML 크롬(헤더·탭) 미노출 — 관계 뷰만');
  // 관계 뷰 카드 아이콘 — SVG 고유 크기(width/height) 필수 (없으면 잘림·줌 배율마다 부분 표시 회귀)
  const icon = await frame.evaluate(() =>
    decodeURIComponent(window._cy.getElementById('salesCompany').data('icon')));
  assert.match(icon, /<svg[^>]*width="\d+"[^>]*height="\d+"/, '아이콘 SVG에 고유 크기 명시');
  // 오버레이 안에서 액션의 [전략 트윈에서 확인] 클릭 = 새 창 없이 실행 중인 트윈으로 복귀
  const pagesBefore = browser.contexts().flatMap(c => c.pages()).length;
  await frame.evaluate(() => openTwinView('settleWholesaleRevenue'));
  await page.waitForTimeout(200);
  const backToTwin = await page.evaluate(() =>
    !document.getElementById('ontoOverlay').classList.contains('on'));
  const pagesAfter = browser.contexts().flatMap(c => c.pages()).length;
  assert.ok(backToTwin, 'sim 트윈 뷰 = 오버레이 닫고 트윈 복귀');
  assert.equal(pagesAfter, pagesBefore, '새 창(최초 화면) 열리지 않음');
  // 재진입 리셋 — 프레임 안에서 드릴다운·트윈 패널을 열어 세션을 어지럽힌 뒤 다시 [온톨로지]
  await page.click('#btnOnto');
  await page.waitForTimeout(200);
  await frame.evaluate(() => {   // 드릴다운(딜러) + 트윈 패널 오픈 = "마지막 세션" 상태
    window._enterFocus('dealer');
    openTwinView('recordDrivingTrip');
  });
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');   // 오버레이 닫힘 (캡처 핸들러 선점 — HQ 선택은 유지, 프레임 세션은 그대로)
  await page.waitForTimeout(150);
  await page.click('#btnOnto');          // 재진입 → 마지막 세션(딜러 드릴+트윈 패널)이 아니라 판매법인 관계 뷰로 초기화
  await page.waitForTimeout(400);
  const fresh = await frame.evaluate(() => ({
    focusOn: window._focusDebug.focusOn,
    stack: window._focusDebug.stack,
    twinOpen: document.getElementById('twinPanel').classList.contains('on'),
  }));
  assert.equal(fresh.focusOn, 'salesCompany', '재진입 시 해당 객체(판매법인) 관계 뷰로 초기화');
  assert.deepEqual(fresh.stack, [], '이전 드릴 경로 미보존');
  assert.equal(fresh.twinOpen, false, '이전 트윈 패널 미보존');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const closed = await page.evaluate(() => !document.getElementById('ontoOverlay').classList.contains('on'));
  assert.ok(closed, 'ESC로 오버레이 닫힘');
});

// ── V2c. Play 연동 — 커서 이동(과거 실적 ↔ 미래 시뮬)이 관계 뷰 카드에 반영 ───
test('V2c 온톨로지 × Play 연동 — 커서 월의 실적/시뮬 값이 카드·시계에 동기화', async () => {
  await page.evaluate(() => { NODE_META.HQ.g.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await page.waitForTimeout(150);
  await page.click('#btnOnto');
  const frame = page.frames().find(f => f.url().includes('v7-ontology-explorer'));
  await frame.waitForFunction(() => window._focusDebug.focusOn === 'salesCompany');
  // 과거로 시크 → 실적 값 동기화
  const ymPast = await page.evaluate(() => { seek(NOW - 6); return M.months[NOW - 6]; });
  await page.waitForTimeout(250);
  const past = await frame.evaluate(() => ({
    ym: window._twinTime?.ym, sim: window._twinTime?.sim,
    clock: document.getElementById('twinClock').textContent,
    sc: window._cy.getElementById('salesCompany').data('label'),
    ws: window._cy.getElementById('wholesale').data('label'),
  }));
  assert.equal(past.ym, ymPast, '관계 뷰가 커서 월로 동기화');
  assert.equal(past.sim, false, '과거 = 실적');
  assert.ok(past.clock.includes('실적'), '시계에 실적 표기');
  assert.ok(past.sc.includes('영업이익') && past.sc.includes(ymPast), '판매법인 카드에 해당 월 영업이익');
  assert.ok(past.ws.includes('도매') && past.ws.includes('대/월'), '도매 카드에 해당 월 도매량');
  // 미래로 시크 → 시뮬 예측 값으로 갱신
  const ymFut = await page.evaluate(() => { seek(NOW + 8); return M.months[NOW + 8]; });
  await page.waitForTimeout(250);
  const fut = await frame.evaluate(() => ({
    ym: window._twinTime?.ym, sim: window._twinTime?.sim,
    clock: document.getElementById('twinClock').textContent,
    sc: window._cy.getElementById('salesCompany').data('label'),
  }));
  assert.equal(fut.ym, ymFut, '미래 월로 동기화');
  assert.equal(fut.sim, true, '미래 = 시뮬레이션');
  assert.ok(fut.clock.includes('시뮬'), '시계에 시뮬(미래 예측) 표기');
  assert.ok(fut.sc.includes('시뮬'), '카드 측정값에 시뮬 표기');
  assert.notEqual(fut.sc, past.sc, '카드 값이 실제로 월 따라 변화');
  // 정리 — 커서 복귀 + 오버레이 닫기
  await page.evaluate(() => seek(NOW));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
});

// ── V2b. 새 창 진입(#noBrief) — 브리핑(최초 화면) 없이 트윈 씬 직행 ───────────
test('V2b #noBrief 진입 — 브리핑 오버레이 없이 트윈 씬으로 직행', async () => {
  const p2 = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await p2.goto(base + '/prototypes/v8-strategy-sim-twin.html#noBrief');
  await p2.waitForFunction(() => typeof NODE_META === 'object');
  await p2.waitForTimeout(400);
  const briefOpen = await p2.evaluate(() =>
    document.getElementById('brief')?.classList.contains('open') || false);
  assert.equal(briefOpen, false, '#noBrief 진입 시 브리핑 미노출');
  await p2.close();
});

// ── V3. 온톨로지 매핑 — 공장·지역사무소도 관계 뷰 딥링크, 미선택=전체 관계 뷰 ──
test('V3 온톨로지 매핑 — 공장→plant·지역사무소→salesZone, 미선택 시 전체 관계 뷰 + 설명문 접힘', async () => {
  const frame = () => page.frames().find(f => f.url().includes('v7-ontology-explorer'));
  // ① 공장(US-GA) 선택 → 버튼 활성 + 매핑 강조, 열면 공장(plant) 관계 뷰
  await page.evaluate(() => { NODE_META['US-GA'].g.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await page.waitForTimeout(150);
  let st = await page.evaluate(() => ({
    disabled: document.getElementById('btnOnto').disabled,
    on: document.getElementById('btnOnto').classList.contains('ontoOn'),
    infoBtn: document.getElementById('nodeInfo').innerHTML.includes('openOntology'),
  }));
  assert.equal(st.disabled, false, '공장 선택 시에도 버튼 활성 (상시 버튼)');
  assert.ok(st.on, '공장 = 온톨로지 매핑 객체 강조');
  assert.ok(st.infoBtn, '공장 정보 칩에도 온톨로지 관계 뷰 버튼');
  await page.click('#btnOnto');
  await frame().waitForFunction(() => window._focusDebug && window._focusDebug.focusOn === 'plant', null, { timeout: 8000 });
  // 오버레이 헤더 설명문 — 기본 접힘, [ⓘ 설명] 클릭 시에만 표시
  let desc = await page.evaluate(() => document.getElementById('ontoDesc').style.display === 'none');
  assert.ok(desc, '헤더 설명문 기본 접힘');
  await page.evaluate(() => toggleOntoDesc());
  desc = await page.evaluate(() => document.getElementById('ontoDesc').style.display === 'none');
  assert.equal(desc, false, 'ⓘ 설명 클릭 시 표시');
  await page.evaluate(() => toggleOntoDesc());   // 복원
  await page.keyboard.press('Escape');           // 오버레이 닫기 (선택은 유지)
  await page.waitForTimeout(150);
  // ② 지역사무소(south) 선택 → salesZone 관계 뷰
  await page.evaluate(() => { NODE_META.south.g.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await page.waitForTimeout(200);
  await page.click('#btnOnto');
  await frame().waitForFunction(() => window._focusDebug.focusOn === 'salesZone', null, { timeout: 8000 });
  await page.keyboard.press('Escape');   // 오버레이 닫기
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');   // 선택·지역 포커스 해제
  await page.waitForTimeout(150);
  // ③ 미선택 → 전체 관계 뷰 (온톨로지 그래프 전체 + 개요), 개요 설명문도 기본 접힘
  st = await page.evaluate(() => ({
    sel: !!document.querySelector('.hitNode.sel'),
    focusZone,
    on: document.getElementById('btnOnto').classList.contains('ontoOn'),
  }));
  assert.ok(!st.sel && !st.focusZone && !st.on, '선택 해제 상태');
  await page.click('#btnOnto');
  await frame().waitForFunction(() => window._focusDebug.focusOn === null, null, { timeout: 8000 });
  const full = await frame().evaluate(() => {
    const d = document.querySelector('#sidePanel details.introDesc');
    return {
      focusOn: window._focusDebug.focusOn,
      visible: window._cy.nodes('[!isGroup]').filter(n => n.visible()).length,
      types: window.ONTOLOGY.objectTypes.length,
      introTitle: document.querySelector('#sidePanel h2')?.textContent || '',
      hasDetails: !!d, collapsed: d ? !d.open : false,
    };
  });
  assert.equal(full.focusOn, null, '미선택 진입 = 관계 뷰 포커스 없음 (전체 그래프)');
  assert.equal(full.visible, full.types, `객체 타입 전체(${full.types})가 표시되는 전체 관계 뷰`);
  assert.ok(full.introTitle.includes('온톨로지'), '개요 패널 (온톨로지 이름)');
  assert.ok(full.hasDetails && full.collapsed, '온톨로지 설명문 기본 접힘 (details)');
  // 펼치면 설명·설계 원칙 확인 가능
  const opened = await frame().evaluate(() => {
    const d = document.querySelector('#sidePanel details.introDesc');
    d.open = true;
    return d.textContent.includes('설계 원칙');
  });
  assert.ok(opened, '클릭해 펼치면 설명·설계 원칙 표시');
  await page.keyboard.press('Escape');   // 오버레이 닫기
  await page.waitForTimeout(150);
});

// ── V3b. 지역 포커스 — South 딜러 선택 시 관련 흐름만 표시 + 온톨로지 정보 ────
test('V3b South 지역사무소 선택 — 타 지역 흐름·노드 흐림, 온톨로지 관할 딜러·지역 광고 표시', async () => {
  await page.evaluate(() => { NODE_META.south.g.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await page.waitForTimeout(250);
  const st = await page.evaluate(() => {
    const dimmedFlows = FLOWS.filter(f => f.dimmed);
    const zoneEnd = f => (ZONE_POS[f.to] ? f.to : ZONE_POS[f.from] ? f.from : null);
    return {
      focusZone,
      dimmedCnt: dimmedFlows.length,
      allOtherZone: dimmedFlows.every(f => zoneEnd(f) && zoneEnd(f) !== 'south'),
      southFlowsClear: FLOWS.filter(f => zoneEnd(f) === 'south').every(f => !f.dimmed),
      chainClear: FLOWS.filter(f => !zoneEnd(f)).every(f => !f.dimmed),   // 한국→항만 체인 등은 유지
      otherNodeDimmed: NODE_META.west.g.classList.contains('dimZone'),
      southNodeClear: !NODE_META.south.g.classList.contains('dimZone'),
      info: document.getElementById('nodeInfo').textContent,
    };
  });
  assert.equal(st.focusZone, 'south', '지역 포커스 활성');
  assert.equal(st.dimmedCnt, 4 * 4 + 4, '타 지역 흐름만 흐림 (4개 지역 × 유입 4 + 소매 4)');
  assert.ok(st.allOtherZone && st.southFlowsClear && st.chainClear, '흐림 대상이 정확히 타 지역 흐름');
  assert.ok(st.otherNodeDimmed && st.southNodeClear, '타 지역 노드 흐림 · South 유지');
  assert.ok(st.info.includes('지역사무소'), '온톨로지 명칭(지역사무소) 표기');
  assert.ok(st.info.includes('관할 딜러 표본'), '온톨로지 링크 기반 관할 딜러');
  assert.ok(st.info.includes('지역 광고'), '온톨로지 링크 기반 지역 광고(co-op)');
  // 해제 — 재클릭
  await page.evaluate(() => { NODE_META.south.g.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await page.waitForTimeout(250);
  const cleared = await page.evaluate(() => ({
    focusZone, dimmed: FLOWS.filter(f => f.dimmed).length,
    nodeDim: document.querySelectorAll('.hitNode.dimZone').length,
  }));
  assert.equal(cleared.focusZone, null, '재클릭 = 포커스 해제');
  assert.equal(cleared.dimmed + cleared.nodeDim, 0, '흐림 전부 복원');
});

// ── V4. 텔레매틱스 Trip 지도 — H3 셀 집계 + 지도 렌더 ────────────────────────
test('V4 Trip 지도 — 도착지 GPS→H3(r7) 집계, 지도 오버레이 렌더, ESC 닫기', async () => {
  const mapPage = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const mapErrors = [];
  mapPage.on('pageerror', e => mapErrors.push(e.message));
  await mapPage.goto(base + '/prototypes/v7-ontology-explorer.html');
  await mapPage.waitForFunction(() => window._cy && typeof openTripMap === 'function');
  // 액션·수명주기 탭 — 트윈 확인 가능 액션마다 [디지털 트윈] 버튼 (텔레매틱스와 동일 방식)
  await mapPage.click('#tabA');
  const catalog = await mapPage.evaluate(() => ({
    twinBtns: document.querySelectorAll('#actionsWrap .twinBtn').length,
    mapBtn: [...document.querySelectorAll('#actionsWrap .twinBtn')]
      .some(b => b.getAttribute('onclick').includes('recordDrivingTrip')),
  }));
  assert.ok(catalog.twinBtns >= 10, `액션 카탈로그에 디지털 트윈 버튼 ${catalog.twinBtns}개`);
  assert.ok(catalog.mapBtn, '주행 데이터 기록 액션에 지도 뷰 버튼');
  // 텔레매틱스 객체 패널의 버튼 경로로 진입
  await mapPage.click('#tabG');
  await mapPage.evaluate(() => { renderTypePanel('telematicsEvent'); });
  const hasBtn = await mapPage.evaluate(() =>
    document.getElementById('sidePanel').innerHTML.includes("openTwinView('recordDrivingTrip')"));
  assert.ok(hasBtn, '주행 데이터 기록 액션에 디지털 트윈 데이터 뷰 버튼 존재');
  await mapPage.evaluate(() => openTwinView('recordDrivingTrip'));
  await mapPage.waitForFunction(() => window._tripMap, null, { timeout: 30000 });
  const tm = await mapPage.evaluate(() => ({
    cells: window._tripMap.cells, trips: window._tripMap.trips, maxN: window._tripMap.maxN,
    panelOn: document.getElementById('twinPanel').classList.contains('on'),
    mapH: document.getElementById('tripMap').offsetHeight,   // maplibre css 충돌로 0이 되는 회귀 방지
    canvas: !!document.querySelector('#tripMap canvas'),
    hexLayer: !!window._tripMap.map.getLayer('hex-fill'),
    stats: document.getElementById('tmStats').textContent,
    // 데이터 뷰 = 관계 뷰 영역 전체를 덮는 오버레이 — Y축 길이가 관계 뷰(graphCol)와 동일해야 함
    panelRect: document.getElementById('twinPanel').getBoundingClientRect().toJSON(),
    colRect: document.getElementById('graphCol').getBoundingClientRect().toJSON(),
    dropdown: {
      shown: getComputedStyle(document.getElementById('twSelect')).display !== 'none',
      options: [...document.getElementById('twSelect').options].map(o => o.value),
    },
    closeBtns: [...document.querySelectorAll('#twinPanel button')].map(b => b.textContent.trim()),
  }));
  assert.ok(tm.trips >= 60, `trip 표본 충분 (${tm.trips}건)`);
  assert.ok(tm.cells >= 15, `H3 셀 집계 (${tm.cells}개)`);
  assert.ok(tm.maxN >= 3, `셀별 카운트 편차 존재 — 농도 표현 (최대 ${tm.maxN}건/셀)`);
  assert.ok(tm.panelOn && tm.canvas, '트윈 데이터 뷰 서브 패널·지도 캔버스 렌더');
  assert.ok(tm.mapH > 150, `지도 영역이 실제 높이를 가짐 (${tm.mapH}px)`);
  // 절반 렌더 방지 — 캔버스 크기가 컨테이너와 일치해야 함 (ResizeObserver)
  await mapPage.waitForTimeout(300);
  const cvs = await mapPage.evaluate(() => {
    const el = document.getElementById('tripMap');
    const c = el.querySelector('canvas');
    const dpr = window.devicePixelRatio || 1;
    return { cw: Math.round(c.width / dpr), ch: Math.round(c.height / dpr), w: el.clientWidth, h: el.clientHeight };
  });
  assert.ok(Math.abs(cvs.cw - cvs.w) <= 2 && Math.abs(cvs.ch - cvs.h) <= 2,
    `지도 캔버스가 컨테이너 전체를 채움 (canvas ${cvs.cw}×${cvs.ch} vs div ${cvs.w}×${cvs.h})`);
  assert.ok(Math.abs(tm.panelRect.height - tm.colRect.height) <= 2
    && Math.abs(tm.panelRect.top - tm.colRect.top) <= 2
    && Math.abs(tm.panelRect.bottom - tm.colRect.bottom) <= 2,
    `데이터 뷰가 관계 뷰 전체 Y축을 사용 (panel ${tm.panelRect.height}px ≈ 관계뷰 ${tm.colRect.height}px)`);
  assert.ok(tm.hexLayer, 'H3 헥사곤 레이어 존재');
  assert.match(tm.stats, /trip \d+건 · H3 셀 \d+개/, '집계 요약 표기');
  // 디자인 통일 — maplibre가 주입하는 Helvetica가 아니라 본문과 동일한 글꼴 스택
  const font = await mapPage.evaluate(() => ({
    map: getComputedStyle(document.querySelector('#tripMap')).fontFamily,
    body: getComputedStyle(document.body).fontFamily,
  }));
  assert.ok(font.map.includes('Pretendard'), `지도 위젯 글꼴이 본문과 동일 스택 (${font.map})`);
  assert.equal(font.map, font.body, '데이터 뷰(지도)와 본문 글꼴 일치');
  // 액션 2개 → 드롭다운 전환 (Trip 지도 ↔ DTC 신호 보드)
  assert.ok(tm.dropdown.shown, '데이터 뷰 2개 이상 → 드롭다운 표시');
  assert.deepEqual(tm.dropdown.options.sort(), ['recordDrivingTrip', 'triageTelematicsSignal'],
    '드롭다운에 텔레매틱스 트윈 뷰 2개');
  assert.equal(tm.closeBtns.filter(t => t.includes('관계 뷰로')).length, 1,
    '닫기 컨트롤은 [관계 뷰로] 단일 (이중 닫기 버튼 없음)');
  await mapPage.evaluate(() => {
    const s = document.getElementById('twSelect');
    s.value = 'triageTelematicsSignal';
    s.dispatchEvent(new Event('change'));
  });
  await mapPage.waitForTimeout(200);
  const board = await mapPage.evaluate(() => ({
    boardOn: document.getElementById('dtcBoard').classList.contains('on'),
    mapOn: document.getElementById('tripMap').classList.contains('on'),
    rows: document.querySelectorAll('#dtcBoard table tr').length,
    safety: document.getElementById('dtcBoard').textContent.includes('SAFETY'),
    current: window._twinPanel.action,
  }));
  assert.ok(board.boardOn && !board.mapOn, '드롭다운 전환 → DTC 신호 보드 표시, 지도 숨김');
  assert.ok(board.rows > 3 && board.safety, 'DTC 보드에 실제 신호 데이터(심각도 포함) 렌더');
  assert.equal(board.current, 'triageTelematicsSignal', '현재 뷰 상태 갱신');
  // Play 시간 연동 — 커서 월까지 '누적'으로 지도·보드 데이터가 함께 변화
  await mapPage.evaluate(() => { window._setTwinTime({ ym: '2026-04', sim: false }); });
  await mapPage.waitForTimeout(200);
  const boardAt04 = await mapPage.evaluate(() => document.getElementById('dtcBoard').textContent);
  assert.ok(boardAt04.includes('2026-04까지 누적'), 'DTC 보드가 커서 월 누적으로 갱신');
  await mapPage.evaluate(() => {   // 지도 뷰로 복귀 — 커서 월이 지도에도 반영
    const s = document.getElementById('twSelect');
    s.value = 'recordDrivingTrip'; s.dispatchEvent(new Event('change'));
  });
  await mapPage.waitForTimeout(400);
  const mapAt04 = await mapPage.evaluate(() => ({
    trips: window._tripMap.trips, stats: document.getElementById('tmStats').textContent }));
  assert.ok(mapAt04.trips < tm.trips, `04월 누적 trip(${mapAt04.trips}) < 전체(${tm.trips})`);
  assert.ok(mapAt04.trips > 0, '과거 월에도 누적 데이터 존재');
  assert.ok(mapAt04.stats.includes('2026-04까지 누적'), '지도 통계에 커서 월 누적 표기');
  await mapPage.evaluate(() => { window._setTwinTime({ ym: '2026-08', sim: false }); });
  await mapPage.waitForTimeout(200);
  assert.equal(await mapPage.evaluate(() => window._tripMap.trips), tm.trips,
    '현재월 복귀 시 전체 누적과 일치');
  // fitBounds — 데이터 전체가 화면 안 (잘림/절반 렌더 방지)
  const fit = await mapPage.evaluate(() => {
    const m = window._tripMap.map, b = window._tripMap.bounds;
    const inView = m.getBounds();
    return { ok: inView.getWest() <= b[0][0] && inView.getEast() >= b[1][0]
      && inView.getSouth() <= b[0][1] && inView.getNorth() >= b[1][1] };
  });
  assert.ok(fit.ok, '지도 뷰포트가 Trip 데이터 전체를 포함 (fitBounds)');
  await mapPage.keyboard.press('Escape');
  await mapPage.waitForTimeout(150);
  assert.equal(await mapPage.evaluate(() =>
    document.getElementById('twinPanel').classList.contains('on')), false, 'ESC = 관계 뷰로 복귀(패널 닫힘)');
  assert.deepEqual(mapErrors, [], '지도 페이지 JS 오류 없음');
  await mapPage.close();
});

// ── V4c. 데이터 뷰 높이 — 관계 뷰(v8 오버레이 임베드)에서 클릭 시 Y축 전체 사용 ─
//  회귀 배경: 데이터 뷰가 관계 뷰 하단 46% 서브 패널로만 열리던 문제.
//  실제 사용자 경로(v8 → HQ → 온톨로지 → 관계 뷰 드릴 → 데이터 뷰 버튼 클릭)로
//  데이터 뷰의 Y축 길이(top·bottom·height)가 관계 뷰 영역과 동일한지 검증한다.
test('V4c 데이터 뷰 — v8 관계 뷰에서 클릭 시 관계 뷰 전체 Y축 길이와 동일', async () => {
  // v8에서 HQ 선택 → 온톨로지 관계 뷰 오버레이 진입
  await page.evaluate(() => { NODE_META.HQ.g.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await page.waitForTimeout(150);
  await page.click('#btnOnto');
  const frame = page.frames().find(f => f.url().includes('v7-ontology-explorer'));
  await frame.waitForFunction(() => window._focusDebug && window._focusDebug.focusOn === 'salesCompany');
  // 데이터 뷰가 열리기 전 관계 뷰 영역(graphCol) 기준 좌표 확보
  const before = await frame.evaluate(() => ({
    col: document.getElementById('graphCol').getBoundingClientRect().toJSON(),
    cyH: document.getElementById('cy').offsetHeight,
    panelOn: document.getElementById('twinPanel').classList.contains('on'),
  }));
  assert.equal(before.panelOn, false, '진입 직후 데이터 뷰 닫힘');
  assert.ok(before.col.height > 300, `관계 뷰 영역이 실제 높이를 가짐 (${before.col.height}px)`);
  // 관계 뷰 드릴 → 텔레매틱스 객체 → 사이드 패널의 [디지털 트윈] 버튼을 실제 클릭
  // 노드 클릭과 동일 경로 (cy tap 핸들러 = enterFocus + renderTypePanel)
  await frame.evaluate(() => { window._enterFocus('telematicsEvent'); renderTypePanel('telematicsEvent'); });
  await frame.waitForTimeout(300);
  const btn = await frame.$('#sidePanel button[onclick*="recordDrivingTrip"]');
  assert.ok(btn, '관계 뷰 사이드 패널에 데이터 뷰(Trip 지도) 버튼 존재');
  await btn.click();
  await frame.waitForFunction(() => window._tripMap
    && document.getElementById('twinPanel').classList.contains('on'), null, { timeout: 30000 });
  await frame.waitForTimeout(300);   // 지도 리사이즈 안정화
  const geo = await frame.evaluate(() => {
    const r = id => document.getElementById(id).getBoundingClientRect().toJSON();
    return { panel: r('twinPanel'), col: r('graphCol'), body: r('twBody'),
      cyCovered: r('cy'), viewH: window.innerHeight };
  });
  // 핵심 검증 — 데이터 뷰 Y축 길이 = 관계 뷰 전체 Y축 길이 (top·bottom·height 모두 일치)
  assert.ok(Math.abs(geo.panel.height - geo.col.height) <= 2,
    `데이터 뷰 높이(${geo.panel.height}px) = 관계 뷰 전체 높이(${geo.col.height}px)`);
  assert.ok(Math.abs(geo.panel.top - geo.col.top) <= 2,
    `데이터 뷰 상단이 관계 뷰 상단과 일치 (${geo.panel.top} vs ${geo.col.top})`);
  assert.ok(Math.abs(geo.panel.bottom - geo.col.bottom) <= 2,
    `데이터 뷰 하단이 관계 뷰 하단과 일치 (${geo.panel.bottom} vs ${geo.col.bottom})`);
  assert.ok(geo.panel.height / geo.col.height > 0.98,
    `하단 서브 패널 회귀 아님 — 46%가 아니라 전체 (${(geo.panel.height / geo.col.height * 100).toFixed(0)}%)`);
  assert.ok(geo.body.height > geo.panel.height * 0.8,
    `지도 본문이 패널 대부분을 차지 (${geo.body.height}px / ${geo.panel.height}px)`);
  // 닫기 — 관계 뷰 복귀 시 그래프가 원래 높이 그대로
  await frame.evaluate(() => closeTwinPanel());
  await frame.waitForTimeout(200);
  const after = await frame.evaluate(() => ({
    panelOn: document.getElementById('twinPanel').classList.contains('on'),
    cyH: document.getElementById('cy').offsetHeight,
  }));
  assert.equal(after.panelOn, false, '닫기 → 관계 뷰 복귀');
  assert.ok(Math.abs(after.cyH - before.cyH) <= 2, `관계 뷰 높이 원복 (${after.cyH}px)`);
  // 정리 — iframe 내부 클릭으로 포커스가 프레임에 있어 ESC가 부모에 안 닿을 수 있으니 직접 닫는다
  await page.evaluate(() => { closeOntology(); setSelNode(null); closeDrill(); });
  await page.waitForTimeout(150);
});

// ── V4d. 정보 패널 접기 — 관계 뷰에서 온톨로지 정보(우측 패널) 가로 축소 ──────
test('V4d 정보 패널 접기 — 토글로 온톨로지 정보 패널 축소, 관계 뷰 가로 확장·복원', async () => {
  // HQ 선택 → 관계 뷰 진입 (온톨로지 정보 패널이 함께 표시되는 상태)
  await page.evaluate(() => { NODE_META.HQ.g.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await page.waitForTimeout(150);
  await page.click('#btnOnto');
  const frame = page.frames().find(f => f.url().includes('v7-ontology-explorer'));
  await frame.waitForFunction(() => window._focusDebug && window._focusDebug.focusOn === 'salesCompany');
  const before = await frame.evaluate(() => ({
    sideW: document.getElementById('sidePanel').getBoundingClientRect().width,
    cyW: document.getElementById('cy').getBoundingClientRect().width,
    toggle: !!document.getElementById('sideToggle'),
  }));
  assert.ok(before.toggle, '접기 토글 존재');
  assert.ok(before.sideW >= 380, `기본 상태: 정보 패널 표시 (${before.sideW}px)`);
  // 접기 → 정보 패널 숨김 + 관계 뷰(그래프)가 그 폭만큼 확장
  await frame.click('#sideToggle');
  await frame.waitForTimeout(200);
  const min = await frame.evaluate(() => ({
    sideVisible: document.getElementById('sidePanel').offsetParent !== null,
    cyW: document.getElementById('cy').getBoundingClientRect().width,
    stripW: document.getElementById('sideToggle').getBoundingClientRect().width,
  }));
  assert.equal(min.sideVisible, false, '접기 → 온톨로지 정보 패널 숨김');
  assert.ok(min.cyW - before.cyW >= before.sideW - 30,
    `관계 뷰 가로 확장 (${before.cyW}px → ${min.cyW}px)`);
  assert.ok(min.stripW > 0 && min.stripW < 30, '재펼침용 슬림 스트립 유지');
  // 재펼침 → 원복 (드릴다운 후에도 상태 유지 확인 겸 관계 뷰 드릴)
  await frame.evaluate(() => { window._enterFocus('dealer'); });
  await frame.waitForTimeout(300);
  assert.equal(await frame.evaluate(() =>
    document.getElementById('sidePanel').offsetParent !== null), false, '드릴다운 후에도 접힘 유지');
  await frame.click('#sideToggle');
  await frame.waitForTimeout(200);
  const restored = await frame.evaluate(() => ({
    sideW: document.getElementById('sidePanel').getBoundingClientRect().width,
    cyW: document.getElementById('cy').getBoundingClientRect().width,
  }));
  assert.ok(restored.sideW >= 380, '재펼침 → 정보 패널 복원');
  assert.ok(Math.abs(restored.cyW - before.cyW) <= 2, '관계 뷰 폭 원복');
  // 정리 — 프레임 클릭으로 포커스가 iframe에 있으니 직접 닫는다
  await page.evaluate(() => { closeOntology(); setSelNode(null); closeDrill(); });
  await page.waitForTimeout(150);
});

// ── V8. 오버레이 토글 — 온톨로지 재클릭=씬 복귀, 온톨로지 ↔ 상세분석 상호 전환 ─
test('V8 오버레이 토글 — 온톨로지 버튼 재클릭 시 복귀, 상세분석과 상호 배타 전환', async () => {
  // 온톨로지 열기 → 버튼 열림 표시, 재클릭 = 원래 화면(씬) 복귀
  await page.click('#btnOnto');
  await page.waitForTimeout(300);
  let st = await page.evaluate(() => ({
    onto: document.getElementById('ontoOverlay').classList.contains('on'),
    btnOn: document.getElementById('btnOnto').classList.contains('on'),
  }));
  assert.ok(st.onto && st.btnOn, '온톨로지 열림 + 버튼 활성 표시');
  await page.click('#btnOnto');
  await page.waitForTimeout(150);
  st = await page.evaluate(() => ({
    onto: document.getElementById('ontoOverlay').classList.contains('on'),
    btnOn: document.getElementById('btnOnto').classList.contains('on'),
  }));
  assert.ok(!st.onto && !st.btnOn, '재클릭 = 씬 복귀 + 버튼 표시 해제');
  // 온톨로지 열린 상태에서 상세분석 클릭 → 온톨로지 닫히고 분석이 실제로 보임
  await page.click('#btnOnto');
  await page.waitForTimeout(200);
  await page.click('#btnAna');
  await page.waitForTimeout(200);
  st = await page.evaluate(() => {
    const r = document.getElementById('anaHead').getBoundingClientRect();
    const el = document.elementFromPoint(r.left + 40, r.top + 12);
    return {
      onto: document.getElementById('ontoOverlay').classList.contains('on'),
      ana: document.getElementById('ana').classList.contains('open'),
      anaVisible: !!(el && el.closest('#ana')),
    };
  });
  assert.ok(!st.onto && st.ana, '상세분석 클릭 → 온톨로지 닫히고 분석으로 전환');
  assert.ok(st.anaVisible, '분석 화면이 온톨로지에 가려지지 않고 실제로 보임');
  // 분석 열린 상태에서 온톨로지 클릭 → 분석 닫히고 온톨로지로 전환
  await page.click('#btnOnto');
  await page.waitForTimeout(200);
  st = await page.evaluate(() => ({
    onto: document.getElementById('ontoOverlay').classList.contains('on'),
    ana: document.getElementById('ana').classList.contains('open'),
    anaBtn: document.getElementById('btnAna').classList.contains('on'),
  }));
  assert.ok(st.onto && !st.ana && !st.anaBtn, '온톨로지 클릭 → 분석 닫히고 온톨로지로 전환');
  await page.evaluate(() => closeOntology());
  await page.waitForTimeout(150);
});

// ── V6. 상세 분석 — 전략 레버 패널을 덮지 않음 (레버 메뉴가 계속 보이도록) ────
test('V6 상세 분석 — 전략 레버 패널 전까지만 위치, 분석 중에도 레버 조작 가능', async () => {
  await page.click('#btnAna');
  await page.waitForTimeout(250);
  const st = await page.evaluate(() => {
    const ana = document.getElementById('ana').getBoundingClientRect();
    const lever = document.getElementById('leverPanel').getBoundingClientRect();
    // 레버 패널 중앙이 실제로 클릭 가능한지 — 오버레이가 덮으면 elementFromPoint가 #ana 쪽
    const hit = document.elementFromPoint((lever.left + lever.right) / 2, (lever.top + lever.bottom) / 2);
    return {
      open: document.getElementById('ana').classList.contains('open'),
      anaRight: ana.right, leverLeft: lever.left,
      leverHit: !!(hit && hit.closest('#leverPanel')),
      warBtnVisible: document.getElementById('btnWar').offsetParent !== null,
      levers: document.querySelectorAll('#levers input[type=range]').length,
    };
  });
  assert.ok(st.open, '상세 분석 열림');
  assert.ok(st.anaRight <= st.leverLeft + 2,
    `상세 분석 우측 끝(${st.anaRight}px)이 전략 레버 패널(${st.leverLeft}px) 전까지만`);
  assert.ok(st.leverHit, '레버 패널이 오버레이에 덮이지 않고 조작 가능');
  assert.ok(st.warBtnVisible && st.levers >= 4, '전략 레버 메뉴(슬라이더·워게이밍) 계속 노출');
  // 분석 열린 채 레버 변경 → recompute가 분석 차트까지 즉시 재생성 (renderAna 경로)
  const changed = await page.evaluate(() => {
    const before = document.getElementById('anaTrend').innerHTML.length;
    const sl = document.querySelector('#levers input[type=range]');
    sl.value = sl.max; sl.dispatchEvent(new Event('input'));
    return { before, after: document.getElementById('anaTrend').innerHTML.length,
      open: document.getElementById('ana').classList.contains('open') };
  });
  assert.ok(changed.open, '레버 변경 후에도 분석 유지');
  await page.evaluate(() => {   // 레버 원복 + 분석 닫기
    levers = { ...DEFAULT_LEVERS }; activePreset = null; syncLeverUI(); recompute();
  });
  await page.click('#anaClose');
  await page.waitForTimeout(150);
});

// ── V7. 고객 레이어 — 판매 레이어 옆 같은 층: 고객·보유 차량·딜러 서비스 ─────
test('V7 고객 레이어 — 판매 레이어 옆 배치, VEH·SVC 노드·흐름·온톨로지 매핑', async () => {
  const st = await page.evaluate(() => {
    const a = id => NODE_META[id].anchor;
    const salesIds = ['HQ', 'PORT', 'west', 'central', 'northeast', 'southeast', 'south'];
    return {
      custXmin: Math.min(...['CUST', 'VEH', 'SVC'].map(id => a(id)[0])),
      salesXmax: Math.max(...salesIds.map(id => a(id)[0])),
      custYmax: Math.max(...['CUST', 'VEH', 'SVC'].map(id => a(id)[1])),
      prodYmin: Math.min(...['KR-1', 'KR-2', 'PYT', 'US-GA', 'US-SV', 'MX-MT'].map(id => a(id)[1])),
      flows: FLOWS.filter(f => ['VEH', 'SVC'].includes(f.to)).map(f => ({ from: f.from, to: f.to, vol: f.vol })),
      vehSub: NODE_META.VEH.sub.textContent,
      svcSub: NODE_META.SVC.sub.textContent,
    };
  });
  assert.ok(st.custXmin > st.salesXmax, '고객 레이어는 판매 레이어 오른쪽 옆');
  assert.ok(st.custYmax < st.prodYmin, '고객 레이어는 판매 레이어와 같은 층 (생산 레이어보다 위)');
  assert.deepEqual(st.flows.map(f => [f.from, f.to]), [['CUST', 'VEH'], ['VEH', 'SVC']],
    '고객 흐름: 인도→보유 차량(UIO)→딜러 서비스');
  assert.ok(st.flows.every(f => f.vol > 0), '고객 흐름 볼륨 반영');
  assert.match(st.vehSub, /UIO [\d,]+대/, '보유 차량 UIO 표기');
  assert.ok(st.svcSub.includes('정비 입고'), '딜러 서비스 입고 표기');
  // 노드 클릭 → 정보 칩·드릴 + 온톨로지 매핑 (VEH→vehicle, SVC→repairOrder)
  await page.evaluate(() => { NODE_META.VEH.g.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await page.waitForTimeout(150);
  const veh = await page.evaluate(() => ({
    info: document.getElementById('nodeInfo').textContent,
    infoBtn: document.getElementById('nodeInfo').innerHTML.includes('openOntology'),
    drill: document.getElementById('drill').classList.contains('open'),
    on: document.getElementById('btnOnto').classList.contains('ontoOn'),
    target: ontoTargetOf(selNode),
  }));
  assert.ok(veh.info.includes('보유 차량'), 'VEH 정보 칩');
  assert.ok(veh.infoBtn && veh.on, 'VEH도 온톨로지 매핑·버튼');
  assert.ok(veh.drill, 'VEH 드릴 패널');
  assert.equal(veh.target, 'vehicle', 'VEH → 온톨로지 차량(VIN)');
  await page.evaluate(() => { NODE_META.SVC.g.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await page.waitForTimeout(150);
  const svc = await page.evaluate(() => ({
    info: document.getElementById('nodeInfo').textContent,
    target: ontoTargetOf(selNode),
    drillTitle: document.getElementById('drillTitle').textContent,
  }));
  assert.ok(svc.info.includes('딜러 서비스'), 'SVC 정보 칩');
  assert.equal(svc.target, 'repairOrder', 'SVC → 온톨로지 정비 오더(RO)');
  assert.ok(svc.drillTitle.includes('딜러 서비스'), 'SVC 드릴 패널');
  // SVC 선택 상태에서 온톨로지 → repairOrder 관계 뷰
  await page.click('#btnOnto');
  const frame = page.frames().find(f => f.url().includes('v7-ontology-explorer'));
  await frame.waitForFunction(() => window._focusDebug.focusOn === 'repairOrder', null, { timeout: 8000 });
  await page.keyboard.press('Escape');   // 오버레이 닫기
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');   // 선택 해제
  await page.waitForTimeout(150);
});

// ── V9. 확대 보기 — 전략 레버를 덮지 않음 + 확대 상태에서 온톨로지 전환 ───────
test('V9 확대 보기 — 전략 레버 전까지만 확대, 확대 중 온톨로지 클릭 시 전환', async () => {
  await page.click('#mcTitleBar .maxBtn');   // 판매량 차트 ⛶ 확대
  await page.waitForTimeout(250);
  const st = await page.evaluate(() => {
    const mx = document.getElementById('maxOverlay').getBoundingClientRect();
    const lever = document.getElementById('leverPanel').getBoundingClientRect();
    const hit = document.elementFromPoint((lever.left + lever.right) / 2, (lever.top + lever.bottom) / 2);
    return {
      open: document.getElementById('maxOverlay').classList.contains('open'),
      maxRight: mx.right, leverLeft: lever.left,
      leverHit: !!(hit && hit.closest('#leverPanel')),
    };
  });
  assert.ok(st.open, '확대 보기 열림');
  assert.ok(st.maxRight <= st.leverLeft + 2,
    `확대 보기 우측 끝(${st.maxRight}px)이 전략 레버(${st.leverLeft}px) 전까지만`);
  assert.ok(st.leverHit, '확대 중에도 전략 레버 조작 가능');
  // 확대 상태에서 온톨로지 클릭 → 확대 보기 닫히고 온톨로지로 전환 (z60 겹침 해소)
  await page.click('#btnOnto');
  await page.waitForTimeout(300);
  const sw = await page.evaluate(() => ({
    onto: document.getElementById('ontoOverlay').classList.contains('on'),
    max: document.getElementById('maxOverlay').classList.contains('open'),
    chartBack: !!document.getElementById('mainChartBox').closest('#chartBand'),
  }));
  assert.ok(sw.onto && !sw.max, '온톨로지 클릭 → 확대 닫히고 온톨로지로 전환');
  assert.ok(sw.chartBack, '확대됐던 차트가 원위치로 복원');
  await page.evaluate(() => closeOntology());
  await page.waitForTimeout(150);
});

// ── V5. 종료 무결성 ──────────────────────────────────────────────────────────
test('V5 v8 전체 시나리오 후 JS 오류 없음', () => {
  assert.deepEqual(errors, [], '테스트 전 과정에서 JS 오류가 없어야 함');
});
