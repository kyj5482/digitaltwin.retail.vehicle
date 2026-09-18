-- =============================================================================
-- 10_generate_raw.sql — SAP 모사 Raw 생성 (Parquet)
-- =============================================================================
-- SAP를 쓰는 판매법인에서 추출을 예상하는 원천 테이블을 실제 SAP 테이블명·컬럼명으로
-- 모사 생성한다 (시드 고정 · 결정적). 스케일은 프로토타입 관례와 동일한 1:50 샘플.
--   SD: VBAK/VBAP(판매오더) LIKP/LIPS(납품) VBRK/VBRP(빌링)
--   MM: EKKO/EKPO(본사 매입 PO)     FI: BKPF/BSEG(회계전표) CSKS(코스트센터)
--   QM: QMEL(품질통지=VoC·클레임)   VMS: VLCVEHICLE(차량 원장)
--   마스터: KNA1(딜러) MARA(자재=모델·트림) T001W(플랜트)
--   인터페이스: ZSD_RDR(딜러 DMS 소매실적 — SAP 외 원천의 커스텀 수신 테이블)
-- 실환경에서는 이 파일 대신 SLT/CDC 추출이 raw/sap/ 파케이를 적재한다.
-- =============================================================================
PRAGMA threads=1;
SELECT setseed(0.4242);

-- ── 차원 (data/master 정본 재사용 — 트윈과 동일 체계) ───────────────────────
CREATE TEMP TABLE dim_model AS SELECT * FROM read_csv('data/master/dim_model.csv');
CREATE TEMP TABLE dim_trim  AS SELECT * FROM read_csv('data/master/dim_trim.csv');
CREATE TEMP TABLE dim_plant AS SELECT * FROM read_csv('data/master/dim_plant.csv');
CREATE TEMP TABLE dim_zone  AS SELECT * FROM read_csv('data/master/dim_zone.csv');

CREATE TEMP TABLE share(model_id VARCHAR, share DOUBLE);
INSERT INTO share VALUES ('TRN',0.24),('VST',0.26),('AUR',0.08),('MRD',0.16),('NOV',0.13),('LUM',0.13);

CREATE TEMP TABLE months AS
SELECT strftime(d,'%Y-%m') ym, d::DATE d0, row_number() OVER (ORDER BY d)-1 i
FROM (SELECT unnest(generate_series(DATE '2024-01-01', DATE '2026-08-01', INTERVAL 1 MONTH)) d);

-- ── 딜러 60개 — 존별 dealer_cnt 비례 배분 ───────────────────────────────────
CREATE TEMP TABLE dealers AS
WITH z AS (
  SELECT zone_id, zone_name,
         cast(round(60.0*dealer_cnt/(SELECT sum(dealer_cnt) FROM dim_zone)) AS INT) n
  FROM dim_zone
)
SELECT 'D' || lpad(cast(row_number() OVER (ORDER BY z.zone_id, g.k) AS VARCHAR), 4, '0') kunnr,
       z.zone_id, z.zone_name || ' Auto ' || g.k AS name1,
       row_number() OVER (ORDER BY z.zone_id, g.k) rn
FROM z, generate_series(1, z.n) g(k);

-- ── 차량(VIN) 원장 — 월×모델 생산, 트림 가중 선택, 딜러 배정, 수명주기 날짜 ──
CREATE TEMP TABLE veh AS
WITH cnt AS (      -- 월×모델 생산 대수 (기준 96대/월 × 점유율 × 잡음)
  SELECT m.ym, m.d0, m.i, s.model_id,
         cast(round(96*s.share*(0.86+0.28*random())) AS INT) n
  FROM months m, share s
), rows_ AS (
  SELECT c.*, g.k, random() r_trim, random() r_dlr, random() r_d1, random() r_d2, random() r_d3
  FROM cnt c, generate_series(1, c.n) g(k)
), trims AS (      -- 모델별 트림 누적 가중 구간
  SELECT model_id, trim_id, msrp_factor,
         sum(mix_weight) OVER (PARTITION BY model_id ORDER BY trim_id) - mix_weight lo,
         sum(mix_weight) OVER (PARTITION BY model_id ORDER BY trim_id) hi
  FROM dim_trim
)
SELECT row_number() OVER (ORDER BY r.ym, r.model_id, r.k) veh_id,
       p.wmi || 'S' || substr(r.model_id,1,2) || 'X' || substr(r.ym,3,2) ||
         lpad(cast(row_number() OVER (ORDER BY r.ym, r.model_id, r.k) AS VARCHAR), 8, '0') vin,
       r.ym prod_ym, r.model_id, t.trim_id,
       dm.primary_plant_id plant_id, p.wmi,
       cast(round(dm.msrp_usd * t.msrp_factor) AS INT) msrp,
       d.kunnr dealer_id, d.zone_id,
       (r.d0 + cast(floor(r.r_d1*26) AS INT)) prod_date,
       (r.d0 + cast(floor(r.r_d1*26) + p.lead_month*30 + 4 + floor(r.r_d2*10) AS INT)) ws_date,
       (r.d0 + cast(floor(r.r_d1*26) + p.lead_month*30 + 19 + floor(r.r_d2*10+r.r_d3*45) AS INT)) rt_date,
       r.r_d3 < 0.94 sold_retail     -- 6%는 아직 딜러 재고
FROM rows_ r
JOIN dim_model dm ON dm.model_id = r.model_id
JOIN dim_plant p  ON p.plant_id = dm.primary_plant_id
JOIN trims t      ON t.model_id = r.model_id AND r.r_trim >= t.lo AND r.r_trim < t.hi
JOIN dealers d    ON d.rn = 1 + cast(floor(r.r_dlr*60) AS INT);

-- =============================================================================
-- 마스터
-- =============================================================================
COPY (   -- KNA1 — 고객(딜러) 마스터
  SELECT kunnr KUNNR, name1 NAME1, 'US' LAND1, upper(substr(zone_id,1,2)) REGION,
         'ZDLR' KTOKD, 'USD' WAERS, zone_id ZZZONE
  FROM dealers ORDER BY kunnr
) TO 'data_new/raw/sap/kna1.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (   -- MARA — 자재 마스터 (차량 = 모델×트림 완성품)
  SELECT 'VEH-' || t.model_id || '-' || substr(t.trim_id, 5) MATNR,
         'FERT' MTART, 'ZVEH' MATKL, m.model_name || ' ' || t.trim_name MAKTX,
         m.model_id ZZMODEL, t.trim_id ZZTRIM, m.segment ZZSEG,
         m.is_ev ZZEV, cast(round(m.msrp_usd*t.msrp_factor) AS INT) ZZMSRP
  FROM dim_trim t JOIN dim_model m USING (model_id) ORDER BY MATNR
) TO 'data_new/raw/sap/mara.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (   -- T001W — 플랜트 마스터
  SELECT plant_id WERKS, plant_name NAME1, country LAND1, wmi ZZWMI
  FROM dim_plant ORDER BY plant_id
) TO 'data_new/raw/sap/t001w.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (   -- CSKS — 코스트센터 (부문×사옥 관리비 귀속)
  SELECT 'CC' || lpad(cast(row_number() OVER () AS VARCHAR),4,'0') KOSTL,
         d || '-' || b KTEXT, 'SC-US' BUKRS
  FROM (VALUES ('SLS'),('MKT'),('PRD'),('FIN'),('SVC'),('QLT'),('SAF'),('HR'),('IT'),('GA')) t1(d),
       (VALUES ('EAST'),('WEST')) t2(b)
) TO 'data_new/raw/sap/csks.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

-- =============================================================================
-- VMS — 차량 원장
-- =============================================================================
COPY (   -- VLCVEHICLE — SAP VMS 차량 (VIN 그레인)
  SELECT lpad(cast(veh_id AS VARCHAR),10,'0') VHCLE, vin VHVIN,
         'VEH-' || model_id || '-' || substr(trim_id,5) MATNR,
         plant_id WERKS, prod_date ZZPRODDT, prod_ym ZZPRODYM,
         CASE WHEN sold_retail THEN 'RTLD' ELSE 'WHSL' END ZZSTATUS,
         dealer_id ZZDEALER, msrp ZZMSRP
  FROM veh ORDER BY veh_id
) TO 'data_new/raw/sap/vlcvehicle.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

-- =============================================================================
-- MM — 본사 매입 (월×플랜트 PO 헤더 + VIN 품목)
-- =============================================================================
CREATE TEMP TABLE po AS
SELECT prod_ym, plant_id,
       '45' || lpad(cast(dense_rank() OVER (ORDER BY prod_ym, plant_id) AS VARCHAR),8,'0') ebeln
FROM veh GROUP BY prod_ym, plant_id;

COPY (   -- EKKO — 구매오더 헤더 (본사 → 판매법인 인터컴퍼니 매입)
  SELECT p.ebeln EBELN, 'ZIC' BSART, 'HQ-NA' LIFNR, 'SC-US' BUKRS,
         (p.prod_ym || '-01')::DATE AEDAT, 'USD' WAERS
  FROM po p ORDER BY p.ebeln
) TO 'data_new/raw/sap/ekko.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (   -- EKPO — 구매오더 품목 (VIN 1건 = 1품목, 매입가 = MSRP×0.84)
  SELECT p.ebeln EBELN,
         lpad(cast(row_number() OVER (PARTITION BY p.ebeln ORDER BY v.veh_id) AS VARCHAR),5,'0') EBELP,
         'VEH-' || v.model_id || '-' || substr(v.trim_id,5) MATNR,
         1 MENGE, cast(round(v.msrp*0.84) AS INT) NETPR, v.vin ZZVIN
  FROM veh v JOIN po p ON p.prod_ym=v.prod_ym AND p.plant_id=v.plant_id
  ORDER BY p.ebeln, EBELP
) TO 'data_new/raw/sap/ekpo.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

-- =============================================================================
-- SD — 도매 판매오더 · 납품 · 빌링 (오더 = 월×딜러 배치, 품목 = VIN)
-- =============================================================================
CREATE TEMP TABLE so AS
SELECT strftime(ws_date,'%Y-%m') ws_ym, dealer_id,
       '20' || lpad(cast(dense_rank() OVER (ORDER BY strftime(ws_date,'%Y-%m'), dealer_id) AS VARCHAR),8,'0') vbeln
FROM veh GROUP BY strftime(ws_date,'%Y-%m'), dealer_id;

COPY (   -- VBAK — 판매오더 헤더
  SELECT s.vbeln VBELN, 'ZVEH' AUART, s.dealer_id KUNNR,
         (s.ws_ym || '-01')::DATE ERDAT, 'USD' WAERK
  FROM so s ORDER BY s.vbeln
) TO 'data_new/raw/sap/vbak.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

CREATE TEMP TABLE soi AS
SELECT s.vbeln,
       lpad(cast(row_number() OVER (PARTITION BY s.vbeln ORDER BY v.veh_id) AS VARCHAR),6,'0') posnr,
       v.*
FROM veh v JOIN so s ON s.ws_ym=strftime(v.ws_date,'%Y-%m') AND s.dealer_id=v.dealer_id;

COPY (   -- VBAP — 판매오더 품목 (도매가 = MSRP×0.965)
  SELECT vbeln VBELN, posnr POSNR,
         'VEH-' || model_id || '-' || substr(trim_id,5) MATNR,
         1 KWMENG, cast(round(msrp*0.965) AS INT) NETWR, vin ZZVIN
  FROM soi ORDER BY vbeln, posnr
) TO 'data_new/raw/sap/vbap.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (   -- LIKP — 납품 헤더 (오더당 1건, 출하일 = 도매일 -3일)
  SELECT '80' || substr(vbeln,3) VBELN, min(dealer_id) KUNNR, min(ws_date)-3 WADAT_IST
  FROM soi GROUP BY vbeln ORDER BY VBELN
) TO 'data_new/raw/sap/likp.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (   -- LIPS — 납품 품목
  SELECT '80' || substr(vbeln,3) VBELN, posnr POSNR,
         'VEH-' || model_id || '-' || substr(trim_id,5) MATNR, 1 LFIMG, vin ZZVIN
  FROM soi ORDER BY VBELN, posnr
) TO 'data_new/raw/sap/lips.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (   -- VBRK — 빌링(도매 인보이스) 헤더
  SELECT '90' || substr(vbeln,3) VBELN, 'F2' FKART, min(dealer_id) KUNAG,
         min(ws_date) FKDAT, sum(cast(round(msrp*0.965) AS INT)) NETWR, 'USD' WAERK
  FROM soi GROUP BY vbeln ORDER BY VBELN
) TO 'data_new/raw/sap/vbrk.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (   -- VBRP — 빌링 품목
  SELECT '90' || substr(vbeln,3) VBELN, posnr POSNR,
         'VEH-' || model_id || '-' || substr(trim_id,5) MATNR,
         1 FKIMG, cast(round(msrp*0.965) AS INT) NETWR, vin ZZVIN,
         strftime(ws_date,'%Y-%m') ZZYM
  FROM soi ORDER BY VBELN, posnr
) TO 'data_new/raw/sap/vbrp.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (   -- VBFA — 판매 문서흐름 (SO 품목 → 납품 'J' / 빌링 'M')
  -- 후속 문서 번호는 SAP 채번이라 SO 에서 파생 불가 — 문서흐름이 유일한 공식 연결이며
  -- 이후 단계(20_stage)는 반드시 VBFA 로만 조인한다 (생성기의 채번 규칙에 기생 금지).
  SELECT vbeln VBELV, posnr POSNV, '80'||substr(vbeln,3) VBELN, posnr POSNN, 'J' VBTYP_N FROM soi
  UNION ALL
  SELECT vbeln, posnr, '90'||substr(vbeln,3), posnr, 'M' FROM soi
  ORDER BY VBELV, POSNV, VBTYP_N
) TO 'data_new/raw/sap/vbfa.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

-- =============================================================================
-- 인터페이스 — 딜러 DMS 소매실적 (SAP 외 원천 → 커스텀 수신 테이블)
-- =============================================================================
COPY (   -- ZSD_RDR — Retail Delivery Report
  SELECT 'RDR' || lpad(cast(row_number() OVER (ORDER BY rt_date, vin) AS VARCHAR),8,'0') ZRDRNO,
         vin ZZVIN, dealer_id KUNNR, rt_date ZZRTLDT, strftime(rt_date,'%Y-%m') ZZYM,
         cast(round(msrp*(0.97+0.05*random())) AS INT) ZZPRICE,
         cast(round(400+2200*random()) AS INT) ZZINCENT,
         'CUST' || lpad(cast(cast(floor(random()*90000) AS INT)+10000 AS VARCHAR),5,'0') ZZCUSTID
  FROM veh WHERE sold_retail ORDER BY rt_date, vin
) TO 'data_new/raw/sap/zsd_rdr.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

-- =============================================================================
-- 외부 — 시장 데이터 (조사기관 구독 데이터 모사 → 수신 테이블. SAP 외 원천)
--   SAAR(연환산 시장 규모) · 자사 점유율 · SUV 세그 점유율 · 경쟁사 평균 인센티브
--   실환경에서는 조사기관 피드(S&P Mobility 등)가 같은 자리에 적재된다.
-- =============================================================================
COPY (
  SELECT m.ym YM,
         cast(round(15500 + 900*sin(2*pi()*m.i/12) + 350*(random()-0.5)) AS INT) SAAR_K,
         round(8.6 + 0.5*sin(2*pi()*(m.i+2)/12) + 0.6*random(), 2) OWN_SHARE_PCT,
         round(6.8 + 0.7*sin(2*pi()*(m.i+4)/12) + 0.5*random(), 2) SEG_SUV_SHARE_PCT,
         cast(round(1450 + 600*sin(2*pi()*(m.i+6)/12) + 350*random()) AS INT) COMP_AVG_INCENTIVE_USD,
         cast(floor(random()*2.2) AS INT) COMP_LAUNCH_CNT
  FROM months m ORDER BY m.ym
) TO 'data_new/raw/external/market_monthly.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

-- =============================================================================
-- QM — 품질통지 (Z1 = VoC, Q1 = 보증클레임) — 소매 차량의 ~28%에서 발생
-- =============================================================================
COPY (
  SELECT 'QM' || lpad(cast(row_number() OVER (ORDER BY q.vin) AS VARCHAR),8,'0') QMNUM,
         CASE WHEN q.r1 < 0.62 THEN 'Z1' ELSE 'Q1' END QMART,
         'VEH-' || q.model_id || '-' || substr(q.trim_id,5) MATNR, q.vin ZZVIN,
         q.dealer_id ZZDEALER,
         (q.rt_date + 10 + cast(floor(q.r2*160) AS INT)) ERDAT,
         CASE cast(floor(q.r3*6) AS INT)
           WHEN 0 THEN 'BRK' WHEN 1 THEN 'INF' WHEN 2 THEN 'ELE'
           WHEN 3 THEN 'PWT' WHEN 4 THEN 'BOD' ELSE 'HVA' END QMGRP,
         CASE WHEN q.r1 < 0.62 THEN 'VoC 접수' ELSE '보증수리 클레임' END QMTXT,
         CASE WHEN q.r1 >= 0.62 THEN cast(round(180+2400*q.r2) AS INT) END ZZCLAIMAMT,
         CASE WHEN q.r1 >= 0.62 AND q.r3 < 0.85 THEN 'APPR'
              WHEN q.r1 >= 0.62 THEN 'PEND' END ZZSTATUS
  FROM (SELECT *, random() r0, random() r1, random() r2, random() r3
        FROM veh WHERE sold_retail) q
  WHERE q.r0 < 0.28
) TO 'data_new/raw/sap/qmel.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

-- =============================================================================
-- FI — 회계전표 (월별 관리비 · 매출/원가 집계 전기)
-- =============================================================================
CREATE TEMP TABLE fi_lines AS
-- 관리비: 코스트센터 × 계정 3종 (전력 466000 · 임차 470000 · 소모품 476000)
SELECT m.ym, cc.KOSTL kostl, a.saknr, a.txt,
       cast(round(a.base*(0.8+0.4*random())) AS INT) dmbtr, 'S' shkzg
FROM months m,
     (SELECT KOSTL FROM read_parquet('data_new/raw/sap/csks.parquet')) cc,
     (VALUES ('466000','전력비',4200),('470000','임차료',10400),('476000','소모품비',1900)) a(saknr,txt,base)
UNION ALL
-- 손익: 도매 매출(H)·매출원가(S) — SD·MM 실적을 월 집계로 전기
-- 매출원가는 수익·비용 대응 원칙에 따라 매출과 같은 판매(도매)월에 인식한다
SELECT strftime(ws_date,'%Y-%m') ym, 'CC0007' kostl, '400100' saknr, '차량 도매 매출' txt,
       sum(cast(round(msrp*0.965) AS INT)) dmbtr, 'H' shkzg
FROM veh GROUP BY 1
UNION ALL
SELECT strftime(ws_date,'%Y-%m') ym, 'CC0007' kostl, '500100' saknr, '차량 매출원가' txt,
       sum(cast(round(msrp*0.84) AS INT)) dmbtr, 'S' shkzg
FROM veh GROUP BY 1;

COPY (   -- BKPF — 전표 헤더 (월 1건 SA 전표로 단순화)
  SELECT 'SC-US' BUKRS, '1' || replace(ym,'-','') || '01' BELNR, 'SA' BLART,
         (ym || '-28')::DATE BUDAT, substr(ym,1,4) GJAHR, 'USD' WAERS
  FROM (SELECT DISTINCT ym FROM fi_lines) ORDER BY BELNR
) TO 'data_new/raw/sap/bkpf.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (   -- BSEG — 전표 라인
  SELECT 'SC-US' BUKRS, '1' || replace(ym,'-','') || '01' BELNR, substr(ym,1,4) GJAHR,
         lpad(cast(row_number() OVER (PARTITION BY ym ORDER BY kostl, saknr) AS VARCHAR),3,'0') BUZEI,
         saknr SAKNR, kostl KOSTL, shkzg SHKZG, dmbtr DMBTR, txt SGTXT, ym ZZYM
  FROM fi_lines ORDER BY BELNR, BUZEI
) TO 'data_new/raw/sap/bseg.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);
