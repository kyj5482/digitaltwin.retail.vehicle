# 04 — 보안·권한(RBAC) · API 계약 · 신선도 요구사항

방향성 리뷰(§2-F)가 지적한 요구사항 공백을 명세한다. 프로토타입의 서빙 API
(`server.js /api/*`)와 폐루프 v0(액션 원장)가 이 계약의 뼈대이며, 실개발은 이 문서를
수용 기준으로 확장한다.

## 1. 역할 모델 (RBAC)

| 역할 | 설명 | 예 |
|---|---|---|
| `viewer` | 조회 전용 — L0/L1 집계 | 전사 임직원 |
| `dept:<부문ID>` | 소속 부문의 L2 실행 원장 조회 + 담당 게이트 결재 | 판매 담당 = `dept:DEPT-SLS` |
| `approver:<액션ID>` | 특정 HITL 액션 결재 권한 — 부문 역할과 조합 | 클레임 심사 = `approver:approveWarrantyClaim` |
| `executive` | 전 레벨 조회 + 시나리오 커밋 + 워게이밍 실행 | CEO·임원 |
| `agent:<에이전트ID>` | AI 에이전트 — gate=ai 액션만, 사람 결재 대체 불가 | VoC 분류기 |
| `admin` | 시멘틱 정본·레지스트리 빌드 배포, 원장 정정 이벤트 승인 | 트윈 운영팀 |

**원칙**
- 게이트 결재 권한은 **시멘틱 정본의 `actionTypes[].gate` 선언과 교차 검증**한다 —
  `gate:"hitl"` 액션은 `agent:*` 역할로 실행 불가(서버가 403), `gate:"ai"` 액션은
  사람 결재를 요구하지 않되 원장에 `actor`(에이전트 ID)를 기록한다.
- 레벨 접근: L0·L1은 `viewer` 이상, L2 실행 원장은 소속 부문(또는 executive),
  **L3 VIN·고객 인스턴스는 필요 역할에만** — VIN은 화면에서 뒤 8자리 마스킹 기본
  (`…00001264`), 고객 ID(`ZZCUSTID`)는 `dept:DEPT-SVC`·`dept:DEPT-QLT` 외 비노출.
- 부문 월드의 결재함은 자기 부문 게이트만 활성 — 타 부문은 읽기 전용 상태 표시.

## 2. API 계약

### 2.1 공통 규약
- **모든 질의는 시멘틱 정본의 `mart` 바인딩만 참조한다** (경로 직접 접근 금지 — 구현됨).
- 인증: `Authorization: Bearer <token>` (실환경 OIDC). 프로토타입은 무인증 로컬.
- 에러 응답: `{ "error": "<사유>" }` + 상태 코드 — 400(입력 형식), 403(권한),
  404(미선언 타입/마트 미바인딩/대상 없음), 409(상태 충돌 — 중복 결재), 501(미구현 액션),
  503(서빙 엔진 미가용). **선언에 없는 것은 404** — 계약이 곧 접근 범위다.
- 페이지네이션: `?limit=`(상한 서버 강제) — 실개발에서 `?cursor=` 추가.

### 2.2 조회 (구현됨 — server.js)
| 엔드포인트 | 레벨 | 최소 역할 |
|---|---|---|
| `GET /api/health` · `GET /api/semantic` | — | viewer |
| `GET /api/kpi/monthly` | L0 | viewer |
| `GET /api/pulse/daily?days=` | L1 (일 그레인) | viewer |
| `GET /api/objects/{type}?ym=&status=&limit=` | 타입의 mart.level | 레벨 규칙(§1) |
| `GET /api/vin/{vin}/chain` | L3 | dept 또는 executive |
| `GET /api/dealers/score?limit=&order=` | L2 | dept:DEPT-SLS 또는 executive |

### 2.3 쓰기 — 액션 실행 (폐루프)
```
POST /api/actions/{actionId}
{ "objectId": "...", "decision": "...", "actor": "...", "requestId": "<클라이언트 생성 UUID>" }
```
- **선언 게이트 검증**: actionId가 정본에 없거나 gate 미선언 → 404. hitl 액션 + agent
  토큰 → 403.
- **상태 전이 검증**: 대상 객체의 현재 상태(원장 오버레이 포함)가 전제조건과 다르면 409
  (구현됨 — PEND 아닌 클레임 재결재 409).
- **멱등성**: 동일 `requestId` 재전송은 최초 결과를 반환하고 원장에 중복 기록하지 않는다
  (실개발 필수 — v0 미구현).
- **감사 추적**: 원장 이벤트는 append-only — `ts · action · gate · objectId · decision ·
  actor · prevStatus`(구현됨) + 실개발에서 `requestId · authSubject · sourceIp` 추가.
  정정은 삭제가 아니라 **역이벤트**로 기록하고 `admin` 승인 게이트를 거친다.

## 3. 신선도(Freshness) · as-of 규칙

- 모든 조회 응답에 **as-of 메타**를 포함한다: L0 = 마감월(`closeMonthlyFinance` 시점 규칙,
  구현됨), 일 펄스 = 기준일(`asof`, 구현됨), 실개발에서는 파티션 워터마크
  (INCREMENTAL.md §2)를 헤더 `X-Data-Watermark` 로 노출.
- 신선도 SLA(가설, 법인별 프로필로 조정): L0 월 마감 +1영업일 · L2 원장 일 배치 +4시간 ·
  일 펄스 익일 06:00 · 위반 시 화면에 스테일 배지(회색 시계 아이콘 + 최종 갱신 시각).
- 장애 시: 스테일 데이터를 **감추지 않고 배지와 함께 표시** — 빈 화면 금지 (오류 UX).

## 4. 수용 기준 (AC)

- AC-S1: gate=hitl 액션을 agent 토큰으로 호출하면 403 + 원장 무기록.
- AC-S2: 동일 requestId 2회 전송 시 원장 이벤트 1건.
- AC-S3: viewer 토큰으로 `GET /api/objects/retailSale`(L3) 호출 시 403, VIN 마스킹 규칙이
  모든 L3 응답에 적용.
- AC-S4: 정정 이벤트 후 조회가 역이벤트 반영 상태를 반환하고, 감사 조회로 원 이벤트·
  역이벤트가 모두 보인다.
- AC-S5: 모든 조회 응답에 as-of 메타 존재 — 회귀 테스트가 검증.
