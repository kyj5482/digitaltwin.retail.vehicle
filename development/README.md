# development/ — 실개발 준비 (v10 기준)

프로토타입(v10 디지털 트윈 월드)을 **특정 법인의 실제 개발**로 전환하기 위한 폴더.
요구사항 문서와, 법인 정보를 입력하면 프런트엔드에 반영되는 빌드 파이프라인으로 구성된다.

## 폴더 구성

```
development/
├── README.md                      ← 이 문서
├── entity-profile.md              ★ [입력] 대상 법인 프로필 — 법인명·조직·KPI·데이터 인벤토리
├── requirements/
│   ├── 00-overview.md             실개발 전환 개요 · 범위 · 진행 단계
│   ├── 01-world-hierarchy.md      계층형 월드 아키텍처 — 레벨별 온톨로지 · 딥링크 무플래시 규격
│   ├── 02-data-ontology.md        보유 데이터 → 온톨로지 매핑 · 데이터 계약 (data/SCHEMA.md 기준)
│   └── 03-frontend.md             v10 수준 Frontend 요구사항 — 씬 문법 · 구성요소 · 기술 요건
├── tools/
│   ├── build-entity.js            entity-profile.md 파서 → 설정 생성 (Node, 외부 의존성 없음)
│   └── build-ontology.js          시멘틱 정본(json) → prototypes/v7-ontology.js 생성 (선언 무결성 검증 포함)
└── generated/
    └── entity-config.json         빌드 생성물 (검토용 JSON — 직접 수정 금지)
```

## 온톨로지 빌드 — 시멘틱 정본 → 프런트 반영

온톨로지 선언(객체·링크·액션·수명주기·메트릭)의 **유일 정본은
`data_new/semantic/semantic-layer.json`** 이다. 선언을 수정하면:

```bash
node development/tools/build-ontology.js    # → prototypes/v7-ontology.js 재생성
```

빌드가 id 유일성·참조 무결성·mart 경로 형식을 검증하고, 회귀 테스트 C19
(`prototypes/tests/ontology-consistency.test.mjs`)가 정본↔생성물 동기를 지킨다.
`prototypes/v7-ontology.js`는 직접 수정 금지.

## 워크플로우 — 법인 정보 입력 → 트윈 반영

1. **입력**: `entity-profile.md`의 표를 실제 법인 값으로 채운다
   (법인명 · 법인 코드 · 상위 조직 · 형제 법인 · 회사 KPI · 부문 · 데이터 인벤토리).
2. **빌드**: 저장소 루트에서 실행 —
   ```bash
   node development/tools/build-entity.js
   ```
   - `development/generated/entity-config.json` (검토용)
   - `prototypes/entity-config.js` (프런트 주입용 `window.ENTITY_CONFIG`)
   두 파일이 생성되고, KPI ID가 `data/governance/ceo_tree.csv`와 일치하는지 검증 리포트가 출력된다.
3. **반영**: `prototypes/v10-twin-world.html`(트윈 월드)와 `v7-ontology-explorer.html`(온톨로지)이
   `entity-config.js`를 읽어 법인명·조직 노드·KPI 이름/가중치를 오버라이드한다.
   생성물이 없으면 기본값(미국판매법인 프로토타입)으로 동작한다.

## 원칙

- **md가 단일 입력 소스** — 법인별 값은 코드가 아니라 `entity-profile.md`에만 존재한다.
  `generated/`와 `prototypes/entity-config.js`는 항상 빌드로 재생성한다.
- **프로토타입 문법 유지** — 씬·드릴다운·Play·폐루프 등 v10 문법은 그대로 두고,
  법인 고유 값(이름·KPI·데이터 소스)만 프로필로 교체한다.
- **계층 = 온톨로지** — 월드는 레벨 트리로 구성되고 각 레벨은 자기 온톨로지 서브그래프를
  데이터 계약으로 가진다. 상세는 `requirements/01-world-hierarchy.md`.
