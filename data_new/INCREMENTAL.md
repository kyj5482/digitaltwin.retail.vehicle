# 증분 적재 설계 — 전량 재생성에서 파티션 증분으로

현재 파이프라인은 전 단계가 **전량 덮어쓰기**(`COPY ... TO x.parquet`)다. 1:50 샘플에서는
1초 이내라 문제없지만, 실볼륨(1:1 ≈ 15만 VIN·월, BSEG 전량)과 일 배치/CDC 환경에서는
증분 처리가 필수다. 이 문서가 그 설계이고, `pipeline/60_incremental_demo.js`가
핵심 메커니즘(파티션 단위 재계산 + 프루닝)의 실측 실증이다.

## 1. 파티션 전략 — `month=YYYY-MM` hive 파티션

```
staging/stg_wholesale/            ontology/objects/wholesale/
├── month=2024-01/part-0.parquet  ├── month=2024-01/part-0.parquet
├── month=2024-02/part-0.parquet  ├── ...
└── ...                           └── month=2026-08/part-0.parquet
```

- **쓰기**: `COPY (...) TO 'dir' (FORMAT PARQUET, PARTITION_BY (month), OVERWRITE_OR_IGNORE)`
  — 재계산은 영향 파티션만 다시 쓴다.
- **읽기**: `read_parquet('dir/*/*.parquet', hive_partitioning=1)` — 월 필터가
  파티션 프루닝으로 해당 디렉터리만 스캔한다 (데모 실측: 35개 파티션 중 1개 파일만 스캔).
- **그레인 규칙**: 파티션 키는 각 마트의 `ym`(업무 발생월). late-arriving(늦게 도착한
  전월 데이터)은 발생월 파티션을 다시 쓴다 — 도착일 기준이 아님.

## 2. 증분 흐름 — 어떤 파티션을 다시 계산하는가

```
CDC/일 배치 수신 (raw)                                재계산 대상
─────────────────────────────────────────────────────────────────
① 수신 배치의 영향 ym 집합 도출:  SELECT DISTINCT ym FROM 변경분
② staging: 영향 ym 파티션만 재계산 (raw 해당 월 + VBFA 조인)
③ ontology: staging 영향 ym 파티션만 재계산.
   단, VIN 그레인 객체(vehicle)는 상태 갱신이므로 해당 VIN 의 생산월 파티션
④ kpi_monthly: 영향 ym 행만 UPSERT (마감월 게이트는 서빙 공통 규칙)
⑤ 50_validate: 영향 파티션 스코프로 대사 (전량 검증은 일 1회)
```

- **워터마크**: `_meta/watermark.json` 에 소스별 최종 처리 커밋 시각(SLT/CDC LSN)을
  기록 — 재실행은 워터마크 이후 변경분만 읽는다 (멱등).
- **정정(訂正)**: 원장은 append-only — 정정은 취소+재기표 이벤트로 수신되며 두 이벤트의
  발생월 파티션을 재계산한다 (02-data-ontology의 원장 규칙과 동일).

## 3. CDC 수신 스키마 (SLT → raw)

raw 파티션에 CDC 메타 3컬럼을 추가한다: `_op`(I/U/D) · `_commit_ts` · `_batch_id`.
- **U/D 전파**: staging 재계산 시 같은 키의 최신 `_commit_ts` 만 남긴다(dedup window).
  D 는 tombstone 으로 남겨 ontology 재계산에서 제외한다.
- **마스터 SCD2**: 딜러(KNA1)·자재(MARA) 마스터는 변경 이력이 딜러 평가·믹스 분석에
  필요하므로 `valid_from/valid_to` SCD2 로 유지한다. 트랜잭션 조인은 발생 시점 버전을
  사용한다 (`ws_date BETWEEN valid_from AND valid_to`).

## 4. 테이블 형식 (Iceberg/Delta) 판단

| 조건 | 파일-hive 파티션으로 충분 | 테이블 형식 필요 |
|---|---|---|
| 쓰기 주체 | 단일 파이프라인 (현재) | 다중 라이터·동시 커밋 |
| 갱신 패턴 | 파티션 통재계산 | 행 단위 MERGE/DELETE 빈번 |
| 읽기 일관성 | 스왑 디렉터리로 해결 가능 | 스냅숏 격리·타임트래블 필요 |
| 스키마 진화 | 시멘틱 정본 + 50_validate 로 통제 | 자동 스키마 진화 필요 |

**판단**: P2(실데이터 연동) 초기는 hive 파티션 + 스왑 디렉터리로 충분하다.
액션 원장(쓰기 경로)이 다중 사용자 동시 커밋으로 성장하는 P4 시점에 원장 스토어만
테이블 형식(또는 OLTP)으로 승격하는 것이 비용 대비 옳다 — 읽기 마트 전체를
Iceberg 로 옮길 필요는 없다.

## 5. 서빙 원자성 — 스왑 디렉터리

Parquet 파일을 제자리에서 덮어쓰면 열려 있는 스캔이 깨질 수 있다 (동시성 리스크).

```
ontology/objects/wholesale/_v2026-08-28T09/   ← 새 버전 쓰기 완료 후
ontology/objects/wholesale/CURRENT            ← 심볼릭 링크(또는 포인터 파일) 원자 교체
```

server.js 는 요청 시점의 `CURRENT` 를 해석해 질의한다 — 교체 중에도 이전 버전으로
일관 읽기. 이전 버전은 N세대 보존 후 삭제(간이 타임트래블).

## 6. 이행 계획

| 단계 | 내용 | 트리거 |
|---|---|---|
| I-1 (완료) | 파티션 재계산·프루닝 실증 — `60_incremental_demo.js` | 이 문서 |
| I-2 | staging·ontology 를 PARTITION_BY 쓰기로 전환, 시멘틱 정본 mart.path 를 디렉터리 패턴으로 | P2 착수 |
| I-3 | CDC 메타 컬럼·워터마크·dedup, 마스터 SCD2 | SLT/CDC 연결 시 |
| I-4 | 스왑 디렉터리 + server.js CURRENT 해석 | 동시 사용자 발생 시 |
| I-5 | 액션 원장 테이블 형식/OLTP 승격 | P4 다중 결재 사용자 |

## 7. 실증 결과 (60_incremental_demo.js)

`node data_new/pipeline/60_incremental_demo.js` — 도매 스테이징을 month 파티션으로
물질화한 뒤, ① 단일 월 파티션만 재계산해 전량 재생성과 결과 동일함을 검증하고
② 월 필터 질의의 파티션 프루닝(스캔 파일 수·시간)을 실측한다. 산출물은
`/tmp` 아래 생성되어 본 파이프라인 마트를 건드리지 않는다.
