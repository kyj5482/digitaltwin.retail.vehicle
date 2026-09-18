-- =============================================================================
-- 20_stage.sql — Staging: SAP Raw → 표준화 (Parquet)
-- =============================================================================
-- 규칙: ① SAP 독일어 축약 컬럼 → 업무 용어로 개명  ② 타입 확정 (날짜·정수)
--       ③ 헤더+품목 결합 (그레인 = 업무 단위)      ④ 월 파티션 컬럼 ym 부여
-- 실환경에서는 dbt/SQLMesh 모델로 동일 SQL을 관리한다.
-- =============================================================================
PRAGMA threads=1;

COPY (   -- 딜러
  SELECT KUNNR dealer_id, NAME1 dealer_name, ZZZONE zone_id, LAND1 country
  FROM read_parquet('data_new/raw/sap/kna1.parquet')
) TO 'data_new/staging/stg_dealer.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (   -- 플랜트
  SELECT WERKS plant_id, NAME1 plant_name, LAND1 country, ZZWMI wmi
  FROM read_parquet('data_new/raw/sap/t001w.parquet')
) TO 'data_new/staging/stg_plant.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (   -- 자재 → 모델·트림
  SELECT MATNR material_id, ZZMODEL model_id, ZZTRIM trim_id, MAKTX title,
         ZZSEG segment, ZZEV is_ev, ZZMSRP msrp_usd
  FROM read_parquet('data_new/raw/sap/mara.parquet')
) TO 'data_new/staging/stg_material.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (   -- 차량 (VIN 원장)
  SELECT VHVIN vin, MATNR material_id, WERKS plant_id, ZZPRODDT prod_date,
         ZZPRODYM prod_ym, ZZSTATUS status, ZZDEALER dealer_id, ZZMSRP msrp_usd
  FROM read_parquet('data_new/raw/sap/vlcvehicle.parquet')
) TO 'data_new/staging/stg_vehicle.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (   -- 매입 (본사 인터컴퍼니 PO — 헤더+품목 결합, 그레인 = VIN)
  SELECT i.EBELN po_id, i.EBELP po_item, h.LIFNR supplier_id, i.ZZVIN vin,
         i.MATNR material_id, i.NETPR purchase_price_usd,
         strftime(h.AEDAT,'%Y-%m') ym
  FROM read_parquet('data_new/raw/sap/ekpo.parquet') i
  JOIN read_parquet('data_new/raw/sap/ekko.parquet') h USING (EBELN)
) TO 'data_new/staging/stg_purchase.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (   -- 도매 (판매오더+빌링 결합, 그레인 = VIN)
  -- SO→빌링 연결은 문서흐름 VBFA(VBTYP_N='M')로만 조인한다 — 실SAP 에서 후속 문서
  -- 번호는 SO 에서 파생 불가능하므로 채번 규칙 기반 조인은 금지.
  SELECT p.VBELN so_id, p.POSNR so_item, h.KUNNR dealer_id, p.ZZVIN vin,
         p.MATNR material_id, p.NETWR wholesale_price_usd,
         b.FKDAT invoice_date, b.VBELN invoice_id, r.ZZYM ym
  FROM read_parquet('data_new/raw/sap/vbap.parquet') p
  JOIN read_parquet('data_new/raw/sap/vbak.parquet') h USING (VBELN)
  JOIN read_parquet('data_new/raw/sap/vbfa.parquet') f
       ON f.VBELV=p.VBELN AND f.POSNV=p.POSNR AND f.VBTYP_N='M'
  JOIN read_parquet('data_new/raw/sap/vbrp.parquet') r
       ON r.VBELN=f.VBELN AND r.POSNR=f.POSNN
  JOIN read_parquet('data_new/raw/sap/vbrk.parquet') b ON b.VBELN=r.VBELN
) TO 'data_new/staging/stg_wholesale.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (   -- 출하 (납품 — 그레인 = VIN)
  SELECT i.VBELN delivery_id, i.POSNR delivery_item, h.KUNNR dealer_id,
         i.ZZVIN vin, h.WADAT_IST ship_date, strftime(h.WADAT_IST,'%Y-%m') ym
  FROM read_parquet('data_new/raw/sap/lips.parquet') i
  JOIN read_parquet('data_new/raw/sap/likp.parquet') h USING (VBELN)
) TO 'data_new/staging/stg_delivery.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (   -- 소매 (딜러 DMS RDR)
  SELECT ZRDRNO rdr_id, ZZVIN vin, KUNNR dealer_id, ZZRTLDT retail_date,
         ZZPRICE retail_price_usd, ZZINCENT incentive_usd, ZZCUSTID customer_id, ZZYM ym
  FROM read_parquet('data_new/raw/sap/zsd_rdr.parquet')
) TO 'data_new/staging/stg_retail.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (   -- 품질통지 (Z1 VoC · Q1 보증클레임)
  SELECT QMNUM notif_id,
         CASE QMART WHEN 'Z1' THEN 'voc' ELSE 'warranty_claim' END notif_type,
         ZZVIN vin, ZZDEALER dealer_id, MATNR material_id,
         ERDAT created_date, strftime(ERDAT,'%Y-%m') ym,
         QMGRP defect_group, QMTXT title, ZZCLAIMAMT claim_amount_usd, ZZSTATUS claim_status
  FROM read_parquet('data_new/raw/sap/qmel.parquet')
) TO 'data_new/staging/stg_quality_notification.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (   -- 시장 (외부 구독 데이터 — 그레인 = 월)
  SELECT YM ym, SAAR_K*1000 saar_units, OWN_SHARE_PCT own_share_pct,
         SEG_SUV_SHARE_PCT seg_suv_share_pct,
         COMP_AVG_INCENTIVE_USD comp_avg_incentive_usd, COMP_LAUNCH_CNT comp_launch_cnt
  FROM read_parquet('data_new/raw/external/market_monthly.parquet')
) TO 'data_new/staging/stg_market.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (   -- 회계 (전표 라인 — 그레인 = 월×코스트센터×계정)
  SELECT l.BELNR doc_id, l.BUZEI line_no, l.ZZYM ym, l.KOSTL cost_center_id,
         c.KTEXT cost_center_name, l.SAKNR account_id, l.SGTXT account_name,
         CASE l.SHKZG WHEN 'H' THEN -l.DMBTR ELSE l.DMBTR END amount_usd   -- 차변(+)/대변(-)
  FROM read_parquet('data_new/raw/sap/bseg.parquet') l
  JOIN read_parquet('data_new/raw/sap/csks.parquet') c ON c.KOSTL=l.KOSTL
) TO 'data_new/staging/stg_fi_posting.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);
