-- =============================================================================
-- 40_serve.sql — 서빙 데모: DuckDB가 온톨로지 파케이 위에서 직접 답하는 질의
-- =============================================================================
-- 백엔드 서비스 패턴: DuckDB(:memory:) + 파케이 뷰 — 별도 DB 적재 없이
-- 파일을 그대로 질의한다. run.js가 각 질의의 응답 시간을 실측해 출력한다.
-- =============================================================================

-- Q1 [L0 회사] 월별 KPI 롤업 — 트윈 월드 좌 레일·관계뷰 값
SELECT ym, wholesale_units, retail_units, asp_usd, gross_profit_usd, opex_usd, voc_count
FROM read_parquet('data_new/ontology/kpi_monthly.parquet')
ORDER BY ym DESC LIMIT 6;

-- Q2 [L3 인스턴스] VIN 폐루프 체인 — 매입→도매→출하→소매→VoC 순회 (탐색기 드릴)
WITH v AS (SELECT vin FROM read_parquet('data_new/ontology/objects/vocTicket.parquet')
           ORDER BY object_id LIMIT 1)
SELECT 'vehicle' step, ve.object_id id, ve.prod_ym detail
  FROM read_parquet('data_new/ontology/objects/vehicle.parquet') ve JOIN v ON ve.object_id = (SELECT vin FROM v)
UNION ALL SELECT 'purchase', p.object_id, cast(p.purchase_price_usd AS VARCHAR)
  FROM read_parquet('data_new/ontology/objects/vehiclePurchase.parquet') p WHERE p.vin=(SELECT vin FROM v)
UNION ALL SELECT 'wholesale', w.object_id, w.invoice_id
  FROM read_parquet('data_new/ontology/objects/wholesale.parquet') w WHERE w.vin=(SELECT vin FROM v)
UNION ALL SELECT 'shipment', s.object_id, cast(s.ship_date AS VARCHAR)
  FROM read_parquet('data_new/ontology/objects/shipment.parquet') s WHERE s.vin=(SELECT vin FROM v)
UNION ALL SELECT 'retailSale', r.object_id, cast(r.retail_price_usd AS VARCHAR)
  FROM read_parquet('data_new/ontology/objects/retailSale.parquet') r WHERE r.vin=(SELECT vin FROM v)
UNION ALL SELECT 'vocTicket', q.object_id, q.defect_group
  FROM read_parquet('data_new/ontology/objects/vocTicket.parquet') q WHERE q.vin=(SELECT vin FROM v);

-- Q3 [L2 부문] 딜러 스코어 — 소매·평균 인센티브·VoC율 (evaluateDealer 액션의 데이터뷰)
SELECT d.object_id dealer_id, d.title,
       count(DISTINCT r.object_id) retail_units,
       cast(avg(r.incentive_usd) AS INT) avg_incentive_usd,
       count(DISTINCT q.object_id) voc_count,
       round(count(DISTINCT q.object_id)*1.0/nullif(count(DISTINCT r.object_id),0),3) voc_rate
FROM read_parquet('data_new/ontology/objects/dealer.parquet') d
LEFT JOIN read_parquet('data_new/ontology/objects/retailSale.parquet') r ON r.dealer_id=d.object_id
LEFT JOIN read_parquet('data_new/ontology/objects/vocTicket.parquet') q ON q.dealer_id=d.object_id
GROUP BY 1,2 ORDER BY retail_units DESC LIMIT 5;

-- Q4 [L1 도메인] 모델×월 도매 추이 — 전략 월드 시계열 (링크 경유 = 온톨로지 순회)
SELECT w.ym, l.to_id model_id, count(*) units, sum(w.wholesale_price_usd) revenue_usd
FROM read_parquet('data_new/ontology/objects/wholesale.parquet') w
JOIN read_parquet('data_new/ontology/links/wsOfVehicle.parquet') lv ON lv.from_id=w.object_id
JOIN read_parquet('data_new/ontology/links/vehicleModel.parquet') l ON l.from_id=lv.to_id
GROUP BY 1,2 ORDER BY ym DESC, units DESC LIMIT 8;
