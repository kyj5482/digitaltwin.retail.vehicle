#!/usr/bin/env node
/**
 * 60_incremental_demo.js — 증분 적재 실증 (INCREMENTAL.md §7)
 *
 * ① 도매 스테이징을 month=YYYY-MM hive 파티션으로 물질화 (/tmp — 본 마트 불변)
 * ② 단일 월 파티션만 재계산 → 전량 재생성과 결과 동일 검증 (파티션 단위 재계산의 정합)
 * ③ 월 필터 질의의 파티션 프루닝 실측 (스캔 파일 수 · 응답 시간)
 *
 * 실행: node data_new/pipeline/60_incremental_demo.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
process.chdir(ROOT);
const { DuckDBInstance } = require(path.join(ROOT, 'node_modules', '@duckdb/node-api'));

const BASE = fs.mkdtempSync('/tmp/dt-incr-');
const PART_DIR = path.join(BASE, 'stg_wholesale');
const SRC = 'data_new/staging/stg_wholesale.parquet';
const TARGET_YM = '2026-05';   // 재계산 실증 대상 파티션

(async () => {
  const inst = await DuckDBInstance.create(':memory:');
  const con = await inst.connect();
  const q = async sql => (await con.run(sql)).getRowObjects();
  const one = async sql => Object.values((await q(sql))[0])[0];
  const ms = async fn => { const t0 = process.hrtime.bigint(); const r = await fn();
    return { r, ms: Number(process.hrtime.bigint() - t0) / 1e6 }; };

  // ① 파티션 물질화 — ym 을 파티션 키 month 로
  await con.run(`COPY (SELECT *, ym AS month FROM read_parquet('${SRC}'))
                 TO '${PART_DIR}' (FORMAT PARQUET, PARTITION_BY (month), OVERWRITE_OR_IGNORE)`);
  const nPart = fs.readdirSync(PART_DIR).filter(d => d.startsWith('month=')).length;
  console.log(`■ ① 파티션 물질화 — ${nPart}개 월 파티션 (${PART_DIR})`);

  // ② 단일 파티션 재계산 — 대상 월만 raw 부터 다시 조인해 해당 디렉터리만 교체
  const before = await one(`SELECT count(*) FROM read_parquet('${PART_DIR}/*/*.parquet', hive_partitioning=1)
                            WHERE month='${TARGET_YM}'`);
  const rebuild = await ms(() => con.run(`
    COPY (
      SELECT p.VBELN so_id, p.POSNR so_item, h.KUNNR dealer_id, p.ZZVIN vin,
             p.MATNR material_id, p.NETWR wholesale_price_usd,
             b.FKDAT invoice_date, b.VBELN invoice_id, r.ZZYM ym, r.ZZYM AS month
      FROM read_parquet('data_new/raw/sap/vbap.parquet') p
      JOIN read_parquet('data_new/raw/sap/vbak.parquet') h USING (VBELN)
      JOIN read_parquet('data_new/raw/sap/vbfa.parquet') f
           ON f.VBELV=p.VBELN AND f.POSNV=p.POSNR AND f.VBTYP_N='M'
      JOIN read_parquet('data_new/raw/sap/vbrp.parquet') r
           ON r.VBELN=f.VBELN AND r.POSNR=f.POSNN
      JOIN read_parquet('data_new/raw/sap/vbrk.parquet') b ON b.VBELN=r.VBELN
      WHERE r.ZZYM='${TARGET_YM}'
    ) TO '${PART_DIR}' (FORMAT PARQUET, PARTITION_BY (month), OVERWRITE_OR_IGNORE)`));
  // 정합 검증 — 재계산 파티션 = 전량 소스의 해당 월 (행수 + 금액 합)
  const chk = await q(`
    SELECT (SELECT count(*) FROM read_parquet('${PART_DIR}/month=${TARGET_YM}/*.parquet')) part_n,
           (SELECT count(*) FROM read_parquet('${SRC}') WHERE ym='${TARGET_YM}') src_n,
           (SELECT sum(wholesale_price_usd) FROM read_parquet('${PART_DIR}/month=${TARGET_YM}/*.parquet')) part_amt,
           (SELECT sum(wholesale_price_usd) FROM read_parquet('${SRC}') WHERE ym='${TARGET_YM}') src_amt`);
  const c = chk[0];
  const ok = Number(c.part_n) === Number(c.src_n) && Number(c.part_amt) === Number(c.src_amt);
  console.log(`■ ② 단일 파티션(${TARGET_YM}) 재계산 — ${rebuild.ms.toFixed(0)}ms · ` +
    `행 ${c.part_n}=${c.src_n} · 금액 ${c.part_amt}=${c.src_amt} → ${ok ? '✔ 전량과 동일' : '✖ 불일치'}`);
  if (!ok || Number(before) !== Number(c.part_n)) { console.error('✖ 정합 실패'); process.exit(1); }

  // ③ 파티션 프루닝 실측 — 월 필터 질의: 단일 파일 vs 파티션 (EXPLAIN ANALYZE 로 스캔 파일 확인)
  const sqlPart = `SELECT count(*), sum(wholesale_price_usd)
                   FROM read_parquet('${PART_DIR}/*/*.parquet', hive_partitioning=1)
                   WHERE month='${TARGET_YM}'`;
  const sqlFlat = `SELECT count(*), sum(wholesale_price_usd) FROM read_parquet('${SRC}') WHERE ym='${TARGET_YM}'`;
  await q(sqlPart); await q(sqlFlat);                               // 워밍업
  const tPart = await ms(() => q(sqlPart));
  const tFlat = await ms(() => q(sqlFlat));
  const plan = (await q(`EXPLAIN ANALYZE ${sqlPart}`)).map(r => r.explain_value).join('\n');
  const scanned = (plan.match(/Total Files Read:\s*(\d+)/) || [])[1] || '?';
  console.log(`■ ③ 프루닝 실측 — 월 필터 질의가 ${nPart}개 파티션 중 ${scanned}개 파일만 스캔 · ` +
    `파티션 ${tPart.ms.toFixed(1)}ms vs 단일파일 ${tFlat.ms.toFixed(1)}ms`);
  console.log(`\n✔ 실증 완료 — 파티션 단위 재계산 정합 + 프루닝 (산출물: ${BASE}, 본 마트 불변)`);
})().catch(e => { console.error('✖', e.message); process.exit(1); });
