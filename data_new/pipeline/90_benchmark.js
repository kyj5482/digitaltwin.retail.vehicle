#!/usr/bin/env node
/**
 * 90_benchmark.js — CSV vs Parquet 실측 (저장 포맷 판단 근거)
 *
 * 실환경 규모를 가정해 도매 원장 형태의 200만 행을 생성한 뒤,
 * 같은 데이터를 CSV / Parquet(ZSTD)로 저장하고 ① 파일 크기 ② 집계 질의
 * ③ 단일 컬럼 스캔(컬럼 프루닝) ④ 월 필터(통계 기반 로우그룹 스킵)를 비교한다.
 * 결과는 data_new/pipeline/benchmark-result.json 에 기록된다.
 *
 * 실행: node data_new/pipeline/90_benchmark.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const ROOT = path.resolve(__dirname, '..', '..');
process.chdir(ROOT);
const { DuckDBInstance } = require(path.join(ROOT, 'node_modules', '@duckdb/node-api'));

const N = 2_000_000;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dtwin-bench-'));
const CSV = path.join(DIR, 'ledger.csv');
const PQ = path.join(DIR, 'ledger.parquet');

const timed = async (con, sql, reps = 5) => {
  const ms = [];
  for (let i = 0; i < reps; i++) {
    const t0 = process.hrtime.bigint();
    await (await con.run(sql)).getRows();
    ms.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  ms.sort((a, b) => a - b);
  return +ms[Math.floor(reps / 2)].toFixed(1);   // 중앙값
};

(async () => {
  const inst = await DuckDBInstance.create(':memory:');
  const con = await inst.connect();
  console.log(`■ 벤치마크 데이터 생성 — 도매 원장 형태 ${N.toLocaleString()}행`);
  await con.run(`SELECT setseed(0.7)`);
  await con.run(`
    CREATE TABLE ledger AS
    SELECT 'SO' || lpad(cast(g.k AS VARCHAR), 9, '0') so_id,
           strftime(DATE '2024-01-01' + cast(floor(random()*1065) AS INT), '%Y-%m') ym,
           'D' || lpad(cast(cast(floor(random()*1200) AS INT) AS VARCHAR), 4, '0') dealer_id,
           ['TRN','VST','AUR','MRD','NOV','LUM'][cast(floor(random()*6) AS INT)+1] model_id,
           'VF' || lpad(cast(g.k AS VARCHAR), 15, '0') vin,
           cast(round(28000 + random()*38000) AS INT) net_usd,
           cast(round(random()*3200) AS INT) incentive_usd
    FROM generate_series(1, ${N}) g(k)`);

  await con.run(`COPY ledger TO '${CSV}' (FORMAT CSV, HEADER)`);
  await con.run(`COPY ledger TO '${PQ}' (FORMAT PARQUET, COMPRESSION ZSTD)`);
  const size = f => +(fs.statSync(f).size / 1024 / 1024).toFixed(1);

  const AGG = f => `SELECT ym, model_id, count(*) n, sum(net_usd) rev FROM ${f} GROUP BY 1,2`;
  const ONECOL = f => `SELECT sum(net_usd) FROM ${f}`;
  const FILTER = f => `SELECT count(*), avg(incentive_usd) FROM ${f} WHERE ym = '2026-06'`;
  const csvSrc = `read_csv('${CSV}')`, pqSrc = `read_parquet('${PQ}')`;

  const result = {
    rows: N,
    size_mb: { csv: size(CSV), parquet: size(PQ) },
    query_ms: {
      agg_group_by: { csv: await timed(con, AGG(csvSrc)), parquet: await timed(con, AGG(pqSrc)) },
      single_column_sum: { csv: await timed(con, ONECOL(csvSrc)), parquet: await timed(con, ONECOL(pqSrc)) },
      month_filter: { csv: await timed(con, FILTER(csvSrc)), parquet: await timed(con, FILTER(pqSrc)) },
    },
  };
  result.ratio = {
    size: +(result.size_mb.csv / result.size_mb.parquet).toFixed(1),
    agg: +(result.query_ms.agg_group_by.csv / result.query_ms.agg_group_by.parquet).toFixed(1),
    onecol: +(result.query_ms.single_column_sum.csv / result.query_ms.single_column_sum.parquet).toFixed(1),
    filter: +(result.query_ms.month_filter.csv / result.query_ms.month_filter.parquet).toFixed(1),
  };
  console.log(JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(__dirname, 'benchmark-result.json'), JSON.stringify(result, null, 2) + '\n');
  fs.rmSync(DIR, { recursive: true, force: true });
  console.log('✔ 기록: data_new/pipeline/benchmark-result.json');
})().catch(e => { console.error('✖', e.message); process.exit(1); });
