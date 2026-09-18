#!/usr/bin/env node
/**
 * 50_validate.js — 파이프라인 품질 게이트 (실패 = exit 1, run.js 가 마지막에 실행)
 *
 * 검증 계층:
 *   V1 시멘틱 계약 — mart 선언 파일 실재 + 필드 스키마(mart.fields ↔ 실제 Parquet) 대조
 *   V2 그레인/PK  — 객체 마트 object_id 유일, kpi_monthly ym 유일
 *   V3 참조 무결성 — 링크 마트의 from_id/to_id 가 끝점 객체 마트에 실재 (고아 0건)
 *   V4 레이어 대사 — staging ↔ ontology 행수, L0 KPI ↔ 원장 집계, FI 매출 ↔ 도매 원장 금액
 *   V5 시점 규칙  — L0 KPI 는 마감월까지만 노출
 *
 * 실행: node data_new/pipeline/50_validate.js   (또는 run.js 가 30 단계 후 자동 실행)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

const CLOSED_YM = '2026-08';   // 마감월 — 30_ontology.sql 의 시점 게이트와 동일 상수

async function validate(con) {
  const sem = JSON.parse(fs.readFileSync(path.join(ROOT, 'data_new', 'semantic', 'semantic-layer.json'), 'utf8'));
  const fails = [];
  let nChecks = 0;
  const q = async sql => (await con.run(sql)).getRowObjects();
  const one = async sql => Object.values((await q(sql))[0])[0];
  const check = (ok, msg) => { nChecks++; if (!ok) fails.push(msg); };

  // ── V1. 시멘틱 계약 — mart 파일 실재 + 필드 스키마 대조 ────────────────────
  const martObjs = sem.objectTypes.filter(t => t.mart);
  const martLnks = sem.linkTypes.filter(l => l.mart);
  for (const t of [...martObjs, ...martLnks]) {
    const p = t.mart.path;
    if (!fs.existsSync(path.join(ROOT, p))) { check(false, `V1 마트 파일 없음: ${t.id} → ${p}`); continue; }
    if (!t.mart.fields) continue;
    const actual = (await q(`DESCRIBE SELECT * FROM read_parquet('${p}')`))
      .map(r => `${r.column_name}:${r.column_type}`).join(', ');
    const declared = t.mart.fields.map(f => `${f.id}:${f.type}`).join(', ');
    check(actual === declared,
      `V1 스키마 불일치 ${t.id}\n      선언: ${declared}\n      실제: ${actual}`);
  }
  {
    const p = sem.kpiBindings.datasource;
    const actual = (await q(`DESCRIBE SELECT * FROM read_parquet('${p}')`))
      .map(r => `${r.column_name}:${r.column_type}`).join(', ');
    const declared = (sem.kpiBindings.schema || []).map(f => `${f.id}:${f.type}`).join(', ');
    check(actual === declared, `V1 스키마 불일치 kpiBindings\n      선언: ${declared}\n      실제: ${actual}`);
  }

  // ── V2. 그레인/PK 유일성 ────────────────────────────────────────────────────
  for (const t of martObjs) {
    const dup = await one(`SELECT count(*) - count(DISTINCT object_id)
                           FROM read_parquet('${t.mart.path}')`);
    check(Number(dup) === 0, `V2 PK 중복 ${t.id}: ${dup}건`);
  }
  {
    const dup = await one(`SELECT count(*) - count(DISTINCT ym)
                           FROM read_parquet('${sem.kpiBindings.datasource}')`);
    check(Number(dup) === 0, `V2 kpi_monthly ym 중복: ${dup}건`);
  }

  // ── V3. 참조 무결성 — 링크 고아 0건 (양 끝점이 mart 바인딩된 링크만) ───────
  const martOf = Object.fromEntries(martObjs.map(t => [t.id, t.mart.path]));
  for (const l of martLnks) {
    for (const [side, typeId] of [['from_id', l.from], ['to_id', l.to]]) {
      const mp = martOf[typeId];
      if (!mp) continue;
      const orphan = await one(
        `SELECT count(*) FROM read_parquet('${l.mart.path}') k
         WHERE NOT EXISTS (SELECT 1 FROM read_parquet('${mp}') o WHERE o.object_id = k.${side})`);
      check(Number(orphan) === 0, `V3 고아 링크 ${l.id}.${side} → ${typeId}: ${orphan}건`);
    }
  }

  // ── V4. 레이어 대사 — staging ↔ ontology ↔ L0 ─────────────────────────────
  const recon = [
    ['vehicle',    'data_new/staging/stg_vehicle.parquet'],
    ['wholesale',  'data_new/staging/stg_wholesale.parquet'],
    ['retailSale', 'data_new/staging/stg_retail.parquet'],
    ['shipment',   'data_new/staging/stg_delivery.parquet'],
  ];
  for (const [typeId, stg] of recon) {
    const a = await one(`SELECT count(*) FROM read_parquet('${stg}')`);
    const b = await one(`SELECT count(*) FROM read_parquet('${martOf[typeId]}')`);
    check(Number(a) === Number(b), `V4 행수 대사 ${typeId}: staging ${a} ≠ ontology ${b}`);
  }
  {  // L0 도매 대수 = 도매 원장 마감월 집계
    const l0 = await one(`SELECT sum(wholesale_units) FROM read_parquet('${sem.kpiBindings.datasource}')`);
    const led = await one(`SELECT count(*) FROM read_parquet('data_new/staging/stg_wholesale.parquet')
                           WHERE ym <= '${CLOSED_YM}'`);
    check(Number(l0) === Number(led), `V4 L0 대사 도매대수: kpi ${l0} ≠ 원장 ${led}`);
  }
  {  // FI 매출(400100) 총액 = 도매 원장 금액 총액 (매출은 도매월 전기 — 부호: 대변 음수)
    const fi = await one(`SELECT -sum(amount_usd) FROM read_parquet('data_new/staging/stg_fi_posting.parquet')
                          WHERE account_id='400100'`);
    const ws = await one(`SELECT sum(wholesale_price_usd) FROM read_parquet('data_new/staging/stg_wholesale.parquet')`);
    check(Number(fi) === Number(ws), `V4 금액 대사 매출: FI ${fi} ≠ 도매 원장 ${ws}`);
  }

  // ── V5. 시점 규칙 — L0 는 마감월까지만 ─────────────────────────────────────
  {
    const maxYm = await one(`SELECT max(ym) FROM read_parquet('${sem.kpiBindings.datasource}')`);
    check(String(maxYm) <= CLOSED_YM, `V5 시점 위반: kpi_monthly 최대 월 ${maxYm} > 마감월 ${CLOSED_YM}`);
  }

  return { nChecks, fails };
}

module.exports = { validate };

if (require.main === module) {
  (async () => {
    process.chdir(ROOT);
    const { DuckDBInstance } = require(path.join(ROOT, 'node_modules', '@duckdb/node-api'));
    const inst = await DuckDBInstance.create(':memory:');
    const con = await inst.connect();
    const { nChecks, fails } = await validate(con);
    if (fails.length) {
      console.error(`✖ 품질 게이트 실패 — ${fails.length}/${nChecks}건:`);
      for (const f of fails) console.error('  - ' + f);
      process.exit(1);
    }
    console.log(`✔ 품질 게이트 통과 — 검증 ${nChecks}건 (계약·PK·참조·대사·시점)`);
  })().catch(e => { console.error('✖', e.message); process.exit(1); });
}
