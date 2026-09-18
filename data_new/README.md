# data_new/ — SAP 원천 → 온톨로지 데이터 파이프라인

SAP를 쓰는 판매법인의 실데이터를 가정한 **엔드투엔드 파이프라인**이다.
SAP 예상 Raw(Parquet)를 만들고 → 표준화(Staging) → 온톨로지 인스턴스(객체·링크·KPI 마트)로
가공하며 → 시멘틱 레이어가 관계와 액션을 선언하고 → DuckDB가 그 위에서 바로 서빙한다.

진행 방향 시각화: **[pipeline-overview.html](pipeline-overview.html)** (서버 실행 후
`/data_new/pipeline-overview.html`)

```
┌─────────┐   ┌─────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────┐
│ RAW     │ → │ STAGING │ → │ ONTOLOGY     │ → │ SEMANTIC     │ → │ SERVING  │
│ SAP 추출 │   │ 표준화   │   │ 객체·링크·KPI │   │ 관계·액션 선언 │   │ DuckDB   │
│ parquet │   │ parquet │   │ parquet      │   │ json         │   │ :memory: │
└─────────┘   └─────────┘   └──────────────┘   └──────────────┘   └────┬─────┘
     ▲                                                                 │
     └──────────── 폐루프: 월드의 액션 실행 → 원장 append → 재적재 ◄──────┘ (트윈 월드·탐색기)
```

## 폴더 구성

```
data_new/
├── README.md                  ← 이 문서 (파이프라인 + CSV/Parquet 판단)
├── pipeline-overview.html     ★ 진행 방향 시각화 (레이어 DAG · 스키마 · 실측 수치)
├── raw/sap/                   [생성] SAP 모사 추출 — 실제 SAP 테이블명·컬럼명 (18개, VBFA 포함)
├── staging/                   [생성] 표준화 마트 — 업무 용어 개명·타입 확정·ym 파티션 (10개)
├── ontology/
│   ├── objects/               [생성] 객체 인스턴스 (dealer·vehicle·wholesale … 13개)
│   ├── links/                 [생성] 링크 인스턴스 (from_id→to_id, 15개)
│   └── kpi_monthly.parquet    [생성] L0 KPI 큐브 (마감월만 — 시점 규칙)
├── ledger/                    [런타임 · git 제외] 액션 원장 action_log.jsonl (폐루프 v0)
├── semantic/
│   └── semantic-layer.json    ★★ 시멘틱 정본 (유일 소스) — 객체 32·링크 62·액션 36 전체 선언
│                                 + mart 바인딩(필드 스키마 계약) · prototypes/v7-ontology.js 의 원본
└── pipeline/
    ├── run.js                 러너: node data_new/pipeline/run.js  (단계 지정: 10 20 30 40 50)
    ├── 10_generate_raw.sql    SAP 모사 Raw 생성 (시드 고정 — 실환경에선 SLT/CDC 추출로 대체)
    ├── 20_stage.sql           Raw → Staging (SAP 컬럼 개명·VBFA 문서흐름 조인·헤더+품목 결합)
    ├── 30_ontology.sql        Staging → 객체·링크·KPI 마트
    ├── 40_serve.sql           서빙 데모 질의 4종 (러너가 응답 시간 실측 출력)
    ├── 50_validate.js         품질 게이트 — 계약·PK·참조·대사·시점 80건 (실패 = 파이프라인 실패)
    ├── 90_benchmark.js        CSV vs Parquet 실측 (200만 행)
    └── benchmark-result.json  [생성] 벤치마크 결과 기록
```

## 실행

```bash
npm i --no-save @duckdb/node-api      # 최초 1회 — 유일한 외부 의존성
node data_new/pipeline/run.js         # 전체 (RAW→STAGING→ONTOLOGY→SERVE→VALIDATE, 1초 이내)
node data_new/pipeline/90_benchmark.js  # 포맷 벤치마크 (선택)
```

## 1단계 — RAW: SAP 예상 추출 (Parquet)

실제 SAP 테이블명·컬럼명으로 모사한다. 실환경에서는 SLT/CDC(또는 일 배치 추출)가
같은 자리에 Parquet를 적재하고, 이후 단계는 그대로 재사용된다.

| 모듈 | 테이블 | 내용 | → 온톨로지 |
|---|---|---|---|
| 마스터 | KNA1 / MARA / T001W / CSKS | 딜러 · 자재(모델×트림) · 플랜트 · 코스트센터 | dealer · model/trim · plant · (관리비 귀속) |
| VMS | VLCVEHICLE | 차량 원장 (VIN 그레인) | vehicle |
| MM | EKKO / EKPO | 본사 인터컴퍼니 매입 PO | vehiclePurchase |
| SD | VBAK / VBAP | 도매 판매오더 (품목 = VIN) | wholesale |
| SD | LIKP / LIPS | 납품 (출하) | shipment |
| SD | VBRK / VBRP | 빌링 (도매 인보이스) | wholesale (invoice 속성) |
| SD | VBFA | 판매 문서흐름 (SO→납품·빌링) | 도매 스테이징의 유일한 문서 연결 키 |
| 인터페이스 | ZSD_RDR | 딜러 DMS 소매실적 (RDR) — **SAP 외 원천** | retailSale |
| 외부 | market_monthly (raw/external/) | 조사기관 구독 데이터 — SAAR·점유율·경쟁 인센티브 | marketSnapshot |
| QM | QMEL | 품질통지 — Z1=VoC · Q1=보증클레임 | vocTicket · warrantyClaim |
| FI | BKPF / BSEG | 회계전표 (관리비 · 매출/원가) | kpi_monthly (L0) |

규모: 1:50 샘플 (VIN 3,078 · 소매 2,889 · 통지 794 · 전표라인 1,987 — 32개월).

## 2단계 — STAGING: 표준화

① SAP 독일어 축약 컬럼 → 업무 용어 (`KUNNR→dealer_id`, `DMBTR→amount_usd`)
② 타입 확정 ③ 헤더+품목 결합 (그레인 = 업무 단위: VIN·건) ④ 월 파티션 컬럼 `ym`.
실환경에서는 이 SQL을 dbt/SQLMesh 모델로 관리한다.

**문서 연결 규칙**: SO→납품·빌링은 **문서흐름(VBFA)으로만 조인**한다 — 실SAP에서
후속 문서 번호는 SO에서 파생 불가능하므로 채번 규칙 기반 조인은 금지 (`20_stage.sql` 주석 참조).

## 3단계 — ONTOLOGY: 객체·링크 인스턴스

- **객체** = `object_id + title + 속성` (10 타입), **링크** = `from_id → to_id` (15 타입).
- 타입 id는 `prototypes/v7-ontology.js`와 동일 체계 — 탐색기·트윈 월드가 그대로 소비 가능.
- **레벨별 계약**: L0 `kpi_monthly`(마감월만) · L1 모델×월 · L2 실행 원장 · L3 VIN 체인.
  VIN 하나로 매입→도매→출하→소매→VoC가 모두 이어진다 (`40_serve.sql` Q2로 검증).

## 4단계 — SEMANTIC: 시멘틱 정본 (유일 소스)

`semantic/semantic-layer.json`이 **온톨로지 선언의 유일 정본**이다 — 객체 32·링크 62
(카디널리티 포함)·액션 36(파라미터·효과 포함)·수명주기·메트릭 전체와, 그중 data_new
마트가 실체화한 타입의 **mart 바인딩**(경로 + **필드 수준 스키마 계약** + SAP 원천 +
레벨)·액션 게이트 8종(HITL/AI · 원장 매핑)·L0 KPI 필드 바인딩을 선언한다.

- **프런트 온톨로지는 생성물**: `prototypes/v7-ontology.js`는
  `node development/tools/build-ontology.js`로 재생성한다 (직접 수정 금지 — 회귀 C19가
  정본↔생성물 동기를 검증).
- **서빙·검증도 이 선언만 참조**: `server.js /api`는 `mart.path`만 질의하고,
  `50_validate.js`는 `mart.fields`를 실제 Parquet 스키마와 대조한다 — 선언과 마트가
  어긋나면 파이프라인이 실패한다.

## 5단계 — SERVING: DuckDB

적재 없는 서빙 — DuckDB(`:memory:`)가 Parquet를 파일 그대로 질의한다. 실측(40_serve):

| 질의 | 레벨 | 응답 |
|---|---|---|
| Q1 월별 KPI 롤업 | L0 | ~4ms |
| Q2 VIN 폐루프 체인 (매입→도매→출하→소매→VoC) | L3 | ~10ms |
| Q3 딜러 스코어 (소매·인센티브·VoC율) | L2 | ~12ms |
| Q4 모델×월 도매 추이 (링크 순회) | L1 | ~5ms |

**서빙 API (구현됨)** — `server.js`가 `/api/*`로 이 마트를 서빙한다. 질의는
`semantic-layer.json`의 datasource 선언만 참조한다 (시멘틱 계약). `@duckdb/node-api`
미설치 시 `/api`는 503, 정적 서빙은 그대로 동작한다.

| 엔드포인트 | 내용 |
|---|---|
| `GET /api/health` | 가용성 · 시멘틱 버전 · 원장 이벤트 수 |
| `GET /api/semantic` | 시멘틱 레이어 선언 |
| `GET /api/kpi/monthly` | L0 KPI 큐브 (kpiBindings.datasource) |
| `GET /api/pulse/daily?days=` | **일 펄스** — 일 그레인 소매·도매·VoC·인센티브 (1-DAU 심박) |
| `GET /api/dealers/score?limit=&order=` | 딜러 스코어 — 소매·인센티브·VoC율 (evaluateDealer 근거) |
| `GET /api/objects/{type}?ym=&status=&limit=` | 객체 마트 (선언된 타입만 — 미선언 404 · marketSnapshot 시장 축 포함) |
| `GET /api/vin/{vin}/chain` | VIN 폐루프 체인 (Q2와 동일) |
| `POST /api/actions/approveWarrantyClaim` | **폐루프 v0** — HITL 결재 → 원장 append |

**폐루프 v0** — `approveWarrantyClaim` 결재가 `data_new/ledger/action_log.jsonl`
(append-only, git 제외)에 이벤트를 기록하고, 이후 warrantyClaim 조회에 최신 이벤트가
오버레이된다 (PEND→APPR/REJ). 소비처: `prototypes/v10-twin-world.html`의
「⛁ 실데이터 L0」 패널 — API 미가용이면 버튼이 숨고 기존 동작 불변(폴백 규칙).
회귀: `prototypes/tests/v10-world.test.mjs` W18.

## 판단 — CSV인가 Parquet인가

**결론: 파이프라인 전 구간(raw/staging/ontology)은 Parquet + DuckDB. CSV는 사람이
직접 읽고 편집하는 소량 마스터(`data/master/dim_*.csv`, `ceo_tree.csv`)에만 유지.**

실측 근거 — 도매 원장 형태 200만 행 (`90_benchmark.js`, 5회 중앙값):

| 항목 | CSV | Parquet(ZSTD) | 배율 |
|---|---|---|---|
| 파일 크기 | 111.9 MB | 14.0 MB | **8.0×** |
| 집계 (GROUP BY 월×모델) | 170.5 ms | 18.4 ms | **9.3×** |
| 단일 컬럼 SUM (컬럼 프루닝) | 120.0 ms | 4.8 ms | **25×** |
| 월 필터 (로우그룹 통계 스킵) | 138.3 ms | 5.0 ms | **28×** |

이유는 구조적이다:

- **스키마 내장** — CSV는 읽을 때마다 타입을 추론(또는 선언)해야 하고 날짜·선행 0(`D0001`)이
  잘못 해석되는 사고가 난다. Parquet는 타입·컬럼이 파일에 내장된다.
- **컬럼 프루닝 + 통계** — Parquet는 필요한 컬럼만 읽고, 로우그룹 min/max 통계로 월 필터를
  스킵한다. CSV는 무조건 전체를 파싱한다. (위 25×·28× 차이의 원인)
- **압축** — 컬럼 단위 ZSTD로 1/8. 월 파티션(`month=YYYY-MM/`)과 결합하면 증분 적재·재처리 단위가 된다.
- **CSV의 남는 자리** — git diff로 리뷰하는 소량 마스터, 사람이 값을 입력하는 시드.
  즉 **"사람이 쓰는 파일은 CSV, 기계가 읽는 파일은 Parquet"**.

## 기존 data/ 와의 관계

`data/`는 프로토타입 화면용 가상 데이터(CSV, generate.py)로 유지된다. `data_new/`는
그 다음 단계 — **SAP 원천 형태부터 시작하는 실개발용 파이프라인의 실행 가능한 사양**이다.
`development/requirements/02-data-ontology.md`의 레벨별 데이터 계약이 이 파이프라인의
검수 기준이고, 대상 법인 값은 `development/entity-profile.md`(§5 데이터 인벤토리)로 입력한다.
