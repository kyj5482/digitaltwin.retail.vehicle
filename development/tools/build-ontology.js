#!/usr/bin/env node
/**
 * build-ontology.js — 시멘틱 정본(json) → 프런트 온톨로지(js) 생성기 (외부 의존성 없음)
 *
 * 정본:  data_new/semantic/semantic-layer.json   (유일 소스 — 여기만 수정)
 * 출력:  prototypes/v7-ontology.js               (window.ONTOLOGY — 직접 수정 금지)
 *
 * 빌드 시 선언 무결성을 검증한다 (테스트 C1·C2와 동일 규칙 — 오류는 빌드에서 잡는다):
 *   ① id 유일성 (객체·링크·액션·그룹)
 *   ② 링크 from/to → 객체 타입 실재, 액션 objectType → 객체 타입 실재
 *   ③ mart 바인딩 형식 (data_new/*.parquet) — 파일 실재는 파이프라인 검증(50_validate) 소관
 *
 * 사용:  node development/tools/build-ontology.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'data_new', 'semantic', 'semantic-layer.json');
const OUT = path.join(ROOT, 'prototypes', 'v7-ontology.js');

if (!fs.existsSync(SRC)) { console.error(`✖ 정본 없음: ${SRC}`); process.exit(1); }
const sem = JSON.parse(fs.readFileSync(SRC, 'utf8'));

// ── 선언 무결성 검증 ─────────────────────────────────────────────────────────
const errs = [];
const dupCheck = (name, arr) => {
  const seen = new Set();
  for (const x of arr) {
    if (seen.has(x.id)) errs.push(`${name} id 중복: ${x.id}`);
    seen.add(x.id);
  }
  return seen;
};
const objIds = dupCheck('objectTypes', sem.objectTypes);
dupCheck('linkTypes', sem.linkTypes);
dupCheck('actionTypes', sem.actionTypes);
dupCheck('groups', sem.groups);
const groupIds = new Set(sem.groups.map(g => g.id));

for (const t of sem.objectTypes) {
  if (!groupIds.has(t.group)) errs.push(`객체 ${t.id}의 group(${t.group}) 미선언`);
  if (t.mart && !/^data_new\/[\w/.-]+\.parquet$/.test(t.mart.path))
    errs.push(`객체 ${t.id}의 mart.path 형식 오류: ${t.mart.path}`);
}
for (const l of sem.linkTypes) {
  if (!objIds.has(l.from)) errs.push(`링크 ${l.id}의 from(${l.from}) 미선언`);
  if (!objIds.has(l.to)) errs.push(`링크 ${l.id}의 to(${l.to}) 미선언`);
  if (l.mart && !/^data_new\/[\w/.-]+\.parquet$/.test(l.mart.path))
    errs.push(`링크 ${l.id}의 mart.path 형식 오류: ${l.mart.path}`);
}
for (const a of sem.actionTypes) {
  if (!objIds.has(a.objectType)) errs.push(`액션 ${a.id}의 objectType(${a.objectType}) 미선언`);
  if (a.gate && !['ai', 'hitl'].includes(a.gate)) errs.push(`액션 ${a.id}의 gate 값 오류: ${a.gate}`);
}
if (sem.kpiBindings && !/^data_new\/[\w/.-]+\.parquet$/.test(sem.kpiBindings.datasource))
  errs.push(`kpiBindings.datasource 형식 오류: ${sem.kpiBindings.datasource}`);

if (errs.length) {
  console.error('✖ 시멘틱 정본 검증 실패:');
  for (const e of errs) console.error('  - ' + e);
  process.exit(1);
}

// ── 프런트 온톨로지 생성 (window.ONTOLOGY — 정본과 구조 동일) ───────────────
const ont = {
  meta: sem.meta,
  groups: sem.groups,
  objectTypes: sem.objectTypes,
  linkTypes: sem.linkTypes,
  lifecycles: sem.lifecycles,
  actionTypes: sem.actionTypes,
  metrics: sem.metrics,
};
fs.writeFileSync(OUT,
  '// =============================================================================\n' +
  '// v7-ontology.js — 생성 파일. 직접 수정 금지.\n' +
  '// 정본:   data_new/semantic/semantic-layer.json (시멘틱 레이어 — 유일 소스)\n' +
  '// 재생성: node development/tools/build-ontology.js\n' +
  '// mart 필드 = data_new 온톨로지 마트(Parquet) 바인딩 — server.js /api 가 서빙,\n' +
  '// mart.fields 는 필드 수준 계약 (파이프라인 50_validate 가 실스키마와 대조).\n' +
  '// =============================================================================\n' +
  'window.ONTOLOGY = ' + JSON.stringify(ont, null, 2) + ';\n');

const nMartO = sem.objectTypes.filter(t => t.mart).length;
const nMartL = sem.linkTypes.filter(l => l.mart).length;
const nGate = sem.actionTypes.filter(a => a.gate).length;
console.log(`✔ 정본 v${sem.version} (${sem.updated}) — 객체 ${sem.objectTypes.length}(mart ${nMartO}) · ` +
  `링크 ${sem.linkTypes.length}(mart ${nMartL}) · 액션 ${sem.actionTypes.length}(gate ${nGate}) · ` +
  `수명주기 ${Object.keys(sem.lifecycles).length} · 메트릭 ${sem.metrics.length}`);
console.log(`✔ 생성: ${path.relative(ROOT, OUT)}`);
