// =============================================================================
// v11-vin-twin.test.mjs — V11 차량 트윈 (VIN 라이프사이클 + 트립 재생 + 플릿 KPI + AI 진단)
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
  server = spawn('node', ['server.js', '--port', '8794'], { cwd: ROOT });
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
  await page.goto(base + '/prototypes/v11-vin-twin.html');
  await page.waitForFunction(() => typeof window._v11 === 'object');
  await page.waitForTimeout(300);
});

after(async () => {
  await browser?.close();
  server?.kill();
});

// ── T1. 초기 로드 — 홈(KPI 트리) 랜딩 → VIN 모드 표본 8대·기본 선택 ─────────
test('T1 초기 로드 — 홈 KPI 트리 랜딩 · VIN 모드 표본 8대 · 기본 선택 · JS 오류 없음', async () => {
  const home = await page.evaluate(() => ({
    mode: window._v11.state().mode,
    cards: document.querySelectorAll('#scene .node').length,
    teams: document.querySelectorAll('#teamList .kpiTile').length,
    kpis: window._v11.kpis().length,
  }));
  assert.equal(home.mode, 'home', '랜딩 = 홈 (하나의 서비스 진입점)');
  assert.equal(home.cards, 7, 'CSI 노드 + 하위 KPI 카드 6');
  assert.equal(home.teams, 3, '담당 팀 타일 3 (딜러·품질·서비스)');
  assert.equal(home.kpis, 7, 'KPI 정의 7종 (최상위 1 + 하위 6)');
  await page.evaluate(() => window._v11.setMode('vin'));
  await page.waitForTimeout(150);
  const st = await page.evaluate(() => ({
    tiles: document.querySelectorAll('.vinTile').length,
    nodes: document.querySelectorAll('#scene .node').length,
    ticks: document.querySelectorAll('#scene .tick').length,
    state: window._v11.state(),
    band: document.querySelectorAll('#tripChart *').length,
    veil: document.getElementById('tripVeil').style.display,
  }));
  assert.equal(st.tiles, 8, '트윈 표본 VIN 8대');
  assert.ok(st.nodes >= 10, '라이프사이클 이벤트 노드');
  assert.ok(st.ticks >= 10, '트립(시동 ON~OFF) 틱');
  assert.equal(st.state.selVin, 'presale12v', '기본 표본 = 12V 방전 스토리');
  assert.ok(st.state.selEv, '주목 이벤트 기본 선택');
  assert.ok(st.state.selTrip, '최근 트립 기본 선택');
  assert.ok(st.band > 20, '트립 플레이어 렌더');
  assert.equal(st.veil, 'none', '트립 밴드 베일 해제');
  assert.deepEqual(errors, [], 'JS 오류 없음');
});

// ── T2. 라이프사이클 정합 — 전 표본 이벤트 체인 순서·게이트 구성 ─────────────
test('T2 라이프사이클 — 시간순 정렬 · 생산→G1→입고→G3(→G4→판매) · KR 생산분 해상 구간', async () => {
  const res = await page.evaluate(() => {
    const V = window._v11;
    return V.EXEMPLARS.map(ex => {
      const v = V.vehicle(ex.key);
      const seq = v.events.map(e => e.type + (e.g || ''));
      return { key: ex.key, plant: v.md.plant,
        sorted: v.events.every((e, i, a) => !i || a[i - 1].d <= e.d),
        first: seq[0], hasG1: seq.includes('GATEG1'), hasG3: seq.includes('GATEG3'),
        sold: v.soldD != null,
        g4beforeRetail: v.soldD == null || seq.indexOf('GATEG4') < seq.indexOf('RETAIL'),
        sea: seq.includes('SHIP') && seq.includes('GATEG2') };
    });
  });
  for (const r of res) {
    assert.ok(r.sorted, `${r.key} 이벤트 시간순`);
    assert.equal(r.first, 'PROD', `${r.key} 생산이 첫 이벤트`);
    assert.ok(r.hasG1 && r.hasG3, `${r.key} G1 PDI·G3 인수 게이트`);
    assert.ok(r.g4beforeRetail, `${r.key} G4 PDS → 판매 순서`);
    if (r.plant.startsWith('KR')) assert.ok(r.sea, `${r.key} KR 생산 — 선적·G2 VPC 구간`);
  }
});

// ── T3. 12V 방전 스토리 — 판매 전 이슈 검출 → OTA 시정 → 위험도 하락 폐루프 ──
test('T3 12V 스토리 — G3 조건부 판정 · SoC 임계 하회 · DTC · OTA 후 위험도 하락', async () => {
  const r = await page.evaluate(() => {
    const V = window._v11, v = V.vehicle('presale12v');
    const g3 = v.events.find(e => e.g === 'G3');
    const stockMin = Math.min(...v.soc.slice(v.arriveD, v.soldD));
    const preRisk = V.riskOf(v, v.soldD - 10);          // 재고 말 — 시정 전
    const postRisk = V.riskOf(v, V.NOWD);               // OTA 이후
    return { g3st: g3.st, judge: g3.kds.judge, soc: g3.kds.soc, stockMin,
      dtc: v.dtcs.map(x => x.code), ota: v.events.some(e => e.type === 'OTA'),
      preScore: preRisk.score, preRecs: preRisk.recs.map(x => x.act),
      postScore: postRisk.score, fixD: v.fixD, soldD: v.soldD };
  });
  assert.equal(r.g3st, 'warn', 'G3 인수 검사 조건부(warn)');
  assert.ok(r.judge.includes('보충 충전'), 'KDS 판정 — 보충 충전 지시');
  assert.ok(r.soc < 65, 'G3 시점 12V SoC 저하');
  assert.ok(r.stockMin < 56, '재고 중 SoC 임계 하회 (판매 전 12V 이슈)');
  assert.ok(r.dtc.filter(c => c === 'B1250').length >= 2, '12V 저전압 DTC 반복');
  assert.ok(r.ota, 'OTA 시정 이벤트 존재');
  assert.ok(r.preScore > r.postScore, '시정 전 위험도 > 시정 후');
  assert.ok(r.postScore <= 25, 'OTA 후 안정');
  assert.ok(r.preRecs.length >= 1, '시정 전 AI 권고(예약/OTA) 존재');
});

// ── T4. 트립 재생 — 시동 ON~OFF 신호(차속·12V·HDA·Terrain·경고등) 합성·재생 ──
test('T4 트립 재생 — 신호 범위 · HDA/Terrain 세그먼트 · 재생 커서 진행', async () => {
  const r = await page.evaluate(() => {
    const V = window._v11;
    const vh = V.vehicle('hda'), S = V.tripSeries('hda', vh.trips.find(t => t.ctx === 'cust').id);
    const vt = V.vehicle('towing');
    const towTrip = vt.trips.find(t => t.tow) || vt.trips.find(t => t.ctx === 'cust');
    const St = V.tripSeries('towing', towTrip.id);
    const vp = V.vehicle('presale12v'), Sp = V.tripSeries('presale12v', vp.trips.find(t => t.ctx === 'yard').id);
    return { n: S.n, vmax: Math.max(...S.spd), vmin: Math.min(...S.spd),
      smin: Math.min(...S.soc), smax: Math.max(...S.soc),
      hdaSegs: S.hdaSeg.length, ig: S.evts.filter(e => /IG-/.test(e.txt)).length,
      towTer: St.terSeg.length, yardMax: Math.max(...Sp.spd) };
  });
  assert.ok(r.n >= 36, '10초/틱 시계열 길이');
  assert.ok(r.vmax > 60 && r.vmax <= 140 && r.vmin >= 0, '차속 범위');
  assert.ok(r.smin > 33 && r.smax < 90, '12V SoC 범위');
  assert.ok(r.hdaSegs >= 1, 'HDA 헤비유저 — 고속 구간 HDA 세그먼트');
  assert.equal(r.ig, 2, 'IG-ON/OFF 마커');
  assert.ok(r.towTer >= 1, '견인 트립 — Terrain 모드 세그먼트');
  assert.ok(r.yardMax < 40, '사전 이동(야드) 트립 저속 프로파일');
});

test('T4b 재생 커서 — ▶ 클릭 후 진행, 정지 동작', async () => {
  await page.evaluate(() => { window._v11.selectVin('hda'); });
  await page.waitForTimeout(120);
  const t0 = await page.evaluate(() => window._v11.state().tpCursor);
  await page.click('#tpPlay');
  await page.waitForTimeout(450);
  await page.click('#tpPlay');                            // 정지
  const t1 = await page.evaluate(() => window._v11.state().tpCursor);
  assert.ok(t1 > t0, `재생 커서 진행 (${t0} → ${t1})`);
});

// ── T5. 이벤트 선택·관측 시점 — KDS 상세 · 미도래 dim ────────────────────────
test('T5 이벤트 드릴 — G3 선택 시 KDS 판정·DTC 상세, 월 커서 이전으로 미도래 dim', async () => {
  const r = await page.evaluate(() => {
    const V = window._v11;
    V.setMode('vin'); V.seek(31); V.selectVin('presale12v');
    const v = V.vehicle('presale12v');
    V.selectEvent(v.events.find(e => e.g === 'G3').id);
    const side = document.getElementById('sideBody').textContent;
    V.seek(26);                                           // 2026-03 — 판매(06)·OTA(07) 미도래
    const dim = document.querySelectorAll('#scene .node.dim').length;
    const st = V.state();
    V.seek(31);
    return { side, dim, cursor26: st.cursor };
  });
  assert.ok(r.side.includes('KDS 판정'), '우 레일 KDS 판정');
  assert.ok(r.side.includes('보충 충전'), '판정 내용 표시');
  assert.equal(r.cursor26, 26, '월 커서 이동');
  assert.ok(r.dim >= 2, '관측 시점 이후 이벤트 dim 처리');
});

// ── T6. KPI 상세 — 팀별 그룹 타일 + 목표 판정 + OTA 전후 검증 + 문제 VIN 드릴 ──
test('T6 KPI 상세 — 타일 7종(팀 그룹) · 배포 전후 하락 · 목표 판정 · 문제 차량→VIN 드릴', async () => {
  const r = await page.evaluate(() => {
    const V = window._v11;
    V.setKpi('disc'); V.setMode('fleet');
    const tiles = document.querySelectorAll('#railFleet .kpiTile').length;
    const pp = V.prepost('disc');
    const scene = document.getElementById('scene').textContent;
    const side = document.getElementById('sideBody').textContent;
    return { tiles, dpct: pp.dpct, ota31: V.otaApplied(31), target: V.OTA.target,
      marker: scene.includes('OTA-2606 배포 개시'), mode: V.state().mode,
      judge: side.includes('목표'), drills: document.querySelectorAll('#sideBody [data-drill]').length };
  });
  assert.equal(r.tiles, 7, 'KPI 타일 7종 (최상위 1 + 팀별 6)');
  assert.ok(r.dpct < -10, `12V 방전 — 배포 전후 하락 (${r.dpct.toFixed(1)}%)`);
  assert.equal(r.ota31, 9500, 'OTA 적용 9,500대 (csi_actions 원장)');
  assert.ok(r.marker, '배포 시점 마커');
  assert.ok(r.judge, '목표 판정 카드');
  assert.ok(r.drills >= 2, '문제 차량 드릴 버튼');
  // KPI 근거 → VIN 드릴다운
  await page.click('#sideBody [data-drill]');
  await page.waitForTimeout(120);
  const st = await page.evaluate(() => window._v11.state());
  assert.equal(st.mode, 'vin', '드릴 — VIN 모드 전환');
  assert.equal(st.selVin, 'presale12v', '드릴 — 12V 스토리 차량');
});

// ── T7. AI 사전 진단 — 권고 실행 등록 (예약/OTA) ─────────────────────────────
test('T7 AI 진단 — 권고 버튼 실행 시 등록·완료 표시', async () => {
  await page.evaluate(() => { window._v11.setMode('vin'); window._v11.seek(28); window._v11.selectVin('presale12v'); });
  await page.waitForTimeout(120);
  const n = await page.evaluate(() => document.querySelectorAll('#sideBody [data-rec]').length);
  assert.ok(n >= 1, '시정 전 관측 시점 — 권고 버튼 존재');
  await page.click('#sideBody [data-rec]');
  await page.waitForTimeout(120);
  const r = await page.evaluate(() => ({
    applied: window._v11.APPLIED.size,
    done: document.querySelectorAll('#sideBody .recBtn.done').length,
  }));
  assert.ok(r.applied >= 1, '조치 등록');
  assert.ok(r.done >= 1, '완료 상태 표시');
  await page.evaluate(() => window._v11.seek(31));
});

// ── T8. 해시 딥링크 — 상태 선적용(무플래시 규격) ─────────────────────────────
test('T8 해시 진입 — #i·m·vin 선적용', async () => {
  const p2 = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs2 = [];
  p2.on('pageerror', e => errs2.push(e.message));
  await p2.goto(base + '/prototypes/v11-vin-twin.html#i=27&m=fleet&vin=aging');
  await p2.waitForFunction(() => typeof window._v11 === 'object');
  const st = await p2.evaluate(() => window._v11.state());
  assert.equal(st.cursor, 27, '월 커서 선적용');
  assert.equal(st.mode, 'fleet', '모드 선적용');
  assert.equal(st.selVin, 'aging', 'VIN 선적용');
  assert.deepEqual(errs2, [], '딥링크 JS 오류 없음');
  await p2.close();
});

// ── T9. 드라이브 모드 — 레이싱 뷰 재생·일시정지·시킹·종료 ────────────────────
test('T9 드라이브 — 오픈·rAF 진행·일시정지·시킹·닫기', async () => {
  await page.evaluate(() => {
    const V = window._v11;
    V.setMode('vin'); V.seek(31); V.selectVin('towing');
    const t = V.vehicle('towing').trips.find(x => x.tow) || V.vehicle('towing').trips.find(x => x.ctx === 'cust');
    V.selectTrip(t.id); V.openDrive(t.id);
  });
  await page.waitForTimeout(900);
  const d1 = await page.evaluate(() => window._v11.drive());
  assert.ok(d1.open, '드라이브 오버레이 오픈');
  assert.ok(d1.tick > 0.5, `데이터 시계 진행 (tick ${d1.tick.toFixed(2)})`);
  assert.ok(d1.pos > 0, '월드 이동 (실시간 물리)');
  // 일시정지
  await page.click('#dvPlay');
  const t0 = (await page.evaluate(() => window._v11.drive())).tick;
  await page.waitForTimeout(400);
  const t1 = (await page.evaluate(() => window._v11.drive())).tick;
  assert.ok(Math.abs(t1 - t0) < 0.01, '일시정지 — 시계 정지');
  // 스크러버 시킹 → 재생 재개
  const bb = await (await page.$('#dvScrub')).boundingBox();
  await page.mouse.click(bb.x + bb.width * 0.7, bb.y + bb.height * 0.5);
  const d2 = await page.evaluate(() => window._v11.drive());
  assert.ok(d2.playing, '시킹 후 재생 재개');
  const S_n = await page.evaluate(() => window._v11.tripSeries(window._v11.state().selVin, window._v11.state().selTrip).n);
  assert.ok(Math.abs(d2.tick - (S_n - 1) * 0.7) < S_n * 0.06, '시킹 위치 반영');
  // HUD — 계기판·텔테일 DOM
  const hud = await page.evaluate(() => ({
    needle: !!document.getElementById('dvNeedle'),
    dig: document.getElementById('dvDig')?.textContent,
    ter: document.getElementById('ttTer').textContent,
  }));
  assert.ok(hud.needle, '속도계 바늘');
  assert.ok(!Number.isNaN(+hud.dig), '디지털 속도 표시');
  // 닫기
  await page.click('#dvClose');
  const d3 = await page.evaluate(() => window._v11.drive());
  assert.equal(d3.open, false, '닫기 동작');
  assert.deepEqual(errors, [], '드라이브 모드 JS 오류 없음');
});

// ── T11. 관제 (피트월) — F1 방식: 타이밍 타워·라이브 클럭·채널 스택·엔지니어 콜 ──
test('T11 관제 모드 — 타워 위험도 순 8대 · LIVE 클럭 진행 · 채널·델타 렌더 · 콜 피드', async () => {
  await page.evaluate(() => { window._v11.seek(31); window._v11.setMode('ctl'); });
  await page.waitForTimeout(900);
  const r = await page.evaluate(() => {
    const V = window._v11, c = V.ctl();
    const risks = c.order.map(k => V.riskOf(V.vehicle(k), c.obsD).score);
    return { c, risks,
      tower: document.querySelectorAll('#towerList [data-tw]').length,
      scene: document.getElementById('scene').textContent,
      feed: document.querySelectorAll('#sideBody .callRow').length };
  });
  assert.equal(r.tower, 8, '타이밍 타워 8대');
  assert.ok(r.risks.every((s, i, a) => !i || a[i - 1] >= s), '위험도 내림차순 정렬 (P1=최우선)');
  assert.ok(r.c.tick > 2, `관제 클럭 진행 (tick ${r.c.tick})`);
  assert.ok(r.c.live >= 7, `라이브 트립 병렬 재생 (${r.c.live}대)`);
  assert.ok(r.scene.includes('CH1 차속'), '채널 1 — 차속 + 기준차 레퍼런스');
  assert.ok(r.scene.includes('CH2 12V'), '채널 2 — 12V SoC');
  assert.ok(r.scene.includes('Δ12V'), '델타 채널 (레퍼런스 랩 델타 방식)');
  assert.ok(r.c.calls >= 1 && r.feed >= 1, `엔지니어 콜 피드 (${r.c.calls}건)`);
  assert.deepEqual(errors, [], '관제 모드 JS 오류 없음');
});

// ── T12. 개입 전략 몬테카를로 — 언더컷 판단과 동형 ───────────────────────────
test('T12 개입 전략 MC — presale12v 시정 전: 즉시 개입 위험도 < 미개입', async () => {
  const r = await page.evaluate(() => {
    const sc = window._v11.stratScenarios('presale12v', 28 * 30 + 29);  // 2026-05 말 — OTA 전 재고
    return sc.map(s => ({ nm: s.nm, end: s.med[60] }));
  });
  assert.ok(r[0].end < r[2].end, `즉시 개입(${r[0].end}) < 미개입(${r[2].end})`);
  assert.ok(r[2].end >= 40, `미개입 — 암전류 방치 시 위험 상승 (${r[2].end})`);
  assert.ok(r[0].end <= 25, `즉시 개입 — 안정권 (${r[0].end})`);
});

// ── T13. 엔지니어 콜 — 지시 전송 (single voice → 환류) ───────────────────────
test('T13 관제 콜 — 지시 전송 등록·상태 표시', async () => {
  await page.evaluate(() => { window._v11.setMode('ctl'); });
  await page.waitForTimeout(600);
  const n0 = await page.evaluate(() => window._v11.APPLIED.size);
  const clicked = await page.evaluate(() => {
    const b = document.querySelector('#sideBody [data-call]');
    if (!b) return false;
    b.click(); return true;
  });
  assert.ok(clicked, 'actionable 콜(지시 전송 버튼) 존재');
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => ({
    size: window._v11.APPLIED.size,
    sent: document.querySelectorAll('#sideBody .sendBtn.sent').length }));
  assert.ok(r.size > n0, '지시 등록 (APPLIED)');
  assert.ok(r.sent >= 1, '전송 완료 상태 표시');
  await page.evaluate(() => { window._v11.setMode('vin'); window._v11.seek(31); });
});

// ── T14. 홈 폐루프 — KPI 선택 → 데이터 확인 → 문제 VIN 드릴 · 목표 판정 추이 ──
test('T14 홈 KPI 트리 — 판정(28 미달→31 개선) · ①데이터 확인 · ②VIN 드릴 내비게이션', async () => {
  const judge = await page.evaluate(() => {
    const V = window._v11;
    V.setMode('home'); V.seek(28);
    const at28 = V.kpis().filter(k => k.team && !k.met).length;
    V.seek(31);
    const at31 = V.kpis().filter(k => k.team && k.met).length;
    return { at28, at31 };
  });
  assert.ok(judge.at28 >= 2, `2026-05 — 미달 KPI 존재 (${judge.at28})`);
  assert.ok(judge.at31 >= 5, `2026-08 — 개선 후 달성 (${judge.at31}/6)`);
  // ① 데이터로 확인 → KPI 상세
  await page.evaluate(() => { window._v11.setKpi('stock12v'); });
  await page.click('#btnKpiData');
  await page.waitForTimeout(120);
  let st = await page.evaluate(() => window._v11.state());
  assert.equal(st.mode, 'fleet', '① KPI 상세 진입');
  assert.equal(st.selMetric, 'stock12v', '선택 KPI 유지');
  // ② 문제 차량 드릴 → VIN 트윈
  await page.evaluate(() => { window._v11.setMode('home'); window._v11.setKpi('aging90'); });
  await page.click('#btnKpiDrill');
  await page.waitForTimeout(120);
  st = await page.evaluate(() => window._v11.state());
  assert.equal(st.mode, 'vin', '② VIN 트윈 진입');
  assert.equal(st.selVin, 'aging', '장기 재고 문제 차량');
});

// ── T15. KPI 조치 — 미달 KPI에 조치 등록 (환류 계약) ─────────────────────────
test('T15 KPI 조치 — 등록·완료 표시 (kpi| 키)', async () => {
  await page.evaluate(() => { window._v11.setKpi('disc'); window._v11.setMode('fleet'); });
  await page.waitForTimeout(120);
  const has = await page.evaluate(() => !!document.querySelector('#sideBody [data-kact]'));
  assert.ok(has, '조치 버튼 존재');
  await page.click('#sideBody [data-kact]');
  await page.waitForTimeout(120);
  const r = await page.evaluate(() => ({
    reg: window._v11.APPLIED.has('kpi|disc'),
    done: document.querySelectorAll('#sideBody .recBtn.done').length }));
  assert.ok(r.reg, '조치 등록 (APPLIED kpi|disc)');
  assert.ok(r.done >= 1, '완료 상태 표시');
  await page.evaluate(() => { window._v11.setMode('vin'); window._v11.seek(31); });
});

// ── T10. 드라이브 — VIN·모드 전환 시 자동 종료 (상태 누수 방지) ──────────────
test('T10 드라이브 — 표본/모드 전환 시 자동 종료', async () => {
  await page.evaluate(() => {
    const V = window._v11;
    V.selectVin('hda');
    const t = V.vehicle('hda').trips.find(x => x.ctx === 'cust');
    V.selectTrip(t.id); V.openDrive(t.id);
  });
  await page.waitForTimeout(200);
  assert.ok((await page.evaluate(() => window._v11.drive())).open, '오픈 확인');
  await page.evaluate(() => window._v11.selectVin('baseline'));
  assert.equal((await page.evaluate(() => window._v11.drive())).open, false, 'VIN 전환 시 종료');
  await page.evaluate(() => {
    const V = window._v11; V.selectVin('hda');
    const t = V.vehicle('hda').trips.find(x => x.ctx === 'cust');
    V.selectTrip(t.id); V.openDrive(t.id); V.setMode('fleet');
  });
  assert.equal((await page.evaluate(() => window._v11.drive())).open, false, '플릿 모드 전환 시 종료');
  await page.evaluate(() => { window._v11.setMode('vin'); window._v11.seek(31); });
});
