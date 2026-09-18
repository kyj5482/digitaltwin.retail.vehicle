-- =============================================================================
-- 30_ontology.sql — Staging → 온톨로지 인스턴스 마트 (objects/ · links/)
-- =============================================================================
-- 객체·링크 타입 id는 prototypes/v7-ontology.js 의 타입 체계와 동일하게 맞춘다.
-- 객체 파일: object_id + title + 속성 컬럼 / 링크 파일: from_id, to_id (+속성).
-- 어떤 마트가 어떤 타입에 바인딩되는지는 semantic/semantic-layer.json 이 선언한다.
-- =============================================================================
PRAGMA threads=1;

-- ── 객체 ─────────────────────────────────────────────────────────────────────
COPY (SELECT 'SC-US' object_id, '미국판매법인' title, 'US' country)
TO 'data_new/ontology/objects/salesCompany.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT zone_id object_id, zone_name title, dealer_cnt
      FROM read_csv('data/master/dim_zone.csv'))
TO 'data_new/ontology/objects/salesZone.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT plant_id object_id, plant_name title, country, wmi
      FROM read_parquet('data_new/staging/stg_plant.parquet'))
TO 'data_new/ontology/objects/plant.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT dealer_id object_id, dealer_name title, zone_id, country
      FROM read_parquet('data_new/staging/stg_dealer.parquet'))
TO 'data_new/ontology/objects/dealer.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (   -- 시장 스냅샷 — 경쟁·시장 축 (마감월만 — L0 시점 규칙과 동일)
  SELECT 'MKT-'||ym object_id, ym||' 시장' title, ym, saar_units, own_share_pct,
         seg_suv_share_pct, comp_avg_incentive_usd, comp_launch_cnt
  FROM read_parquet('data_new/staging/stg_market.parquet') WHERE ym <= '2026-08')
TO 'data_new/ontology/objects/marketSnapshot.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT DISTINCT model_id object_id, split_part(title,' ',1) title, segment, is_ev
      FROM read_parquet('data_new/staging/stg_material.parquet'))
TO 'data_new/ontology/objects/model.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT trim_id object_id, title, model_id, msrp_usd
      FROM read_parquet('data_new/staging/stg_material.parquet'))
TO 'data_new/ontology/objects/trim.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT v.vin object_id, v.vin title, m.model_id, m.trim_id, v.plant_id,
             v.prod_ym, v.prod_date, v.status, v.dealer_id, v.msrp_usd
      FROM read_parquet('data_new/staging/stg_vehicle.parquet') v
      JOIN read_parquet('data_new/staging/stg_material.parquet') m USING (material_id))
TO 'data_new/ontology/objects/vehicle.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT po_id||'-'||po_item object_id, 'PO '||po_id||'/'||po_item title,
             vin, supplier_id, purchase_price_usd, ym
      FROM read_parquet('data_new/staging/stg_purchase.parquet'))
TO 'data_new/ontology/objects/vehiclePurchase.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT so_id||'-'||so_item object_id, 'WS '||invoice_id title,
             vin, dealer_id, wholesale_price_usd, invoice_id, invoice_date, ym
      FROM read_parquet('data_new/staging/stg_wholesale.parquet'))
TO 'data_new/ontology/objects/wholesale.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT delivery_id||'-'||delivery_item object_id, 'DLV '||delivery_id title,
             vin, dealer_id, ship_date, ym
      FROM read_parquet('data_new/staging/stg_delivery.parquet'))
TO 'data_new/ontology/objects/shipment.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT rdr_id object_id, 'RS '||rdr_id title, vin, dealer_id, customer_id,
             retail_date, retail_price_usd, incentive_usd, ym
      FROM read_parquet('data_new/staging/stg_retail.parquet'))
TO 'data_new/ontology/objects/retailSale.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT notif_id object_id, title, vin, dealer_id, defect_group, created_date, ym
      FROM read_parquet('data_new/staging/stg_quality_notification.parquet')
      WHERE notif_type='voc')
TO 'data_new/ontology/objects/vocTicket.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT notif_id object_id, title, vin, dealer_id, defect_group,
             claim_amount_usd, claim_status, created_date, ym
      FROM read_parquet('data_new/staging/stg_quality_notification.parquet')
      WHERE notif_type='warranty_claim')
TO 'data_new/ontology/objects/warrantyClaim.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

-- ── 링크 (from_id → to_id, 타입 id = v7-ontology 링크 타입) ──────────────────
COPY (SELECT object_id from_id, model_id to_id
      FROM read_parquet('data_new/ontology/objects/trim.parquet'))
TO 'data_new/ontology/links/trimOfModel.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT object_id from_id, model_id to_id
      FROM read_parquet('data_new/ontology/objects/vehicle.parquet'))
TO 'data_new/ontology/links/vehicleModel.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT object_id from_id, trim_id to_id
      FROM read_parquet('data_new/ontology/objects/vehicle.parquet'))
TO 'data_new/ontology/links/vehicleTrim.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT plant_id from_id, object_id to_id
      FROM read_parquet('data_new/ontology/objects/vehicle.parquet'))
TO 'data_new/ontology/links/plantBuildsVehicle.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT object_id from_id, zone_id to_id
      FROM read_parquet('data_new/ontology/objects/dealer.parquet'))
TO 'data_new/ontology/links/dealerInZone.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT 'SC-US' from_id, object_id to_id
      FROM read_parquet('data_new/ontology/objects/dealer.parquet'))
TO 'data_new/ontology/links/scManagesDealer.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT object_id from_id, vin to_id
      FROM read_parquet('data_new/ontology/objects/vehiclePurchase.parquet'))
TO 'data_new/ontology/links/purchaseOfVehicle.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT object_id from_id, vin to_id
      FROM read_parquet('data_new/ontology/objects/wholesale.parquet'))
TO 'data_new/ontology/links/wsOfVehicle.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT object_id from_id, dealer_id to_id
      FROM read_parquet('data_new/ontology/objects/wholesale.parquet'))
TO 'data_new/ontology/links/wsToDealer.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (   -- 도매의 원가 근거 = 같은 VIN의 매입 (wsCostBasis)
  SELECT w.object_id from_id, p.object_id to_id
  FROM read_parquet('data_new/ontology/objects/wholesale.parquet') w
  JOIN read_parquet('data_new/ontology/objects/vehiclePurchase.parquet') p USING (vin))
TO 'data_new/ontology/links/wsCostBasis.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT vin from_id, object_id to_id
      FROM read_parquet('data_new/ontology/objects/shipment.parquet'))
TO 'data_new/ontology/links/vehicleOnShipment.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT object_id from_id, vin to_id
      FROM read_parquet('data_new/ontology/objects/retailSale.parquet'))
TO 'data_new/ontology/links/rsOfVehicle.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT object_id from_id, dealer_id to_id
      FROM read_parquet('data_new/ontology/objects/retailSale.parquet'))
TO 'data_new/ontology/links/rsByDealer.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT object_id from_id, vin to_id
      FROM read_parquet('data_new/ontology/objects/vocTicket.parquet'))
TO 'data_new/ontology/links/vocOfVehicle.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT object_id from_id, 'SC-US' to_id
      FROM read_parquet('data_new/ontology/objects/warrantyClaim.parquet')
      WHERE claim_status='APPR')
TO 'data_new/ontology/links/claimPaidBySc.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

-- ── KPI 집계 (L0 회사 레벨 — agg_kpi 계약과 동일 그레인: 월×지표) ────────────
-- 시점 규칙: 마감월(NOW=2026-08)까지만 — 원장에는 미마감 미래 월 실적이 존재하지만
-- L0 집계는 확정치만 노출한다 (requirements/02-data-ontology.md 품질 게이트).
COPY (
  WITH ws AS (SELECT ym, count(*) n, sum(wholesale_price_usd) rev
              FROM read_parquet('data_new/staging/stg_wholesale.parquet') GROUP BY ym),
       rt AS (SELECT ym, count(*) n, avg(retail_price_usd-incentive_usd) asp
              FROM read_parquet('data_new/staging/stg_retail.parquet') GROUP BY ym),
       fi AS (SELECT ym,
                sum(CASE WHEN account_id IN ('466000','470000','476000') THEN amount_usd END) opex,
                -sum(CASE WHEN account_id='400100' THEN amount_usd END)
                 - sum(CASE WHEN account_id='500100' THEN amount_usd END) gross_profit
              FROM read_parquet('data_new/staging/stg_fi_posting.parquet') GROUP BY ym),
       vc AS (SELECT ym, count(*) n FROM read_parquet('data_new/staging/stg_quality_notification.parquet')
              WHERE notif_type='voc' GROUP BY ym)
  SELECT ws.ym, ws.n wholesale_units, rt.n retail_units, ws.rev wholesale_revenue_usd,
         cast(rt.asp AS INT) asp_usd, fi.opex opex_usd, fi.gross_profit gross_profit_usd,
         coalesce(vc.n,0) voc_count
  FROM ws LEFT JOIN rt USING (ym) LEFT JOIN fi USING (ym) LEFT JOIN vc USING (ym)
  WHERE ws.ym <= '2026-08'
  ORDER BY ws.ym
) TO 'data_new/ontology/kpi_monthly.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);
