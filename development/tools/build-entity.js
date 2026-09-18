#!/usr/bin/env node
/**
 * build-entity.js — 법인 프로필(md) → 트윈 설정 생성기 (외부 의존성 없음)
 *
 * 입력:  development/entity-profile.md   (단일 입력 소스 — 표의 값 칸만 수정)
 * 출력:  development/generated/entity-config.json  (검토용)
 *        prototypes/entity-config.js               (window.ENTITY_CONFIG — 프런트 주입)
 *
 * 검증:  KPI ID를 data/governance/ceo_tree.csv의 node_id와 대조.
 *        일치 → 오버라이드 / 불일치 → 신규 KPI로 리포트 (ceo_tree 확장 대상).
 *
 * 사용:  node development/tools/build-entity.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'development', 'entity-profile.md');
const OUT_JSON = path.join(ROOT, 'development', 'generated', 'entity-config.json');
const OUT_JS = path.join(ROOT, 'prototypes', 'entity-config.js');
const CEO_TREE = path.join(ROOT, 'data', 'governance', 'ceo_tree.csv');

const blank = v => v == null || v === '' || v === '—' || v === '-';

// ── md 파싱: '## ' 섹션 제목 아래의 표를 [{헤더:값}] 배열로 ──────────────────
function parseSections(md) {
  const sections = {};
  let cur = null;
  let table = null;
  const flush = () => { if (cur && table && table.rows.length) sections[cur] = table.rows; table = null; };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('## ')) { flush(); cur = line.slice(3).trim(); continue; }
    if (line.startsWith('|')) {
      const cells = line.slice(1, line.endsWith('|') ? -1 : undefined).split('|').map(c => c.trim());
      if (cells.every(c => /^:?-{3,}:?$/.test(c))) continue;              // 구분선
      if (!table) { table = { header: cells, rows: [] }; continue; }       // 첫 행 = 헤더
      const row = {};
      table.header.forEach((h, i) => { row[h] = cells[i] != null ? cells[i] : ''; });
      table.rows.push(row);
    } else if (line === '' && table) { flush(); }                          // 표 종료 (섹션 유지)
  }
  flush();
  return sections;
}
const findSection = (sections, kw) => {
  const key = Object.keys(sections).find(t => t.includes(kw));
  return key ? sections[key] : null;
};

// ── 입력 읽기 ────────────────────────────────────────────────────────────────
if (!fs.existsSync(SRC)) { console.error(`✖ 입력 없음: ${SRC}`); process.exit(1); }
const sections = parseSections(fs.readFileSync(SRC, 'utf8'));
const warn = [];

// §1 기본 정보 (항목/값)
const basic = {};
for (const r of findSection(sections, '기본 정보') || []) {
  if (!blank(r['값'])) basic[r['항목']] = r['값'];
}
const pickBasic = kw => {
  const k = Object.keys(basic).find(x => x.includes(kw));
  return k ? basic[k] : undefined;
};
const entity = {
  name: pickBasic('법인명'),
  code: pickBasic('법인 코드'),
  hq: pickBasic('상위 조직'),
  currency: pickBasic('통화'),
  market: pickBasic('시장'),
  fyStart: pickBasic('회계연도'),
  owner: pickBasic('오너'),
};
if (!entity.name) { console.error('✖ 필수 입력 누락: §1 기본 정보의 「법인명」'); process.exit(1); }

// §2 형제 법인
entity.siblings = (findSection(sections, '형제 법인') || [])
  .filter(r => !blank(r['법인명']))
  .map(r => ({
    name: r['법인명'], code: blank(r['코드']) ? undefined : r['코드'],
    built: /구축|완료|Y|O|운영/i.test(r['트윈 구축 여부'] || ''),
  }));

// §3 KPI — ceo_tree 대조
let treeIds = new Set();
if (fs.existsSync(CEO_TREE)) {
  treeIds = new Set(fs.readFileSync(CEO_TREE, 'utf8').split(/\r?\n/).slice(1)
    .map(l => l.split(',')[0]).filter(Boolean));
} else warn.push(`ceo_tree.csv 없음 — KPI ID 검증 생략 (${CEO_TREE})`);

const kpis = {}; const newKpis = []; let wSum = 0;
for (const r of findSection(sections, '회사 KPI') || []) {
  const id = r['KPI ID'];
  if (blank(id)) continue;
  const o = {};
  if (!blank(r['KPI 이름'])) o.name = r['KPI 이름'];
  if (!blank(r['약칭'])) o.short = r['약칭'];
  if (!blank(r['가중치(%)'])) { o.weight = parseFloat(r['가중치(%)']); wSum += o.weight || 0; }
  if (!blank(r['단위'])) o.unit = r['단위'];
  // 방향 컬럼은 '-'(낮을수록 좋음)가 유효 값 — blank의 '-' 센티널을 적용하지 않는다 (미입력은 '—')
  const dir = (r['방향'] || '').trim();
  if (dir === '+' || dir === '-') o.dir = dir;
  if (!blank(r['BP 목표(연)'])) o.target = r['BP 목표(연)'];
  if (!blank(r['데이터 소스(바인딩)'])) o.source = r['데이터 소스(바인딩)'];
  if (treeIds.size && !treeIds.has(id)) { newKpis.push(id); continue; }   // 신규 — 오버라이드 대상 아님
  kpis[id] = o;
}
// 가중치는 화면에서 가중 평균으로 정규화 — 합계는 참고 정보로만 출력
const wNote = wSum ? ` · KPI 가중치 합 ${wSum}` : '';
if (newKpis.length) warn.push(`신규 KPI ${newKpis.length}건 (ceo_tree 미등록 → 확장 필요): ${newKpis.join(', ')}`);

// §4 부문
const depts = {};
for (const r of findSection(sections, '부문') || []) {
  const id = r['부문 ID'];
  if (blank(id)) continue;
  const o = {};
  if (!blank(r['이름'])) o.name = r['이름'];
  if (!blank(r['오너(조직/직책)'])) o.owner = r['오너(조직/직책)'];
  if (Object.keys(o).length) depts[id] = o;
}

// §5 데이터 인벤토리
const dataInventory = (findSection(sections, '데이터 인벤토리') || [])
  .filter(r => !blank(r['보유 데이터(테이블/파일/API)']))
  .map(r => ({
    source: r['보유 데이터(테이블/파일/API)'],
    objectType: blank(r['온톨로지 객체 타입']) ? undefined : r['온톨로지 객체 타입'],
    level: blank(r['월드 레벨']) ? undefined : r['월드 레벨'],
    grain: blank(r['그레인']) ? undefined : r['그레인'],
    refresh: blank(r['갱신 주기']) ? undefined : r['갱신 주기'],
    note: blank(r['비고']) ? undefined : r['비고'],
  }));
for (const d of dataInventory) {
  if (!d.objectType) warn.push(`데이터 인벤토리 「${d.source}」— 온톨로지 객체 타입 미지정`);
  if (!d.level) warn.push(`데이터 인벤토리 「${d.source}」— 월드 레벨 미지정`);
}

// ── 월드 레지스트리 — 구조 정본(world-registry.json) + 프로필 표기 병합 ──────
// 구조(부문·스텝·형제 수·소환 월드)는 정본이, 표기(이름·오너)는 프로필이 결정한다.
const WORLD_SRC = path.join(ROOT, 'development', 'world-registry.json');
const OUT_WORLD = path.join(ROOT, 'prototypes', 'world-registry.js');
let world = null;
if (fs.existsSync(WORLD_SRC)) {
  world = JSON.parse(fs.readFileSync(WORLD_SRC, 'utf8'));
  // 프로필 병합 — §1 상위 조직 → hq 이름, §2 형제 법인 전체(수 제한 없음), §4 부문 이름·오너
  if (entity.hq) world.org.hq.name = entity.hq;
  if (entity.siblings.length) {
    world.org.siblings = entity.siblings.map((s, i) => ({
      id: s.code || `SIB-${i + 1}`, name: s.name,
      lbl: s.built ? '판매법인' : '판매법인 (계획)', hex: '#8f8d85', planned: !s.built,
    }));
  }
  for (const d of world.depts) {
    const o = depts[d.id];
    if (o) { if (o.name) d.name = o.name; if (o.owner) d.owner = o.owner; }
  }
  // 검증 — 부문 KPI ↔ ceo_tree, 스텝 onto ↔ 시멘틱 정본, world 참조 ↔ worlds 키
  const semPath = path.join(ROOT, 'data_new', 'semantic', 'semantic-layer.json');
  if (fs.existsSync(semPath)) {
    const sem = JSON.parse(fs.readFileSync(semPath, 'utf8'));
    const actIds = new Set(sem.actionTypes.map(a => a.id));
    const objIds = new Set(sem.objectTypes.map(o => o.id));
    for (const d of world.depts) {
      for (const k of d.kpis || [])
        if (treeIds.size && !treeIds.has(k)) warn.push(`레지스트리 ${d.id} — ceo_tree에 없는 KPI: ${k}`);
      for (const s of d.steps) for (const o of s.onto || []) {
        if (o.act && !actIds.has(o.act)) warn.push(`레지스트리 ${d.id}/${s.id || s.act} — 시멘틱 정본에 없는 액션: ${o.act}`);
        if (o.type && !objIds.has(o.type)) warn.push(`레지스트리 ${d.id}/${s.id || s.act} — 시멘틱 정본에 없는 객체 타입: ${o.type}`);
        if (o.world && !world.worlds[o.world]) warn.push(`레지스트리 ${d.id}/${s.id || s.act} — 미선언 월드 참조: ${o.world}`);
      }
    }
  } else warn.push(`시멘틱 정본 없음 — 레지스트리 onto 검증 생략 (${semPath})`);
  const dupDept = world.depts.map(d => d.id).filter((id, i, a) => a.indexOf(id) !== i);
  if (dupDept.length) { console.error(`✖ 레지스트리 부문 id 중복: ${dupDept.join(', ')}`); process.exit(1); }
} else warn.push(`world-registry.json 없음 — 월드 레지스트리 생성 생략 (${WORLD_SRC})`);

// ── 출력 ────────────────────────────────────────────────────────────────────
const config = {
  generatedFrom: 'development/entity-profile.md',
  generator: 'development/tools/build-entity.js',
  entity, kpis, depts, dataInventory, newKpis,
};
fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(config, null, 2) + '\n');
fs.writeFileSync(OUT_JS,
  '// 생성 파일 — 직접 수정 금지. 입력: development/entity-profile.md,\n' +
  '// 재생성: node development/tools/build-entity.js\n' +
  'window.ENTITY_CONFIG = ' + JSON.stringify(config, null, 2) + ';\n');
if (world) fs.writeFileSync(OUT_WORLD,
  '// 생성 파일 — 직접 수정 금지. 구조 정본: development/world-registry.json,\n' +
  '// 표기 입력: development/entity-profile.md — 재생성: node development/tools/build-entity.js\n' +
  '// v10 트윈 월드의 조직·부문·소환 월드 구조는 이 레지스트리가 결정한다 (코드 하드코딩 금지).\n' +
  'window.WORLD_REGISTRY = ' + JSON.stringify(world, null, 2) + ';\n');

console.log(`✔ 법인: ${entity.name} (${entity.code || '코드 미입력'}) · 상위 ${entity.hq || '—'} · 형제 ${entity.siblings.length}`);
console.log(`✔ KPI 오버라이드 ${Object.keys(kpis).length}건${wNote} · 부문 ${Object.keys(depts).length}건 · 데이터 인벤토리 ${dataInventory.length}건`);
if (world) console.log(`✔ 월드 레지스트리 v${world.version} — 부문 ${world.depts.length} · 형제 ${world.org.siblings.length} · 소환 월드 ${Object.keys(world.worlds).length}`);
console.log(`✔ 생성: ${path.relative(ROOT, OUT_JSON)}`);
console.log(`✔ 생성: ${path.relative(ROOT, OUT_JS)}`);
if (world) console.log(`✔ 생성: ${path.relative(ROOT, OUT_WORLD)}`);
for (const w of warn) console.log(`⚠ ${w}`);
