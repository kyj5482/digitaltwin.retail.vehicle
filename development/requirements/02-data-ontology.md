# 02. 데이터 → 온톨로지 구성 요구사항

보유 데이터를 어떻게 바꿔야 트윈에 연결되는지 정의한다. 기준 계약은 `data/SCHEMA.md`
(프로토타입 가상 데이터가 이미 이 계약으로 생성됨) — 실개발은 **같은 계약을 실데이터로 채운다**.

> **실행 가능한 사양**: 이 문서의 파이프라인을 SAP 원천 기준으로 구현한 것이
> `data_new/` 다 — SAP 모사 Raw(Parquet) → Staging → 온톨로지 마트 → 시멘틱 레이어
> → DuckDB 서빙. `node data_new/pipeline/run.js`로 재현되며, 포맷 판단(CSV vs Parquet
> 실측)은 `data_new/README.md` 참조.

## 현재 프로토타입의 데이터 흐름

```
data/*.csv (가상, _generator/generate.py 시드 고정)
  → v7-data.js (window.TWIN_DATA — 월 집계·원장·마스터)
  → v7-ontology.js (타입 선언) + v7-ontology-instances.js (표본 인스턴스, 시드 PRNG)
  → 월드(HTML)가 TWIN_DATA·ONTOLOGY만 참조
```

## 실개발 목표 흐름

```
법인 원천 시스템 (DMS·ERP·텔레매틱스·설문 …)
  → ELT → parquet 마트 (레벨별 데이터 계약: 그레인·필수 컬럼·갱신 주기)
  → 온톨로지 바인딩 (objectType.datasource.path = 마트 경로)
  → 월드는 온톨로지 API로만 조회 (레벨별 서브그래프 — 01 문서)
```

핵심: **인스턴스 빌더(`v7-ontology-instances.js`)만 실마트 조회로 교체**하고,
저장소 인터페이스(obj/link 순회)는 유지한다 — 빌더 파일 머리말에 명시된 설계 의도.

## 레벨별 데이터 계약 — 보유 데이터 교체 매핑

| 레벨 | 현재(프로토타입) 소스 | 실데이터 요구 | 그레인 | 주기 |
|---|---|---|---|---|
| L0 회사 | `agg_kpi/` `agg_kpi_bp/` `governance/ceo_tree.csv` | KPI 월 마감 집계 + BP 목표 + KPI 트리 마스터 | 월 × KPI | 월 마감 |
| L1 도메인 | `market_industry/` `price_incentive/` `marketing_*` `facility_energy/` `feature_usage/` `financials_pnl/` | 도메인 마트 (산업 수요·인센티브·미디어·에너지·차량 신호·손익) | 월 × 도메인 키 | 월/주 |
| L2 부문 | `governance/workflow_gates/` `governance/project_reviews/` `governance/projects.csv` `csi_actions/` `quality_actions/` | 워크플로우 게이트·프로젝트·액션 실행 원장 | 게이트/액션 × 월 | 수시(이벤트) |
| L3 인스턴스 | `vin_wholesale/` `vin_retail/` `vehicle_master/` `orders/` `logistics_intransit/` `voc_category/` `service_quality/` | VIN 체인·주문·운송·VoC 상세 | VIN/주문/건 | 일 |

- 각 폴더의 필수 컬럼·타입·키는 `data/SCHEMA.md`의 해당 절이 계약서다.
- `entity-profile.md` §5 데이터 인벤토리 표가 "보유 데이터 → 온톨로지 객체" 매핑의 입력이며,
  이 표의 각 행은 위 레벨 중 하나에 귀속되어야 한다.

## KPI 트리(ceo_tree) 변경 절차

1. `entity-profile.md` §3에 법인 KPI를 입력한다 — 기존 `node_id`와 일치하면 표기·가중치 오버라이드.
2. 일치하지 않는 신규 KPI는 빌드 리포트에 표시된다 → `data/governance/ceo_tree.csv`에
   행 추가(bind 컬럼으로 집계 마트 필드 연결) 후 데이터 재생성.
3. `bind`가 비면 화면에서 "미연결 KPI"로 표시된다 — 미연결 상태도 유효한 중간 단계.

## 품질 게이트 (실데이터 수용 기준)

- [ ] 그레인 검증 — 계약 그레인 기준 중복 키 0건 (예: 월×KPI, VIN 유일).
- [ ] 시점 규칙 — L0 집계는 월 마감 확정치, 마감 전 월은 "예측"으로 구분 플래그.
- [ ] 정합 — L3 인스턴스 합계가 L0 집계와 허용 오차 내 일치 (롤업 검증).
- [ ] 재처리 — 원장(게이트·액션)은 append-only, 수정은 정정 이벤트로.
- [ ] 개인정보 — VIN·고객 식별자는 마트 단계에서 가명처리, 화면 표시 규칙 별도 정의.
