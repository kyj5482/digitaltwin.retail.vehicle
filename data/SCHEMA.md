# 데이터 스키마 — 미국판매법인(SC-US) 디지털 트윈

v7 전략 시뮬레이션 트윈이 사용하는 전체 데이터셋 정의. **각 파일을 열어보지 않아도 이 문서만으로 구조를 파악**할 수 있도록 스키마·그레인·샘플값을 함께 기록한다.

## 0. 아키텍처 — Upstream(VIN 원장) → Downstream(공통 차원 큐브)

```
[Upstream — 사실의 원천, VIN 그레인]
  vehicle_master  차량 마스터: VIN → 필터 가능한 모든 속성 (차종·MY·트림·엔진·구동·색상·공장·존)
  vin_wholesale   도매 원장: VIN 단위 도매가·변동마진·운송비  →  Wholesale 판매량·영업이익의 원천
  vin_retail      소매 원장: VIN 단위 소매일·실거래가·인센티브 →  Retail 판매량의 원천
        │
        │   원장 × vehicle_master 조인 → 필터 차원 group-by   (downstream 생성 규칙)
        ▼
[Downstream — 화면·분석이 소비하는 집계, 공통 차원 컬럼 통일]
  agg_kpi         통합 KPI 큐브: 판매·도매·영업이익·재고·DS·CSI 전부 동일 그레인
  agg_kpi_bp      BP 큐브: 같은 믹스 모델로 상향식 생성 → 어떤 필터에도 BP 대비 성립
```

**공통 차원 컬럼 규약** — 모든 downstream 집계는 아래 컬럼을 같은 이름·같은 순서로 갖는다. (과거 retail_sales/retail_sales_attr/retail_color_mix처럼 데이터셋마다 차원이 제각각이던 구조를 폐기)

```
ym, zone_id, model_id, model_year, trim_id, engine, drivetrain, color
```

새 필터 차원(예: 옵션 패키지)을 추가할 때: ① vehicle_master에 속성 컬럼 추가 → ② 생성기(믹스 모델) 확장 → ③ agg_kpi·agg_kpi_bp·프론트가 자동 재생성. 코드 어디에도 차원 하드코딩 집계를 두지 않는다.

## 폴더 구조와 파티션 규칙

```
data/
├── master/                    # 차원(마스터) 테이블 — 파티션 없음
├── vehicle_master/<생산YM>.csv   # ★Upstream: VIN 차량 마스터 (1:50 축소 샘플)
├── vin_wholesale/<YM>.csv        # ★Upstream: VIN 도매 원장
├── vin_retail/<YM>.csv           # ★Upstream: VIN 소매 원장
├── agg_kpi/<YM>.csv              # ★Downstream: 통합 KPI 큐브 (실적 2024-01~2026-08)
├── agg_kpi_bp/<YM>.csv           # ★Downstream: 상향식 BP 큐브 (~2027-12, 미래 포함)
├── bp_target/<YM>.csv            # BP 요약 (차종 그레인, 48개월)
├── csi_external / csi_internal / csi_actions/   # 고객만족도 3종 (§5)
├── production / orders / logistics_intransit / price_incentive /
│   marketing_spend / market_industry / service_quality/   # 운영 데이터 (§4)
├── bp_trim_mix/<MY>.csv          # ★라이프사이클: 트림믹스 결정 + FOB (§10)
├── marketing_media / order_plan / voc_category /
│   quality_actions / parts_pnl/  # ★라이프사이클: 월 파티션 (§10)
├── governance/                # ★V10 거버넌스: ceo_tree(CEO KPI)·ai_agents·projects (마스터)
│   ├── workflow_gates/<YM>.csv   #   게이트 상태 원장 — HITL/AI 위임 (§11)
│   └── project_reviews/<YM>.csv  #   프로젝트 기대 vs 실측 리뷰 (§11)
├── facility_energy/<YM>.csv   # ★V10: 캠퍼스 동관/서관×층 전력 원장 — HVAC 레버 (§11)
└── _generator/generate.py     # 생성기 (시드 20260820 고정 — 재실행해도 동일)
```

- 실데이터 전환 시 규칙: `dataset/scenario=<id>/month=YYYY-MM/*.parquet` (가이드 §5).
- **미래(2026-09~)의 실적 파티션은 존재하지 않는다** — 미래는 Simulation 층이 전략 파라미터로 생성. BP만 48개월 전체.
- `prototypes/v7-data.js`는 동일 소스에서 생성된 프론트 번들 (자동 생성, 직접 수정 금지).
- **샘플 한계**: VIN 원장은 1:50 축소 샘플(×50이 모집단 추정치, 표본 오차 존재). agg_kpi 큐브는 동일 믹스 모델에서 풀스케일로 산출 — 실 시스템에서는 둘 다 전량 VIN에서 나오므로 완전 일치한다.

---

## 1. Upstream — VIN 원장 (1:50 샘플)

### vehicle_master/ — 차량 마스터 ★필터 속성의 정본
파티션: **생산월** · 그레인: VIN (~1,500대/월 샘플) · 원장들은 속성을 갖지 않고 이 마스터와 조인한다.

| 컬럼 | 타입 | 설명 | 샘플 |
|---|---|---|---|
| prod_ym | CHAR(7) | 생산월 (파티션 키) | `2026-06` |
| vin | CHAR(17) | 차대번호 (PK) | `VF3TCAAXTU0031245` |
| model_id | VARCHAR(8) | 차종 → dim_model | `TRN` |
| model_year | INT | 모델 이어 | `2026` |
| trim_id | VARCHAR(12) | 트림 → dim_trim | `TRN-PR` |
| engine | VARCHAR(20) | 파워트레인 | `2.5T 하이브리드` |
| drivetrain | VARCHAR(4) | 구동 (AWD/FWD) | `AWD` |
| color | VARCHAR(16) | 색상 | `스노우 화이트` |
| plant_id | VARCHAR(8) | 생산 공장 | `US-GA` |
| dest_zone_id | VARCHAR(12) | 배정 지역 | `west` |
| msrp_usd | INT | 트림 MSRP | `52000` |

### vin_wholesale/ — 도매 원장 ★Wholesale 판매량·영업이익의 원천
파티션: 도매월 · 그레인: VIN. **영업이익은 도매 기반 VIN 단위**로 마진 요소를 보유 — downstream에서 어떤 필터로 잘라도 근사가 아닌 집계.

| 컬럼 | 타입 | 설명 | 샘플 |
|---|---|---|---|
| ws_ym | CHAR(7) | 도매월 (파티션 키) | `2026-08` |
| vin | CHAR(17) | → vehicle_master | |
| zone_id | VARCHAR(12) | 인수 딜러 지역 | `south` |
| wholesale_price_usd | INT | 도매가 (≈MSRP×0.97) | `50440` |
| variable_margin_usd | INT | 대당 변동마진 (트림 가격계수 반영) | `4624` |
| freight_usd | INT | 대당 운송비 | `380` |

### vin_retail/ — 소매 원장 ★Retail 판매량의 원천
파티션: 소매월 · 그레인: VIN (도매 후 0~2개월 내 소매, 미소매분은 딜러 재고로 잔존)

| 컬럼 | 타입 | 설명 | 샘플 |
|---|---|---|---|
| retail_ym | CHAR(7) | 소매월 (파티션 키) | `2026-08` |
| vin / zone_id | | → vehicle_master | |
| retail_date | DATE | 소매일 | `2026-08-14` |
| channel | VARCHAR(8) | retail / fleet | `retail` |
| txn_price_usd | INT | 실거래가 (MSRP−인센티브) | `50825` |
| incentive_usd | INT | 적용 인센티브 | `1175` |

---

## 2. Downstream — 통합 KPI 큐브 (공통 차원 컬럼)

### agg_kpi/ — 통합 KPI 큐브 ★4대 KPI 전부 필터 그레인으로 집계
그레인: 공통 차원 전체 (≈2,900~5,700행/월) · 생성: 원장×마스터 조인 group-by (샘플은 믹스 모델 직산)

| 컬럼 | 타입 | 설명 | 샘플 |
|---|---|---|---|
| ym, zone_id, model_id, model_year, trim_id, engine, drivetrain, color | | **공통 차원 컬럼** | |
| retail_qty | INT | 소매 (vin_retail 집계) | `121` |
| wholesale_qty | INT | 도매 (vin_wholesale 집계) | `120` |
| variable_margin_usd | INT | 변동마진 (VIN 마진 합) | `509453` |
| op_profit_usd | INT | 영업이익 (마진 − 인센티브·운송·품질·마케팅 배분) | `224706` |
| stock_qty | INT | 딜러 재고 (도매−소매 잔존 VIN) | `221` |
| days_supply | INT | 재고 ÷ 판매속도 | `56` |
| csi_score | DECIMAL(4,1) | 외부 CSI (서베이 VIN 연계 — 차종×존 값) | `88.5` |

### agg_kpi_bp/ — 상향식 BP 큐브 ★어떤 필터에도 BP 대비 가능
그레인: agg_kpi와 **동일한 공통 차원** · 48개월 전체 · 생성: 같은 믹스 모델, 단 **계획 시점(이상 징후 미반영)** 믹스

| 컬럼 | 타입 | 설명 |
|---|---|---|
| (공통 차원 8컬럼) | | agg_kpi와 동일 |
| bp_retail_qty / bp_wholesale_qty / bp_op_profit_usd | INT | 계획 판매·도매·영업이익 |

### bp_target/ — BP 요약 (차종 그레인)
| 컬럼 | 설명 | 샘플 |
|---|---|---|
| ym, model_id | 키 | |
| bp_retail_qty / bp_wholesale_qty / bp_op_profit_usd | 계획값 | `15900` |
| bp_csi / bp_ds_days | 계획 CSI 88.5 / 목표 DS 60 | |

---

## 3. 재무 요약

### financials_pnl/ — 손익계산서 (차종 그레인)
경영 보고용 요약. 상세 필터 분석은 agg_kpi를 사용한다.

| 컬럼 | 설명 |
|---|---|
| ym, model_id | 키 |
| revenue_usd / variable_margin_usd / incentive_cost_usd / transport_cost_usd / quality_cost_usd / marketing_cost_usd / op_profit_usd | 손익 구성 (영업이익 = 마진 − 4대 비용) |

---

## 4. 운영 데이터 (월 파티션)

| 데이터셋 | 그레인 | 핵심 컬럼 | 용도 |
|---|---|---|---|
| production/ | 월×공장×차종 | prod_qty, plant_cap_month(명판), plant_util_pct | 생산·케파 |
| orders/ | 월×차종×트림 | order_qty, target_ds_days, **estimated=1** (도매 역산 추정) | 월 주문 |
| logistics_intransit/ | 월×루트×차종 | in_transit_qty, avg_lead_days, batch_cnt | 운송 파이프라인 |
| price_incentive/ | 월×차종×트림 | msrp_usd, incentive_usd_per_unit, program_note | 전략 레버 입력 |
| marketing_spend/ | 월×차종 | spend_musd (media/digital/event 분해) | 전략 레버 입력 |
| market_industry/ | 월×세그먼트 | industry_qty, brand_share_pct, competitor_launch | 외부 시장 |
| service_quality/ | 월×지역×차종 | voc_cnt, service_in_cnt, booking_delay_days, campaign_repair_cnt | 품질·서비스 피드백 |

---

## 5. 고객만족도 — 외부 공시 + 내부 관리지수 이원화

원칙: **외부 CSI는 외부기관이 만드는 데이터**라 직접 조작할 수 없다. 회사는 내부 데이터(클레임·예약·재고·OTA)와 연계된 **자체 100점 지수**를 만들어 활동으로 관리하고, 그 개선이 지연을 두고 외부 CSI에 반영된다는 가설로 운영한다.

### csi_external/ — 외부 공시 CSI
그레인: 월×지역×차종 (서베이 응답이 VIN 연계 → 차종 그레인 집계 가능)

| 컬럼 | 설명 | 샘플 |
|---|---|---|
| ym, zone_id, model_id | 키 | |
| csi_score / csi_sales_exp / csi_service_exp | 종합·구매·서비스 (0–100) | `64.3` (캠페인월 AUR) |
| resp_cnt | 응답 수 (판매의 ~18%) | `98` |

### csi_internal/ — 내부 고객만족도 지수 (100점) ★회사가 관리하는 지표
그레인: 월×차종 · 구성요소마다 내부 원장과 1:1 연계 → 활동으로 직접 개선 가능

| 컬럼 | 연계 내부 데이터 | 계산식 |
|---|---|---|
| score_quality | 워런티·캠페인 클레임률 (service_quality) | 100 − 3.2×클레임/1000대 |
| score_connected | 커넥티드/OTA 클레임률 (텔레메트리) | 93.4 − 2.2×클레임/1000대 |
| score_service | 딜러 예약 지연 (booking_delay_days) | 100 − 2.2×지연일 |
| score_delivery | 재고 가용성 (days_supply) | 96 − 부족·과잉 페널티 |
| csi_internal_score | 가중 합성 | 0.30q + 0.25c + 0.25s + 0.20d |

### csi_actions/ — 개선 활동 원장 ★활동 → 클레임 소멸 → 점수 회복의 근거
그레인: 월×프로젝트 · 예: **커넥티드 SW 결함 OTA 시정** — 대상 10,000대 중 적용 누계에 따라 클레임 8.5→0.4/1000으로 소멸 → 계산식에 의해 score_connected 74.7→92.5 회복

| 컬럼 | 설명 | 샘플 |
|---|---|---|
| ym, project_id | 키 | `OTA-2606-LUM` |
| project_name / model_id / component | 활동·대상·구성요소 | `커넥티드 SW 결함 OTA 시정` / `LUM` / `connected` |
| target_vins / applied_vins_cum | 대상 / 적용 누계 | `10000` / `9500` |
| claim_per_1k_before / claim_per_1k_now | 클레임률 전→후 | `8.5` → `0.4` |
| score_impact | 구성요소 점수 기여 (pt) | `+17.8` |

수록 활동 2건: `OTA-2606-LUM`(커넥티드, 2026-06~), `FSC-2603-AUR`(품질 캠페인 조기 완결, 2026-03~).

---

## 6. 마스터 (master/)

| 파일 | 내용 |
|---|---|
| dim_model.csv | 차종 6종 (TRN/VST/AUR/MRD/NOV/LUM) — segment, primary_plant_id, msrp_usd, unit_margin_usd, is_ev |
| dim_trim.csv | 차종×트림 18종 — mix_weight(0.38/0.44/0.18), msrp_factor(0.92/1.00/1.14, 대당 마진도 동일 배율) |
| dim_plant.csv | 공장 5곳 (KR-1/KR-2/US-GA/US-SV/MX-MT) — cap_month, lead_month, ship_mode, batch_size, wmi, freight |
| dim_zone.csv | 딜러 지역 5곳 — dealer_cnt, pop_share, ev_affinity(West·Northeast 1.35) |
| dim_sales_company.csv | 판매법인 3곳 (SC-US full / SC-CA·SC-MX aggregate) |
| dim_route.csv | 운송 루트 5개 — 구간 분해(공장→수출항 2d→해상 18d→수입항 3d→철도 9d 등), total_lead_days |

---

## 7. 주입된 이벤트 (실적 구간의 스토리)

| 시점 | 이벤트 | 데이터에 나타나는 곳 |
|---|---|---|
| 2025-07~08 | 국내 1공장(KR-1) 설비 이상, 생산 −20%/−10% | production → 2개월 뒤 LUM 도매↓ → DS↓ |
| 2025-08~11 | Meridian 재고 소진 인센티브 +$700 | price_incentive → vin_retail 실거래가↓ |
| 2026-01 | 대형 EV SUV 경쟁 신차 출시 | market_industry.competitor_launch=1 |
| 2026-03~06 | Aurora EV 품질 캠페인 (+FSC 조기 완결 활동) | service_quality·csi_external·csi_actions·financials_pnl(품질비 +$14M/월) |
| 2026-03~ | **[사양 이상 A1]** Vista FWD가 South·Southeast에서 급락 | agg_kpi(drivetrain 믹스) — 상세 분석 자동 탐지의 정답 |
| 2026-04~ | **[사양 이상 A2]** EV '스노우 화이트' West·Northeast −10%p → 스틸 그레이 | agg_kpi(color 믹스) |
| 2026-05~08 | **LUM 커넥티드 SW 결함 → OTA 1만대 시정** | csi_internal(74.7→92.5)·csi_actions |
| 매년 11~12월 | 연말 인센티브 +$500 | price_incentive |

## 8. 시뮬레이션과의 관계

실적 자체가 아래 구조 모델 + 노이즈로 생성되었고, v7 시뮬레이터가 같은 구조식을 쓴다 (수식 상세·문헌 근거: `docs/v7-strategy-scenarios.md` §3).

```
수요 = 기저 × 계절 × 인센티브효과(−1.6) × MSRP효과(−4.0) × 침식 × 마케팅(adstock 0.5, 로그 체감)
소매 = min(수요×가용성, 재고×0.95) · 도매 = 수요 + 재고갭×0.5 · 생산 = 도매 리드 시프트 + 케파 클램프
영업이익 = 도매×(마진+MSRP×가격레버) − 소매×인센티브 − 운송 − 품질 − 마케팅
```

## 9. 플랫폼 원칙 — 필터 차원 확장과 Downstream 자동 전파

기존 수작업 업무는 특정 집계 레벨만 다뤄 사양 단위 필터가 어려웠다. 이 트윈은 반대로 설계한다:

1. **원장은 VIN 그레인으로 발생, 속성은 차량 마스터가 보유** — 판매량은 vin_retail, 도매/영업이익은 vin_wholesale, 서베이도 VIN 연계. 어떤 필터든 "근사"가 아니라 "집계"다.
2. **Downstream은 조인 group-by 산출물** — agg_kpi 하나로 4대 KPI가 공통 차원에서 나온다. 화면·분석·자동 탐지는 이 규약만 바라본다.
3. **BP도 같은 믹스 모델로 상향식 생성** (agg_kpi_bp) — 필터가 무엇이든 계획 대비가 성립하고, 실적으로 믹스 모델을 재캘리브레이션하면 BP 정확도가 유지된다.
4. **외부 지표는 내부 지수로 매개** — 외부 CSI처럼 직접 만들 수 없는 데이터는, 내부 원장과 연계된 구성요소 지수(csi_internal)로 재구성하고 개선 활동(csi_actions)으로 관리한다.
5. **새 필터 차원 추가 절차**: vehicle_master 속성 추가 → 생성기(믹스 모델) 확장 → 원장·큐브·BP·프론트 전체 downstream 자동 재생성.

---

## 10. 라이프사이클 데이터 (V9) — 연간 업무 사이클의 실체

판매법인의 1년 사이클(상품 준비 → BP·트림믹스·FOB → 마케팅 → 월 주문 → 판매 → VoC·품질 → 서비스·Parts)을
각 단계의 데이터 실체로 정의한다. v9 라이프사이클 트윈이 이 데이터로 "지금 어떤 업무가 실행 중인가"를 표현한다.

### master/biz_calendar.csv — 연간 업무 캘린더 (파티션 없음)
그레인: 업무 활동. `cadence`: annual(월 창 m_from~m_to) / quarterly / monthly / continuous / event.

| 컬럼 | 설명 | 샘플 |
|---|---|---|
| activity_id / phase | 활동 ID / 단계(product·bp·marketing·order·sales·quality·service) | `BP-2` / `bp` |
| activity_name / cadence | 이름 / 주기 | `차년도 트림믹스 결정` / `annual` |
| month_from / month_to | 연간 활동의 실행 월 창 (1~12, 반복형은 0) | `10` / `10` |
| owner / output_dataset | 담당 조직 / 산출 데이터셋 | `판매법인 상품` / `bp_trim_mix` |

### master/product_plan.csv — 상품 준비 (신차·신규 트림·Feature)
그레인: MY×아이템. 게이트: G1 기획 → G2 개발 → G3 인증 → G4 런칭.

| 컬럼 | 설명 | 샘플 |
|---|---|---|
| model_year / model_id / item_type | MY / 차종 / new_model·new_trim·feature·my_change | `2027` / `SOL` / `new_model` |
| item_name / target_launch_ym / gate / ready_pct | 아이템·런칭 목표·게이트·준비율 | `Solara EV (준중형 EV 세단)` / `2027-03` / `G2` / `45` |

### bp_trim_mix/<MY>.csv — 트림믹스 결정 + FOB ★BP → 생산법인 전달
그레인: 계획MY×차종×트림. 연 사이클: 8~10월 BP 수립 → 10월 트림믹스 결정 → 11월 생산법인 전달·FOB 확정.
NOW(2026-08) 기준 2025·2026은 `FOB 확정`, 2027은 `수립 중 (BP-1)`.

| 컬럼 | 설명 | 샘플 |
|---|---|---|
| plan_my / model_id / trim_id | 키 | `2027` / `TRN` / `TRN-SU` |
| mix_prev_pct / mix_plan_pct | 전년 믹스 → 계획 믹스 (EV 상위 트림 강화) | `21.0` → `22.5` |
| plan_ws_qty | 계획 Wholesale (연간, 대) | `45133` |
| fob_usd / fob_prev_usd | FOB(≈MSRP×0.62, 연 +2.5%) / 전년 FOB | `39580` / `38614` |
| plant_id / status / decided_ym | 생산법인 / 상태 / 확정월 | `US-GA` / `수립 중 (BP-1)` / |

### marketing_media/ — 매체 제작·퍼포먼스 (월 파티션)
그레인: 월×분기캠페인×매체. 차종별 주력 Feature 대상 매체 제작(크리에이티브) 후 집행·퍼포먼스 관리.

| 컬럼 | 설명 | 샘플 |
|---|---|---|
| campaign_id / model_id / feature_focus | 분기 캠페인 / 차종 / 주력 Feature | `LUM-26Q3` / `LUM` / `OTA 2.0 커넥티드` |
| medium / asset_name | TV·DIG·SOC·SRCH / 제작물 | `DIG` / `OTA 2.0 커넥티드 디지털 크리에이티브` |
| spend_musd / impressions_m / clicks_k / ctr_pct / cpm_usd | 집행비·퍼포먼스 | `1.7` / `179.6` / `1616` / `0.9` / `9.5` |
| status | 제작·런칭 → 집행중 → 집행중(최적화) | `집행중` |

### order_plan/ — 월 생산 주문 실행 원장 ★DoS Weight 배분
그레인: 주문월×차종×지역×트림×색상 (720행/월). **주문 = 차종 총주문 × (과거 3개월 Retail MA × DoS Weight) 정규화 배분**,
`Weight = clamp(목표DS 60 / 셀 DS, 0.6~1.6)`. 재고 믹스는 2~4개월 전 주문분이라 색상 수요 이동(§7 A2) 시
DS 괴리가 생기고 Weight가 주문을 보정한다 — 차종 합계는 orders/와 일치. **v9 프론트가 같은 수식을 JS로 실행**한다.

| 컬럼 | 설명 | 샘플 (A2 이후 west LUM) |
|---|---|---|
| ym_order / model_id / zone_id / trim_id / color | 키 | `2026-08` / `LUM` / `west` / `LUM-AI` / `스노우 화이트` |
| retail_ma3 / stock_qty / ds_days | 셀 판매 속도·재고·DS | `177.9` / `448` / `76.6` |
| dos_weight / order_qty / prod_ym | Weight / 주문량 / 생산 예정월 | `0.78` / `139` / `2026-10` |

### voc_category/ — VoC 카테고리 모니터링 ★품질/안전 파이프라인 입력
그레인: 월×차종×카테고리 9종(파워트레인·전장/배터리·커넥티드/SW·바디·샤시/조향·안전/ADAS·인포테인먼트·공조·기타).
스파이크 주입: LUM 커넥티드(→OTA), AUR 전장·안전(→FSC), TRN 파워트레인·MRD 공조(→TSB), **VST 샤시/조향(2026-07~ 신규 탐지, 조치 미배정)**.

| 컬럼 | 설명 | 샘플 |
|---|---|---|
| model_id / category / voc_cnt / voc_per_1k_uio | 차종·카테고리·건수·1000대당 | `VST` / `샤시/조향` / `81` / `1.1` |
| severity / safety_flag | low·med·high / 안전 이슈 플래그 | `high` / `0` |

### quality_actions/ — 품질 조치 원장 (TSB·OTA·FSC·조사)
그레인: 월×조치. VoC 스파이크 탐지 → 조치 배정 → 적용 누계에 따라 클레임 소멸(csi_actions와 동일 사건 공유).

| 컬럼 | 설명 | 샘플 |
|---|---|---|
| action_id / action_type | 조치 / TSB·OTA·FSC·조사 | `OTA-2606-LUM` / `OTA` |
| model_id / category / title / detected_ym | 대상·카테고리·제목·탐지월 | `LUM` / `커넥티드/SW` / / `2026-05` |
| target_vins / applied_vins_cum | 대상 / 적용 누계 | `10000` / `9500` |
| claim_per_1k_before / claim_per_1k_now / status | 클레임률 전→후 / 조치중·완결·원인 조사중 | `8.5` → `0.4` / `완결` |

### parts_pnl/ — Parts 손익 + Dealer Net/Factory 균형
그레인: 월×부품 카테고리 6종. 고객부담(CP) 정비 Parts는 판매법인 이익원(마진 26%), 워런티·캠페인 Parts 가격은
**Dealer Net과 Factory 정산 기준 사이 균형** 필요 — 갭(%)이 크면(딜러 유리) 워런티 마진 압박.
2026-02 가격 개정(`PARTS_REPRICE`)으로 갭 60% 축소.

| 컬럼 | 설명 | 샘플 |
|---|---|---|
| part_category | 엔진/PT·전장/배터리·바디·샤시·소모품·액세서리 | `전장/배터리` |
| cp_sales_kusd / warranty_sales_kusd / campaign_sales_kusd | 채널별 Parts 매출 k$ | `1276` / `1188` / `0` |
| dealer_net_idx / factory_price_idx / gap_pct | DN 지수 / Factory 기준 100 / 갭 | `107.2` / `100` / `7.2` |
| sc_margin_pct | 판매법인 블렌디드 마진 (갭↑ → 워런티 마진↓) | `16.7` |

## 11. 거버넌스 데이터 (V10) — 목표 트리 · 워크플로우 게이트 · 프로젝트

> V10 디지털 트윈 월드의 원장. "회사가 무엇을 목표로, 누가(사람/AI) 무엇을 승인하며,
> 어떤 프로젝트가 어떤 결과를 냈는가"를 데이터로 남긴다.
> 설계 근거: `docs/twin-world-consulting-review.md` §3, HITL 원칙은 `docs/oem-us-sales-process-research.md` §3.4.

### governance/ceo_tree.csv — CEO KPI 트리 마스터
CEO 목표(1년 관리) = **3영역 × 14 KPI × 다운스트림 노드**의 단일 트리.
영역 가중치 = 산하 KPI 가중치 합: 재무 37%(ASP 5 · 경상이익률 5 · 합산손익 12 · 합산손익률 15),
사업 35%(도매판매량 10 · 볼륨 SUV 육성 10 · 시장점유율 10 · 친환경 소매 5),
지속경영 25%(그린워싱 5 · Full SI 2.0 5 · 고객만족도 서비스/판매 각 3.5 · 보안 3 · 브랜드트래커 5).
`bind`는 프론트 계산 키(빈 값 = **미연결** → 데이터 수집 프로젝트 신설 대상), `lever`는 전략
레버 키(`hvac` = 전력사용량). 다운스트림은 앱폴더(아이폰 폴더식)로 한 단계씩 탐색되며,
예시 딥 체인: `경상이익률(KPI-RECUR) → 오피스 관리비(ND-OPEX) → 전력사용량(ND-ENERGY)`.
값 롤업은 온톨로지 데이터(leaf)에서 KPI → 영역 → CEO 종합으로 상향.

| 컬럼 | 샘플 |
|---|---|
| node_id / parent_id / level / kind | `ND-ENERGY` / `ND-OPEX` / `node` / `metric` |
| node_name / short_name / weight_pct | `전력사용량` / `전력` / `0` (KPI만 가중치) |
| bind / unit / direction / lever | `energy` / `$` / `-` / `hvac` |

### facility_energy/ (월 파티션) + governance/office_zones.csv — 시설 원장 (오피스 관리비의 실체)
HQ 캠퍼스 **동관·서관 × 3층 × 구역(24개)** 그레인. `office_zones.csv`는 구역 마스터
(타입 사무/회의/공용/항온 + 면적 + **임차 계약 rent_usd_month** — 임차/시설 지표의 정본),
`facility_energy/`는 월 전력 원장 — `kwh_peak_hvac`(항온존=0)가 HVAC 전략 레버의 대상.
온톨로지 객체 `facility`·`energyMeter`(구역 그레인, v0.11.0)와 바인딩. 레버 시뮬레이션은
**전략 월드 — 오피스 관리비**(`v10-opex-sim.html`)가 상수 미러(`rate_peak 0.29 / rate_off
0.115 / −5%/°C / 예냉 이동 12% / ZTYPE 배율`)로 실행 — 냉방기 기준 온도 전략 **월 ≈ $1만 절감**,
임차 재계약·공용 반납·조명/ESS 레버 포함 시 그 이상 → 관리비 → 경상이익률 상향 전파.
소모품/기타는 **미연결**(예산 모델 추정 — 데이터 수집 프로젝트 대상).

| facility_energy 컬럼 | 샘플 |
|---|---|
| ym / building / floor / zone_id / zone_name / zone_type | `2026-07` / `동관` / `1` / `E1-SRV` / `서버실` / `항온` |
| area_m2 / temp_set_c | `400` / `20.0` |
| kwh_peak / kwh_off / kwh_peak_hvac / cost_usd | `20465` / `14819` / `0` / `7639` |

### governance/workflow_gates/ (월 파티션) — 게이트 상태 원장
활동(biz_calendar)이 활성인 달의 게이트 체인 상태. **과거 월 = 완결된 감사 이력
(승인/실행완료), 현재 월(NOW) = 라이브 큐** — 선행 AI/자동 게이트 완료 → 다음 HITL 게이트
검토대기 → 이후 예정. 규칙 기반·난수 없음(감사 가능성). QLT-2(이벤트)는 quality_actions
상태로 판정(조사중→G1 검토대기, 조치중→G2 실행완료, 완결→G3 승인).

| 컬럼 | 샘플 |
|---|---|
| ym, activity_id, phase | `2026-08`, `ORD-1`, `order` |
| gate_seq / gate_id / gate_name | `2` / `G2` / `주문 승인` |
| gate_type | `hitl`(사람 승인) · `ai`(에이전트 위임) · `auto`(시스템) |
| owner / status | `오더 매니저` / `검토대기` (승인·실행완료·실행중·검토대기·예정) |

### governance/ai_agents.csv — AI 에이전트 레지스트리
위임 업무의 실행 주체. `scope_activity`가 담당 활동, `accuracy_pct`는 초안 채택률.
(AGT-ORD 주문 배분 97.2 · AGT-VOC VoC 분류 94.8 · AGT-MED 매체 예산 91.5 · AGT-VIN VIN 추출 99.6 · AGT-BP BP 초안 89.0)

### governance/projects.csv + project_reviews/ (월 파티션) — 프로젝트 원장·리뷰
목표 노드 아래 Top-down으로 구성된 프로젝트. `linked_objects`는 온톨로지 객체 키
(`type:id`, `|` 구분) — 프로젝트 추가 시 연계 객체와의 관계를 명시한다. 리뷰 원장은
월별 기대(expect) vs 실측(actual, **기존 원장에서 파생**: OTA 클레임·order_plan Weight·
parts 갭 등) → 판정(달성/진행중). 예: PRJ-OTA-LUM은 csi_actions와 동일 사건.

| projects.csv 컬럼 | 샘플 |
|---|---|
| project_id / project_name / goal_node / template | `PRJ-GRAY-ORD` / `그레이 색상 수요 대응 증산` / `K-DS` / `order` |
| model_id / start_ym / end_ym / status | `LUM` / `2026-06` / `` / `진행중` |
| metric / expect_value / linked_objects | `NE 그레이 Weight` / `1.2` / `model:LUM\|salesZone:northeast` |

| project_reviews 컬럼 | 샘플 |
|---|---|
| ym / project_id / metric | `2026-08` / `PRJ-GRAY-ORD` / `NE 그레이 Weight` |
| expect_value / actual_value / verdict | `1.2` / `1.34` / `달성` |

### feature_usage/ (월 파티션) — 차량 신호 월 스냅샷 (학습 피처 원장)
`ym, model_id, hda_usage_pct, trailer_mode_pct, fota_install_pct, connected_optin_pct,
dtc_per_1k, trips_per_vehicle` — 월×차종. IT 전략 월드(차량 데이터)와 온톨로지
`featureUsageEvent`(bound)의 원장. **DTC/1k는 내부지수(csi_internal)가 쓰는
claim_rate와 동일 소스에서 파생**되어 차량 신호 ↔ KPI의 인과가 데이터 안에 실재한다
(LUM 커넥티드 결함·AUR FSC 스토리) — KPI 드라이버 발굴(상관 학습)의 근거.
학습 모델은 온톨로지 `mlModel`(derived) 레지스트리로 선언: v0 = 시즌+추세(포커스
그래프 FORECAST), v1 = 드라이버 회귀, v2 = 레버 시나리오 생성. 마트가 온톨로지에
bound로 선언되어 있어야 학습 가능하다는 것이 확장 원칙.
