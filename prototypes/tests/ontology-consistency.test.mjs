// =============================================================================
// ontology-consistency.test.mjs — 온톨로지 ↔ 표본 인스턴스 ↔ TWIN_DATA ↔ 트윈 화면 정합성
// 순수 Node 테스트 (브라우저 불필요) — 디지털 트윈이 온톨로지를 불러와 쓰기 위한 계약 검증.
// 실행: prototypes/tests/run-tests.sh (node --test)
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => readFileSync(path.join(ROOT, f), 'utf8');

// 페이지와 동일한 로딩 순서로 선언·인스턴스를 구성 (window 셤)
const win = {};
new Function('window', [
  read('prototypes/v7-data.js'),
  read('prototypes/v7-ontology.js'),
  read('prototypes/v7-ontology-instances.js'),
].join('\n;\n'))(win);
const O = win.ONTOLOGY;
const TD = win.TWIN_DATA;
const DB = win.buildOntologyInstances(TD);
const OT = Object.fromEntries(O.objectTypes.map(t => [t.id, t]));
const LT = Object.fromEntries(O.linkTypes.map(l => [l.id, l]));
const STAGES = ['plan', 'logistics', 'commerce', 'finance', 'care', 'quality'];

// ── C1. 선언 무결성: ID 유일성 ───────────────────────────────────────────────
test('C1 선언 ID 유일성 — 객체·링크·액션·그룹', () => {
  for (const [name, arr] of [['objectTypes', O.objectTypes], ['linkTypes', O.linkTypes],
    ['actionTypes', O.actionTypes], ['groups', O.groups]]) {
    const ids = arr.map(x => x.id);
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.deepEqual(dup, [], `${name}에 중복 id 없음`);
  }
});

// ── C2. 참조 무결성: 링크 끝점·액션 대상·그룹 ────────────────────────────────
test('C2 참조 무결성 — 링크 from/to·액션 objectType·객체 group', () => {
  O.linkTypes.forEach(l => {
    assert.ok(OT[l.from], `링크 ${l.id}의 from(${l.from})이 객체 타입으로 존재`);
    assert.ok(OT[l.to], `링크 ${l.id}의 to(${l.to})가 객체 타입으로 존재`);
    assert.ok(l.fk, `링크 ${l.id}에 fk(조인 키) 선언`);
  });
  O.actionTypes.forEach(a => {
    assert.ok(OT[a.objectType], `액션 ${a.id}의 objectType(${a.objectType}) 존재`);
    assert.ok(STAGES.includes(a.stage), `액션 ${a.id}의 stage(${a.stage})가 표준 스테이지`);
    assert.ok(Array.isArray(a.params) && a.params.length, `액션 ${a.id}에 파라미터 선언`);
    assert.ok(Array.isArray(a.effects) && a.effects.length, `액션 ${a.id}에 효과 선언`);
  });
  const groups = new Set(O.groups.map(g => g.id));
  O.objectTypes.forEach(t => assert.ok(groups.has(t.group), `객체 ${t.id}의 group(${t.group}) 존재`));
});

// ── C3. 속성 선언: 유일성 + PK 실재 ─────────────────────────────────────────
test('C3 속성 — 타입별 유일성, primaryKey 구성 속성 실재', () => {
  O.objectTypes.forEach(t => {
    const pids = t.properties.map(p => p.id);
    const dup = pids.filter((id, i) => pids.indexOf(id) !== i);
    assert.deepEqual(dup, [], `${t.id} 속성 id 중복 없음`);
    t.primaryKey.split('+').forEach(pk =>
      assert.ok(pids.includes(pk), `${t.id}의 PK 구성요소(${pk})가 속성으로 선언됨`));
  });
});

// ── C4. 수명주기: 상태·전이·게이트 액션 실재 ────────────────────────────────
test('C4 수명주기 — 전이의 from/to 상태와 action이 실재', () => {
  const lc = O.lifecycles.vehicleLifecycle;
  const states = new Set(lc.states.map(s => s.id));
  const actionIds = new Set(O.actionTypes.map(a => a.id));
  lc.transitions.forEach(tr => {
    assert.ok(states.has(tr.from), `전이 from(${tr.from}) 상태 존재`);
    assert.ok(states.has(tr.to), `전이 to(${tr.to}) 상태 존재`);
    if (tr.action) assert.ok(actionIds.has(tr.action), `전이 액션(${tr.action})이 actionTypes에 선언됨`);
  });
});

// ── C5. 인스턴스 ↔ 선언: 타입·속성 정합 ─────────────────────────────────────
test('C5 표본 인스턴스 — 모든 객체의 타입이 선언되고 속성이 선언 범위 안', () => {
  const bad = [];
  DB.order.forEach(k => {
    const o = DB.objects[k];
    const t = OT[o.type];
    if (!t) { bad.push(`${k}: 미선언 타입 ${o.type}`); return; }
    const declared = new Set(t.properties.map(p => p.id));
    Object.keys(o.props).forEach(pid => {
      if (!declared.has(pid)) bad.push(`${k}: 미선언 속성 ${o.type}.${pid}`);
    });
  });
  assert.deepEqual(bad, [], '인스턴스 속성은 전부 선언된 속성이어야 함');
});

// ── C6. 인스턴스 링크 ↔ 선언: 타입·끝점 정합 ────────────────────────────────
test('C6 표본 링크 — lt 선언 존재, 끝점 객체 실재, 끝점 타입이 from/to와 일치', () => {
  const bad = [];
  DB.links.forEach(l => {
    const lt = LT[l.lt];
    if (!lt) { bad.push(`미선언 링크 타입 ${l.lt}`); return; }
    const fo = DB.objects[l.from], to = DB.objects[l.to];
    if (!fo) { bad.push(`${l.lt}: from 객체 없음 ${l.from}`); return; }
    if (!to) { bad.push(`${l.lt}: to 객체 없음 ${l.to}`); return; }
    if (fo.type !== lt.from) bad.push(`${l.lt}: from 타입 ${fo.type} ≠ 선언 ${lt.from}`);
    if (to.type !== lt.to) bad.push(`${l.lt}: to 타입 ${to.type} ≠ 선언 ${lt.to}`);
  });
  assert.deepEqual([...new Set(bad)], [], '표본 링크가 선언과 일치해야 함');
});

// ── C7. 커버리지: 모든 타입·링크에 표본 ≥1 ──────────────────────────────────
test('C7 커버리지 — 모든 객체 타입과 링크 타입에 표본 인스턴스가 존재', () => {
  const typeCnt = {};
  DB.order.forEach(k => typeCnt[DB.objects[k].type] = (typeCnt[DB.objects[k].type] || 0) + 1);
  const noInst = O.objectTypes.filter(t => !typeCnt[t.id]).map(t => t.id);
  assert.deepEqual(noInst, [], '표본 없는 객체 타입이 없어야 함');
  const linkCnt = {};
  DB.links.forEach(l => linkCnt[l.lt] = (linkCnt[l.lt] || 0) + 1);
  const noLink = O.linkTypes.filter(l => !linkCnt[l.id]).map(l => l.id);
  assert.deepEqual(noLink, [], '표본 없는 링크 타입이 없어야 함');
});

// ── C8. 데이터 마트 바인딩: bound 경로가 실제 data/ 폴더와 일치 ──────────────
test('C8 bound 데이터소스 — data/ 경로가 실제 폴더로 존재', () => {
  const bad = [];
  O.objectTypes.forEach(t => {
    const p = t.datasource.path;
    if (t.datasource.status === 'bound' && p.startsWith('data/')) {
      const dir = p.split('/').slice(0, 2).join('/');
      if (!existsSync(path.join(ROOT, dir))) bad.push(`${t.id}: ${dir} 없음`);
    }
  });
  assert.deepEqual(bad, [], 'bound 마트 폴더가 실재해야 함');
});

// ── C9. TWIN_DATA 정합: 마스터 어휘가 트윈 데이터와 일치 ─────────────────────
test('C9 TWIN_DATA 정합 — 차종·공장·지역사무소·트림·BP가 트윈 데이터와 일치', () => {
  const instIds = ty => (DB.order.filter(k => DB.objects[k].type === ty).map(k => DB.objects[k].id)).sort();
  assert.deepEqual(instIds('model'), TD.models.map(m => m.id).sort(), '차종 집합 일치');
  assert.deepEqual(instIds('plant'), TD.plants.map(p => p.id).sort(), '공장 집합 일치');
  assert.deepEqual(instIds('salesZone'), TD.zones.map(z => z.id).sort(), '지역사무소 집합 일치');
  const trimCnt = DB.order.filter(k => DB.objects[k].type === 'trim').length;
  assert.equal(trimCnt, Object.values(TD.trims).flat().length, '트림 수 일치');
  // BP 표본은 현재월(NOW) 기준으로 트윈 데이터의 bp와 동일 값
  const NOW = TD.meta.months[TD.meta.now];
  const bpNow = TD.bp.find(b => b.ym === NOW);
  DB.order.filter(k => DB.objects[k].type === 'businessPlan').forEach(k => {
    const o = DB.objects[k].props;
    assert.equal(o.bp_retail_qty, bpNow.models[o.model_id].retail, `BP ${o.model_id} 소매 목표 일치`);
  });
});

// ── C10. 재무 관계 정합: 변동마진 = 도매가 − 이전가격 (원가 대응 쌍) ─────────
test('C10 재무 정합 — 같은 VIN의 도매·법인간 매입이 변동마진 산식을 만족', () => {
  const purchases = {};
  DB.order.filter(k => DB.objects[k].type === 'vehiclePurchase')
    .forEach(k => purchases[DB.objects[k].id] = DB.objects[k].props);
  let checked = 0;
  DB.order.filter(k => DB.objects[k].type === 'wholesale').forEach(k => {
    const w = DB.objects[k].props;
    const p = purchases[w.vin];
    assert.ok(p, `도매 ${w.vin}의 원가측(법인간 매입) 존재`);
    assert.equal(w.wholesale_price_usd - p.transfer_price_usd, w.variable_margin_usd,
      `${w.vin}: 변동마진 = 도매가 − 이전가격`);
    checked++;
  });
  assert.ok(checked > 0, '검증 대상 도매 표본 존재');
});

// ── C11. 수명주기 상태 정합: 차량 상태와 링크 체인의 인과 관계 ───────────────
test('C11 수명주기 정합 — 차량 상태가 선언된 상태이고 상태별 필수 링크 보유', () => {
  const states = new Set(O.lifecycles.vehicleLifecycle.states.map(s => s.id));
  const ORDER = Object.fromEntries(O.lifecycles.vehicleLifecycle.states.map((s, i) => [s.id, i]));
  const linksTo = {}, linksFrom = {};
  DB.links.forEach(l => {
    (linksTo[l.to] = linksTo[l.to] || []).push(l.lt);
    (linksFrom[l.from] = linksFrom[l.from] || []).push(l.lt);
  });
  DB.order.filter(k => DB.objects[k].type === 'vehicle').forEach(k => {
    const st = DB.objects[k].props.state;
    assert.ok(states.has(st), `차량 상태(${st})가 수명주기에 선언됨`);
    const incoming = linksTo[k] || [];
    if (ORDER[st] >= ORDER.DEALER_STOCK) assert.ok(incoming.includes('wsOfVehicle'), `${k}: 딜러 재고 이후엔 도매 기록 필요`);
    if (ORDER[st] >= ORDER.RETAILED) assert.ok(incoming.includes('rsOfVehicle'), `${k}: 소매 이후엔 소매 기록 필요`);
  });
});

// ── C12. 텔레매틱스 데이터 카테고리 — trip은 GPS 보유, dtc는 코드 보유 ────────
test('C12 텔레매틱스 — data_category별 필수 속성 (trip=GPS·거리, dtc=DTC 코드)', () => {
  const events = DB.order.filter(k => DB.objects[k].type === 'telematicsEvent').map(k => DB.objects[k].props);
  assert.ok(events.length > 0, '텔레매틱스 표본 존재');
  const cats = new Set(events.map(e => e.data_category));
  assert.ok(cats.has('trip'), '주행 기록(trip) 카테고리 표본 존재');
  assert.ok(cats.has('dtc'), '이상 신호(dtc) 카테고리 표본 존재');
  events.forEach(e => {
    if (e.data_category === 'trip') {
      assert.ok(Number.isFinite(e.dest_lat) && Number.isFinite(e.dest_lon), `${e.event_id}: trip은 도착지 GPS 보유`);
      assert.ok(e.trip_km > 0, `${e.event_id}: trip은 주행 거리 보유`);
      assert.ok(e.dest_lat > 24 && e.dest_lat < 50 && e.dest_lon > -125 && e.dest_lon < -66,
        `${e.event_id}: 도착지가 미국 본토 범위`);
    }
    if (e.data_category === 'dtc') assert.ok(e.dtc_code, `${e.event_id}: dtc는 DTC 코드 보유`);
  });
});

// ── C13. VoC·소셜 공용 분류체계 — 같은 category 어휘 공간 ─────────────────────
test('C13 VoC·소셜 — 공용 분류체계 사용, 이슈 근거 링크 정합', () => {
  const vocCats = new Set(DB.order.filter(k => DB.objects[k].type === 'vocTicket').map(k => DB.objects[k].props.category));
  const spCats = new Set(DB.order.filter(k => DB.objects[k].type === 'socialPost').map(k => DB.objects[k].props.category));
  assert.ok(vocCats.size > 0 && spCats.size > 0, 'VoC·소셜 표본 존재');
  const shared = [...vocCats].filter(c => spCats.has(c));
  assert.ok(shared.length > 0, `VoC와 소셜이 공유하는 카테고리 존재 (통합 분석 조인 키): ${shared}`);
  const catRe = /^[가-힣A-Za-z]+-\S+$/;
  [...vocCats, ...spCats].forEach(c => assert.match(c, catRe, `카테고리(${c})가 '대분류-소분류' 표준 형식`));
});

// ── C14. 용어 일관성 — 화면·선언·트윈에 구용어(텔레메트리) 잔존 금지 ──────────
test('C14 용어 일관성 — telemetry/텔레메트리 잔존 없음 (표준: 텔레매틱스)', () => {
  for (const f of ['prototypes/v7-ontology.js', 'prototypes/v7-ontology-instances.js',
    'prototypes/v7-ontology-explorer.html', 'prototypes/v7-strategy-sim-twin.html']) {
    const src = read(f);
    assert.ok(!src.includes('텔레메트리'), `${f}: '텔레메트리' 잔존 없음`);
    assert.ok(!/telemetryEvent/.test(src), `${f}: telemetryEvent id 잔존 없음`);
  }
});

// ── C15. 트윈 화면 데이터 소스 일치 — 동일 TWIN_DATA를 로드 ───────────────────
test('C15 트윈 화면 — 전략 시뮬레이션과 온톨로지 탐색기가 같은 v7-data.js를 로드', () => {
  assert.match(read('prototypes/v7-strategy-sim-twin.html'), /src="v7-data\.js"/, '전략 트윈이 v7-data.js 로드');
  assert.match(read('prototypes/v7-ontology-explorer.html'), /src="v7-data\.js"/, '탐색기가 v7-data.js 로드');
});

// ── C17. 트윈 바인딩 — v8 KPI ↔ metrics(twinKpi) ↔ 마트, 액션 twinView 유효성 ──
test('C17 시멘틱 레이어 트윈 바인딩 — v8 KPI 전부 metric 경유, twinView 유효', () => {
  // v8 KPI 키 추출 (선언 파일이 화면의 원천이 되는지 — KPI마다 정확히 1개 metric)
  const v8 = read('prototypes/v8-strategy-sim-twin.html');
  const kpisSrc = v8.match(/const KPIS = \[[\s\S]*?\];/)[0];
  const kpiKeys = [...kpisSrc.matchAll(/key:\s*'(\w+)'/g)].map(m => m[1]);
  assert.ok(kpiKeys.length >= 4, `v8 KPI 추출 (${kpiKeys})`);
  for (const key of kpiKeys) {
    const ms = O.metrics.filter(m => m.twinKpi === key);
    assert.equal(ms.length, 1, `KPI '${key}'에 twinKpi metric이 정확히 1개 (${ms.map(m => m.id)})`);
    const ds = ms[0].source.split('.')[0];
    assert.ok(existsSync(path.join(ROOT, 'data', ds)), `metric ${ms[0].id}의 소스 마트 data/${ds} 실재`);
  }
  assert.match(v8, /v7-ontology\.js/, 'v8이 온톨로지 선언을 로드');
  assert.match(v8, /v7-ontology-instances\.js/, 'v8이 온톨로지 표본을 로드');
  // 액션 twinView 유효성 — kind는 map|sim, 주행 기록은 지도 뷰
  let n = 0;
  O.actionTypes.forEach(a => {
    if (!a.twinView) return;
    n++;
    assert.ok(['map', 'sim', 'board'].includes(a.twinView.kind), `${a.id}.twinView.kind 유효`);
    assert.ok(a.twinView.label && a.twinView.label.length > 3, `${a.id}.twinView.label 서술`);
  });
  assert.ok(n >= 10, `트윈 확인 가능 액션 충분 (${n}건)`);
  assert.equal(O.actionTypes.find(a => a.id === 'recordDrivingTrip').twinView.kind, 'map',
    '주행 데이터 기록은 지도 뷰');
  // 드롭다운 전환 케이스 — 한 객체에 데이터 뷰(map/board) 액션 2개 이상
  const teViews = O.actionTypes.filter(a =>
    a.objectType === 'telematicsEvent' && a.twinView && a.twinView.kind !== 'sim');
  assert.ok(teViews.length >= 2,
    `텔레매틱스에 트윈 데이터 뷰 2개 이상 (${teViews.map(a => a.id)})`);
});

// ── C18. 텔레매틱스 표본 밀도 — H3 셀 농도 차이가 나는 분포 ───────────────────
test('C18 Trip 표본 — 충분한 밀도와 셀별 카운트 편차(농도 표현 가능)', () => {
  const trips = DB.order.map(k => DB.objects[k])
    .filter(o => o.type === 'telematicsEvent' && o.props.data_category === 'trip');
  assert.ok(trips.length >= 60, `trip 표본 충분 (${trips.length}건)`);
  // H3 없이 근사: 소수 2자리 격자(≈1km)로 도착지 군집 — 최대 군집이 2건 이상이어야 농도 차이 표현
  const grid = {};
  trips.forEach(t => {
    const g = `${t.props.dest_lat.toFixed(2)}|${t.props.dest_lon.toFixed(2)}`;
    grid[g] = (grid[g] || 0) + 1;
  });
  const counts = Object.values(grid);
  assert.ok(Math.max(...counts) >= 3, `핫스팟 군집 존재 (최대 ${Math.max(...counts)}건/격자)`);
  assert.ok(counts.length >= 10, `분포 다양성 (${counts.length}개 격자)`);
});

// ── C16. 자동화 메타 형식 — before/after/output 문자열 ───────────────────────
test('C16 액션 자동화 메타 — automation 필드는 before/after/output 완비', () => {
  let n = 0;
  O.actionTypes.forEach(a => {
    if (!a.automation) return;
    n++;
    for (const f of ['before', 'after', 'output'])
      assert.ok(typeof a.automation[f] === 'string' && a.automation[f].length > 4,
        `${a.id}.automation.${f} 서술 존재`);
  });
  assert.ok(n >= 8, `자동화 선언된 액션이 충분히 존재 (현재 ${n}건)`);
});
