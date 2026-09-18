# 법인 프로필 — 디지털 트윈 대상 법인 정의 [입력 문서]

이 문서가 **단일 입력 소스**다. 아래 표를 실제 구현 대상 법인의 값으로 채운 뒤
저장소 루트에서 `node development/tools/build-entity.js`를 실행하면
`prototypes/entity-config.js`가 생성되어 트윈 월드·온톨로지 탐색기에 반영된다.

- 표의 **값 칸만** 수정한다 (열 구조·섹션 제목은 파서가 인식하는 계약 — 변경 금지).
- 기본값은 프로토타입(미국판매법인)의 예시 — 실제 법인으로 교체해 사용한다.
- `—` 는 미입력을 뜻하며 해당 항목은 프로토타입 기본값으로 동작한다.

## 1. 기본 정보

| 항목 | 값 |
|---|---|
| 법인명 | 미국판매법인 |
| 법인 코드 | SC-US |
| 상위 조직(권역 본부) | 북미권역본부 |
| 통화 | USD |
| 시장 | 미국 |
| 회계연도 시작 | 1월 |
| 트윈 오너(담당 조직) | — |

## 2. 형제 법인 — 권역 산하 (관계뷰 업스트림에 표시, 최대 2개 반영)

| 법인명 | 코드 | 트윈 구축 여부 |
|---|---|---|
| 캐나다판매법인 | SC-CA | 계획 |
| 멕시코판매법인 | SC-MX | 계획 |

## 3. 회사 KPI — CEO KPI 트리 오버라이드

`KPI ID`가 `data/governance/ceo_tree.csv`의 `node_id`와 일치하면 이름·약칭·가중치가 교체된다.
일치하지 않는 ID는 **신규 KPI**로 리포트만 되며, 실개발 단계에서 ceo_tree 확장으로 반영한다
(`requirements/02-data-ontology.md` 참조). 가중치는 화면에서 가중 평균으로 정규화된다
(합이 100이 아니어도 됨 — 빌드가 합계를 리포트).

| KPI ID | KPI 이름 | 약칭 | 가중치(%) | 단위 | 방향 | BP 목표(연) | 데이터 소스(바인딩) |
|---|---|---|---|---|---|---|---|
| KPI-ASP | ASP (인센티브 차감 후) | ASP | 5 | $ | + | — | agg_kpi.asp |
| KPI-RECUR | 경상이익률 | 경상이익 | 5 | % | + | — | agg_kpi.recur |
| KPI-COMB | 합산손익 | 합산손익 | 12 | $ | + | — | agg_kpi.comb |
| KPI-COMBR | 합산손익률 | 합산손익률 | 15 | % | + | — | agg_kpi.combr |
| KPI-WS | 도매판매량 | 도매판매 | 10 | 대 | + | 790,000대 | agg_kpi.ws |
| KPI-SUV | 볼륨 SUV 육성 (소매) | SUV육성 | 10 | 대 | + | — | agg_kpi.suv |
| KPI-SHARE | 시장점유율 | 점유율 | 10 | % | + | — | agg_kpi.share |
| KPI-EV | 친환경 소매판매량 (소매) | 친환경 | 5 | 대 | + | — | agg_kpi.ev |
| KPI-GREEN | 그린워싱 | 그린워싱 | 5 | 건 | - | 0건 | — |
| KPI-FSI | Full SI 2.0 | Full SI | 5 | % | + | — | — |
| KPI-CSIS | 고객만족도 (서비스) | CS서비스 | 3.5 | 점 | + | — | agg_kpi.csisvc |
| KPI-CSIP | 고객만족도 (판매) | CS판매 | 3.5 | 점 | + | — | agg_kpi.csidlv |
| KPI-SEC | 보안 | 보안 | 3 | 건 | - | 0건 | — |
| KPI-BRAND | 브랜드트래커 | 브랜드 | 5 | 점 | + | — | agg_kpi.brand |

## 4. 부문 — 운영 월드 (9부문 이름 오버라이드)

`부문 ID`는 v10 운영 월드의 부문 키. 이름 열만 법인 조직명으로 교체한다
(부문 추가·삭제·워크플로우 변경은 실개발 범위 — `requirements/03-frontend.md`).

| 부문 ID | 이름 | 오너(조직/직책) |
|---|---|---|
| DEPT-SLS | 판매 | — |
| DEPT-MKT | 마케팅 | — |
| DEPT-PRD | 상품 | — |
| DEPT-FIN | 재경 | — |
| DEPT-SVC | 서비스 | — |
| DEPT-QLT | 품질 | — |
| DEPT-SAF | 안전 | — |
| DEPT-HR | 인사/총무 | — |
| DEPT-IT | IT | — |

## 5. 데이터 인벤토리 — 보유 데이터 → 온톨로지 매핑

법인이 실제 보유한 데이터(DW 테이블·파일·API)를 온톨로지 객체에 매핑한다.
이 표가 `requirements/02-data-ontology.md`의 데이터 계약 검증 입력이 된다.

| 보유 데이터(테이블/파일/API) | 온톨로지 객체 타입 | 월드 레벨 | 그레인 | 갱신 주기 | 비고 |
|---|---|---|---|---|---|
| agg_kpi (월 집계 CSV) | kpiSnapshot | L0 회사 | 월 × KPI | 월 마감 | 프로토타입 예시 |
| vin_retail / vin_wholesale | vehicle | L3 인스턴스 | VIN | 일 | 프로토타입 예시 |
| governance/workflow_gates | approvalGate | L2 부문 | 게이트 × 월 | 수시 | 프로토타입 예시 |
| — | — | — | — | — | 실데이터로 교체 입력 |
