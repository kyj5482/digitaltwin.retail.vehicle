#!/usr/bin/env node
/**
 * run.js — data_new 파이프라인 러너
 *
 *   RAW 생성(10) → STAGING(20) → ONTOLOGY(30) → 서빙 데모(40, 시간 실측) → 품질 게이트(50)
 *
 * 선행: npm i --no-save @duckdb/node-api   (DuckDB — 외부 의존성은 이것뿐)
 * 실행: node data_new/pipeline/run.js            # 전체
 *       node data_new/pipeline/run.js 30 40      # 특정 단계만
 * 항상 저장소 루트 기준 상대 경로를 쓴다 (SQL 안의 경로와 동일).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
process.chdir(ROOT);
const { DuckDBInstance } = require(path.join(ROOT, 'node_modules', '@duckdb/node-api'));

const STEPS = [
  { no: '10', file: '10_generate_raw.sql', label: 'RAW — SAP 모사 추출 (Parquet)' },
  { no: '20', file: '20_stage.sql',        label: 'STAGING — 표준화' },
  { no: '30', file: '30_ontology.sql',     label: 'ONTOLOGY — 객체·링크·KPI 마트' },
  { no: '40', file: '40_serve.sql',        label: 'SERVE — DuckDB 서빙 데모 (실측)' },
  { no: '50', js: '50_validate.js',        label: 'VALIDATE — 품질 게이트 (계약·PK·참조·대사·시점)' },
];
const only = process.argv.slice(2);
const run = only.length ? STEPS.filter(s => only.includes(s.no)) : STEPS;

// SQL 파일 → 문장 배열 (문자열 리터럴 안에는 ';'를 쓰지 않는 것이 이 폴더의 규약)
const statements = f => fs.readFileSync(path.join(__dirname, f), 'utf8')
  .split(';').map(s => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean);

(async () => {
  for (const d of ['raw/sap', 'raw/external', 'staging', 'ontology/objects', 'ontology/links'])
    fs.mkdirSync(path.join(ROOT, 'data_new', d), { recursive: true });

  const inst = await DuckDBInstance.create(':memory:');
  const con = await inst.connect();

  for (const step of run) {
    console.log(`\n■ ${step.no} ${step.label}`);
    const t0 = process.hrtime.bigint();
    if (step.js) {   // JS 단계 (품질 게이트) — 실패 시 파이프라인 전체 실패
      const { validate } = require(path.join(__dirname, step.js));
      const { nChecks, fails } = await validate(con);
      if (fails.length) {
        console.error(`  ✖ 품질 게이트 실패 — ${fails.length}/${nChecks}건:`);
        for (const f of fails) console.error('    - ' + f);
        process.exit(1);
      }
      console.log(`  ✔ 검증 ${nChecks}건 통과 · ${(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(0)}ms`);
      continue;
    }
    let qn = 0;
    for (const sql of statements(step.file)) {
      const q0 = process.hrtime.bigint();
      const res = await con.run(sql);
      if (step.no === '40' && /^select|^with/i.test(sql)) {          // 데모 질의는 결과+시간 출력
        const rows = await res.getRowObjects();
        const ms = Number(process.hrtime.bigint() - q0) / 1e6;
        qn += 1;
        console.log(`  Q${qn} — ${rows.length}행 · ${ms.toFixed(1)}ms`);
        console.table(rows.slice(0, 6));
      }
    }
    console.log(`  완료 · ${(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(0)}ms`);
  }

  // 산출물 요약 — 파일별 행수·크기
  if (run.some(s => s.no === '30')) {
    const files = [];
    const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.parquet')) files.push(p);
    });
    walk(path.join(ROOT, 'data_new'));
    const out = [];
    for (const f of files.sort()) {
      const r = await con.run(`SELECT count(*) n FROM read_parquet('${f.replace(/'/g, "''")}')`);
      out.push({ file: path.relative(ROOT, f), rows: Number((await r.getRows())[0][0]),
                 kb: Math.round(fs.statSync(f).size / 1024) });
    }
    console.log('\n■ 산출물 (파일 · 행수 · KB)');
    console.table(out);
  }
})().catch(e => { console.error('✖', e.message); process.exit(1); });
