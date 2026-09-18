// =============================================================================
// v10-world.test.mjs — V10 디지털 트윈 월드
// 회사 목표 관계뷰(업/다운스트림) · Quick Link · 부문 운영 월드(온톨로지 액션→데이터뷰)
// · 앱폴더 다운스트림 · HVAC 전략 레버 · 게이트 결재 · 프로젝트 컴포저
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
  server = spawn('node', ['server.js', '--port', '8793'], { cwd: ROOT });
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
  await page.addInitScript(() => localStorage.setItem('v10_intro_seen', '1'));   // 테스트는 인트로 생략
  await page.goto(base + '/prototypes/v10-twin-world.html');
  await page.waitForFunction(() => typeof window._v10 === 'object');
  await page.waitForTimeout(400);
});

after(async () => {
  await browser?.close();
  server?.kill();
});

// ── W1. 관계뷰 초기 씬 — 루트 = 미국판매법인, 다운스트림 4영역(운영 포함) ────
test('W1 관계뷰 — 루트 4 다운스트림(재무·사업·지속경영·운영) · Quick Link · 좌 레일 회사 카드 5', async () => {
  const st = await page.evaluate(() => ({
    focus: window._v10.focus(),
    rootUp: window._v10.relUp('SC-US'),
    hqDown: window._v10.relDown('HQ-NA', window.TWIN_DATA.meta.now),
    rootDown: window._v10.relDown('SC-US', window.TWIN_DATA.meta.now),
    center: document.querySelectorAll('#scene .cNode').length,
    crumb: document.getElementById('sceneCrumb').textContent,
    ql: document.querySelectorAll('#qlList .qlRow').length,
    goalCards: document.querySelectorAll('#goalList .goalCard').length,
    agents: document.querySelectorAll('#agtList .agtCard').length,
    fbLbl: [...document.querySelectorAll('#scene text')].some(t => t.textContent === '실적 피드백'),
    ceoLbl: document.querySelector('#goalList .goalCard .nm').textContent,
    hdSub: !!document.getElementById('hdSub'),
    railOrder: [...document.querySelectorAll('#rail .railTtl')].map(e => e.textContent),
    hdrWorldBtns: !!document.getElementById('btnV9') || !!document.getElementById('btnV8') || !!document.getElementById('btnOnto'),
    chips: [...document.querySelectorAll('#scene g.rel text')].map(t => t.textContent)
      .filter(t => /^[◎⚙◇⚡]/.test(t)),
  }));
  assert.equal(st.focus, 'SC-US', '초기 포커스 = 미국판매법인');
  assert.deepEqual(st.rootUp, ['HQ-NA'], '미국판매법인 업스트림 = 북미권역본부');
  assert.deepEqual(st.hqDown, ['SC-US', 'SC-CA', 'SC-MX'], '권역본부 산하 = 미국 + 계획 법인 2');
  assert.deepEqual(st.rootDown, ['AR-FIN', 'AR-BIZ', 'AR-ESG', 'AR-OPS'], '루트 다운스트림 = 4영역');
  assert.equal(st.center, 1, '포커스 카드 1');
  assert.match(st.crumb, /북미권역본부.*미국판매법인/, '씬 브레드크럼 (권역본부 › 법인)');
  assert.ok(st.ql >= 5, 'Quick Link 기본 항목');
  assert.match(st.railOrder[0], /회사 목표/, '좌 레일: 회사 목표 먼저');
  assert.match(st.railOrder[1], /Quick Link/, 'Quick Link는 회사 목표 아래');
  assert.equal(st.goalCards, 5, '회사 종합 + 3영역 + 운영 카드');
  assert.equal(st.agents, 5, 'AI 에이전트 5개');
  assert.ok(st.fbLbl, '폐루프 피드백 채널');
  assert.match(st.ceoLbl, /회사 종합/, 'CEO → 회사 네이밍 변경');
  assert.equal(st.hdSub, false, '헤더 부제목 삭제');
  assert.equal(st.hdrWorldBtns, false, '헤더 월드 3버튼 삭제 (포커스 칩으로 대체)');
  assert.ok(st.chips.some(c => c.includes('운영 월드')) && st.chips.some(c => c.includes('전략 월드')),
    '루트 포커스 칩 = 실제 구현된 운영·전략 월드');
  assert.ok(!st.chips.some(c => c.includes('온톨로지')), '온톨로지 칩 없음 (액션 경유만)');
  assert.deepEqual(errors, [], 'JS 오류 없음');
});

// ── W1e. 바로가기 칩 스코프 + 드릴 제거 ─────────────────────────────────────
test('W1e 칩 스코프 — 구현된 월드만 · 드릴 패널 제거 · 그래프 줌/리셋', async () => {
  const st = await page.evaluate(() => {
    const V = window._v10;
    return {
      drill: !!document.getElementById('drill'),
      byNode: {
        area: V.focusShortcuts('AR-FIN').map(s => s.lbl),
        kpi: V.focusShortcuts('KPI-WS').map(s => s.lbl),
        opex: V.focusShortcuts('ND-OPEX').map(s => s.lbl),
        dept: V.focusShortcuts('DEPT-SLS').map(s => s.lbl),
        root: V.focusShortcuts('SC-US').map(s => s.lbl),
      },
    };
  });
  assert.equal(st.drill, false, '상세 드릴 패널 제거');
  assert.deepEqual(st.byNode.area, [], '영역: 구현 월드 없음 → 칩 없음');
  assert.deepEqual(st.byNode.kpi, [], '일반 KPI: 칩 없음');
  assert.ok(st.byNode.opex.some(l => l.includes('관리비')), '관리비: 전용 전략 월드 칩');
  assert.ok(st.byNode.dept.some(l => l.includes('부문 운영 월드')), '부문: 운영 월드 칩');
  assert.equal(st.byNode.root.length, 2, '루트: V9 + V8');
  // 그래프 줌 (씬과 동일 문법) — 휠 확대 → viewBox 축소, 더블클릭 → 리셋
  const zoom = await page.evaluate(() => {
    const svg = document.getElementById('graphSvg');
    const r = svg.getBoundingClientRect();
    const w0 = window._v10.graphView().w;
    svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
    const w1 = window._v10.graphView().w;
    svg.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return { w0, w1, w2: window._v10.graphView().w,
      axis: document.querySelectorAll('#graphSvg .gAxis').length };
  });
  assert.ok(zoom.w1 < zoom.w0, '그래프 휠 → 확대');
  assert.equal(zoom.w2, zoom.w0, '더블클릭 → 리셋');
  assert.ok(zoom.axis >= 10, 'Y 4단 + X 월 라벨 축');
});

// ── W1f. 씬 전환 애니메이션 — FLIP 슬라이드 + 페이드 (온톨로지 관계뷰 감각) ──
test('W1f 애니메이션 — 포커스 이동 시 카드 슬라이드·신규 페이드 · Play는 무동작', async () => {
  await page.evaluate(() => window._v10.gotoFocus('SC-US'));
  await page.waitForTimeout(450);
  const nav = await page.evaluate(() => {
    window._v10.gotoFocus('AR-FIN');                     // 다운스트림 카드 → 중앙
    return window._v10.animInfo();
  });
  assert.ok(nav.moved >= 2, '기존 카드 슬라이드 (클릭 카드→중앙 · 중앙→업스트림)');
  assert.ok(nav.entered >= 3, '신규 카드 페이드 인');
  await page.waitForTimeout(90);
  const midTrans = await page.evaluate(() =>
    [...document.querySelectorAll('#scene g[data-nid]')].some(g => g.style.transition.includes('transform')));
  assert.ok(midTrans, 'transform 트랜지션 적용 중');
  await page.waitForTimeout(450);
  // Play(월 이동)는 포커스 불변 → 애니메이션 없음
  const play = await page.evaluate(() => {
    const before = window._v10.animInfo();
    window._v10.seek(20); window._v10.seek(window.TWIN_DATA.meta.now);
    const after = window._v10.animInfo();
    return { same: before.moved === after.moved && before.entered === after.entered };
  });
  assert.ok(play.same, 'seek 재렌더는 애니메이션 트리거 없음');
  await page.evaluate(() => window._v10.gotoFocus('SC-US'));
  await page.waitForTimeout(450);
});

// ── W1d. 포커스 그래프 + 우 패널 — Play 커서 연동 ───────────────────────────
test('W1d 그래프·우 패널 — 포커스 시계열 · 포커스 정보 · 기여 프로젝트 스코프 · Play 반응', async () => {
  const st = await page.evaluate(() => {
    const V = window._v10, out = {};
    out.rootGraph = document.getElementById('graphTtl').textContent;
    out.graphPaths = document.querySelectorAll('#graphSvg path').length;
    V.gotoFocus('KPI-RECUR');
    out.kpiGraph = document.getElementById('graphTtl').textContent;
    out.kpiFi = document.getElementById('focusInfo').textContent;
    out.kpiPrj = document.getElementById('prjTtl').textContent;
    V.gotoFocus('DEPT-QLT');
    out.deptRows = document.querySelectorAll('#focusInfo .fiRow').length;
    out.deptPrj = document.querySelectorAll('#prjList .prjCard').length;
    V.gotoFocus('SC-CA');
    out.plannedNote = document.getElementById('graphTtl').textContent;
    V.gotoFocus('SC-US');
    V.seek(0);
    out.g0 = document.getElementById('graphTtl').textContent;
    out.f0 = document.getElementById('focusTtl').textContent;
    V.seek(window.TWIN_DATA.meta.now);
    out.g1 = document.getElementById('graphTtl').textContent;
    return out;
  });
  assert.match(st.rootGraph, /가중 달성률/, '루트 그래프 = 회사 종합 시계열');
  assert.ok(st.graphPaths >= 2, '실적 + 기준 라인');
  assert.match(st.kpiGraph, /경상이익률/, 'KPI 포커스 → 그래프 전환');
  assert.match(st.kpiFi, /달성률.*가중치/s, '우 패널 = 포커스 정보 (값·기준·달성률)');
  assert.match(st.kpiPrj, /경상이익률/, '기여 프로젝트 = 포커스 스코프');
  assert.ok(st.deptRows >= 4, '부문 포커스 = 스텝·기여 KPI 행');
  assert.ok(st.deptPrj >= 1, '부문 기여 프로젝트 (기여 KPI 하위)');
  assert.match(st.plannedNote, /미연결/, '계획 법인 = 시계열 미연결 노트');
  assert.match(st.f0, /2024-01/, '우 패널이 Play 커서를 따라감');
  assert.notEqual(st.g0, st.g1, '그래프가 Play 커서를 따라감');
});

// ── W1b. 관계뷰 탐색 — 업/다운스트림 이동 · 부문 연결 · ESC 상위 ─────────────
test('W1b 관계뷰 탐색 — KPI 업/다운스트림 · 부문 업스트림 = 운영+기여 KPI · ESC 상위', async () => {
  const st = await page.evaluate(() => {
    const V = window._v10, NOW = window.TWIN_DATA.meta.now;
    V.gotoFocus('KPI-RECUR');
    const up = V.relUp('KPI-RECUR');
    const down = V.relDown('KPI-RECUR', NOW);
    const crumb = document.getElementById('sceneCrumb').textContent;
    V.gotoFocus('DEPT-FIN');
    return { up, down, crumb, finUp: V.relUp('DEPT-FIN'), lineage: V.lineageOf('DEPT-FIN'),
      opsDown: V.relDown('AR-OPS', NOW).length };
  });
  assert.deepEqual(st.up, ['AR-FIN'], '경상이익률 업스트림 = 재무');
  assert.ok(st.down.includes('ND-OPEX') && st.down.includes('DEPT-FIN'), 'KPI 다운스트림 = 지표 + 실행 부문');
  assert.match(st.crumb, /미국판매법인.*재무.*경상이익률/, '브레드크럼 경로');
  assert.deepEqual(st.finUp, ['AR-OPS', 'KPI-RECUR', 'KPI-COMB', 'KPI-COMBR'], '재경 업스트림 = 운영 + 기여 KPI 3');
  assert.deepEqual(st.lineage, ['HQ-NA', 'SC-US', 'AR-OPS', 'DEPT-FIN'], '부문 계보 (권역본부부터)');
  assert.equal(st.opsDown, 9, '운영 다운스트림 = 부문 9');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  const focus = await page.evaluate(() => window._v10.focus());
  assert.equal(focus, 'AR-OPS', 'ESC = 한 단계 위(운영)');
  await page.evaluate(() => window._v10.gotoFocus('SC-US'));
});

// ── W1c. Quick Link — 현재 뷰 저장 · 클릭 이동 · 삭제 ───────────────────────
test('W1c Quick Link — 저장 · 이동 · 삭제', async () => {
  const st = await page.evaluate(() => {
    const V = window._v10;
    V.gotoFocus('ND-OPEX');
    document.getElementById('btnQL').click();
    const added = V.quickLinks().includes('ND-OPEX');
    V.gotoFocus('SC-US');
    const row = [...document.querySelectorAll('#qlList .qlRow')].find(r => r.textContent.includes('오피스 관리비'));
    row.click();
    const nav = V.focus();
    V.removeQuickLink('ND-OPEX');
    return { added, nav, removed: !V.quickLinks().includes('ND-OPEX') };
  });
  assert.ok(st.added, '★ 저장 → Quick Link 등록');
  assert.equal(st.nav, 'ND-OPEX', 'Quick Link 클릭 = 관계뷰 바로 이동');
  assert.ok(st.removed, '삭제 동작');
  await page.evaluate(() => window._v10.gotoFocus('SC-US'));
});

// ── W2. CEO KPI 트리 — 가중치·바인딩 정합 ───────────────────────────────────
test('W2 트리 — 영역 가중치 합 97 (재무 37·사업 35·지속경영 25) · 바인딩 값 정합', async () => {
  const st = await page.evaluate(() => {
    const NOW = window.TWIN_DATA.meta.now;
    const V = window._v10;
    const wByArea = {};
    V.KPIS.forEach(k => wByArea[k.parent] = (wByArea[k.parent] || 0) + k.w);
    const ms = Object.values(window.TWIN_DATA.actual[NOW].models);
    const md = Object.fromEntries(window.TWIN_DATA.models.map(m => [m.id, m]));
    const suvRef = Object.entries(window.TWIN_DATA.actual[NOW].models)
      .filter(([id]) => md[id].seg.includes('SUV') && !md[id].ev)
      .reduce((s, [, m]) => s + m.retail, 0);
    return {
      wByArea, totalW: V.AREAS.reduce((s, a) => s + a.w, 0),
      ws: V.bindVal('ws', NOW), wsRef: ms.reduce((s, m) => s + m.ws, 0),
      suv: V.bindVal('suv', NOW), suvRef,
      ev: V.bindVal('ev', NOW),
      share: V.bindVal('share', NOW), asp: V.bindVal('asp', NOW),
      recur: V.bindVal('recur', NOW), comb: V.bindVal('comb', NOW),
      ceo: V.ceoScore(NOW),
      naGreen: V.attain('KPI-GREEN', NOW),
    };
  });
  assert.deepEqual(st.wByArea, { 'AR-FIN': 37, 'AR-BIZ': 35, 'AR-ESG': 25 }, '영역별 KPI 가중치 합');
  assert.equal(st.totalW, 97, '3영역 가중치 합 97 (재무 37+사업 35+지속경영 25)');
  assert.equal(st.ws, st.wsRef, '도매판매량 = Σ 차종 도매');
  assert.equal(st.suv, st.suvRef, '볼륨 SUV = Terron+Vista 소매');
  assert.ok(st.ev > 0 && st.ev < st.wsRef, '친환경 소매 합리 범위');
  assert.ok(st.share > 5 && st.share < 15, `시장점유율 합리 범위 (${st.share.toFixed(1)}%)`);
  assert.ok(st.asp > 25000 && st.asp < 60000, `ASP 합리 범위 ($${Math.round(st.asp)})`);
  assert.ok(st.recur > 0 && st.recur < 20, `경상이익률 합리 범위 (${st.recur.toFixed(1)}%)`);
  assert.ok(st.comb > 0, '합산손익 > 0');
  assert.ok(st.ceo.score > 0.5 && st.ceo.score < 1.3, 'CEO 종합 가중 달성률');
  assert.equal(st.ceo.nNa, 3, '미연결 KPI 3개 (그린워싱·Full SI·보안)');
  assert.equal(st.naGreen, null, '그린워싱 = 미연결(null)');
});

// ── W3. 딥 체인 — 경상이익률 → 관리비 → 전력사용량 관계뷰 탐색 ──────────────
test('W3 딥 체인 — 관계뷰 이동 · 브레드크럼 경로 · 우 패널 시설 요약 · 그래프 전환', async () => {
  const st = await page.evaluate(() => {
    const V = window._v10, NOW = window.TWIN_DATA.meta.now;
    V.gotoFocus('KPI-RECUR');
    const recurDown = V.relDown('KPI-RECUR', NOW);
    V.gotoFocus('ND-OPEX');
    const opexDown = V.relDown('ND-OPEX', NOW);
    const opexCrumb = document.getElementById('sceneCrumb').textContent;
    V.gotoFocus('ND-ENERGY');
    return {
      recurDown, opexDown, opexCrumb,
      crumb: document.getElementById('sceneCrumb').textContent,
      fi: document.getElementById('focusInfo').textContent,
      graph: document.getElementById('graphTtl').textContent,
    };
  });
  assert.ok(st.recurDown.includes('ND-OPEX'), '경상이익률 다운스트림에 관리비 폴더');
  assert.deepEqual(st.opexDown.slice(0, 3), ['ND-ENERGY', 'ND-LEASE', 'ND-SUPPLY'], '관리비 하위 3 (전력·임차·소모품)');
  assert.match(st.opexCrumb, /재무.*경상이익률.*오피스 관리비/, '브레드크럼 경로');
  assert.match(st.crumb, /경상이익률.*오피스 관리비.*전력사용량/, '전체 딥 체인 경로');
  assert.ok(st.fi.includes('동관') && st.fi.includes('서관'), '우 패널 = 시설 원장 요약 (동관·서관)');
  assert.ok(st.fi.includes('항온'), '항온존 제외 노트 (레버는 전략 월드)');
  assert.match(st.graph, /전력사용량/, '하단 그래프 = 전력 시계열로 전환');
  await page.evaluate(() => window._v10.gotoFocus('SC-US'));
});

// ── W4. HVAC 전략 레버 — 절감액 계산 + 업스트림 즉시 전파 ───────────────────
test('W4 레버 — 피크 +2°C·예냉 -2°C ≈ $10만/월 절감 → 관리비·경상이익률 반영', async () => {
  const st = await page.evaluate(() => {
    const NOW = window.TWIN_DATA.meta.now;
    const V = window._v10;
    const sv = V.hvacSavings(NOW, 2, 2);
    const winterSv = V.hvacSavings(24, 2, 2);           // 2026-01 (비냉방기)
    const energy0 = V.bindVal('energy', NOW);
    const recur0 = V.bindVal('recur', NOW);
    const comb0 = V.bindVal('comb', NOW);
    V.setLever('peak', 2); V.setLever('pre', 2); V.applyLever(true);
    const energy1 = V.bindVal('energy', NOW);
    const recur1 = V.bindVal('recur', NOW);
    const comb1 = V.bindVal('comb', NOW);
    const badge = [...document.querySelectorAll('#scene text')].some(t => t.textContent.includes('HVAC 레버 적용'));
    V.applyLever(false); V.setLever('peak', 0); V.setLever('pre', 0);
    return { sv, winterSv, dEnergy: energy0 - energy1, dRecur: recur1 - recur0, dComb: comb1 - comb0, badge };
  });
  assert.ok(st.sv > 5000 && st.sv < 16000, `8월(냉방기) 절감 ≈ $1만/월 (실제 $${Math.round(st.sv)})`);
  assert.ok(st.winterSv < st.sv * 0.5, '비냉방기 절감은 냉방기 대비 축소');
  assert.ok(Math.abs(st.dEnergy - st.sv) < 1, '전력사용량 = 절감액만큼 감소');
  assert.ok(st.dRecur > 0, '경상이익률 즉시 상승 (업스트림 전파)');
  assert.ok(Math.abs(st.dComb - st.sv) < 1, '합산손익 += 절감액');
  assert.ok(st.badge, '씬에 레버 적용 배지');
});

// ── W5. 미연결 KPI — 우 패널 신설 버튼 → 프로젝트 생성 · 수집중 전환 ────────
test('W5 미연결 — 그린워싱 포커스 신설 버튼(우 패널) → 프로젝트 생성 · 수집중 배지', async () => {
  await page.evaluate(() => window._v10.gotoFocus('KPI-GREEN'));
  const st0 = await page.evaluate(() => ({
    note: document.getElementById('focusInfo').textContent,
    graphNote: document.getElementById('graphTtl').textContent,
    btn: !!document.querySelector('#focusInfo [data-dcp]'),
  }));
  assert.match(st0.note, /미연결/, '우 패널 미연결 안내');
  assert.match(st0.graphNote, /미연결/, '그래프 = 미연결 노트');
  assert.ok(st0.btn, '데이터 수집 프로젝트 신설 버튼 (우 패널)');
  const st = await page.evaluate(() => {
    const n0 = window._v10.projects().length;
    document.querySelector('#focusInfo [data-dcp]').click();
    const btnGone = !document.querySelector('#focusInfo [data-dcp]');
    window._v10.gotoFocus('AR-ESG');                 // 지속경영 관계뷰에서 KPI 카드 확인
    return {
      n0, n1: window._v10.projects().length, btnGone,
      collecting: window._v10.dataProjects.has('KPI-GREEN'),
      sceneSub: [...document.querySelectorAll('#scene g.rel text')].some(t => t.textContent.includes('수집중')),
    };
  });
  assert.equal(st.n1, st.n0 + 1, '프로젝트 신설');
  assert.ok(st.collecting, 'dataProjects 등록');
  assert.ok(st.btnGone, '신설 후 버튼 → 수집중 전환');
  assert.ok(st.sceneSub, '관계뷰 KPI 카드 배지 → 수집중');
  await page.evaluate(() => window._v10.gotoFocus('SC-US'));
});

// ── W6. 게이트 결재 — HITL 승인 → 자동 게이트 전개 (기존 계약 유지) ─────────
test('W6 게이트 — ORD-1 승인 시 G3 자동 전송 · 과거 월 감사 이력', async () => {
  const st = await page.evaluate(() => {
    const NOW = window.TWIN_DATA.meta.now;
    window._v10.seek(NOW);
    const before = window._v10.pendingGates(NOW).map(g => g.act + '/' + g.gate);
    window._v10.approveGate('ORD-1', 'G2');
    const after = window._v10.gatesAt(NOW).filter(g => g.act === 'ORD-1').map(g => g.gate + ':' + g.status);
    const past = window._v10.gatesAt(NOW - 1);
    return { before, after, pastPend: past.filter(g => g.status === '검토대기').length };
  });
  assert.ok(st.before.includes('ORD-1/G2') && st.before.includes('BP-1/G2'), '결재함 대기');
  assert.deepEqual(st.after, ['G1:실행완료', 'G2:승인', 'G3:실행완료'], '승인 → 생산법인 전송 자동 실행');
  assert.equal(st.pastPend, 0, '과거 월 = 감사 이력');
});

// ── W7. 프로젝트 원장 — KPI 경로·리뷰 판정 ──────────────────────────────────
test('W7 프로젝트 — 원장 6건 · KPI 경로 매핑 · OTA/그레이 달성 · 컴포저 추가', async () => {
  const st = await page.evaluate(() => {
    const NOW = window.TWIN_DATA.meta.now;
    const V = window._v10;
    const ps = V.projects();
    const ota = V.prjReviews('PRJ-OTA-LUM', NOW);
    const grayPath = V.pathOf(ps.find(p => p.id === 'PRJ-GRAY-ORD').goal).map(n => n.id);
    const imp = V.tmplImpact('facility', '', '', NOW);
    const p = V.addProject({ tmpl: 'incent', goal: 'KPI-WS', model: 'TRN', zone: 'west' });
    return {
      n: ps.filter(p => !p.added).length,
      otaLast: ota[ota.length - 1], grayPath, imp,
      added: { goal: p.goal, links: p.links, verdict: V.prjReviews(p.id, NOW).pop().verdict },
    };
  });
  assert.equal(st.n, 6, '거버넌스 프로젝트 원장 6건');
  assert.equal(st.otaLast.verdict, '달성', 'OTA 클레임 달성');
  assert.deepEqual(st.grayPath, ['AR-BIZ', 'KPI-WS', 'ND-DS'], '그레이 증산 → 사업영역›도매판매량›DS 경로');
  assert.ok(st.imp.expect > 4000, '에너지 템플릿 기대 절감 산출');
  assert.equal(st.added.goal, 'KPI-WS', '컴포저 목표 노드');
  assert.ok(st.added.links.includes('model:TRN') && st.added.links.includes('salesZone:west'), '온톨로지 연계 객체');
  assert.equal(st.added.verdict, '측정중', '추가 직후 리뷰 = 측정중');
});

// ── W8. 온톨로지 — facility·energyMeter 인스턴스 해석 ───────────────────────
test('W8 온톨로지 — 시설·계측 객체 인스턴스와 링크', async () => {
  const st = await page.evaluate(() => ({
    fac: window._v10.resolveLink('facility:FC-EAST'),
    meter: window._v10.resolveLink('energyMeter:EM-E1-SRV'),
    fu: window._v10.resolveLink('featureUsageEvent:FU-2026-08-LUM'),
    ml: window._v10.resolveLink('mlModel:ML-KPI-FCST-V0'),
    types: window.ONTOLOGY.objectTypes.length,
    links: window.ONTOLOGY.linkTypes.length,
    action: window.ONTOLOGY.actionTypes.some(a => a.id === 'adjustHvacSetpoint'),
    mlActs: ['logFeatureUsage', 'trainForecastModel', 'discoverKpiDrivers']
      .every(id => window.ONTOLOGY.actionTypes.some(a => a.id === id)),
  }));
  assert.ok(st.fac.found && st.fac.title === '동관', 'facility:FC-EAST = 동관');
  assert.ok(st.fac.links >= 12, '동관 ↔ 계측 링크 12+ (층별)');
  assert.ok(st.meter.found, '층 계측 인스턴스');
  assert.ok(st.fu.found, '차량 기능 사용 인스턴스 (feature_usage 마트)');
  assert.ok(st.ml.found && st.ml.links >= 2, '학습 모델 레지스트리 + 학습 피처 링크');
  assert.equal(st.types, 32, '객체 타입 32 (featureUsageEvent·mlModel·marketSnapshot 추가)');
  assert.equal(st.links, 62, '링크 타입 62 (학습 기반 4종 + marketOfSc 추가)');
  assert.ok(st.action, 'adjustHvacSetpoint 액션 선언');
  assert.ok(st.mlActs, '학습 액션 3종 (적재·학습·드라이버 발굴) 선언');
});

// ── W9. 월드 소환 + ESC ─────────────────────────────────────────────────────
test('W9 월드 소환 — 운영 월드 V9 iframe · 닫기 · ESC 관계뷰 상위', async () => {
  await page.evaluate(() => window._v10.openWorld('v9'));
  await page.waitForFunction(() => {
    const f = document.getElementById('worldFrame');
    return f && f.src.includes('v9-lifecycle-twin');
  });
  let frame = null;                       // 프레임 등록은 src 반영보다 늦을 수 있어 재시도
  for (let t = 0; t < 50 && !frame; t++) {
    frame = page.frames().find(f => f.url().includes('v9-lifecycle-twin'));
    if (!frame) await page.waitForTimeout(100);
  }
  assert.ok(frame, 'V9 프레임 존재');
  await frame.waitForFunction(() => typeof window._v9 === 'object', null, { timeout: 15000 });
  const hdr = await page.evaluate(() => ({
    crumb: document.getElementById('hdCrumb').textContent,
    back: getComputedStyle(document.getElementById('btnBack')).display !== 'none',
    worldHd: !!document.getElementById('worldHd'),
  }));
  assert.match(hdr.crumb, /운영 월드/, '헤더 브레드크럼 › 운영 월드');
  assert.ok(hdr.back, '[월드로 돌아가기] 버튼 표시');
  assert.equal(hdr.worldHd, false, '별도 월드 제목줄 없음 (제목줄 1개)');
  const v9HdrHidden = await frame.evaluate(() => getComputedStyle(document.querySelector('header')).display === 'none');
  assert.ok(v9HdrHidden, '임베드 시 V9 자체 제목줄 숨김 (제목줄 1개)');
  await page.evaluate(() => window._v10.closeWorld());
  await page.evaluate(() => window._v10.gotoFocus('AR-FIN'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  const st = await page.evaluate(() => ({
    world: document.getElementById('world').classList.contains('open'),
    focus: window._v10.focus(),
    crumbHidden: document.getElementById('hdCrumb').style.display === 'none',
  }));
  assert.equal(st.world, false, '월드 닫힘');
  assert.equal(st.focus, 'SC-US', 'ESC = 관계뷰 한 단계 위');
  assert.ok(st.crumbHidden, '닫으면 브레드크럼 숨김');
});

// ── W11. 전략 월드(오피스 관리비) — KPI 리스트·씬 전환·Play·미래 시뮬·환류 ──
test('W11 관리비 월드 — 소환 · KPI 씬 전환 · Play/미래 시뮬 · 적용 시 V10 환류', async () => {
  // 오피스 관리비 포커스 옆 전용 전략 월드 칩 (구현된 월드만 노출)
  await page.evaluate(() => {
    window._v10.applyLever(false); window._v10.setLever('peak', 0); window._v10.setLever('pre', 0);
    window._v10.gotoFocus('ND-OPEX');
  });
  const hasChip = await page.evaluate(() =>
    [...document.querySelectorAll('#scene g.rel text')].some(t => t.textContent.includes('전략 월드 — 관리비')));
  assert.ok(hasChip, 'ND-OPEX 포커스 옆 [⚡ 전략 월드 — 관리비] 칩');

  await page.evaluate(() => window._v10.openWorld('opex', '#i=31&peak=0&pre=0'));
  let frame = null;
  for (let t = 0; t < 50 && !frame; t++) {
    frame = page.frames().find(f => f.url().includes('v10-opex-sim'));
    if (!frame) await page.waitForTimeout(100);
  }
  assert.ok(frame, '관리비 월드 프레임 존재');
  await frame.waitForFunction(() => typeof window._vo === 'object', null, { timeout: 15000 });

  const st = await frame.evaluate(() => {
    const V = window._vo;
    const n1 = V.NOWi + 1;
    const eBase = V.kpiVal('energy', n1, null);
    V.set('peak', 2); V.set('pre', 2);
    const eLev = V.kpiVal('energy', n1, V.LV);
    const kpiTiles = document.querySelectorAll('#kpiList .kpiTile').length;
    const zRects0 = document.querySelectorAll('#scene rect').length;
    V.select('lease');
    const leaseTtl = document.querySelector('#scene text').textContent;
    const leaseLevers = document.querySelectorAll('#levers .lv').length;
    V.set('renego', 0.05);
    const lLev = V.kpiVal('lease', n1, V.LV), lBase = V.kpiVal('lease', n1, null);
    V.select('supplies');
    const supLevers = document.querySelectorAll('#levers .lv').length;
    V.select('energy');
    // Play 구간: 실적 → NOW 넘어 SIMULATED
    V.seek(V.NOWi); const modeA = document.getElementById('modeLbl').textContent;
    V.seek(V.NOWi + 3); const modeS = document.getElementById('modeLbl').textContent;
    const chart = document.querySelectorAll('#simChart path').length;
    return { zones: V.zones.length, embed: V.EMBED, maxi: V.MAXI,
      eBase, eSave: eBase - eLev, kpiTiles, zRects0, leaseTtl, leaseLevers, lSave: lBase - lLev,
      supLevers, modeA, modeS, chart };
  });
  assert.equal(st.zones, 24, '구역 24개 (동관 13 + 서관 11, 3층)');
  assert.ok(st.embed, 'iframe 소환 상태 인지');
  assert.equal(st.maxi, 43, '타임라인 = 실적 32 + 미래 12개월');
  assert.equal(st.kpiTiles, 4, '좌 레일 = 합계 + 전력·임차·소모품');
  assert.ok(st.zRects0 >= 24, '전력 씬 구역 렉트');
  assert.ok(st.eSave > 5000 && st.eSave < 16000, `9월 전력 절감 ≈ $1만 ($${Math.round(st.eSave)})`);
  assert.match(st.leaseTtl, /임차/, 'KPI 클릭 → 임차 씬 전환');
  assert.equal(st.leaseLevers, 2, '임차 레버 2종 (재계약·반납)');
  assert.ok(st.lSave > 30000, '임차 재계약 -5% → 절감');
  assert.equal(st.supLevers, 1, '소모품 레버 1종');
  assert.equal(st.modeA, '실적', 'NOW = 실적 모드');
  assert.equal(st.modeS, 'SIMULATED', 'NOW+3 = SIMULATED 모드');
  assert.ok(st.chart >= 4, '미래 시뮬 그래프 (실적·기준·레버·절감 영역)');

  // 제목줄 1개: V10 헤더 브레드크럼 + 임베드 시 자체 헤더 숨김 + V10 Play 가려짐
  const ui = await page.evaluate(() => {
    const w = document.getElementById('world').getBoundingClientRect();
    return {
      crumb: document.getElementById('hdCrumb').textContent,
      back: getComputedStyle(document.getElementById('btnBack')).display !== 'none',
      coversFooter: w.bottom >= innerHeight - 1,
    };
  });
  assert.match(ui.crumb, /오피스 관리비/, 'V10 제목줄에 › 전략 월드 — 오피스 관리비');
  assert.ok(ui.back, '온톨로지 옆 [월드로 돌아가기] 버튼');
  assert.ok(ui.coversFooter, '오버레이가 V10 Play 푸터까지 덮음');
  const inner = await frame.evaluate(() => ({
    hdrHidden: document.querySelector('header').style.display === 'none',
    modeBtns: document.querySelectorAll('#modeBar button').length,
  }));
  assert.ok(inner.hdrHidden, '임베드 시 자체 제목줄 숨김 (제목줄 1개)');
  assert.equal(inner.modeBtns, 3, '씬 모드 3종 (구역·히트맵·흐름)');

  // 씬 모드 전환: 온도 히트맵(구역×요일×시간 — 주간 전개/요일 슬라이스) · 전력 흐름
  const modes = await frame.evaluate(() => {
    const V = window._vo;
    V.setMode('heat');
    const weekCells = document.querySelectorAll('#scene rect[data-h]').length;
    const dayBtns = document.querySelectorAll('#dayBar button').length;
    V.setDay(5);                                       // 토요일 슬라이스
    const satCells = document.querySelectorAll('#scene rect[data-h]').length;
    const z = V.zones.find(x => x.typ === '사무');
    const wkdT = V.hourTemp(z, V.NOWi, 14, 2), satT = V.hourTemp(z, V.NOWi, 14, 5);
    const shw = V.zones.find(x => x.id === 'W1-SHW');
    const shwSat = V.hourTemp(shw, V.NOWi, 14, 5), shwWkd = V.hourTemp(shw, V.NOWi, 14, 2);
    V.setDay('week');
    const heatCells = weekCells;
    V.setMode('flow');
    const F = V.flowData(V.NOWi);
    const flowTxt = document.getElementById('scene').textContent;
    const parts = document.querySelectorAll('#scene circle').length;
    V.setMode('zone');
    return { heatCells, dayBtns, satCells, wkdT, satT, shwSat, shwWkd, F, parts,
      hasSolar: flowTxt.includes('태양광'), hasEV: flowTxt.includes('EV 충전기'), hasGrid: flowTxt.includes('그리드') };
  });
  assert.equal(modes.heatCells, 24 * 7 * 24, `주간 전개 = 구역×요일×시간 4032셀 (${modes.heatCells})`);
  assert.equal(modes.dayBtns, 8, '요일 칩 8개 (주간 전개 + 월~일)');
  assert.equal(modes.satCells, 24 * 24, '요일 슬라이스 = 구역×시간 576셀');
  assert.ok(modes.satT > modes.wkdT, `주말 셋백: 토 ${modes.satT}° > 평일 ${modes.wkdT}° (냉방월)`);
  assert.equal(modes.shwSat, modes.shwWkd, '쇼룸(전시·딜러 라운지)은 토요일도 운영 온도');
  assert.ok(modes.hasGrid && modes.hasSolar && modes.hasEV, '흐름 노드: 그리드·태양광·EV 충전기');
  assert.ok(modes.F.solar > 50000 && modes.F.grid > 0 && modes.F.ev > 30000, '흐름 모델 값 합리 범위');
  assert.ok(modes.F.selfPct > 5 && modes.F.selfPct < 50, `자가발전 비율 (${modes.F.selfPct.toFixed(1)}%)`);
  assert.ok(modes.parts >= 5, '흐름 파티클');

  // 씬 확대/이동: 휠 줌 → viewBox 축소, 더블클릭 → 초기화
  const zoom = await frame.evaluate(() => {
    const sc = document.getElementById('scene');
    const r = sc.getBoundingClientRect();
    const w0 = window._vo.view().w;
    sc.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, clientX: r.left + r.width/2, clientY: r.top + r.height/2, bubbles: true, cancelable: true }));
    const w1 = window._vo.view().w;
    sc.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return { w0, w1, w2: window._vo.view().w };
  });
  assert.ok(zoom.w1 < zoom.w0, '휠 → 확대 (viewBox 축소)');
  assert.equal(zoom.w2, 1000, '더블클릭 → 초기화');

  // [트윈 월드에 적용] → postMessage 환류 → V10 레버 적용 + ND-OPEX 복귀
  await frame.evaluate(() => window._vo.apply());
  await page.waitForTimeout(300);
  const back = await page.evaluate(() => ({
    applied: window._v10.hvacLever.applied, peak: window._v10.hvacLever.peak,
    worldOpen: document.getElementById('world').classList.contains('open'),
    focus: window._v10.focus(),
    focusTtl: document.getElementById('focusTtl').textContent,
    leverNote: document.getElementById('focusInfo').textContent.includes('HVAC 레버 적용 중'),
  }));
  assert.ok(back.applied && back.peak === 2, '트윈 월드 레버로 환류 적용');
  assert.equal(back.worldOpen, false, '월드 닫힘 (Seamless 복귀)');
  assert.equal(back.focus, 'ND-OPEX', '오피스 관리비 관계뷰로 복귀');
  assert.ok(back.focusTtl.includes('오피스 관리비'), '우 패널 포커스 = 오피스 관리비');
  await page.evaluate(() => { window._v10.applyLever(false); window._v10.setLever('peak', 0); window._v10.setLever('pre', 0); window._v10.gotoFocus('SC-US'); });
});

// ── W12. 부문 운영 월드 — V9 문법: 탭·레일·씬·트렌드·피드·Play — 조직별 생성 ──
test('W12 부문 운영 월드 — V9 구성요소(레일·씬·트렌드·피드·Play) · 9부문 · 게이트 · 액션', async () => {
  const st = await page.evaluate(() => {
    const V = window._v10, NOW = window.TWIN_DATA.meta.now;
    V.openDeptWorld('DEPT-SLS');
    return {
      open: document.getElementById('deptWorld').classList.contains('open'),
      tabs: document.querySelectorAll('#dwTabs button').length,
      railSteps: document.querySelectorAll('#dwRail .dwStep').length,
      stations: document.querySelectorAll('#dwScene g.wNode').length,
      particles: document.querySelectorAll('#dwScene circle').length,
      loop: document.getElementById('dwScene').textContent.includes('폐루프'),
      trendPaths: document.querySelectorAll('#dwTrend path').length,
      trendTtl: document.getElementById('dwTrendTtl').textContent,
      feedActs: document.querySelectorAll('#dwFeed .actBtn').length,
      ring: !!document.getElementById('dwRing'),
      ringDots: document.querySelectorAll('#dwRing circle').length,
      ringCenter: document.getElementById('dwRing').textContent,
      footer: !!document.getElementById('dwTl') && !!document.getElementById('dwPlay'),
      crumb: document.getElementById('hdCrumb').textContent,
      depts: V.DEPTS.map(d => d.name),
      ordStatus: V.stepStatus('ORD-1', NOW),
      slsGates: V.deptGates('DEPT-SLS', NOW).length,
    };
  });
  assert.ok(st.open, '부문 운영 월드 오픈');
  assert.equal(st.tabs, 9, '부문 탭 9개');
  assert.deepEqual(st.depts, ['판매', '마케팅', '상품', '재경', '서비스', '품질', '안전', 'IT', '인사/총무'], '조직 9부문');
  assert.equal(st.railSteps, 4, '좌 레일 스텝 카드 4 (V9 단계 리스트 문법)');
  assert.equal(st.stations, 4, '씬 스테이션 4 (게이트 칩 포함)');
  assert.ok(st.particles >= 4, '진행·폐루프 파티클');
  assert.ok(st.loop, '폐루프 리턴 채널 라벨');
  assert.ok(st.trendPaths >= 2, '트렌드 밴드 = 실적+기준 라인 (공용 차트)');
  assert.match(st.trendTtl, /게이트 처리/, '부문 기본 트렌드 = 월 게이트 처리');
  assert.ok(st.feedActs >= 6, '우 피드 온톨로지 액션 버튼');
  assert.ok(st.ring, '좌 레일 하단 연간 사이클 링');
  assert.equal(st.ringDots, 4 + 4 * 12, '링 4(가이드) + 스텝 4 × 12개월 점');
  assert.match(st.ringCenter, /실행 창 2\/4/, '커서 월(8월) 실행 창 = 월 주문 + 도소매 상시');
  assert.ok(st.footer, 'Play 푸터 (V9 문법)');
  assert.match(st.crumb, /운영 월드 — 판매/, '제목줄 1개 — 헤더 브레드크럼');
  assert.match(st.ordStatus, /G/, '월 생산 주문 = 게이트 원장 상태');
  assert.ok(st.slsGates >= 3, '판매 부문 이번 달 게이트 원장');
  // 스텝 선택 → 트렌드·피드 연동
  const sel = await page.evaluate(() => {
    window._v10.dwSelect('ORD-1');
    return {
      trend: document.getElementById('dwTrendTtl').textContent,
      feedCards: document.querySelectorAll('#dwFeed .fiCard').length,
      railSel: !!document.querySelector('#dwRail .dwStep.sel'),
    };
  });
  assert.match(sel.trend, /월 생산 주문/, '스텝 선택 → 트렌드 전환');
  assert.equal(sel.feedCards, 2, '피드 = 선택 스텝 + 폐루프 노트');
  assert.ok(sel.railSel, '레일 선택 상태 동기화');
  await page.evaluate(() => window._v10.dwSelect('ORD-1'));   // 해제
  // 탭 전환: 인사/총무 — HVAC 전략 스텝 + 전략 월드 액션 + 미연결 스텝
  const hr = await page.evaluate(() => {
    document.querySelector('#dwTabs button[data-d="DEPT-HR"]').click();
    return {
      steps: document.querySelectorAll('#dwRail .dwStep').length,
      opexBtn: [...document.querySelectorAll('#dwFeed .actBtn')].some(b => b.textContent.includes('오피스 관리비')),
      naStep: document.getElementById('dwFeed').textContent.includes('수집 프로젝트 대상'),
    };
  });
  assert.equal(hr.steps, 3, '인사/총무 스텝 3');
  assert.ok(hr.opexBtn, 'HVAC 스텝 → 전략 월드(오피스 관리비) 액션');
  assert.ok(hr.naStep, '미연결 스텝(인력 운영) 표시');
  // 푸터 슬라이더 = 메인 커서 공유
  const tl = await page.evaluate(() => {
    const tl = document.getElementById('dwTl');
    tl.value = '10'; tl.dispatchEvent(new Event('input'));
    const ym = document.getElementById('dwYm').textContent;
    window._v10.seek(window.TWIN_DATA.meta.now);
    return ym;
  });
  assert.equal(tl, '2024-11', '부문 월드 타임라인 = 메인 seek 공유');
  await page.evaluate(() => window._v10.closeDeptWorld());
  const closed = await page.evaluate(() => ({
    open: document.getElementById('deptWorld').classList.contains('open'),
    crumbHidden: document.getElementById('hdCrumb').style.display === 'none',
  }));
  assert.equal(closed.open, false, '닫기');
  assert.ok(closed.crumbHidden, '브레드크럼 복원');
});

// ── W12b. 관계뷰 씬 — 컨테이너 비율 뷰박스 (Y축 영역 채움) ──────────────────
test('W12b 씬 뷰박스 — 컨테이너 종횡비 일치 · 레터박스 없음', async () => {
  const st = await page.evaluate(() => {
    const wrap = document.getElementById('sceneWrap').getBoundingClientRect();
    const vb = document.getElementById('scene').getAttribute('viewBox').split(' ').map(Number);
    return { wrapAspect: wrap.width / wrap.height, vbAspect: vb[2] / vb[3], vh: vb[3] };
  });
  assert.ok(Math.abs(st.wrapAspect - st.vbAspect) < 0.05, `씬 뷰박스 비율 = 컨테이너 비율 (${st.vbAspect.toFixed(2)} vs ${st.wrapAspect.toFixed(2)})`);
  assert.ok(st.vh >= 430 && st.vh <= 820, '설계 높이 클램프 범위');
});

// ── W13. 온톨로지 데이터뷰 — 워크플로우 액션 실행 → 탐색기 딥링크 ────────────
test('W13 데이터뷰 — 액션 실행 = 탐색기 #act 딥링크 (관계뷰 + 트윈 데이터뷰) · 해시 재소환', async () => {
  await page.evaluate(() => window._v10.runOntoAction('ACT:QLT-1:0'));    // classifyVocDaily
  let frame = null;
  for (let t = 0; t < 60 && !frame; t++) {
    frame = page.frames().find(f => f.url().includes('v7-ontology-explorer'));
    if (!frame) await page.waitForTimeout(100);
  }
  assert.ok(frame, '온톨로지 탐색기 프레임');
  assert.match(frame.url(), /#act:classifyVocDaily/, '#act 딥링크 해시');
  await frame.waitForFunction(() => window._focusDebug && window._focusDebug.focusOn === 'vocTicket', null, { timeout: 20000 });
  // 해시만 바꿔 재소환(hashchange 경로) — 트윈 데이터뷰(map) 액션까지 자동 오픈
  await page.evaluate(() => window._v10.runOntoAction('ACT:IT-1:0'));     // recordDrivingTrip
  await frame.waitForFunction(() => window._focusDebug && window._focusDebug.focusOn === 'telematicsEvent'
    && window._twinPanel && window._twinPanel.open, null, { timeout: 30000 });
  const tw = await frame.evaluate(() => window._twinPanel);
  assert.equal(tw.action, 'recordDrivingTrip', '트윈 데이터뷰 = Trip 지도 액션');
  // 객체 타입 딥링크(#focus:)
  await page.evaluate(() => window._v10.runOntoAction('ACT:HR-2:0'));     // facility 객체
  await frame.waitForFunction(() => window._focusDebug && window._focusDebug.focusOn === 'facility', null, { timeout: 20000 });
  await page.evaluate(() => window._v10.closeWorld());
});

// ── W14. 인트로 시네마틱 — 첫 진입 재생 · 씬 진행 · 건너뛰기 · 재생 버튼 ─────
test('W14 인트로 — 6씬 재생 · 클릭 진행 · 건너뛰기 → localStorage · ✦ 재생', async () => {
  const st0 = await page.evaluate(() => ({
    open: document.getElementById('intro').classList.contains('open'),   // 플래그 세팅 → 자동 재생 없음
    scenes: document.querySelectorAll('#intro .iScene').length,
    bars: document.querySelectorAll('#introBar i').length,
    stars: document.querySelectorAll('#introStars circle').length,
  }));
  assert.equal(st0.open, false, '본 사용자는 자동 재생 없음');
  assert.equal(st0.scenes, 6, '씬 6개');
  assert.equal(st0.bars, 6, '쇼츠식 프로그레스 6분절');
  assert.ok(st0.stars >= 40, '별 배경');
  const st = await page.evaluate(() => {
    window._v10.introShow();
    const open = document.getElementById('intro').classList.contains('open');
    const sc0 = document.querySelector('#intro .iScene[data-sc="0"]').classList.contains('on');
    document.getElementById('intro').click();                            // 클릭 = 다음 씬
    const idx = window._v10.introIdx();
    window._v10.introClose();
    return { open, sc0, idx,
      closed: !document.getElementById('intro').classList.contains('open'),
      seen: localStorage.getItem('v10_intro_seen') === '1' };
  });
  assert.ok(st.open && st.sc0, '재생 시작 = 씬 0');
  assert.equal(st.idx, 1, '클릭 → 다음 씬');
  assert.ok(st.closed && st.seen, '닫으면 시청 플래그 저장');
});

// ── W15. FORECAST — 학습 모델 v0 (시즌+추세) 예측 구간 ──────────────────────
test('W15 예측 — 학습 v0 12개월 FORECAST · 그래프 NOW 분리선 · 합리 범위', async () => {
  const st = await page.evaluate(() => {
    const V = window._v10, NOW = window.TWIN_DATA.meta.now;
    V.gotoFocus('KPI-WS');
    const s = V.seriesOf('KPI-WS');
    const svgTxt = document.getElementById('graphSvg').textContent;
    const ttl = document.getElementById('graphTtl').textContent;
    const last12 = s.va.slice(NOW - 11).reduce((a, b) => a + b, 0) / 12;
    const fcAvg = s.fc.reduce((a, b) => a + b, 0) / s.fc.length;
    V.gotoFocus('SC-US');
    return { fcLen: s.fc.length, ratio: fcAvg / last12,
      fcLbl: svgTxt.includes('FORECAST'), nowLbl: svgTxt.includes('NOW'),
      ttlFc: ttl.includes('예측'), stepFc: !V.seriesOf('ORD-1') || !V.seriesOf('ORD-1').fc };
  });
  assert.equal(st.fcLen, 12, '12개월 예측');
  assert.ok(st.ratio > 0.85 && st.ratio < 1.35, `예측 평균이 최근 실적과 합리 범위 (${st.ratio.toFixed(2)}×)`);
  assert.ok(st.fcLbl && st.nowLbl, 'FORECAST 라벨 + NOW 분리선');
  assert.ok(st.ttlFc, '타이틀에 +12M 예측');
  assert.ok(st.stepFc, '게이트 건수 시계열은 예측 제외');
});

// ── W16. 차량 데이터 전략 월드 — 신호·드라이버 발굴·레버·환류 ────────────────
test('W16 차량 데이터 월드 — IT 칩 소환 · 드라이버 상관 · 레버 미래 재생성 · 프로젝트 환류', async () => {
  const chips = await page.evaluate(() => window._v10.focusShortcuts('DEPT-IT').map(s => s.lbl));
  assert.ok(chips.some(l => l.includes('차량 데이터')), 'IT 부문 포커스 칩 = 차량 데이터 전략 월드');
  await page.evaluate(() => window._v10.openWorld('vdata', '#i=31'));
  let frame = null;
  for (let t = 0; t < 60 && !frame; t++) {
    frame = page.frames().find(f => f.url().includes('v10-vehicle-sim'));
    if (!frame) await page.waitForTimeout(100);
  }
  assert.ok(frame, '차량 데이터 월드 프레임');
  await frame.waitForFunction(() => typeof window._vv === 'object', null, { timeout: 15000 });
  const st = await frame.evaluate(() => {
    const V = window._vv, NOW = V.NOWi;
    const cs = V.corrs();
    const dtcCsi = cs.find(c => c.sig === 'dtc' && c.kpi === 'csi_total');
    const lumConn = cs.find(c => c.mid === 'LUM');
    const aurQ = cs.find(c => c.mid === 'AUR');
    const base = V.fleetVal('dtc', NOW + 12, null);
    V.set('fota', 1); V.set('ews', 1);
    const lev = V.fleetVal('dtc', NOW + 12, V.LV);
    const im = V.impact(V.LV);
    return {
      embed: V.EMBED, maxi: V.MAXI, sigs: V.SIGS.length,
      tiles: document.querySelectorAll('#sigList .sigTile').length,
      hmCells: document.querySelectorAll('#scene rect').length,
      drvRows: document.querySelectorAll('#drvList .drv').length,
      dtcCsiR: dtcCsi.r, lumConnR: lumConn.r, aurQR: aurQ.r,
      leverTag: [...document.querySelectorAll('#drvList .tag.lever')].length,
      dtcCut: (base - lev) / base, csiGain: im.csiGain,
      chart: document.querySelectorAll('#simChart path').length,
      hdrHidden: document.querySelector('header').style.display === 'none',
    };
  });
  assert.ok(st.embed && st.hdrHidden, '임베드 — 제목줄 1개');
  assert.equal(st.maxi, 43, '실적 32 + 미래 12개월');
  assert.equal(st.sigs, 6, '신호 6종 (HDA·트레일러·FOTA·옵트인·DTC·Trip)');
  assert.equal(st.tiles, 6, '좌 레일 신호 타일');
  assert.ok(st.hmCells >= 36, '차종 6 × 신호 6 히트맵');
  assert.ok(st.drvRows >= 6, 'KPI 드라이버 랭킹 보드');
  assert.ok(st.dtcCsiR < -0.25, `플릿 DTC ↔ 내부 CSI 음의 상관 (r=${st.dtcCsiR.toFixed(2)})`);
  assert.ok(st.lumConnR < -0.9, `LUM DTC ↔ 커넥티드 지수 강한 음의 상관 발굴 (r=${st.lumConnR.toFixed(2)})`);
  assert.ok(st.aurQR < -0.9, `AUR DTC ↔ 품질 지수 강한 음의 상관 발굴 (r=${st.aurQR.toFixed(2)})`);
  assert.ok(st.leverTag >= 2, '레버 후보 태그 (|r|≥0.7 — DTC 드라이버 2종)');
  assert.ok(st.dtcCut > 0.2, `레버(FOTA+조기경보) → 12개월 후 DTC −${Math.round(st.dtcCut * 100)}%`);
  assert.ok(st.csiGain > 0.5, '기대 임팩트 — 내부 CSI 상승');
  assert.ok(st.chart >= 4, '기준 vs 레버 미래 차트');
  // [트윈 월드에 적용] → 데이터 프로젝트 환류
  const n0 = await page.evaluate(() => window._v10.projects().length);
  await frame.evaluate(() => window._vv.apply());
  await page.waitForTimeout(300);
  const back = await page.evaluate(() => ({
    n: window._v10.projects().length,
    focus: window._v10.focus(),
    worldOpen: document.getElementById('world').classList.contains('open'),
  }));
  assert.equal(back.n, n0 + 1, '차량 데이터 레버 → 프로젝트 등록');
  assert.equal(back.focus, 'DEPT-IT', 'IT 부문 관계뷰로 복귀');
  assert.equal(back.worldOpen, false, '월드 닫힘 (Seamless)');
  await page.evaluate(() => window._v10.gotoFocus('SC-US'));
});

// ── W17. 법인 프로필 주입 + 딥링크 무플래시 ─────────────────────────────────
// entity-config.js(development/entity-profile.md 빌드 생성물)가 법인명을 오버라이드하고,
// 탐색기 딥링크 진입 시 기본 제목줄이 첫 페인트에 노출되지 않는다(dlVeil 선적용).
test('W17 법인 설정 — ENTITY_CONFIG 반영 · 탐색기 딥링크 베일(무플래시)', async () => {
  // 1) v10 — 설정 주입: 루트 노드명·헤더 제목이 프로필 법인명과 일치
  const v10 = await page.evaluate(() => ({
    cfg: !!window.ENTITY_CONFIG,
    name: window.ENTITY_CONFIG && window.ENTITY_CONFIG.entity.name,
    root: window._v10.nodeName('SC-US'),
    h1: document.querySelector('header h1').textContent,
  }));
  assert.ok(v10.cfg, 'entity-config.js 로드');
  assert.equal(v10.root, v10.name, '루트 노드명 = 프로필 법인명');
  assert.ok(v10.h1.includes(v10.name), '헤더 제목에 법인명');
  // 2) 탐색기 — 해시 딥링크 직접 진입: DOMContentLoaded 시점(첫 페인트 전 상태 적용 직후)에
  //    베일이 화면을 덮고 있어야 하고(기본 제목줄 미노출), 상태 적용 후 걷힌다
  const p2 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await p2.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const v = document.getElementById('dlVeil');
      window.__veilAtDCL = v ? !v.hidden : null;
    });
  });
  await p2.goto(base + '/prototypes/v7-ontology-explorer.html?embed=1#focus:facility');
  await p2.waitForFunction(() => window._focusDebug && window._focusDebug.focusOn === 'facility', null, { timeout: 20000 });
  const ex = await p2.evaluate(() => ({
    veilAtDCL: window.__veilAtDCL,
    entName: document.getElementById('entName').textContent,
  }));
  assert.equal(ex.veilAtDCL, true, '딥링크 진입 첫 페인트는 베일이 덮는다');
  assert.equal(ex.entName, v10.name, '탐색기 헤더 법인명 = 프로필');
  await p2.waitForFunction(() => document.getElementById('dlVeil').hidden === true, null, { timeout: 5000 });
  // 3) 해시 없는 일반 진입 — 베일은 나타나지 않는다
  await p2.goto(base + '/prototypes/v7-ontology-explorer.html');
  const plain = await p2.evaluate(() => document.getElementById('dlVeil').hidden);
  assert.equal(plain, true, '일반 진입은 베일 없음');
  await p2.close();
});

// ── W18. 실데이터 L0 — data_new 서빙 API 배선 (폐루프 v0) ────────────────────
test('W18 실데이터 L0 — API 연결 시 버튼 표시 · KPI/클레임 패널 · VIN 체인 · 검증 오류 · ESC', async () => {
  // 1) /api/health 가용 → 헤더 버튼 표시 (미가용이면 숨김 = 폴백 규칙)
  await page.waitForFunction(() => window._v10.liveState().on, null, { timeout: 5000 });
  const btn = await page.evaluate(() => document.getElementById('btnLive').style.display !== 'none');
  assert.equal(btn, true, 'API 가용 시 ⛁ 실데이터 L0 버튼 표시');
  // 2) 패널 — 일 펄스·L0 KPI·시장 축·딜러 스코어·PEND 클레임 (시멘틱 mart 기반 서빙)
  await page.click('#btnLive');
  await page.waitForFunction(() => document.querySelectorAll('#liveBody .liveTbl').length === 5, null, { timeout: 8000 });
  const st = await page.evaluate(() => ({
    open: window._v10.liveState().open,
    pulseRows: document.querySelectorAll('#pulseTbl tr').length - 1,
    pulseSum: document.getElementById('pulseSum').textContent,
    kpiRows: document.querySelectorAll('#liveBody .liveTbl:nth-of-type(2) tr').length - 1,
    marketRows: document.querySelectorAll('#marketTbl tr').length - 1,
    dealerRows: document.querySelectorAll('#dealerTbl tr').length - 1,
    claimRows: document.querySelectorAll('#liveBody .liveTbl:nth-of-type(5) tr').length - 1,
    meta: document.getElementById('liveMeta').textContent,
  }));
  assert.equal(st.open, true);
  assert.equal(st.pulseRows, 7, '일 펄스 최근 7일 표 (일 그레인 심박)');
  assert.match(st.pulseSum, /전일/, '펄스 요약에 전일 대비 델타');
  assert.equal(st.kpiRows, 6, 'L0 KPI 최근 6개월');
  assert.equal(st.marketRows, 6, '시장 축(SAAR·점유율·경쟁 인센티브) 최근 6개월');
  assert.equal(st.dealerRows, 5, '딜러 스코어 TOP 5');
  assert.ok(st.claimRows >= 1 && st.claimRows <= 8, 'PEND 클레임 결재 행 1~8');
  assert.match(st.meta, /DuckDB/, '메타에 서빙 엔진 표기');
  // 3) VIN 폐루프 체인 드릴 (매입→도매→출하→소매)
  await page.click('#liveBody [data-vin]');
  await page.waitForFunction(() => document.querySelectorAll('#liveChain .liveTag').length >= 3, null, { timeout: 8000 });
  // 4) 액션 계약 검증 — 잘못된 decision 은 400 (원장 무변경 — 테스트는 상태를 남기지 않는다)
  const bad = await page.evaluate(async () => {
    const r = await fetch('../api/actions/approveWarrantyClaim', { method: 'POST', body: JSON.stringify({ objectId: 'QM00000001', decision: 'XX' }) });
    return { status: r.status, err: (await r.json()).error };
  });
  assert.equal(bad.status, 400);
  assert.match(bad.err, /decision/);
  // 5) 미선언 액션은 404 (시멘틱 레이어가 곧 계약)
  const undecl = await page.evaluate(async () =>
    (await fetch('../api/actions/notDeclared', { method: 'POST', body: '{}' })).status);
  assert.equal(undecl, 404);
  // 위 4)·5)는 의도된 4xx — 브라우저의 리소스 로드 실패 콘솔 로그를 오류 수집에서 제거
  for (let i = errors.length - 1; i >= 0; i--)
    if (/Failed to load resource.*(400|404)/.test(errors[i])) errors.splice(i, 1);
  // 6) ESC 닫기
  await page.keyboard.press('Escape');
  const closed = await page.evaluate(() => !window._v10.liveState().open);
  assert.equal(closed, true, 'ESC 로 패널 닫힘');
});

// ── W19. 월드 레지스트리 — 조직·부문·소환 월드 구조가 레지스트리에서 파생 ────
test('W19 월드 레지스트리 — 구조 = window.WORLD_REGISTRY 파생 (코드 하드코딩 없음)', async () => {
  const st = await page.evaluate(() => {
    const r = window.WORLD_REGISTRY;
    return {
      loaded: !!r,
      deptN: window._v10.DEPTS.length, regDeptN: r.depts.length,
      deptSame: window._v10.DEPTS === r.depts,                       // 참조 동일 = 리터럴 아님
      sibN: r.org.siblings.length,
      hqDown: window._v10.relDown(r.org.hq.id, window.TWIN_DATA.meta.now),
      hqName: window._v10.nodeName(r.org.hq.id),
      worldKeys: Object.keys(r.worlds),
    };
  });
  assert.ok(st.loaded, 'world-registry.js 로드');
  assert.equal(st.deptN, st.regDeptN, '부문 수 = 레지스트리 선언 수');
  assert.ok(st.deptSame, 'DEPTS는 레지스트리 객체 자체 (v10 내 리터럴 없음)');
  assert.equal(st.hqDown.length, 1 + st.sibN, '권역 산하 = 루트 + 형제 N (레지스트리 수만큼)');
  assert.ok(st.hqName.length > 0, 'HQ 표기는 레지스트리(프로필 병합)에서');
  assert.ok(st.worldKeys.includes('v8') && st.worldKeys.includes('onto'), '소환 월드 카탈로그');
});

// ── W10. 타임라인 + 인덱스 ──────────────────────────────────────────────────
test('W10 타임라인 — seek 재렌더 · 32개월 · 인덱스 링크 · JS 오류 없음', async () => {
  const st = await page.evaluate(() => {
    window._v10.seek(0);
    const first = document.getElementById('ymLbl').textContent;
    const focus0 = document.getElementById('focusTtl').textContent;
    window._v10.seek(31);
    return { first, last: document.getElementById('ymLbl').textContent, focus0,
             max: document.getElementById('tl').max };
  });
  assert.equal(st.first, '2024-01');
  assert.equal(st.last, '2026-08');
  assert.match(st.focus0, /2024-01/, '우 패널 포커스 정보 = 커서 월');
  assert.equal(st.max, '31');
  const idx = await page.evaluate(async b => (await fetch(b + '/')).text(), base);
  assert.match(idx, /v10-twin-world\.html/, '인덱스에 V10 링크');
  assert.deepEqual(errors, [], '전 과정 JS 오류 없음');
});
