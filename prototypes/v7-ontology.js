// =============================================================================
// v7-ontology.js — 생성 파일. 직접 수정 금지.
// 정본:   data_new/semantic/semantic-layer.json (시멘틱 레이어 — 유일 소스)
// 재생성: node development/tools/build-ontology.js
// mart 필드 = data_new 온톨로지 마트(Parquet) 바인딩 — server.js /api 가 서빙,
// mart.fields 는 필드 수준 계약 (파이프라인 50_validate 가 실스키마와 대조).
// =============================================================================
window.ONTOLOGY = {
  "meta": {
    "id": "sc-us-vehicle-ontology",
    "name": "미국판매법인 차량 비즈니스 온톨로지",
    "version": "0.13.0",
    "updated": "2026-08-28",
    "description": "해외·로컬 생산법인으로부터의 차량 매입 → 운송·검사 → 딜러 배분·도매 → 소매·인센티브 → 커스터머 케어 → 커넥티드 품질·안전까지, 판매법인 업무 전체를 객체·관계·액션으로 선언한다.",
    "principles": [
      "원장은 VIN 그레인, 속성은 vehicle_master가 정본 (SCHEMA.md §9와 동일 원칙)",
      "상태 전이마다 검사(Inspection) 게이트 — 문제없음을 기록해야 다음 단계로 전달",
      "도매(Wholesale) 시점에 판매법인 이익 실현, 소매(Retail) 가속은 인센티브로 관리",
      "외부에서 직접 만들 수 없는 지표(외부 CSI)는 내부 지수·활동으로 매개"
    ]
  },
  "groups": [
    {
      "id": "org",
      "name": "조직 · 네트워크",
      "order": 0
    },
    {
      "id": "product",
      "name": "제품",
      "order": 1
    },
    {
      "id": "plan",
      "name": "계획 · 발주",
      "order": 2
    },
    {
      "id": "logistics",
      "name": "물류 · 검사",
      "order": 3
    },
    {
      "id": "commerce",
      "name": "도매 · 소매",
      "order": 4
    },
    {
      "id": "care",
      "name": "커스터머 케어",
      "order": 5
    },
    {
      "id": "quality",
      "name": "커넥티드 · 품질",
      "order": 6
    }
  ],
  "objectTypes": [
    {
      "id": "salesCompany",
      "group": "org",
      "name": "판매법인",
      "en": "Sales Company",
      "abbr": "SC",
      "description": "시장별 판매법인. SC-US가 완전 트윈 대상 — 생산법인에서 차량을 매입해 딜러에 도매하고, 인센티브·마케팅·딜러 관리·커스터머 케어를 수행한다.",
      "primaryKey": "company_id",
      "titleKey": "company_name",
      "datasource": {
        "status": "bound",
        "kind": "master",
        "path": "data/master/dim_sales_company.csv",
        "grain": "법인"
      },
      "properties": [
        {
          "id": "company_id",
          "name": "법인 코드",
          "type": "string",
          "role": "key",
          "sample": "SC-US"
        },
        {
          "id": "company_name",
          "name": "법인명",
          "type": "string",
          "role": "dim",
          "sample": "미국판매법인"
        },
        {
          "id": "market",
          "name": "담당 시장",
          "type": "string",
          "role": "dim",
          "sample": "US"
        },
        {
          "id": "twin_level",
          "name": "트윈 수준",
          "type": "string",
          "role": "meta",
          "sample": "full"
        }
      ],
      "mart": {
        "path": "data_new/ontology/objects/salesCompany.parquet",
        "sapSource": "상수 (법인 코드)",
        "level": "L0",
        "primaryKey": "object_id",
        "fields": [
          {
            "id": "object_id",
            "type": "VARCHAR"
          },
          {
            "id": "title",
            "type": "VARCHAR"
          },
          {
            "id": "country",
            "type": "VARCHAR"
          }
        ]
      }
    },
    {
      "id": "productionCompany",
      "group": "org",
      "name": "생산법인",
      "en": "Production Company",
      "abbr": "PC",
      "description": "차량을 생산해 판매법인에 판매(매출)하는 법인. 해외(한국·멕시코)와 로컬(미국) 모두 포함 — 판매법인 관점에서는 매입처다.",
      "primaryKey": "pc_id",
      "titleKey": "pc_name",
      "datasource": {
        "status": "planned",
        "kind": "master",
        "path": "data/master/dim_production_company.csv",
        "grain": "법인",
        "note": "현재 dim_plant에 공장만 존재 — 법인 레벨 마스터 신설 예정 (공장 → 법인 롤업 키 owner_pc_id 추가)"
      },
      "properties": [
        {
          "id": "pc_id",
          "name": "법인 코드",
          "type": "string",
          "role": "key",
          "sample": "PC-KR"
        },
        {
          "id": "pc_name",
          "name": "법인명",
          "type": "string",
          "role": "dim",
          "sample": "국내생산법인"
        },
        {
          "id": "country",
          "name": "국가",
          "type": "string",
          "role": "dim",
          "sample": "KR"
        },
        {
          "id": "incoterms",
          "name": "인도 조건",
          "type": "string",
          "role": "dim",
          "sample": "CIF 서부수입항"
        },
        {
          "id": "transfer_price_basis",
          "name": "이전가격 기준",
          "type": "string",
          "role": "meta",
          "sample": "도매가 − 판매법인 변동마진"
        }
      ]
    },
    {
      "id": "plant",
      "group": "org",
      "name": "공장",
      "en": "Plant",
      "abbr": "PL",
      "description": "생산법인 산하 생산 거점. 케파(월)·리드타임·출하 방식(선박/철도/트럭)·배치 크기를 보유한다.",
      "primaryKey": "plant_id",
      "titleKey": "plant_name",
      "datasource": {
        "status": "bound",
        "kind": "master",
        "path": "data/master/dim_plant.csv",
        "grain": "공장"
      },
      "properties": [
        {
          "id": "plant_id",
          "name": "공장 코드",
          "type": "string",
          "role": "key",
          "sample": "US-GA"
        },
        {
          "id": "plant_name",
          "name": "공장명",
          "type": "string",
          "role": "dim",
          "sample": "조지아 공장"
        },
        {
          "id": "country",
          "name": "국가",
          "type": "string",
          "role": "dim",
          "sample": "US"
        },
        {
          "id": "cap_month",
          "name": "월 케파",
          "type": "int",
          "role": "measure",
          "unit": "대",
          "sample": "36000"
        },
        {
          "id": "lead_month",
          "name": "리드타임",
          "type": "int",
          "role": "measure",
          "unit": "개월",
          "sample": "0"
        },
        {
          "id": "ship_mode",
          "name": "출하 방식",
          "type": "string",
          "role": "dim",
          "sample": "트럭·철도"
        },
        {
          "id": "batch_size",
          "name": "운송 배치",
          "type": "int",
          "role": "measure",
          "unit": "대",
          "sample": "300"
        },
        {
          "id": "wmi",
          "name": "WMI(VIN 1-3)",
          "type": "string",
          "role": "meta",
          "sample": "VF3"
        },
        {
          "id": "freight_usd_per_unit",
          "name": "대당 운송비",
          "type": "int",
          "role": "measure",
          "unit": "USD",
          "sample": "380"
        }
      ],
      "mart": {
        "path": "data_new/ontology/objects/plant.parquet",
        "sapSource": "T001W",
        "level": "L1",
        "primaryKey": "object_id",
        "fields": [
          {
            "id": "object_id",
            "type": "VARCHAR"
          },
          {
            "id": "title",
            "type": "VARCHAR"
          },
          {
            "id": "country",
            "type": "VARCHAR"
          },
          {
            "id": "wmi",
            "type": "VARCHAR"
          }
        ]
      }
    },
    {
      "id": "salesZone",
      "group": "org",
      "name": "지역사무소",
      "en": "Regional Sales Office (Zone)",
      "abbr": "ZN",
      "description": "판매법인 산하 지역사무소 5곳 (West/Central/South/Northeast/Southeast). 단순한 지리 구획이 아니라 관할 딜러 관리·배분 조정·지역 마케팅·지역 트렌드 분석을 수행하는 판매법인의 현장 조직 단위다.",
      "primaryKey": "zone_id",
      "titleKey": "zone_name",
      "datasource": {
        "status": "bound",
        "kind": "master",
        "path": "data/master/dim_zone.csv",
        "grain": "지역사무소"
      },
      "properties": [
        {
          "id": "zone_id",
          "name": "지역 코드",
          "type": "string",
          "role": "key",
          "sample": "west"
        },
        {
          "id": "zone_name",
          "name": "지역명",
          "type": "string",
          "role": "dim",
          "sample": "West"
        },
        {
          "id": "office_city",
          "name": "사무소 소재지",
          "type": "string",
          "role": "dim",
          "sample": "Irvine, CA"
        },
        {
          "id": "dealer_cnt",
          "name": "관할 딜러 수",
          "type": "int",
          "role": "measure",
          "unit": "개",
          "sample": "168"
        },
        {
          "id": "pop_share",
          "name": "인구 비중",
          "type": "decimal",
          "role": "measure",
          "sample": "0.26"
        },
        {
          "id": "ev_affinity",
          "name": "EV 선호도",
          "type": "decimal",
          "role": "measure",
          "sample": "1.35"
        }
      ],
      "mart": {
        "path": "data_new/ontology/objects/salesZone.parquet",
        "sapSource": "dim_zone (마스터 CSV)",
        "level": "L2",
        "primaryKey": "object_id",
        "fields": [
          {
            "id": "object_id",
            "type": "VARCHAR"
          },
          {
            "id": "title",
            "type": "VARCHAR"
          },
          {
            "id": "dealer_cnt",
            "type": "BIGINT"
          }
        ]
      }
    },
    {
      "id": "facility",
      "group": "org",
      "name": "시설(건물)",
      "en": "Facility",
      "abbr": "FC",
      "description": "판매법인이 운영하는 캠퍼스 건물(동관/서관). 관리비(전력·임차)의 발생 주체 — 경상이익률 다운스트림의 물리 실체. HVAC 전략 레버(피크 설정온도·예냉)의 적용 대상.",
      "primaryKey": "facility_id",
      "titleKey": "facility_name",
      "datasource": {
        "status": "bound",
        "kind": "mart",
        "path": "data/facility_energy/",
        "grain": "월×건물×층×구역 (건물 롤업)"
      },
      "properties": [
        {
          "id": "facility_id",
          "name": "시설 코드",
          "type": "string",
          "role": "key",
          "sample": "FC-EAST"
        },
        {
          "id": "facility_name",
          "name": "시설명",
          "type": "string",
          "role": "dim",
          "sample": "동관"
        },
        {
          "id": "floors",
          "name": "층수",
          "type": "int",
          "role": "measure",
          "unit": "층",
          "sample": "3"
        },
        {
          "id": "area_m2",
          "name": "연면적",
          "type": "int",
          "role": "measure",
          "unit": "m²",
          "sample": "11200"
        }
      ]
    },
    {
      "id": "energyMeter",
      "group": "org",
      "name": "전력 계측(층)",
      "en": "Energy Meter",
      "abbr": "EM",
      "description": "층·구역별 전력 계측점 — 피크/비피크 kWh·설정온도·비용을 월 단위로 기록. 전력사용량 지표의 최하위 데이터 실체이며, 여기서 한 단계씩 관리비 → 경상이익률로 롤업된다. 항온존(서버실)은 HVAC 레버 제외.",
      "primaryKey": "meter_id",
      "titleKey": "meter_name",
      "datasource": {
        "status": "bound",
        "kind": "mart",
        "path": "data/facility_energy/",
        "grain": "월×건물×층×구역"
      },
      "properties": [
        {
          "id": "meter_id",
          "name": "계측 코드",
          "type": "string",
          "role": "key",
          "sample": "EM-E1-SRV"
        },
        {
          "id": "meter_name",
          "name": "계측점",
          "type": "string",
          "role": "dim",
          "sample": "동관 1F 서버실"
        },
        {
          "id": "floor",
          "name": "층",
          "type": "int",
          "role": "dim",
          "sample": "7"
        },
        {
          "id": "temp_set_c",
          "name": "설정온도",
          "type": "float",
          "role": "measure",
          "unit": "°C",
          "sample": "22.0"
        },
        {
          "id": "kwh_peak",
          "name": "피크 사용량",
          "type": "int",
          "role": "measure",
          "unit": "kWh",
          "sample": "20465"
        },
        {
          "id": "cost_usd",
          "name": "월 전력비",
          "type": "int",
          "role": "measure",
          "unit": "USD",
          "sample": "7639"
        }
      ]
    },
    {
      "id": "dealer",
      "group": "org",
      "name": "딜러",
      "en": "Dealer",
      "abbr": "DL",
      "description": "프랜차이즈 딜러. 도매 인수(재고 부담)·소매·서비스(워런티/캠페인/고객 페이)를 수행하는 판매법인의 관리 대상 — 계약·평가·배분의 주체.",
      "primaryKey": "dealer_id",
      "titleKey": "dealer_name",
      "datasource": {
        "status": "planned",
        "kind": "master",
        "path": "data/master/dim_dealer.csv",
        "grain": "딜러 (전국 745개)",
        "note": "현재 지역별 dealer_cnt 집계만 존재 — 딜러 마스터 신설 예정"
      },
      "properties": [
        {
          "id": "dealer_id",
          "name": "딜러 코드",
          "type": "string",
          "role": "key",
          "sample": "D-W012"
        },
        {
          "id": "dealer_name",
          "name": "상호",
          "type": "string",
          "role": "dim",
          "sample": "Pacific Crest Motors"
        },
        {
          "id": "zone_id",
          "name": "지역",
          "type": "string",
          "role": "dim",
          "sample": "west"
        },
        {
          "id": "city",
          "name": "도시",
          "type": "string",
          "role": "dim",
          "sample": "Sacramento, CA"
        },
        {
          "id": "grade",
          "name": "딜러 등급",
          "type": "string",
          "role": "status",
          "sample": "A"
        },
        {
          "id": "ssi_score",
          "name": "구매경험 점수",
          "type": "decimal",
          "role": "measure",
          "sample": "91.2"
        },
        {
          "id": "service_stalls",
          "name": "서비스 베이",
          "type": "int",
          "role": "measure",
          "unit": "개",
          "sample": "14"
        },
        {
          "id": "floorplan_line",
          "name": "재고금융 한도",
          "type": "int",
          "role": "measure",
          "unit": "USD",
          "sample": "18000000"
        }
      ],
      "mart": {
        "path": "data_new/ontology/objects/dealer.parquet",
        "sapSource": "KNA1",
        "level": "L2",
        "primaryKey": "object_id",
        "fields": [
          {
            "id": "object_id",
            "type": "VARCHAR"
          },
          {
            "id": "title",
            "type": "VARCHAR"
          },
          {
            "id": "zone_id",
            "type": "VARCHAR"
          },
          {
            "id": "country",
            "type": "VARCHAR"
          }
        ]
      }
    },
    {
      "id": "customer",
      "group": "care",
      "name": "고객",
      "en": "Customer",
      "abbr": "CU",
      "description": "차량 구매·운행 고객 (개인정보 익명화 ID). 소매·서비스 이력·커넥티드 동의의 주체.",
      "primaryKey": "customer_id",
      "titleKey": "customer_id",
      "datasource": {
        "status": "planned",
        "kind": "parquet",
        "path": "customer_master/",
        "grain": "고객 (익명 ID)",
        "note": "PII 비식별화 규칙 확정 후 마트 신설"
      },
      "properties": [
        {
          "id": "customer_id",
          "name": "고객 ID(익명)",
          "type": "string",
          "role": "key",
          "sample": "C-58201"
        },
        {
          "id": "zone_id",
          "name": "거주 지역",
          "type": "string",
          "role": "dim",
          "sample": "south"
        },
        {
          "id": "owned_since",
          "name": "보유 시작",
          "type": "date",
          "role": "dim",
          "sample": "2026-04-18"
        },
        {
          "id": "connected_optin",
          "name": "커넥티드 동의",
          "type": "bool",
          "role": "status",
          "sample": "true"
        }
      ]
    },
    {
      "id": "model",
      "group": "product",
      "name": "차종",
      "en": "Model",
      "abbr": "MD",
      "description": "판매 차종 6종. 주 생산 공장·세그먼트·MSRP·대당 마진을 보유한다.",
      "primaryKey": "model_id",
      "titleKey": "model_name",
      "datasource": {
        "status": "bound",
        "kind": "master",
        "path": "data/master/dim_model.csv",
        "grain": "차종"
      },
      "properties": [
        {
          "id": "model_id",
          "name": "차종 코드",
          "type": "string",
          "role": "key",
          "sample": "TRN"
        },
        {
          "id": "model_name",
          "name": "차종명",
          "type": "string",
          "role": "dim",
          "sample": "Terron"
        },
        {
          "id": "segment",
          "name": "세그먼트",
          "type": "string",
          "role": "dim",
          "sample": "대형 SUV"
        },
        {
          "id": "primary_plant_id",
          "name": "주 생산공장",
          "type": "string",
          "role": "dim",
          "sample": "US-GA"
        },
        {
          "id": "msrp_usd",
          "name": "MSRP",
          "type": "int",
          "role": "measure",
          "unit": "USD",
          "sample": "52000"
        },
        {
          "id": "unit_margin_usd",
          "name": "대당 마진",
          "type": "int",
          "role": "measure",
          "unit": "USD",
          "sample": "4600"
        },
        {
          "id": "is_ev",
          "name": "EV 여부",
          "type": "bool",
          "role": "dim",
          "sample": "0"
        }
      ],
      "mart": {
        "path": "data_new/ontology/objects/model.parquet",
        "sapSource": "MARA",
        "level": "L1",
        "primaryKey": "object_id",
        "fields": [
          {
            "id": "object_id",
            "type": "VARCHAR"
          },
          {
            "id": "title",
            "type": "VARCHAR"
          },
          {
            "id": "segment",
            "type": "VARCHAR"
          },
          {
            "id": "is_ev",
            "type": "BIGINT"
          }
        ]
      }
    },
    {
      "id": "trim",
      "group": "product",
      "name": "트림",
      "en": "Trim",
      "abbr": "TR",
      "description": "차종별 트림(18종). 믹스 가중치와 가격 계수(마진 동일 배율)를 보유한다.",
      "primaryKey": "trim_id",
      "titleKey": "trim_name",
      "datasource": {
        "status": "bound",
        "kind": "master",
        "path": "data/master/dim_trim.csv",
        "grain": "차종×트림"
      },
      "properties": [
        {
          "id": "trim_id",
          "name": "트림 코드",
          "type": "string",
          "role": "key",
          "sample": "TRN-PR"
        },
        {
          "id": "model_id",
          "name": "차종",
          "type": "string",
          "role": "dim",
          "sample": "TRN"
        },
        {
          "id": "trim_name",
          "name": "트림명",
          "type": "string",
          "role": "dim",
          "sample": "Prime"
        },
        {
          "id": "mix_weight",
          "name": "믹스 비중",
          "type": "decimal",
          "role": "measure",
          "sample": "0.44"
        },
        {
          "id": "msrp_factor",
          "name": "가격 계수",
          "type": "decimal",
          "role": "measure",
          "sample": "1.00"
        }
      ],
      "mart": {
        "path": "data_new/ontology/objects/trim.parquet",
        "sapSource": "MARA",
        "level": "L1",
        "primaryKey": "object_id",
        "fields": [
          {
            "id": "object_id",
            "type": "VARCHAR"
          },
          {
            "id": "title",
            "type": "VARCHAR"
          },
          {
            "id": "model_id",
            "type": "VARCHAR"
          },
          {
            "id": "msrp_usd",
            "type": "INTEGER"
          }
        ]
      }
    },
    {
      "id": "vehicle",
      "group": "product",
      "name": "차량 (VIN)",
      "en": "Vehicle",
      "abbr": "VN",
      "description": "온톨로지의 중심 객체. 생산→운송→검사→배분→도매→소매→운행의 전 수명주기 상태를 가지며, 모든 원장(매입·도매·소매·검사·정비·텔레매틱스)이 VIN으로 연결된다.",
      "primaryKey": "vin",
      "titleKey": "vin",
      "lifecycleRef": "vehicleLifecycle",
      "datasource": {
        "status": "bound",
        "kind": "parquet",
        "path": "data/vehicle_master/<생산YM>.csv",
        "grain": "VIN (1:50 샘플)",
        "note": "실환경: vehicle_master/scenario=base/month=YYYY-MM/*.parquet"
      },
      "properties": [
        {
          "id": "vin",
          "name": "차대번호",
          "type": "string",
          "role": "key",
          "sample": "VF3TCAAXTU0031245"
        },
        {
          "id": "model_id",
          "name": "차종",
          "type": "string",
          "role": "dim",
          "sample": "TRN"
        },
        {
          "id": "model_year",
          "name": "모델이어",
          "type": "int",
          "role": "dim",
          "sample": "2026"
        },
        {
          "id": "trim_id",
          "name": "트림",
          "type": "string",
          "role": "dim",
          "sample": "TRN-PR"
        },
        {
          "id": "engine",
          "name": "파워트레인",
          "type": "string",
          "role": "dim",
          "sample": "2.5T 하이브리드"
        },
        {
          "id": "drivetrain",
          "name": "구동",
          "type": "string",
          "role": "dim",
          "sample": "AWD"
        },
        {
          "id": "color",
          "name": "색상",
          "type": "string",
          "role": "dim",
          "sample": "스노우 화이트"
        },
        {
          "id": "plant_id",
          "name": "생산 공장",
          "type": "string",
          "role": "dim",
          "sample": "US-GA"
        },
        {
          "id": "prod_ym",
          "name": "생산월",
          "type": "string",
          "role": "dim",
          "sample": "2026-06"
        },
        {
          "id": "dest_zone_id",
          "name": "배정 지역",
          "type": "string",
          "role": "dim",
          "sample": "west"
        },
        {
          "id": "msrp_usd",
          "name": "MSRP",
          "type": "int",
          "role": "measure",
          "unit": "USD",
          "sample": "52000"
        },
        {
          "id": "state",
          "name": "수명주기 상태",
          "type": "string",
          "role": "status",
          "sample": "DEALER_STOCK",
          "note": "원장 이벤트에서 파생 — 최신 통과 게이트가 상태를 결정"
        }
      ],
      "mart": {
        "path": "data_new/ontology/objects/vehicle.parquet",
        "sapSource": "VLCVEHICLE",
        "level": "L3",
        "primaryKey": "object_id",
        "fields": [
          {
            "id": "object_id",
            "type": "VARCHAR"
          },
          {
            "id": "title",
            "type": "VARCHAR"
          },
          {
            "id": "model_id",
            "type": "VARCHAR"
          },
          {
            "id": "trim_id",
            "type": "VARCHAR"
          },
          {
            "id": "plant_id",
            "type": "VARCHAR"
          },
          {
            "id": "prod_ym",
            "type": "VARCHAR"
          },
          {
            "id": "prod_date",
            "type": "DATE"
          },
          {
            "id": "status",
            "type": "VARCHAR"
          },
          {
            "id": "dealer_id",
            "type": "VARCHAR"
          },
          {
            "id": "msrp_usd",
            "type": "INTEGER"
          }
        ]
      }
    },
    {
      "id": "businessPlan",
      "group": "plan",
      "name": "사업계획 (BP)",
      "en": "Business Plan",
      "abbr": "BP",
      "description": "연간 사업계획의 월 전개. 판매·도매·이익·CSI·재고일수 목표 — 모든 실적 비교의 기준선.",
      "primaryKey": "ym+model_id",
      "titleKey": "ym",
      "datasource": {
        "status": "bound",
        "kind": "parquet",
        "path": "data/bp_target/<YM>.csv",
        "grain": "월×차종 (48개월)"
      },
      "properties": [
        {
          "id": "ym",
          "name": "계획월",
          "type": "string",
          "role": "key",
          "sample": "2026-08"
        },
        {
          "id": "model_id",
          "name": "차종",
          "type": "string",
          "role": "key",
          "sample": "TRN"
        },
        {
          "id": "bp_retail_qty",
          "name": "계획 소매",
          "type": "int",
          "role": "measure",
          "unit": "대",
          "sample": "15900"
        },
        {
          "id": "bp_wholesale_qty",
          "name": "계획 도매",
          "type": "int",
          "role": "measure",
          "unit": "대",
          "sample": "16200"
        },
        {
          "id": "bp_op_profit_usd",
          "name": "계획 영업이익",
          "type": "int",
          "role": "measure",
          "unit": "USD",
          "sample": "52400000"
        },
        {
          "id": "bp_csi",
          "name": "계획 CSI",
          "type": "decimal",
          "role": "measure",
          "sample": "88.5"
        },
        {
          "id": "bp_ds_days",
          "name": "목표 재고일수",
          "type": "int",
          "role": "measure",
          "unit": "일",
          "sample": "60"
        }
      ]
    },
    {
      "id": "marketSnapshot",
      "group": "plan",
      "name": "시장 스냅샷",
      "en": "Market Snapshot",
      "abbr": "MS",
      "description": "외부 조사기관 구독 데이터의 월 스냅샷 — SAAR(연환산 시장 규모)·자사 점유율·SUV 세그 점유율·경쟁사 평균 인센티브·경쟁 런칭. 점유율 방어형 의사결정(경쟁·시장 축)의 데이터 실체이며 KPI-SHARE 의 외부 기준선이다.",
      "primaryKey": "snapshot_id",
      "titleKey": "snapshot_id",
      "datasource": {
        "status": "bound",
        "kind": "parquet",
        "path": "data_new/ontology/objects/marketSnapshot.parquet",
        "grain": "월 (마감월만 — L0 시점 규칙)",
        "note": "실환경: 조사기관 피드(S&P Mobility 등) 수신 테이블 → 월 스냅샷 적재"
      },
      "properties": [
        {
          "id": "snapshot_id",
          "name": "스냅샷 키",
          "type": "string",
          "role": "key",
          "sample": "MKT-2026-08"
        },
        {
          "id": "ym",
          "name": "월",
          "type": "string",
          "role": "dim",
          "sample": "2026-08"
        },
        {
          "id": "saar_units",
          "name": "SAAR(연환산)",
          "type": "int",
          "role": "measure",
          "unit": "대",
          "sample": "15180000"
        },
        {
          "id": "own_share_pct",
          "name": "자사 점유율",
          "type": "decimal",
          "role": "measure",
          "unit": "%",
          "sample": "8.62"
        },
        {
          "id": "seg_suv_share_pct",
          "name": "SUV 세그 점유율",
          "type": "decimal",
          "role": "measure",
          "unit": "%",
          "sample": "6.83"
        },
        {
          "id": "comp_avg_incentive_usd",
          "name": "경쟁 평균 인센티브",
          "type": "int",
          "role": "measure",
          "unit": "USD",
          "sample": "1946"
        },
        {
          "id": "comp_launch_cnt",
          "name": "경쟁 런칭 수",
          "type": "int",
          "role": "measure",
          "unit": "건",
          "sample": "0"
        }
      ],
      "mart": {
        "path": "data_new/ontology/objects/marketSnapshot.parquet",
        "sapSource": "외부 구독 피드 (비SAP)",
        "level": "L1",
        "primaryKey": "object_id",
        "fields": [
          {
            "id": "object_id",
            "type": "VARCHAR"
          },
          {
            "id": "title",
            "type": "VARCHAR"
          },
          {
            "id": "ym",
            "type": "VARCHAR"
          },
          {
            "id": "saar_units",
            "type": "INTEGER"
          },
          {
            "id": "own_share_pct",
            "type": "DOUBLE"
          },
          {
            "id": "seg_suv_share_pct",
            "type": "DOUBLE"
          },
          {
            "id": "comp_avg_incentive_usd",
            "type": "INTEGER"
          },
          {
            "id": "comp_launch_cnt",
            "type": "INTEGER"
          }
        ]
      }
    },
    {
      "id": "productionRequest",
      "group": "plan",
      "name": "생산 요청",
      "en": "Production Request",
      "abbr": "PO",
      "description": "판매법인이 매월 생산법인에 제출하는 발주. 목표 재고일수(DS)와 수요 전망을 근거로 차종×트림 수량을 확정한다 — 판매법인→생산법인 구매의 시작점.",
      "primaryKey": "request_id",
      "titleKey": "request_id",
      "datasource": {
        "status": "bound",
        "kind": "parquet",
        "path": "data/orders/<YM>.csv",
        "grain": "월×차종×트림",
        "note": "주문 데이터 미보유 구간은 도매 리드타임 역산 (estimated=1)"
      },
      "properties": [
        {
          "id": "request_id",
          "name": "요청 번호",
          "type": "string",
          "role": "key",
          "sample": "PR-2026-08-TRN"
        },
        {
          "id": "order_ym",
          "name": "발주월",
          "type": "string",
          "role": "dim",
          "sample": "2026-08"
        },
        {
          "id": "model_id",
          "name": "차종",
          "type": "string",
          "role": "dim",
          "sample": "TRN"
        },
        {
          "id": "trim_id",
          "name": "트림",
          "type": "string",
          "role": "dim",
          "sample": "TRN-PR"
        },
        {
          "id": "order_qty",
          "name": "발주 수량",
          "type": "int",
          "role": "measure",
          "unit": "대",
          "sample": "6900"
        },
        {
          "id": "target_ds_days",
          "name": "목표 DS",
          "type": "int",
          "role": "measure",
          "unit": "일",
          "sample": "60"
        },
        {
          "id": "status",
          "name": "상태",
          "type": "string",
          "role": "status",
          "sample": "CONFIRMED",
          "note": "DRAFT → SUBMITTED → CONFIRMED(생산법인 케파 확정) → IN_PRODUCTION → COMPLETED"
        },
        {
          "id": "estimated",
          "name": "역산 추정",
          "type": "bool",
          "role": "meta",
          "sample": "1"
        }
      ]
    },
    {
      "id": "allocation",
      "group": "plan",
      "name": "딜러 배분",
      "en": "Allocation",
      "abbr": "AL",
      "description": "생산 확정 물량을 미국 5개 지역→딜러로 배분하는 월 단위 의사결정. 지역 수요·딜러 실적·재고일수 기준 — 배분 결과가 운송 지시가 된다.",
      "primaryKey": "alloc_id",
      "titleKey": "alloc_id",
      "datasource": {
        "status": "planned",
        "kind": "parquet",
        "path": "allocation/<YM>.parquet",
        "grain": "월×딜러×차종",
        "note": "현재 vehicle_master.dest_zone_id로 지역 배정만 존재 — 딜러 그레인 배분 마트 신설 예정"
      },
      "properties": [
        {
          "id": "alloc_id",
          "name": "배분 번호",
          "type": "string",
          "role": "key",
          "sample": "AL-2026-08-D-W012-TRN"
        },
        {
          "id": "alloc_ym",
          "name": "배분월",
          "type": "string",
          "role": "dim",
          "sample": "2026-08"
        },
        {
          "id": "dealer_id",
          "name": "딜러",
          "type": "string",
          "role": "dim",
          "sample": "D-W012"
        },
        {
          "id": "model_id",
          "name": "차종",
          "type": "string",
          "role": "dim",
          "sample": "TRN"
        },
        {
          "id": "alloc_qty",
          "name": "배분 수량",
          "type": "int",
          "role": "measure",
          "unit": "대",
          "sample": "18"
        },
        {
          "id": "method",
          "name": "배분 방식",
          "type": "string",
          "role": "dim",
          "sample": "실적·DS 가중"
        },
        {
          "id": "status",
          "name": "상태",
          "type": "string",
          "role": "status",
          "sample": "CONFIRMED"
        }
      ]
    },
    {
      "id": "transportRoute",
      "group": "logistics",
      "name": "운송 루트",
      "en": "Transport Route",
      "abbr": "RT",
      "description": "공장→딜러 표준 운송 경로. 구간(leg) 분해와 총 리드타임 보유 — 해외 공장은 수출항·해상·수입항 경유, 내륙은 철도·트럭.",
      "primaryKey": "route_id",
      "titleKey": "route_id",
      "datasource": {
        "status": "bound",
        "kind": "master",
        "path": "data/master/dim_route.csv",
        "grain": "루트"
      },
      "properties": [
        {
          "id": "route_id",
          "name": "루트 코드",
          "type": "string",
          "role": "key",
          "sample": "KR1-W"
        },
        {
          "id": "plant_id",
          "name": "출발 공장",
          "type": "string",
          "role": "dim",
          "sample": "KR-1"
        },
        {
          "id": "legs",
          "name": "구간 분해",
          "type": "string",
          "role": "meta",
          "sample": "공장→국내수출항(2d)→해상(18d)→서부수입항(3d)→내륙철도(9d)"
        },
        {
          "id": "total_lead_days",
          "name": "총 리드타임",
          "type": "int",
          "role": "measure",
          "unit": "일",
          "sample": "32"
        }
      ]
    },
    {
      "id": "shipment",
      "group": "logistics",
      "name": "운송 배치",
      "en": "Shipment",
      "abbr": "SH",
      "description": "루트를 따라 이동하는 차량 묶음(선박 800대 / 철도·트럭 300대). 현재 구간·출발/도착 예정이 상태로 관리된다.",
      "primaryKey": "shipment_id",
      "titleKey": "shipment_id",
      "datasource": {
        "status": "derived",
        "kind": "parquet",
        "path": "data/logistics_intransit/<YM>.csv",
        "grain": "월×루트×차종 → 배치 전개",
        "note": "집계 마트에서 배치 단위로 전개 — 실환경은 배치 원장 직접 수신"
      },
      "properties": [
        {
          "id": "shipment_id",
          "name": "배치 번호",
          "type": "string",
          "role": "key",
          "sample": "SH-2026-08-KR1W-03"
        },
        {
          "id": "route_id",
          "name": "루트",
          "type": "string",
          "role": "dim",
          "sample": "KR1-W"
        },
        {
          "id": "mode",
          "name": "운송 수단",
          "type": "string",
          "role": "dim",
          "sample": "선박→철도",
          "note": "해상(선박) / 철도(autorack) / 트럭(car-hauler) 조합"
        },
        {
          "id": "vin_qty",
          "name": "적재 대수",
          "type": "int",
          "role": "measure",
          "unit": "대",
          "sample": "800"
        },
        {
          "id": "depart_date",
          "name": "출발일",
          "type": "date",
          "role": "dim",
          "sample": "2026-08-04"
        },
        {
          "id": "eta_date",
          "name": "도착 예정",
          "type": "date",
          "role": "dim",
          "sample": "2026-09-05"
        },
        {
          "id": "current_leg",
          "name": "현재 구간",
          "type": "string",
          "role": "status",
          "sample": "해상 (12/18일차)"
        },
        {
          "id": "status",
          "name": "상태",
          "type": "string",
          "role": "status",
          "sample": "IN_TRANSIT"
        }
      ],
      "mart": {
        "path": "data_new/ontology/objects/shipment.parquet",
        "sapSource": "LIKP/LIPS",
        "level": "L3",
        "primaryKey": "object_id",
        "fields": [
          {
            "id": "object_id",
            "type": "VARCHAR"
          },
          {
            "id": "title",
            "type": "VARCHAR"
          },
          {
            "id": "vin",
            "type": "VARCHAR"
          },
          {
            "id": "dealer_id",
            "type": "VARCHAR"
          },
          {
            "id": "ship_date",
            "type": "DATE"
          },
          {
            "id": "ym",
            "type": "VARCHAR"
          }
        ]
      }
    },
    {
      "id": "inspection",
      "group": "logistics",
      "name": "품질 검사",
      "en": "Inspection",
      "abbr": "IN",
      "description": "차량 상태가 전이될 때마다 수행하는 게이트 검사 — 문제없음을 기록해야 다음 단계로 전달된다. G1 공장 출하(PDI) / G2 항만 인수(VPC) / G3 딜러 인수 / G4 인도 전 점검(PDS).",
      "primaryKey": "inspection_id",
      "titleKey": "inspection_id",
      "datasource": {
        "status": "planned",
        "kind": "parquet",
        "path": "vin_inspection/<YM>.parquet",
        "grain": "VIN×게이트",
        "note": "검사 원장 마트 신설 예정 — 현재는 통과 이력을 상태 전이로만 유추"
      },
      "properties": [
        {
          "id": "inspection_id",
          "name": "검사 번호",
          "type": "string",
          "role": "key",
          "sample": "IN-VF3..1245-G2"
        },
        {
          "id": "vin",
          "name": "VIN",
          "type": "string",
          "role": "dim",
          "sample": "VF3TCAAXTU0031245"
        },
        {
          "id": "gate",
          "name": "게이트",
          "type": "string",
          "role": "dim",
          "sample": "G2-항만인수(VPC)",
          "note": "G1-공장출하(PDI) / G2-항만인수(VPC) / G3-딜러인수 / G4-인도전점검(PDS)"
        },
        {
          "id": "result",
          "name": "판정",
          "type": "string",
          "role": "status",
          "sample": "PASS",
          "note": "PASS(다음 단계 전달) / HOLD(보수 후 재검) / FAIL"
        },
        {
          "id": "inspector_org",
          "name": "검사 주체",
          "type": "string",
          "role": "dim",
          "sample": "수입항 VPC"
        },
        {
          "id": "found_issue",
          "name": "발견 사항",
          "type": "string",
          "role": "meta",
          "sample": "-"
        },
        {
          "id": "inspected_at",
          "name": "검사일",
          "type": "date",
          "role": "dim",
          "sample": "2026-08-25"
        }
      ]
    },
    {
      "id": "vehiclePurchase",
      "group": "commerce",
      "name": "법인간 매입",
      "en": "Intercompany Purchase",
      "abbr": "IC",
      "description": "판매법인이 생산법인으로부터 차량을 매입하는 거래(생산법인 관점의 판매). 이전가격 기준 — 도매 시 실현될 변동마진의 원가측 대응.",
      "primaryKey": "vin",
      "titleKey": "vin",
      "datasource": {
        "status": "derived",
        "kind": "parquet",
        "path": "vin_wholesale 역산 (transfer = 도매가 − 변동마진)",
        "grain": "VIN",
        "note": "실환경은 법인간 인보이스 원장 직접 수신 예정"
      },
      "properties": [
        {
          "id": "vin",
          "name": "VIN",
          "type": "string",
          "role": "key",
          "sample": "VF1LCABXTU0018872"
        },
        {
          "id": "seller_pc_id",
          "name": "판매 생산법인",
          "type": "string",
          "role": "dim",
          "sample": "PC-KR"
        },
        {
          "id": "buyer_sc_id",
          "name": "매입 판매법인",
          "type": "string",
          "role": "dim",
          "sample": "SC-US"
        },
        {
          "id": "transfer_price_usd",
          "name": "이전가격",
          "type": "int",
          "role": "measure",
          "unit": "USD",
          "sample": "38520"
        },
        {
          "id": "invoice_ym",
          "name": "인보이스월",
          "type": "string",
          "role": "dim",
          "sample": "2026-07"
        }
      ],
      "mart": {
        "path": "data_new/ontology/objects/vehiclePurchase.parquet",
        "sapSource": "EKKO/EKPO",
        "level": "L3",
        "primaryKey": "object_id",
        "fields": [
          {
            "id": "object_id",
            "type": "VARCHAR"
          },
          {
            "id": "title",
            "type": "VARCHAR"
          },
          {
            "id": "vin",
            "type": "VARCHAR"
          },
          {
            "id": "supplier_id",
            "type": "VARCHAR"
          },
          {
            "id": "purchase_price_usd",
            "type": "INTEGER"
          },
          {
            "id": "ym",
            "type": "VARCHAR"
          }
        ]
      }
    },
    {
      "id": "wholesale",
      "group": "commerce",
      "name": "도매 판매",
      "en": "Wholesale",
      "abbr": "WS",
      "description": "판매법인→딜러 판매(딜러 인수). 이 시점에 판매법인의 실질 판매 이익(변동마진)이 실현되고 차량은 딜러 재고가 된다.",
      "primaryKey": "vin",
      "titleKey": "vin",
      "datasource": {
        "status": "bound",
        "kind": "parquet",
        "path": "data/vin_wholesale/<YM>.csv",
        "grain": "VIN (1:50 샘플)"
      },
      "properties": [
        {
          "id": "vin",
          "name": "VIN",
          "type": "string",
          "role": "key",
          "sample": "VF3TCAAXTU0031245"
        },
        {
          "id": "ws_ym",
          "name": "도매월",
          "type": "string",
          "role": "dim",
          "sample": "2026-08"
        },
        {
          "id": "zone_id",
          "name": "인수 지역",
          "type": "string",
          "role": "dim",
          "sample": "south"
        },
        {
          "id": "wholesale_price_usd",
          "name": "도매가",
          "type": "int",
          "role": "measure",
          "unit": "USD",
          "sample": "50440"
        },
        {
          "id": "variable_margin_usd",
          "name": "변동마진",
          "type": "int",
          "role": "measure",
          "unit": "USD",
          "sample": "4624"
        },
        {
          "id": "freight_usd",
          "name": "운송비",
          "type": "int",
          "role": "measure",
          "unit": "USD",
          "sample": "380"
        }
      ],
      "mart": {
        "path": "data_new/ontology/objects/wholesale.parquet",
        "sapSource": "VBAK/VBAP+VBRK/VBRP",
        "level": "L3",
        "primaryKey": "object_id",
        "fields": [
          {
            "id": "object_id",
            "type": "VARCHAR"
          },
          {
            "id": "title",
            "type": "VARCHAR"
          },
          {
            "id": "vin",
            "type": "VARCHAR"
          },
          {
            "id": "dealer_id",
            "type": "VARCHAR"
          },
          {
            "id": "wholesale_price_usd",
            "type": "INTEGER"
          },
          {
            "id": "invoice_id",
            "type": "VARCHAR"
          },
          {
            "id": "invoice_date",
            "type": "DATE"
          },
          {
            "id": "ym",
            "type": "VARCHAR"
          }
        ]
      }
    },
    {
      "id": "retailSale",
      "group": "commerce",
      "name": "소매 판매",
      "en": "Retail Sale",
      "abbr": "RS",
      "description": "딜러→고객 판매. 실거래가 = MSRP − 인센티브. 소매 속도가 도매(딜러 발주)를 견인하므로 판매법인은 인센티브로 소매를 가속한다.",
      "primaryKey": "vin",
      "titleKey": "vin",
      "datasource": {
        "status": "bound",
        "kind": "parquet",
        "path": "data/vin_retail/<YM>.csv",
        "grain": "VIN (1:50 샘플)"
      },
      "properties": [
        {
          "id": "vin",
          "name": "VIN",
          "type": "string",
          "role": "key",
          "sample": "VF3TCAAXTU0031245"
        },
        {
          "id": "retail_ym",
          "name": "소매월",
          "type": "string",
          "role": "dim",
          "sample": "2026-08"
        },
        {
          "id": "retail_date",
          "name": "소매일",
          "type": "date",
          "role": "dim",
          "sample": "2026-08-14"
        },
        {
          "id": "zone_id",
          "name": "지역",
          "type": "string",
          "role": "dim",
          "sample": "south"
        },
        {
          "id": "channel",
          "name": "채널",
          "type": "string",
          "role": "dim",
          "sample": "retail"
        },
        {
          "id": "txn_price_usd",
          "name": "실거래가",
          "type": "int",
          "role": "measure",
          "unit": "USD",
          "sample": "50825"
        },
        {
          "id": "incentive_usd",
          "name": "적용 인센티브",
          "type": "int",
          "role": "measure",
          "unit": "USD",
          "sample": "1175"
        }
      ],
      "mart": {
        "path": "data_new/ontology/objects/retailSale.parquet",
        "sapSource": "ZSD_RDR (딜러 DMS 인터페이스)",
        "level": "L3",
        "primaryKey": "object_id",
        "fields": [
          {
            "id": "object_id",
            "type": "VARCHAR"
          },
          {
            "id": "title",
            "type": "VARCHAR"
          },
          {
            "id": "vin",
            "type": "VARCHAR"
          },
          {
            "id": "dealer_id",
            "type": "VARCHAR"
          },
          {
            "id": "customer_id",
            "type": "VARCHAR"
          },
          {
            "id": "retail_date",
            "type": "DATE"
          },
          {
            "id": "retail_price_usd",
            "type": "INTEGER"
          },
          {
            "id": "incentive_usd",
            "type": "INTEGER"
          },
          {
            "id": "ym",
            "type": "VARCHAR"
          }
        ]
      }
    },
    {
      "id": "incentiveProgram",
      "group": "commerce",
      "name": "인센티브 프로그램",
      "en": "Incentive Program",
      "abbr": "IP",
      "description": "Retail 가속 레버. 고객 현금(customer cash)·저리 할부(APR)·리스 지원·딜러 캐시 유형 — 대당 금액과 기간·대상 사양을 관리한다.",
      "primaryKey": "program_id",
      "titleKey": "program_name",
      "datasource": {
        "status": "bound",
        "kind": "parquet",
        "path": "data/price_incentive/<YM>.csv",
        "grain": "월×차종×트림"
      },
      "properties": [
        {
          "id": "program_id",
          "name": "프로그램 ID",
          "type": "string",
          "role": "key",
          "sample": "IP-2608-MRD-CASH"
        },
        {
          "id": "program_name",
          "name": "프로그램명",
          "type": "string",
          "role": "dim",
          "sample": "Meridian 재고 소진 캐시"
        },
        {
          "id": "incentive_type",
          "name": "유형",
          "type": "string",
          "role": "dim",
          "sample": "customer cash",
          "note": "customer cash / APR 지원 / 리스 지원 / dealer cash"
        },
        {
          "id": "model_id",
          "name": "대상 차종",
          "type": "string",
          "role": "dim",
          "sample": "MRD"
        },
        {
          "id": "amount_usd",
          "name": "대당 금액",
          "type": "int",
          "role": "measure",
          "unit": "USD",
          "sample": "700"
        },
        {
          "id": "start_ym",
          "name": "시작월",
          "type": "string",
          "role": "dim",
          "sample": "2025-08"
        },
        {
          "id": "end_ym",
          "name": "종료월",
          "type": "string",
          "role": "dim",
          "sample": "2025-11"
        },
        {
          "id": "status",
          "name": "상태",
          "type": "string",
          "role": "status",
          "sample": "CLOSED"
        }
      ]
    },
    {
      "id": "marketingCampaign",
      "group": "commerce",
      "name": "마케팅 캠페인",
      "en": "Marketing Campaign",
      "abbr": "MK",
      "description": "수요 창출 활동 (media/digital/event). 2층 구조 — 판매법인이 브랜드(전 차종) → 차종 순으로 집행하고, 딜러는 지역 광고(tier=dealer_local)를 집행한다(협력광고 co-op 분담). 광고 잔존효과(adstock 0.5)·로그 체감으로 수요에 반영.",
      "primaryKey": "campaign_id",
      "titleKey": "campaign_name",
      "datasource": {
        "status": "bound",
        "kind": "parquet",
        "path": "data/marketing_spend/<YM>.csv",
        "grain": "월×차종",
        "note": "딜러 지역 광고(tier=dealer_local)는 co-op 정산 원장 신설로 확장 예정"
      },
      "properties": [
        {
          "id": "campaign_id",
          "name": "캠페인 ID",
          "type": "string",
          "role": "key",
          "sample": "MK-2608-TRN"
        },
        {
          "id": "campaign_name",
          "name": "캠페인명",
          "type": "string",
          "role": "dim",
          "sample": "Terron 하계 브랜드 캠페인"
        },
        {
          "id": "tier",
          "name": "집행 레벨",
          "type": "string",
          "role": "dim",
          "sample": "brand | model | dealer_local"
        },
        {
          "id": "model_id",
          "name": "대상 차종",
          "type": "string",
          "role": "dim",
          "sample": "TRN (brand 티어는 전 차종)"
        },
        {
          "id": "dealer_id",
          "name": "집행 딜러",
          "type": "string",
          "role": "dim",
          "sample": "D-S012 (dealer_local만)"
        },
        {
          "id": "zone_id",
          "name": "대상 지역",
          "type": "string",
          "role": "dim",
          "sample": "south (dealer_local만)"
        },
        {
          "id": "coop_rate",
          "name": "co-op 분담률",
          "type": "decimal",
          "role": "measure",
          "sample": "0.5 — 판매법인 상환 비율"
        },
        {
          "id": "channel",
          "name": "채널 믹스",
          "type": "string",
          "role": "dim",
          "sample": "media 55% · digital 35% · event 10%"
        },
        {
          "id": "spend_musd",
          "name": "집행액",
          "type": "decimal",
          "role": "measure",
          "unit": "M USD",
          "sample": "11.6"
        },
        {
          "id": "ym",
          "name": "집행월",
          "type": "string",
          "role": "dim",
          "sample": "2026-08"
        }
      ]
    },
    {
      "id": "repairOrder",
      "group": "care",
      "name": "정비 오더 (RO)",
      "en": "Repair Order",
      "abbr": "RO",
      "description": "딜러 서비스 입고 단위. 지불 유형 3종 — 워런티(판매법인 부담)·캠페인(리콜/FSC)·고객 페이. 예약 지연일이 내부 CSI 서비스 점수와 연동된다.",
      "primaryKey": "ro_id",
      "titleKey": "ro_id",
      "datasource": {
        "status": "planned",
        "kind": "parquet",
        "path": "vin_service/<YM>.parquet",
        "grain": "RO (VIN×입고)",
        "note": "현재 service_quality 집계(월×지역×차종)만 존재 — RO 원장 신설 예정"
      },
      "properties": [
        {
          "id": "ro_id",
          "name": "RO 번호",
          "type": "string",
          "role": "key",
          "sample": "RO-D-S044-260812-07"
        },
        {
          "id": "vin",
          "name": "VIN",
          "type": "string",
          "role": "dim",
          "sample": "VF5MCACXTU0009917"
        },
        {
          "id": "dealer_id",
          "name": "딜러",
          "type": "string",
          "role": "dim",
          "sample": "D-S044"
        },
        {
          "id": "pay_type",
          "name": "지불 유형",
          "type": "string",
          "role": "dim",
          "sample": "warranty",
          "note": "warranty / campaign / customer_pay"
        },
        {
          "id": "component",
          "name": "작업 부위",
          "type": "string",
          "role": "dim",
          "sample": "인포테인먼트"
        },
        {
          "id": "labor_usd",
          "name": "공임",
          "type": "int",
          "role": "measure",
          "unit": "USD",
          "sample": "240"
        },
        {
          "id": "parts_usd",
          "name": "부품비",
          "type": "int",
          "role": "measure",
          "unit": "USD",
          "sample": "385"
        },
        {
          "id": "booking_delay_days",
          "name": "예약 지연",
          "type": "int",
          "role": "measure",
          "unit": "일",
          "sample": "4"
        },
        {
          "id": "opened_at",
          "name": "입고일",
          "type": "date",
          "role": "dim",
          "sample": "2026-08-12"
        },
        {
          "id": "status",
          "name": "상태",
          "type": "string",
          "role": "status",
          "sample": "CLOSED"
        }
      ]
    },
    {
      "id": "warrantyClaim",
      "group": "care",
      "name": "워런티 클레임",
      "en": "Warranty Claim",
      "abbr": "WC",
      "description": "워런티·캠페인 RO에 대한 딜러→판매법인 정산 청구. 승인 시 품질비로 인식 — 클레임률이 내부 CSI 품질 점수와 연동된다.",
      "primaryKey": "claim_id",
      "titleKey": "claim_id",
      "datasource": {
        "status": "planned",
        "kind": "parquet",
        "path": "warranty_claim/<YM>.parquet",
        "grain": "클레임 (RO 1:1)",
        "note": "집계는 financials_pnl.quality_cost_usd·service_quality로 존재"
      },
      "properties": [
        {
          "id": "claim_id",
          "name": "클레임 번호",
          "type": "string",
          "role": "key",
          "sample": "WC-RO-D-S044-260812-07"
        },
        {
          "id": "ro_id",
          "name": "RO",
          "type": "string",
          "role": "dim",
          "sample": "RO-D-S044-260812-07"
        },
        {
          "id": "claim_usd",
          "name": "청구액",
          "type": "int",
          "role": "measure",
          "unit": "USD",
          "sample": "625"
        },
        {
          "id": "decision",
          "name": "심사 결과",
          "type": "string",
          "role": "status",
          "sample": "APPROVED"
        },
        {
          "id": "paid_ym",
          "name": "지급월",
          "type": "string",
          "role": "dim",
          "sample": "2026-09"
        }
      ],
      "mart": {
        "path": "data_new/ontology/objects/warrantyClaim.parquet",
        "sapSource": "QMEL (QMART=Q1)",
        "level": "L3",
        "primaryKey": "object_id",
        "fields": [
          {
            "id": "object_id",
            "type": "VARCHAR"
          },
          {
            "id": "title",
            "type": "VARCHAR"
          },
          {
            "id": "vin",
            "type": "VARCHAR"
          },
          {
            "id": "dealer_id",
            "type": "VARCHAR"
          },
          {
            "id": "defect_group",
            "type": "VARCHAR"
          },
          {
            "id": "claim_amount_usd",
            "type": "INTEGER"
          },
          {
            "id": "claim_status",
            "type": "VARCHAR"
          },
          {
            "id": "created_date",
            "type": "DATE"
          },
          {
            "id": "ym",
            "type": "VARCHAR"
          }
        ]
      }
    },
    {
      "id": "vocTicket",
      "group": "care",
      "name": "VoC 티켓",
      "en": "Voice of Customer",
      "abbr": "VC",
      "description": "고객의 소리 — 콜센터·딜러·앱·이메일로 접수되는 불만/문의/제안. LLM 분류기가 표준 분류체계(소셜 포스트와 동일 taxonomy)로 자동 분류하고 매일 모니터링된다.",
      "primaryKey": "voc_id",
      "titleKey": "voc_id",
      "datasource": {
        "status": "planned",
        "kind": "stream→parquet",
        "path": "voc_ticket/<YM>.parquet",
        "grain": "티켓",
        "note": "콜센터 CTI·딜러 DMS·앱 인입 통합 — 분류 결과 컬럼 포함 적재"
      },
      "properties": [
        {
          "id": "voc_id",
          "name": "티켓 ID",
          "type": "string",
          "role": "key",
          "sample": "VOC-2608-01184"
        },
        {
          "id": "customer_id",
          "name": "고객",
          "type": "string",
          "role": "dim",
          "sample": "C-58214"
        },
        {
          "id": "vin",
          "name": "VIN",
          "type": "string",
          "role": "dim",
          "sample": "VF1LCABXTU0018872"
        },
        {
          "id": "channel",
          "name": "접수 채널",
          "type": "string",
          "role": "dim",
          "sample": "call | dealer | app | email"
        },
        {
          "id": "category",
          "name": "표준 분류",
          "type": "string",
          "role": "dim",
          "sample": "품질-커넥티드SW",
          "note": "소셜 포스트와 공용 분류체계 — 통합 분석의 조인 키"
        },
        {
          "id": "sentiment",
          "name": "감성",
          "type": "string",
          "role": "dim",
          "sample": "NEG"
        },
        {
          "id": "severity",
          "name": "심각도",
          "type": "string",
          "role": "status",
          "sample": "HIGH"
        },
        {
          "id": "status",
          "name": "처리 상태",
          "type": "string",
          "role": "status",
          "sample": "CLASSIFIED"
        },
        {
          "id": "opened_at",
          "name": "접수일",
          "type": "date",
          "role": "dim",
          "sample": "2026-08-11"
        },
        {
          "id": "issue_id",
          "name": "연계 이슈",
          "type": "string",
          "role": "dim",
          "sample": "QI-2605-LUM-CONN (승격 시)"
        }
      ],
      "mart": {
        "path": "data_new/ontology/objects/vocTicket.parquet",
        "sapSource": "QMEL (QMART=Z1)",
        "level": "L3",
        "primaryKey": "object_id",
        "fields": [
          {
            "id": "object_id",
            "type": "VARCHAR"
          },
          {
            "id": "title",
            "type": "VARCHAR"
          },
          {
            "id": "vin",
            "type": "VARCHAR"
          },
          {
            "id": "dealer_id",
            "type": "VARCHAR"
          },
          {
            "id": "defect_group",
            "type": "VARCHAR"
          },
          {
            "id": "created_date",
            "type": "DATE"
          },
          {
            "id": "ym",
            "type": "VARCHAR"
          }
        ]
      }
    },
    {
      "id": "socialPost",
      "group": "care",
      "name": "소셜 포스트",
      "en": "Social Post",
      "abbr": "SP",
      "description": "소셜 미디어·커뮤니티의 자사 차량 관련 발화 수집. VoC와 동일한 표준 분류체계로 자동 분류되어 감성·화제 트렌드와 품질 조기 신호를 제공한다.",
      "primaryKey": "post_id",
      "titleKey": "post_id",
      "datasource": {
        "status": "planned",
        "kind": "stream→parquet",
        "path": "social_listening/<YM>.parquet",
        "grain": "포스트",
        "note": "소셜 리스닝 수집기 — 분류·감성 스코어링 후 적재"
      },
      "properties": [
        {
          "id": "post_id",
          "name": "포스트 ID",
          "type": "string",
          "role": "key",
          "sample": "SP-2608-84120"
        },
        {
          "id": "platform",
          "name": "플랫폼",
          "type": "string",
          "role": "dim",
          "sample": "X | reddit | youtube | forum"
        },
        {
          "id": "model_id",
          "name": "언급 차종",
          "type": "string",
          "role": "dim",
          "sample": "LUM"
        },
        {
          "id": "category",
          "name": "표준 분류",
          "type": "string",
          "role": "dim",
          "sample": "품질-커넥티드SW",
          "note": "VoC 티켓과 공용 분류체계 — 통합 분석의 조인 키"
        },
        {
          "id": "sentiment",
          "name": "감성",
          "type": "string",
          "role": "dim",
          "sample": "NEG"
        },
        {
          "id": "engagement",
          "name": "반응 지수",
          "type": "int",
          "role": "measure",
          "sample": "480"
        },
        {
          "id": "posted_at",
          "name": "작성일",
          "type": "date",
          "role": "dim",
          "sample": "2026-08-09"
        },
        {
          "id": "issue_id",
          "name": "연계 이슈",
          "type": "string",
          "role": "dim",
          "sample": "QI-2605-LUM-CONN (승격 시)"
        }
      ]
    },
    {
      "id": "telematicsEvent",
      "group": "quality",
      "name": "텔레매틱스 이벤트",
      "en": "Telematics Event",
      "abbr": "TE",
      "description": "고객 차량(커넥티드 동의)에서 수집되는 텔레매틱스 데이터. 이상 신호(DTC)만이 아니라 주행 기록(Trip)·주행 통계·충전 등 카테고리가 다양하다 — 품질 조기 탐지·안전 대응·이용 패턴 분석의 입력. (용어: 자동차 업계 표준은 telemetry가 아닌 telematics)",
      "primaryKey": "event_id",
      "titleKey": "event_id",
      "datasource": {
        "status": "planned",
        "kind": "stream→parquet",
        "path": "telematics_event/<YM>.parquet",
        "grain": "이벤트 (VIN×시각)",
        "note": "스트림 수신 후 월 파티션 적재 — 집계는 csi_internal.score_connected로 연동"
      },
      "properties": [
        {
          "id": "event_id",
          "name": "이벤트 ID",
          "type": "string",
          "role": "key",
          "sample": "TE-260810-004417"
        },
        {
          "id": "vin",
          "name": "VIN",
          "type": "string",
          "role": "dim",
          "sample": "VF1LCABXTU0018872"
        },
        {
          "id": "ts",
          "name": "발생 시각",
          "type": "datetime",
          "role": "dim",
          "sample": "2026-08-10T14:22:05Z"
        },
        {
          "id": "data_category",
          "name": "데이터 카테고리",
          "type": "string",
          "role": "dim",
          "sample": "trip",
          "note": "dtc(이상 신호) / trip(주행 기록) / drive_stat(주행 통계) / charging(충전)"
        },
        {
          "id": "dtc_code",
          "name": "DTC 코드",
          "type": "string",
          "role": "dim",
          "sample": "U3100-17 (dtc만)"
        },
        {
          "id": "trip_km",
          "name": "주행 거리",
          "type": "decimal",
          "role": "measure",
          "unit": "km",
          "sample": "23.4 (trip만)"
        },
        {
          "id": "trip_min",
          "name": "주행 시간",
          "type": "int",
          "role": "measure",
          "unit": "분",
          "sample": "38 (trip만)"
        },
        {
          "id": "dest_lat",
          "name": "도착지 위도",
          "type": "decimal",
          "role": "dim",
          "sample": "32.78 (trip만)"
        },
        {
          "id": "dest_lon",
          "name": "도착지 경도",
          "type": "decimal",
          "role": "dim",
          "sample": "-96.80 (trip만)"
        },
        {
          "id": "dest_h3_r7",
          "name": "도착지 H3(r7)",
          "type": "string",
          "role": "dim",
          "sample": "87446ca11ffffff — GPS→H3 변환 파생"
        },
        {
          "id": "severity",
          "name": "심각도",
          "type": "string",
          "role": "status",
          "sample": "MEDIUM",
          "note": "SAFETY(즉시 대응) / HIGH / MEDIUM / LOW — dtc 카테고리만"
        },
        {
          "id": "triage_status",
          "name": "트리아지",
          "type": "string",
          "role": "status",
          "sample": "LINKED_TO_ISSUE"
        }
      ]
    },
    {
      "id": "qualityIssue",
      "group": "quality",
      "name": "품질 이슈",
      "en": "Quality Issue",
      "abbr": "QI",
      "description": "텔레매틱스·클레임·VoC·소셜 신호를 클러스터링해 오픈하는 이슈. 안전성 평가 → 시정 방식(OTA/입고 수리) 결정 → 개선 활동 발령의 허브.",
      "primaryKey": "issue_id",
      "titleKey": "issue_name",
      "datasource": {
        "status": "derived",
        "kind": "parquet",
        "path": "텔레매틱스·클레임·VoC·소셜 클러스터링 산출",
        "grain": "이슈"
      },
      "properties": [
        {
          "id": "issue_id",
          "name": "이슈 ID",
          "type": "string",
          "role": "key",
          "sample": "QI-2605-LUM-CONN"
        },
        {
          "id": "issue_name",
          "name": "이슈명",
          "type": "string",
          "role": "dim",
          "sample": "Lumen EV 커넥티드 SW 결함"
        },
        {
          "id": "model_id",
          "name": "차종",
          "type": "string",
          "role": "dim",
          "sample": "LUM"
        },
        {
          "id": "component",
          "name": "부위",
          "type": "string",
          "role": "dim",
          "sample": "connected"
        },
        {
          "id": "detect_source",
          "name": "탐지 경로",
          "type": "string",
          "role": "dim",
          "sample": "텔레매틱스 DTC 급증 + 클레임"
        },
        {
          "id": "safety_flag",
          "name": "안전 관련",
          "type": "bool",
          "role": "status",
          "sample": "false"
        },
        {
          "id": "claim_per_1k",
          "name": "클레임률",
          "type": "decimal",
          "role": "measure",
          "unit": "/1000대",
          "sample": "8.5"
        },
        {
          "id": "status",
          "name": "상태",
          "type": "string",
          "role": "status",
          "sample": "REMEDY_DEPLOYED"
        }
      ]
    },
    {
      "id": "qualityCampaign",
      "group": "quality",
      "name": "품질 개선 활동",
      "en": "Quality Campaign",
      "abbr": "QC",
      "description": "품질 이슈 시정 활동 — OTA 배포·서비스 캠페인(FSC)·리콜. 적용 누계에 따라 클레임이 소멸하고 내부 CSI가 회복된다 (csi_actions 원장).",
      "primaryKey": "project_id",
      "titleKey": "project_name",
      "datasource": {
        "status": "bound",
        "kind": "parquet",
        "path": "data/csi_actions/<YM>.csv",
        "grain": "월×프로젝트"
      },
      "properties": [
        {
          "id": "project_id",
          "name": "프로젝트 ID",
          "type": "string",
          "role": "key",
          "sample": "OTA-2606-LUM"
        },
        {
          "id": "project_name",
          "name": "활동명",
          "type": "string",
          "role": "dim",
          "sample": "커넥티드 SW 결함 OTA 시정"
        },
        {
          "id": "remedy_type",
          "name": "시정 방식",
          "type": "string",
          "role": "dim",
          "sample": "OTA",
          "note": "OTA / FSC(서비스 캠페인) / RECALL"
        },
        {
          "id": "model_id",
          "name": "대상 차종",
          "type": "string",
          "role": "dim",
          "sample": "LUM"
        },
        {
          "id": "component",
          "name": "부위",
          "type": "string",
          "role": "dim",
          "sample": "connected"
        },
        {
          "id": "target_vins",
          "name": "대상 대수",
          "type": "int",
          "role": "measure",
          "unit": "대",
          "sample": "10000"
        },
        {
          "id": "applied_vins_cum",
          "name": "적용 누계",
          "type": "int",
          "role": "measure",
          "unit": "대",
          "sample": "9500"
        },
        {
          "id": "claim_per_1k_before",
          "name": "클레임률(전)",
          "type": "decimal",
          "role": "measure",
          "sample": "8.5"
        },
        {
          "id": "claim_per_1k_now",
          "name": "클레임률(현재)",
          "type": "decimal",
          "role": "measure",
          "sample": "0.4"
        },
        {
          "id": "score_impact",
          "name": "CSI 기여",
          "type": "decimal",
          "role": "measure",
          "unit": "pt",
          "sample": "+17.8"
        }
      ]
    },
    {
      "id": "featureUsageEvent",
      "group": "quality",
      "name": "차량 기능 사용",
      "en": "Feature Usage",
      "abbr": "FU",
      "description": "커넥티드 차량의 기능 사용·신호 월 스냅샷 — HDA(고속도로 주행 보조) 사용률, 트레일러 모드, FOTA 설치율, 커넥티드 옵트인, DTC/1k, 월 Trip. KPI(CS·브랜드·VoC)에 영향을 주는 드라이버 후보이자 예측 모델의 학습 피처.",
      "primaryKey": "usage_key",
      "titleKey": "usage_key",
      "datasource": {
        "status": "bound",
        "kind": "parquet",
        "path": "data/feature_usage/<YM>.csv",
        "grain": "월×차종"
      },
      "properties": [
        {
          "id": "usage_key",
          "name": "스냅샷 키",
          "type": "string",
          "role": "key",
          "sample": "FU-2026-08-LUM"
        },
        {
          "id": "ym",
          "name": "월",
          "type": "string",
          "role": "dim",
          "sample": "2026-08"
        },
        {
          "id": "model_id",
          "name": "차종",
          "type": "string",
          "role": "dim",
          "sample": "LUM"
        },
        {
          "id": "hda_usage_pct",
          "name": "HDA 사용률",
          "type": "decimal",
          "role": "measure",
          "unit": "%",
          "sample": "53.3"
        },
        {
          "id": "trailer_mode_pct",
          "name": "트레일러 모드",
          "type": "decimal",
          "role": "measure",
          "unit": "%",
          "sample": "1.0"
        },
        {
          "id": "fota_install_pct",
          "name": "FOTA 설치율",
          "type": "decimal",
          "role": "measure",
          "unit": "%",
          "sample": "92.9"
        },
        {
          "id": "connected_optin_pct",
          "name": "커넥티드 옵트인",
          "type": "decimal",
          "role": "measure",
          "unit": "%",
          "sample": "81.7"
        },
        {
          "id": "dtc_per_1k",
          "name": "DTC/1k",
          "type": "decimal",
          "role": "measure",
          "unit": "/1k",
          "sample": "6.4"
        },
        {
          "id": "trips_per_vehicle",
          "name": "월 Trip/대",
          "type": "decimal",
          "role": "measure",
          "unit": "회",
          "sample": "35.4"
        }
      ]
    },
    {
      "id": "mlModel",
      "group": "quality",
      "name": "학습 모델",
      "en": "ML Model",
      "abbr": "ML",
      "description": "온톨로지 마트(실적·차량 신호)를 학습한 모델 레지스트리 — KPI 시계열 예측, KPI 드라이버(피처 중요도) 발굴. 전략 레버가 주입하는 가상 데이터를 입력으로 미래를 재생성한다. 학습 가능 상태 = 마트가 온톨로지에 bound로 선언되어 있어야 한다.",
      "primaryKey": "ml_model_id",
      "titleKey": "ml_name",
      "datasource": {
        "status": "derived",
        "kind": "derived",
        "path": "(파생) feature_usage × telematics × agg_kpi 조인 학습 산출",
        "grain": "모델 버전"
      },
      "properties": [
        {
          "id": "ml_model_id",
          "name": "모델 ID",
          "type": "string",
          "role": "key",
          "sample": "ML-KPI-FCST-V0"
        },
        {
          "id": "ml_name",
          "name": "모델명",
          "type": "string",
          "role": "dim",
          "sample": "KPI 시계열 예측 v0"
        },
        {
          "id": "task",
          "name": "태스크",
          "type": "string",
          "role": "dim",
          "sample": "forecast"
        },
        {
          "id": "algo",
          "name": "알고리즘",
          "type": "string",
          "role": "dim",
          "sample": "시즌 지수 + 선형 추세"
        },
        {
          "id": "target",
          "name": "타깃",
          "type": "string",
          "role": "dim",
          "sample": "회사 KPI 14종"
        },
        {
          "id": "train_window",
          "name": "학습 구간",
          "type": "string",
          "role": "dim",
          "sample": "2024-01~2026-08 (32개월)"
        },
        {
          "id": "quality_metric",
          "name": "검증 지표",
          "type": "string",
          "role": "measure",
          "sample": "MAPE 6.2% (홀드아웃 6개월)"
        },
        {
          "id": "status",
          "name": "상태",
          "type": "string",
          "role": "status",
          "sample": "serving"
        }
      ]
    }
  ],
  "linkTypes": [
    {
      "id": "pcOwnsPlant",
      "name": "운영",
      "from": "productionCompany",
      "to": "plant",
      "card": "1:N",
      "fk": "plant.owner_pc_id",
      "desc": "생산법인이 공장을 운영"
    },
    {
      "id": "scBuysFromPc",
      "name": "매입처",
      "from": "salesCompany",
      "to": "productionCompany",
      "card": "N:M",
      "fk": "vehiclePurchase(seller,buyer)",
      "desc": "판매법인 ↔ 생산법인 매매 관계 (법인간 매입으로 실체화)"
    },
    {
      "id": "dealerInZone",
      "name": "관할 사무소",
      "from": "dealer",
      "to": "salesZone",
      "card": "N:1",
      "fk": "dealer.zone_id",
      "desc": "딜러는 5개 지역사무소 중 한 곳의 관할",
      "mart": {
        "path": "data_new/ontology/links/dealerInZone.parquet",
        "fields": [
          {
            "id": "from_id",
            "type": "VARCHAR"
          },
          {
            "id": "to_id",
            "type": "VARCHAR"
          }
        ]
      }
    },
    {
      "id": "zoneOfficeOfSc",
      "name": "소속 법인",
      "from": "salesZone",
      "to": "salesCompany",
      "card": "N:1",
      "fk": "salesZone.sc_id (파생 — 단일 법인)",
      "desc": "지역사무소는 판매법인의 지역 조직 — 딜러 관리·배분·지역 마케팅의 현장 주체"
    },
    {
      "id": "scOperatesFacility",
      "name": "운영 시설",
      "from": "facility",
      "to": "salesCompany",
      "card": "N:1",
      "fk": "facility.sc_id (파생 — 단일 법인)",
      "desc": "판매법인이 운영하는 캠퍼스 건물 — 관리비 발생 주체 (경상이익률 다운스트림)"
    },
    {
      "id": "meterOfFacility",
      "name": "계측 시설",
      "from": "energyMeter",
      "to": "facility",
      "card": "N:1",
      "fk": "energyMeter.facility_id",
      "desc": "층별 전력 계측점의 소속 건물 — facility_energy 마트의 그레인"
    },
    {
      "id": "scManagesDealer",
      "name": "딜러 관리",
      "from": "salesCompany",
      "to": "dealer",
      "card": "1:N",
      "fk": "dealer.sc_id",
      "desc": "계약·평가·배분·인센티브의 관리 주체",
      "mart": {
        "path": "data_new/ontology/links/scManagesDealer.parquet",
        "fields": [
          {
            "id": "from_id",
            "type": "VARCHAR"
          },
          {
            "id": "to_id",
            "type": "VARCHAR"
          }
        ]
      }
    },
    {
      "id": "trimOfModel",
      "name": "트림 구성",
      "from": "trim",
      "to": "model",
      "card": "N:1",
      "fk": "trim.model_id",
      "desc": "",
      "mart": {
        "path": "data_new/ontology/links/trimOfModel.parquet",
        "fields": [
          {
            "id": "from_id",
            "type": "VARCHAR"
          },
          {
            "id": "to_id",
            "type": "VARCHAR"
          }
        ]
      }
    },
    {
      "id": "vehicleModel",
      "name": "차종",
      "from": "vehicle",
      "to": "model",
      "card": "N:1",
      "fk": "vehicle.model_id",
      "desc": "",
      "mart": {
        "path": "data_new/ontology/links/vehicleModel.parquet",
        "fields": [
          {
            "id": "from_id",
            "type": "VARCHAR"
          },
          {
            "id": "to_id",
            "type": "VARCHAR"
          }
        ]
      }
    },
    {
      "id": "vehicleTrim",
      "name": "트림",
      "from": "vehicle",
      "to": "trim",
      "card": "N:1",
      "fk": "vehicle.trim_id",
      "desc": "",
      "mart": {
        "path": "data_new/ontology/links/vehicleTrim.parquet",
        "fields": [
          {
            "id": "from_id",
            "type": "VARCHAR"
          },
          {
            "id": "to_id",
            "type": "VARCHAR"
          }
        ]
      }
    },
    {
      "id": "plantBuildsVehicle",
      "name": "생산",
      "from": "plant",
      "to": "vehicle",
      "card": "1:N",
      "fk": "vehicle.plant_id",
      "desc": "WMI(VIN 1-3자리)가 공장을 식별",
      "mart": {
        "path": "data_new/ontology/links/plantBuildsVehicle.parquet",
        "fields": [
          {
            "id": "from_id",
            "type": "VARCHAR"
          },
          {
            "id": "to_id",
            "type": "VARCHAR"
          }
        ]
      }
    },
    {
      "id": "vehicleDestZone",
      "name": "배정 지역",
      "from": "vehicle",
      "to": "salesZone",
      "card": "N:1",
      "fk": "vehicle.dest_zone_id",
      "desc": ""
    },
    {
      "id": "scSubmitsPr",
      "name": "생산 요청",
      "from": "salesCompany",
      "to": "productionRequest",
      "card": "1:N",
      "fk": "productionRequest.sc_id",
      "desc": "매월 제출"
    },
    {
      "id": "prToPlant",
      "name": "생산 배정",
      "from": "productionRequest",
      "to": "plant",
      "card": "N:1",
      "fk": "productionRequest.plant_id",
      "desc": "케파 확정 시 공장 배정"
    },
    {
      "id": "prForModel",
      "name": "대상 차종",
      "from": "productionRequest",
      "to": "model",
      "card": "N:1",
      "fk": "productionRequest.model_id",
      "desc": ""
    },
    {
      "id": "prFulfilledBy",
      "name": "요청 이행",
      "from": "vehicle",
      "to": "productionRequest",
      "card": "N:1",
      "fk": "vehicle.request_id",
      "desc": "생산분이 어느 월 요청을 이행했는지"
    },
    {
      "id": "bpForModel",
      "name": "계획 대상",
      "from": "businessPlan",
      "to": "model",
      "card": "N:1",
      "fk": "businessPlan.model_id",
      "desc": ""
    },
    {
      "id": "marketOfSc",
      "name": "시장 기준선",
      "from": "marketSnapshot",
      "to": "salesCompany",
      "card": "N:1",
      "fk": "marketSnapshot.sc_id (파생 — 단일 법인)",
      "desc": "자사 점유율·경쟁 인센티브의 비교 주체 — KPI-SHARE 외부 기준선"
    },
    {
      "id": "allocToDealer",
      "name": "배분 대상",
      "from": "allocation",
      "to": "dealer",
      "card": "N:1",
      "fk": "allocation.dealer_id",
      "desc": ""
    },
    {
      "id": "allocForModel",
      "name": "배분 차종",
      "from": "allocation",
      "to": "model",
      "card": "N:1",
      "fk": "allocation.model_id",
      "desc": ""
    },
    {
      "id": "vehicleAllocated",
      "name": "배분 소속",
      "from": "vehicle",
      "to": "allocation",
      "card": "N:1",
      "fk": "vehicle.alloc_id",
      "desc": "배분 확정 시 VIN 매핑"
    },
    {
      "id": "routeFromPlant",
      "name": "출발 공장",
      "from": "transportRoute",
      "to": "plant",
      "card": "N:1",
      "fk": "transportRoute.plant_id",
      "desc": ""
    },
    {
      "id": "shipmentOnRoute",
      "name": "운행 루트",
      "from": "shipment",
      "to": "transportRoute",
      "card": "N:1",
      "fk": "shipment.route_id",
      "desc": ""
    },
    {
      "id": "vehicleOnShipment",
      "name": "적재",
      "from": "vehicle",
      "to": "shipment",
      "card": "N:1",
      "fk": "vehicle.shipment_id",
      "desc": "배치 단위 이동",
      "mart": {
        "path": "data_new/ontology/links/vehicleOnShipment.parquet",
        "fields": [
          {
            "id": "from_id",
            "type": "VARCHAR"
          },
          {
            "id": "to_id",
            "type": "VARCHAR"
          }
        ]
      }
    },
    {
      "id": "inspectionOfVehicle",
      "name": "검사 대상",
      "from": "inspection",
      "to": "vehicle",
      "card": "N:1",
      "fk": "inspection.vin",
      "desc": "상태 전이 게이트마다 1건"
    },
    {
      "id": "purchaseOfVehicle",
      "name": "매입 차량",
      "from": "vehiclePurchase",
      "to": "vehicle",
      "card": "1:1",
      "fk": "vehiclePurchase.vin",
      "desc": "",
      "mart": {
        "path": "data_new/ontology/links/purchaseOfVehicle.parquet",
        "fields": [
          {
            "id": "from_id",
            "type": "VARCHAR"
          },
          {
            "id": "to_id",
            "type": "VARCHAR"
          }
        ]
      }
    },
    {
      "id": "purchaseFromPc",
      "name": "매입처",
      "from": "vehiclePurchase",
      "to": "productionCompany",
      "card": "N:1",
      "fk": "vehiclePurchase.seller_pc_id",
      "desc": ""
    },
    {
      "id": "wsOfVehicle",
      "name": "도매 차량",
      "from": "wholesale",
      "to": "vehicle",
      "card": "1:1",
      "fk": "wholesale.vin",
      "desc": "",
      "mart": {
        "path": "data_new/ontology/links/wsOfVehicle.parquet",
        "fields": [
          {
            "id": "from_id",
            "type": "VARCHAR"
          },
          {
            "id": "to_id",
            "type": "VARCHAR"
          }
        ]
      }
    },
    {
      "id": "wsToDealer",
      "name": "인수 딜러",
      "from": "wholesale",
      "to": "dealer",
      "card": "N:1",
      "fk": "wholesale.dealer_id",
      "desc": "이 시점에 판매법인 이익 실현",
      "mart": {
        "path": "data_new/ontology/links/wsToDealer.parquet",
        "fields": [
          {
            "id": "from_id",
            "type": "VARCHAR"
          },
          {
            "id": "to_id",
            "type": "VARCHAR"
          }
        ]
      }
    },
    {
      "id": "rsOfVehicle",
      "name": "소매 차량",
      "from": "retailSale",
      "to": "vehicle",
      "card": "1:1",
      "fk": "retailSale.vin",
      "desc": "",
      "mart": {
        "path": "data_new/ontology/links/rsOfVehicle.parquet",
        "fields": [
          {
            "id": "from_id",
            "type": "VARCHAR"
          },
          {
            "id": "to_id",
            "type": "VARCHAR"
          }
        ]
      }
    },
    {
      "id": "rsByDealer",
      "name": "판매 딜러",
      "from": "retailSale",
      "to": "dealer",
      "card": "N:1",
      "fk": "retailSale.dealer_id",
      "desc": "",
      "mart": {
        "path": "data_new/ontology/links/rsByDealer.parquet",
        "fields": [
          {
            "id": "from_id",
            "type": "VARCHAR"
          },
          {
            "id": "to_id",
            "type": "VARCHAR"
          }
        ]
      }
    },
    {
      "id": "rsToCustomer",
      "name": "구매 고객",
      "from": "retailSale",
      "to": "customer",
      "card": "N:1",
      "fk": "retailSale.customer_id",
      "desc": ""
    },
    {
      "id": "rsUsedIncentive",
      "name": "적용 프로그램",
      "from": "retailSale",
      "to": "incentiveProgram",
      "card": "N:M",
      "fk": "retail_incentive_applied",
      "desc": "소매 1건에 복수 프로그램 적용 가능"
    },
    {
      "id": "ipForModel",
      "name": "대상 차종",
      "from": "incentiveProgram",
      "to": "model",
      "card": "N:1",
      "fk": "incentiveProgram.model_id",
      "desc": ""
    },
    {
      "id": "mkForModel",
      "name": "대상 차종",
      "from": "marketingCampaign",
      "to": "model",
      "card": "N:1",
      "fk": "marketingCampaign.model_id",
      "desc": "tier=model 캠페인만 — brand 티어는 전 차종이라 링크 없음"
    },
    {
      "id": "mkBySc",
      "name": "집행 법인",
      "from": "marketingCampaign",
      "to": "salesCompany",
      "card": "N:1",
      "fk": "marketingCampaign.sc_id (파생 — brand·model 티어)",
      "desc": "브랜드·차종 캠페인 집행 주체 + 딜러 지역 광고의 co-op 상환 재원"
    },
    {
      "id": "mkByDealer",
      "name": "집행 딜러",
      "from": "marketingCampaign",
      "to": "dealer",
      "card": "N:1",
      "fk": "marketingCampaign.dealer_id",
      "desc": "지역 광고(tier=dealer_local) 집행 주체 — co-op 정산 대상"
    },
    {
      "id": "mkInZone",
      "name": "대상 지역",
      "from": "marketingCampaign",
      "to": "salesZone",
      "card": "N:1",
      "fk": "marketingCampaign.zone_id",
      "desc": "딜러 지역 광고의 커버리지 — 지역 수요에 반영"
    },
    {
      "id": "wsSettlesToSc",
      "name": "매출 귀속",
      "from": "wholesale",
      "to": "salesCompany",
      "card": "N:1",
      "fk": "vehiclePurchase.buyer_sc_id 경유",
      "desc": "도매 시점 매출·변동마진이 인식되는 판매법인 — settleWholesaleRevenue 정산 귀속"
    },
    {
      "id": "wsCostBasis",
      "name": "원가 대응",
      "from": "wholesale",
      "to": "vehiclePurchase",
      "card": "1:1",
      "fk": "wholesale.vin",
      "desc": "같은 VIN의 법인간 매입이 도매 매출의 원가측 — 변동마진 = 도매가 − 이전가격 − 운송비",
      "mart": {
        "path": "data_new/ontology/links/wsCostBasis.parquet",
        "fields": [
          {
            "id": "from_id",
            "type": "VARCHAR"
          },
          {
            "id": "to_id",
            "type": "VARCHAR"
          }
        ]
      }
    },
    {
      "id": "purchaseBySc",
      "name": "매입 법인",
      "from": "vehiclePurchase",
      "to": "salesCompany",
      "card": "N:1",
      "fk": "vehiclePurchase.buyer_sc_id",
      "desc": "매입채무(AP) 인식·정산 주체 — settleIntercompanyPayable"
    },
    {
      "id": "ipFundedBySc",
      "name": "재원 법인",
      "from": "incentiveProgram",
      "to": "salesCompany",
      "card": "N:1",
      "fk": "incentiveProgram.sc_id (파생 — 단일 법인)",
      "desc": "인센티브 충당부채 계상(accrueIncentiveLiability)·딜러 정산(settleIncentiveToDealer) 재원 주체"
    },
    {
      "id": "roOfVehicle",
      "name": "입고 차량",
      "from": "repairOrder",
      "to": "vehicle",
      "card": "N:1",
      "fk": "repairOrder.vin",
      "desc": ""
    },
    {
      "id": "roAtDealer",
      "name": "서비스 딜러",
      "from": "repairOrder",
      "to": "dealer",
      "card": "N:1",
      "fk": "repairOrder.dealer_id",
      "desc": ""
    },
    {
      "id": "roUnderCampaign",
      "name": "캠페인 작업",
      "from": "repairOrder",
      "to": "qualityCampaign",
      "card": "N:1",
      "fk": "repairOrder.project_id",
      "desc": "pay_type=campaign인 RO"
    },
    {
      "id": "claimOfRo",
      "name": "정산 청구",
      "from": "warrantyClaim",
      "to": "repairOrder",
      "card": "1:1",
      "fk": "warrantyClaim.ro_id",
      "desc": ""
    },
    {
      "id": "claimPaidBySc",
      "name": "지급 법인",
      "from": "warrantyClaim",
      "to": "salesCompany",
      "card": "N:1",
      "fk": "warrantyClaim.sc_id",
      "desc": "승인 시 품질비 인식",
      "mart": {
        "path": "data_new/ontology/links/claimPaidBySc.parquet",
        "fields": [
          {
            "id": "from_id",
            "type": "VARCHAR"
          },
          {
            "id": "to_id",
            "type": "VARCHAR"
          }
        ]
      }
    },
    {
      "id": "customerOwnsVehicle",
      "name": "보유 차량",
      "from": "customer",
      "to": "vehicle",
      "card": "1:N",
      "fk": "retailSale 파생",
      "desc": ""
    },
    {
      "id": "vocFromCustomer",
      "name": "접수 고객",
      "from": "vocTicket",
      "to": "customer",
      "card": "N:1",
      "fk": "vocTicket.customer_id",
      "desc": ""
    },
    {
      "id": "vocOfVehicle",
      "name": "대상 차량",
      "from": "vocTicket",
      "to": "vehicle",
      "card": "N:1",
      "fk": "vocTicket.vin",
      "desc": "차량 관련 VoC만",
      "mart": {
        "path": "data_new/ontology/links/vocOfVehicle.parquet",
        "fields": [
          {
            "id": "from_id",
            "type": "VARCHAR"
          },
          {
            "id": "to_id",
            "type": "VARCHAR"
          }
        ]
      }
    },
    {
      "id": "vocEvidencesIssue",
      "name": "이슈 근거",
      "from": "vocTicket",
      "to": "qualityIssue",
      "card": "N:1",
      "fk": "vocTicket.issue_id",
      "desc": "VoC·소셜 통합 분석으로 이슈 승격 시 연결"
    },
    {
      "id": "postAboutModel",
      "name": "언급 차종",
      "from": "socialPost",
      "to": "model",
      "card": "N:1",
      "fk": "socialPost.model_id",
      "desc": ""
    },
    {
      "id": "postEvidencesIssue",
      "name": "이슈 근거",
      "from": "socialPost",
      "to": "qualityIssue",
      "card": "N:1",
      "fk": "socialPost.issue_id",
      "desc": "VoC와 동일 카테고리 신호가 이슈 근거로 연결"
    },
    {
      "id": "teFromVehicle",
      "name": "발신 차량",
      "from": "telematicsEvent",
      "to": "vehicle",
      "card": "N:1",
      "fk": "telematicsEvent.vin",
      "desc": "커넥티드 동의 차량만"
    },
    {
      "id": "teEvidencesIssue",
      "name": "이슈 근거",
      "from": "telematicsEvent",
      "to": "qualityIssue",
      "card": "N:1",
      "fk": "telematicsEvent.issue_id",
      "desc": "클러스터링 결과 (data_category=dtc)"
    },
    {
      "id": "roEvidencesIssue",
      "name": "이슈 근거",
      "from": "repairOrder",
      "to": "qualityIssue",
      "card": "N:1",
      "fk": "repairOrder.issue_id",
      "desc": "클레임 신호"
    },
    {
      "id": "issueOnModel",
      "name": "발생 차종",
      "from": "qualityIssue",
      "to": "model",
      "card": "N:1",
      "fk": "qualityIssue.model_id",
      "desc": ""
    },
    {
      "id": "qcRemediesIssue",
      "name": "시정 대상",
      "from": "qualityCampaign",
      "to": "qualityIssue",
      "card": "N:1",
      "fk": "qualityCampaign.issue_id",
      "desc": "OTA/FSC/리콜 발령"
    },
    {
      "id": "usageOfModel",
      "name": "대상 차종",
      "from": "featureUsageEvent",
      "to": "model",
      "card": "N:1",
      "fk": "featureUsageEvent.model_id",
      "desc": "차량 신호 스냅샷의 차종 — 차종별 KPI 드라이버 비교의 조인 키"
    },
    {
      "id": "mlTrainsOnUsage",
      "name": "학습 피처",
      "from": "mlModel",
      "to": "featureUsageEvent",
      "card": "N:M",
      "fk": "mlModel.train_set (feature_usage)",
      "desc": "기능 사용·DTC·Trip 신호를 학습 피처로 사용"
    },
    {
      "id": "mlTrainsOnTelematics",
      "name": "학습 피처",
      "from": "mlModel",
      "to": "telematicsEvent",
      "card": "N:M",
      "fk": "mlModel.train_set (telematics_event)",
      "desc": "주행·DTC 원시 이벤트를 학습 피처로 사용 (마트 bound 시)"
    },
    {
      "id": "mlPredictsFor",
      "name": "예측 대상",
      "from": "mlModel",
      "to": "salesCompany",
      "card": "N:1",
      "fk": "mlModel.company_id",
      "desc": "회사 KPI 트리의 미래 예측·드라이버 발굴을 서빙 — 트윈 월드 FORECAST·전략 레버의 근거"
    }
  ],
  "lifecycles": {
    "vehicleLifecycle": {
      "name": "차량 수명주기",
      "description": "생산부터 운행까지. 게이트(G1~G4) 검사에서 PASS가 기록되어야 다음 상태로 전달된다 — HOLD면 보수 후 재검.",
      "states": [
        {
          "id": "PRODUCED",
          "name": "생산 완료",
          "desc": "공장 라인오프. 생산법인 재고"
        },
        {
          "id": "IN_TRANSIT",
          "name": "운송 중",
          "desc": "수출항→해상→수입항(해외) 또는 철도·트럭(내륙) — 배치 단위 이동"
        },
        {
          "id": "AT_PORT",
          "name": "항만 처리장",
          "desc": "수입항 VPC — 액세서리 장착·보수 대기 (해외 생산분)"
        },
        {
          "id": "ALLOCATED",
          "name": "배분 확정",
          "desc": "5개 지역→딜러 배분 확정, 내륙 운송(철도/트럭) 지시"
        },
        {
          "id": "DEALER_STOCK",
          "name": "딜러 재고",
          "desc": "딜러 인수 = Wholesale — 판매법인 이익 실현, 재고 부담은 딜러(재고금융)"
        },
        {
          "id": "RETAILED",
          "name": "소매 완료",
          "desc": "고객 인도. 실거래가 = MSRP − 인센티브"
        },
        {
          "id": "IN_SERVICE",
          "name": "운행 중",
          "desc": "커스터머 케어 대상 — RO·텔레매틱스·캠페인"
        }
      ],
      "transitions": [
        {
          "from": "PRODUCED",
          "to": "IN_TRANSIT",
          "gate": "G1",
          "gateName": "공장 출하 검사 (PDI)",
          "action": "dispatchShipment"
        },
        {
          "from": "IN_TRANSIT",
          "to": "AT_PORT",
          "gate": "G2",
          "gateName": "항만 인수 검사 (VPC)",
          "action": "receiveShipment",
          "note": "해외 생산분. 내륙 생산분은 G2 생략하고 ALLOCATED로"
        },
        {
          "from": "AT_PORT",
          "to": "ALLOCATED",
          "gate": null,
          "gateName": null,
          "action": "allocateToDealers"
        },
        {
          "from": "ALLOCATED",
          "to": "DEALER_STOCK",
          "gate": "G3",
          "gateName": "딜러 인수 검사",
          "action": "invoiceWholesale"
        },
        {
          "from": "DEALER_STOCK",
          "to": "RETAILED",
          "gate": "G4",
          "gateName": "인도 전 점검 (PDS)",
          "action": "recordRetailSale"
        },
        {
          "from": "RETAILED",
          "to": "IN_SERVICE",
          "gate": null,
          "gateName": null,
          "action": null,
          "note": "인도 즉시 케어 대상 전환"
        }
      ]
    }
  },
  "actionTypes": [
    {
      "id": "reviseBusinessPlan",
      "name": "사업계획 수립 · 조정",
      "objectType": "businessPlan",
      "stage": "plan",
      "params": [
        {
          "id": "plan_year",
          "type": "int"
        },
        {
          "id": "model_targets",
          "type": "table"
        },
        {
          "id": "revision_reason",
          "type": "string"
        }
      ],
      "effects": [
        "businessPlan 월 전개 생성/갱신",
        "전 실적 화면의 BP 대비 기준선 교체",
        "시뮬레이션 시나리오와 연동"
      ],
      "automation": {
        "before": "연 1회 엑셀 취합 — 월 전개·차종 배분 수작업, 기중 조정 반영 지연",
        "after": "수요 전망·시뮬레이션 결과 기반 월 전개 자동 생성 — 기중 조정 즉시 전파",
        "output": "BP 대비 실적 대시보드 (차종×월 목표/실적/갭 — 조정 이력 추적)"
      },
      "desc": "연간 사업계획의 수립과 기중 조정 — 모든 실적 비교의 기준선 관리",
      "twinView": {
        "kind": "sim",
        "label": "전략 트윈 — BP 대비 기준선"
      },
      "status": "active"
    },
    {
      "id": "submitProductionRequest",
      "name": "생산 요청 제출",
      "objectType": "productionRequest",
      "stage": "plan",
      "params": [
        {
          "id": "order_ym",
          "type": "string"
        },
        {
          "id": "model_trim_qty",
          "type": "table"
        },
        {
          "id": "target_ds_days",
          "type": "int"
        }
      ],
      "effects": [
        "productionRequest 생성 (status=SUBMITTED)",
        "생산법인 통보"
      ],
      "automation": {
        "before": "지역 수요를 엑셀로 취합해 이메일 발주 — 트림 믹스 오류 잦음",
        "after": "수요 전망·목표 DS 기반 발주안 자동 산출 → 승인 후 시스템 전송",
        "output": "오더 현황 대시보드 (요청 → 확정 → 생산 → 이행 단계별 추적)"
      },
      "desc": "판매법인이 매월 수요 전망·목표 DS 기반으로 생산법인에 발주",
      "twinView": {
        "kind": "sim",
        "label": "전략 트윈 — 오더·생산 흐름"
      },
      "status": "active"
    },
    {
      "id": "confirmProductionRequest",
      "name": "생산 요청 확정",
      "objectType": "productionRequest",
      "stage": "plan",
      "params": [
        {
          "id": "request_id",
          "type": "ref"
        },
        {
          "id": "plant_split",
          "type": "table"
        }
      ],
      "effects": [
        "status → CONFIRMED",
        "공장 배정(케파 클램프)"
      ],
      "desc": "생산법인이 케파 내에서 공장별 물량 확정",
      "status": "active"
    },
    {
      "id": "allocateToDealers",
      "name": "딜러 배분 확정",
      "objectType": "allocation",
      "stage": "plan",
      "params": [
        {
          "id": "alloc_ym",
          "type": "string"
        },
        {
          "id": "method",
          "type": "enum(균등/실적/DS 가중)"
        }
      ],
      "effects": [
        "allocation 생성",
        "vehicle.alloc_id 매핑",
        "vehicle.state → ALLOCATED",
        "내륙 운송 지시"
      ],
      "automation": {
        "before": "지역사무소별 엑셀 배분표 수작업 — 딜러 이의 제기 처리 지연",
        "after": "실적·DS 가중 배분안 자동 생성 → 지역사무소 검토 → 확정",
        "output": "딜러 배분 대시보드 (지역사무소×딜러 배분/인수/재고 현황 — 이의 처리 큐)"
      },
      "desc": "5개 지역사무소→딜러로 월 물량 배분",
      "twinView": {
        "kind": "sim",
        "label": "전략 트윈 — 딜러 배분·지역 재고"
      },
      "status": "active"
    },
    {
      "id": "recordInspection",
      "name": "검사 결과 기록",
      "objectType": "inspection",
      "stage": "logistics",
      "params": [
        {
          "id": "vin",
          "type": "ref"
        },
        {
          "id": "gate",
          "type": "enum(G1/G2/G3/G4)"
        },
        {
          "id": "result",
          "type": "enum(PASS/HOLD/FAIL)"
        },
        {
          "id": "found_issue",
          "type": "string"
        }
      ],
      "effects": [
        "inspection 생성",
        "PASS → vehicle.state 다음 단계 전이 허용",
        "HOLD → 보수 후 재검"
      ],
      "desc": "상태 전이 게이트마다 문제없음을 기록해야 다음 단계로 전달",
      "status": "active"
    },
    {
      "id": "dispatchShipment",
      "name": "운송 출발 처리",
      "objectType": "shipment",
      "stage": "logistics",
      "params": [
        {
          "id": "route_id",
          "type": "ref"
        },
        {
          "id": "vins",
          "type": "ref[]"
        }
      ],
      "effects": [
        "shipment 생성 (status=IN_TRANSIT)",
        "vehicle.state → IN_TRANSIT"
      ],
      "desc": "G1 PASS 차량을 배치로 묶어 출발 (선박 800대 / 철도·트럭 300대)",
      "status": "active",
      "gate": "ai",
      "ledger": "LIKP/LIPS → objects/shipment.parquet"
    },
    {
      "id": "receiveShipment",
      "name": "운송 도착 처리",
      "objectType": "shipment",
      "stage": "logistics",
      "params": [
        {
          "id": "shipment_id",
          "type": "ref"
        }
      ],
      "effects": [
        "status → ARRIVED",
        "해외분: vehicle.state → AT_PORT (G2 대기)"
      ],
      "desc": "항만/딜러 도착 등록",
      "status": "active"
    },
    {
      "id": "invoiceWholesale",
      "name": "도매 인보이스 발행",
      "objectType": "wholesale",
      "stage": "commerce",
      "params": [
        {
          "id": "vin",
          "type": "ref"
        },
        {
          "id": "dealer_id",
          "type": "ref"
        }
      ],
      "effects": [
        "wholesale 생성",
        "vehicle.state → DEALER_STOCK",
        "변동마진 실현 (영업이익 인식)"
      ],
      "desc": "G3 PASS 후 딜러 인수 — 판매법인의 실질 판매 이익 발생 시점",
      "twinView": {
        "kind": "sim",
        "label": "전략 트윈 — 도매·재고 흐름"
      },
      "status": "active",
      "gate": "ai",
      "ledger": "VBRK/VBRP → objects/wholesale.parquet"
    },
    {
      "id": "recordRetailSale",
      "name": "소매 등록",
      "objectType": "retailSale",
      "stage": "commerce",
      "params": [
        {
          "id": "vin",
          "type": "ref"
        },
        {
          "id": "txn_price_usd",
          "type": "int"
        },
        {
          "id": "programs",
          "type": "ref[]"
        }
      ],
      "effects": [
        "retailSale 생성",
        "vehicle.state → RETAILED → IN_SERVICE",
        "인센티브 비용 인식"
      ],
      "desc": "딜러의 소매 보고 (G4 PDS 완료 후 인도)",
      "twinView": {
        "kind": "sim",
        "label": "전략 트윈 — 판매량 KPI"
      },
      "status": "active",
      "gate": "ai",
      "ledger": "ZSD_RDR → objects/retailSale.parquet"
    },
    {
      "id": "registerIncentiveProgram",
      "name": "인센티브 프로그램 등록",
      "objectType": "incentiveProgram",
      "stage": "commerce",
      "params": [
        {
          "id": "incentive_type",
          "type": "enum"
        },
        {
          "id": "scope",
          "type": "model/trim"
        },
        {
          "id": "amount_usd",
          "type": "int"
        },
        {
          "id": "period",
          "type": "ym~ym"
        }
      ],
      "effects": [
        "incentiveProgram 생성 (status=ACTIVE)",
        "이후 소매 실거래가에 반영"
      ],
      "desc": "Retail 가속 레버 — 재고일수·경쟁 상황 기반",
      "twinView": {
        "kind": "sim",
        "label": "전략 트윈 — 인센티브 레버"
      },
      "status": "active"
    },
    {
      "id": "adjustIncentive",
      "name": "인센티브 조정",
      "objectType": "incentiveProgram",
      "stage": "commerce",
      "params": [
        {
          "id": "program_id",
          "type": "ref"
        },
        {
          "id": "amount_usd",
          "type": "int"
        }
      ],
      "effects": [
        "amount_usd 갱신 (탄력 −1.6 → 수요 반영)"
      ],
      "desc": "",
      "twinView": {
        "kind": "sim",
        "label": "전략 트윈 — 인센티브 레버"
      },
      "status": "active"
    },
    {
      "id": "launchBrandCampaign",
      "name": "브랜드 캠페인 집행",
      "objectType": "marketingCampaign",
      "stage": "commerce",
      "params": [
        {
          "id": "period",
          "type": "ym~ym"
        },
        {
          "id": "channel_mix",
          "type": "table"
        },
        {
          "id": "spend_musd",
          "type": "decimal"
        }
      ],
      "effects": [
        "marketingCampaign 생성 (tier=brand, 전 차종)",
        "브랜드 인지 → 전 차종 수요 베이스라인 상승",
        "차종 캠페인의 우산(선행) 역할"
      ],
      "desc": "판매법인 마케팅 1층 — 브랜드 먼저, 차종은 그 위에 얹는다",
      "twinView": {
        "kind": "sim",
        "label": "전략 트윈 — 마케팅 레버"
      },
      "status": "active"
    },
    {
      "id": "launchMarketingCampaign",
      "name": "차종 마케팅 캠페인 집행",
      "objectType": "marketingCampaign",
      "stage": "commerce",
      "params": [
        {
          "id": "scope",
          "type": "model"
        },
        {
          "id": "channel_mix",
          "type": "table"
        },
        {
          "id": "spend_musd",
          "type": "decimal"
        }
      ],
      "effects": [
        "marketingCampaign 생성 (tier=model)",
        "adstock 0.5로 해당 차종 수요 반영"
      ],
      "desc": "판매법인 마케팅 2층 — 브랜드 캠페인 아래 차종별 집행 (신차 런칭·재고 소진 등)",
      "twinView": {
        "kind": "sim",
        "label": "전략 트윈 — 마케팅 레버"
      },
      "status": "active"
    },
    {
      "id": "launchDealerLocalAd",
      "name": "딜러 지역 광고 집행",
      "objectType": "marketingCampaign",
      "stage": "commerce",
      "params": [
        {
          "id": "dealer_id",
          "type": "ref"
        },
        {
          "id": "zone_id",
          "type": "ref"
        },
        {
          "id": "spend_musd",
          "type": "decimal"
        },
        {
          "id": "coop_rate",
          "type": "decimal"
        }
      ],
      "effects": [
        "marketingCampaign 생성 (tier=dealer_local)",
        "지역(zone) 수요 반영",
        "co-op 정산 대상 등록 (settleCoopAdReimbursement)"
      ],
      "desc": "딜러 주체의 지역 광고 — 로컬 미디어·이벤트. 판매법인이 coop_rate만큼 상환",
      "status": "active"
    },
    {
      "id": "manageMediaPlanActuals",
      "name": "제작 · 매체 계획/실적 관리",
      "objectType": "marketingCampaign",
      "stage": "commerce",
      "params": [
        {
          "id": "campaign_id",
          "type": "ref"
        },
        {
          "id": "media_plan",
          "type": "table"
        },
        {
          "id": "actuals_feed",
          "type": "ref"
        }
      ],
      "effects": [
        "채널별 계획 대비 집행 실적 자동 수집",
        "크리에이티브(제작물) 성과 태깅",
        "저성과 채널 재배분 제안"
      ],
      "automation": {
        "before": "매체사별 엑셀 정산서를 월말 취합 — 계획 대비 실적 확인에 2~3주",
        "after": "매체 API·정산 피드 자동 수집 — 제작물·채널 단위 성과 일 단위 집계",
        "output": "마케팅 계획/실적 대시보드 (캠페인×채널 집행률·성과 — 재배분 제안 포함)"
      },
      "desc": "캠페인 제작·매체 운영의 계획 대비 실적 관리 자동화",
      "twinView": {
        "kind": "sim",
        "label": "전략 트윈 — 마케팅 계획/실적"
      },
      "status": "active"
    },
    {
      "id": "evaluateDealer",
      "name": "딜러 평가 갱신",
      "objectType": "dealer",
      "stage": "commerce",
      "params": [
        {
          "id": "dealer_id",
          "type": "ref"
        },
        {
          "id": "grade",
          "type": "enum(A/B/C)"
        },
        {
          "id": "ssi_score",
          "type": "decimal"
        }
      ],
      "effects": [
        "dealer.grade·ssi_score 갱신",
        "차기 배분 가중치 반영"
      ],
      "desc": "판매·서비스 성과 기반 딜러 관리",
      "status": "active",
      "gate": "hitl",
      "ledger": "파생 스코어 (40_serve.sql Q3)"
    },
    {
      "id": "settleWholesaleRevenue",
      "name": "도매 매출 인식 · 정산",
      "objectType": "wholesale",
      "stage": "finance",
      "params": [
        {
          "id": "vin",
          "type": "ref"
        },
        {
          "id": "wholesale_price_usd",
          "type": "int"
        },
        {
          "id": "transfer_price_usd",
          "type": "int"
        },
        {
          "id": "freight_usd",
          "type": "int"
        }
      ],
      "effects": [
        "매출 인식 (도매가)",
        "매출원가 인식 (이전가격 + 운송비)",
        "딜러 채권(AR) 생성 — 플로어플랜 금융사 경유 회수",
        "변동마진 = 도매가 − 이전가격 − 운송비 확정"
      ],
      "automation": {
        "before": "월말 엑셀 대사 (인보이스 ↔ 원장) — 정산 마감까지 영업일 +7",
        "after": "도매 이벤트 발생 즉시 자동 분개 — 일 단위 가마감",
        "output": "월 도매 정산 대시보드 (일 마감 누계 · 미수 채권 에이징 · BP 대비)"
      },
      "desc": "도매(딜러 인수) 시점에 발생하는 판매법인 손익 이벤트 — invoiceWholesale과 동시 트리거",
      "twinView": {
        "kind": "sim",
        "label": "전략 트윈 — 영업이익 KPI"
      },
      "status": "active"
    },
    {
      "id": "settleIntercompanyPayable",
      "name": "법인간 매입 대금 정산",
      "objectType": "vehiclePurchase",
      "stage": "finance",
      "params": [
        {
          "id": "invoice_ym",
          "type": "string"
        },
        {
          "id": "seller_pc_id",
          "type": "ref"
        },
        {
          "id": "vins",
          "type": "ref[]"
        }
      ],
      "effects": [
        "이전가격 기준 매입채무(AP) 인식",
        "월 배치 생산법인 송금",
        "인코텀즈·환율 반영 정산 확정"
      ],
      "desc": "생산법인 인보이스에 대한 판매법인 지급 — 도매 실현 변동마진의 원가측 대응",
      "status": "active",
      "gate": "hitl",
      "ledger": "EKKO/EKPO + BSEG → objects/vehiclePurchase.parquet"
    },
    {
      "id": "accrueIncentiveLiability",
      "name": "인센티브 충당부채 계상",
      "objectType": "incentiveProgram",
      "stage": "finance",
      "params": [
        {
          "id": "program_id",
          "type": "ref"
        },
        {
          "id": "expected_units",
          "type": "int"
        },
        {
          "id": "amount_usd",
          "type": "int"
        }
      ],
      "effects": [
        "예상 소진액(대당 금액 × 예상 대수) 충당부채 계상",
        "월 마감 시 소진 실적으로 재측정"
      ],
      "desc": "프로그램 ACTIVE 기간의 미지급 인센티브를 미리 비용 인식 — 손익 왜곡 방지",
      "status": "active"
    },
    {
      "id": "settleIncentiveToDealer",
      "name": "인센티브 딜러 정산",
      "objectType": "retailSale",
      "stage": "finance",
      "params": [
        {
          "id": "vin",
          "type": "ref"
        },
        {
          "id": "programs",
          "type": "ref[]"
        },
        {
          "id": "incentive_usd",
          "type": "int"
        }
      ],
      "effects": [
        "소매 보고 검증 후 딜러 지급 승인",
        "충당부채 상계 · 인센티브 비용 확정"
      ],
      "desc": "소매 1건 단위 정산 — retailSale.incentive_usd가 정산 원장",
      "status": "active"
    },
    {
      "id": "payWarrantyClaim",
      "name": "워런티 클레임 지급",
      "objectType": "warrantyClaim",
      "stage": "finance",
      "params": [
        {
          "id": "pay_ym",
          "type": "string"
        },
        {
          "id": "claim_ids",
          "type": "ref[]"
        }
      ],
      "effects": [
        "APPROVED 클레임 월 배치 딜러 지급",
        "품질비 확정 (부품 + 공임)"
      ],
      "desc": "심사(approveWarrantyClaim)와 분리된 지급 실행 — 재무 원장 기록",
      "status": "active"
    },
    {
      "id": "settleCoopAdReimbursement",
      "name": "협력광고(Co-op) 정산",
      "objectType": "marketingCampaign",
      "stage": "finance",
      "params": [
        {
          "id": "settle_ym",
          "type": "string"
        },
        {
          "id": "campaign_ids",
          "type": "ref[]"
        }
      ],
      "effects": [
        "딜러 지역 광고비 × coop_rate 만큼 판매법인 마케팅비 인식",
        "딜러 상환 지급 (월 배치)",
        "증빙 미비 캠페인은 상환 보류"
      ],
      "desc": "딜러가 집행한 지역 광고(tier=dealer_local)의 판매법인 분담분 정산",
      "status": "active"
    },
    {
      "id": "closeMonthlyFinance",
      "name": "월 재무 마감 (P&L 확정)",
      "objectType": "salesCompany",
      "stage": "finance",
      "params": [
        {
          "id": "close_ym",
          "type": "string"
        }
      ],
      "effects": [
        "financials_pnl 산출 — 영업이익 = Σ변동마진 − 인센티브 − 운송 − 품질 − 마케팅",
        "BP 대비 손익 비교 확정",
        "충당부채 재측정 반영"
      ],
      "automation": {
        "before": "부문별 엑셀 손익 취합 — 마감까지 영업일 +5, 항목 누락 잦음",
        "after": "원장 자동 집계 — 일 단위 가마감, 월말 확정만 승인",
        "output": "P&L 마감 대시보드 (BP 대비 실시간 손익 · 항목별 드릴다운)"
      },
      "desc": "월 단위 판매법인 손익 마감 — metrics.opProfit·financials_pnl 마트의 생성 주체",
      "twinView": {
        "kind": "sim",
        "label": "전략 트윈 — P&L·BP 대비"
      },
      "status": "active",
      "gate": "hitl",
      "ledger": "BKPF/BSEG → kpi_monthly.parquet"
    },
    {
      "id": "adjustHvacSetpoint",
      "name": "HVAC 설정온도 전략 조정",
      "objectType": "facility",
      "stage": "finance",
      "params": [
        {
          "id": "facility_id",
          "type": "ref"
        },
        {
          "id": "peak_delta_c",
          "type": "float"
        },
        {
          "id": "precool_delta_c",
          "type": "float"
        },
        {
          "id": "apply_months",
          "type": "string"
        }
      ],
      "effects": [
        "피크 요금 시간대 설정온도 +Δ°C → HVAC 피크 사용량 감소 (-5%/°C)",
        "피크 전 예냉 -Δ°C → 피크 부하의 일부가 비피크로 이동",
        "월 전력비 절감 → 오피스 관리비 → 경상이익률 상향 롤업"
      ],
      "automation": {
        "before": "시설팀 수동 BMS 조작 — 요금제 변경 대응 지연, 절감액 산출 불가",
        "after": "트윈 레버로 즉시 시뮬레이션·적용 — 층별 온도·비용을 보며 실행, 별도 조사 불필요",
        "output": "월 에너지 절감 리포트 (건물×층 온도·피크 kWh·비용 · 경상이익률 기여)"
      },
      "desc": "전력사용량 leaf의 전략 레버 — 다운스트림 레버 실행이 업스트림 KPI 변화로 예측·전파되는 예시",
      "twinView": {
        "kind": "board",
        "label": "V10 월드 — 전력사용량 레버"
      },
      "status": "active"
    },
    {
      "id": "openRepairOrder",
      "name": "RO 개설",
      "objectType": "repairOrder",
      "stage": "care",
      "params": [
        {
          "id": "vin",
          "type": "ref"
        },
        {
          "id": "pay_type",
          "type": "enum(warranty/campaign/customer_pay)"
        },
        {
          "id": "component",
          "type": "string"
        }
      ],
      "effects": [
        "repairOrder 생성 (status=OPEN)"
      ],
      "desc": "딜러 서비스 입고 — 워런티·캠페인·고객 페이",
      "status": "active"
    },
    {
      "id": "approveWarrantyClaim",
      "name": "워런티 클레임 심사",
      "objectType": "warrantyClaim",
      "stage": "care",
      "params": [
        {
          "id": "claim_id",
          "type": "ref"
        },
        {
          "id": "decision",
          "type": "enum(APPROVED/REJECTED)"
        }
      ],
      "effects": [
        "decision 기록",
        "APPROVED → 품질비 인식·딜러 지급"
      ],
      "desc": "",
      "status": "active",
      "gate": "hitl",
      "ledger": "QMEL(Q1).ZZSTATUS → objects/warrantyClaim.parquet"
    },
    {
      "id": "classifyVocDaily",
      "name": "VoC 자동 분류 · 데일리 모니터링",
      "objectType": "vocTicket",
      "stage": "care",
      "params": [
        {
          "id": "date",
          "type": "date"
        },
        {
          "id": "taxonomy_ver",
          "type": "string"
        }
      ],
      "effects": [
        "신규 VoC 전건 LLM 분류 (표준 분류체계)",
        "카테고리·감성·심각도 라벨 적재",
        "급증 카테고리 알림"
      ],
      "automation": {
        "before": "상담사가 엑셀에 수기 분류 — 주간 취합, 누락·분류 편차 큼",
        "after": "LLM 분류기가 접수 즉시 자동 분류 — 표준 taxonomy 준수율 검증 포함",
        "output": "VoC 데일리 모니터링 대시보드 (카테고리 트렌드 · 급증 알림 · 미분류 큐)"
      },
      "desc": "매일 자동 분류·모니터링 — 소셜 포스트와 동일 분류체계라 통합 분석 가능",
      "status": "active",
      "gate": "ai",
      "ledger": "QMEL(Z1) → objects/vocTicket.parquet"
    },
    {
      "id": "analyzeSocialListening",
      "name": "소셜 미디어 분석",
      "objectType": "socialPost",
      "stage": "care",
      "params": [
        {
          "id": "period",
          "type": "ym"
        },
        {
          "id": "platforms",
          "type": "enum[]"
        }
      ],
      "effects": [
        "수집 포스트 카테고리·감성 자동 분류 (VoC 공용 taxonomy)",
        "차종별 화제·감성 트렌드 산출",
        "부정 급증 → 품질 이슈 후보 신호"
      ],
      "automation": {
        "before": "대행사 월간 리포트(PPT) — 4주 지연, 분류 기준 상이",
        "after": "수집→분류→스코어링 파이프라인 자동화 — VoC와 동일 분류체계 정렬",
        "output": "소셜 리스닝 대시보드 (플랫폼×차종×카테고리 감성 히트맵)"
      },
      "desc": "고객 소셜 발화의 자동 수집·분석",
      "status": "active"
    },
    {
      "id": "analyzeVocSocialUnified",
      "name": "VoC · 소셜 통합 분석",
      "objectType": "qualityIssue",
      "stage": "quality",
      "params": [
        {
          "id": "category",
          "type": "ref(공용 분류체계)"
        },
        {
          "id": "period",
          "type": "ym~ym"
        }
      ],
      "effects": [
        "동일 카테고리의 VoC+소셜 신호 통합 집계",
        "임계 초과 → 품질 이슈 후보 승격 (vocEvidencesIssue·postEvidencesIssue 링크)",
        "텔레매틱스·RO 신호와 교차 검증"
      ],
      "automation": {
        "before": "VoC와 소셜이 다른 조직·다른 분류로 관리 — 통합 뷰 부재",
        "after": "공용 분류체계 조인으로 채널 통합 신호 자동 집계",
        "output": "통합 VoC·소셜 이슈 레이더 (카테고리별 신호 강도 · 이슈 승격 이력)"
      },
      "desc": "같은 분류체계로 묶인 VoC·소셜을 함께 보고 이슈로 승격",
      "status": "active"
    },
    {
      "id": "recordDrivingTrip",
      "name": "주행 데이터 기록 (Trip)",
      "objectType": "telematicsEvent",
      "stage": "quality",
      "params": [
        {
          "id": "vin",
          "type": "ref"
        },
        {
          "id": "trip_km",
          "type": "decimal"
        },
        {
          "id": "trip_min",
          "type": "int"
        },
        {
          "id": "dest_gps",
          "type": "lat,lon"
        }
      ],
      "effects": [
        "telematicsEvent 생성 (data_category=trip)",
        "도착지 GPS → H3(r7) 셀 변환 적재",
        "지역 이용 패턴·수요 분석 입력"
      ],
      "automation": {
        "before": "주행 데이터 수집·분석 자체가 부재 (딜러 구두 피드백 의존)",
        "after": "커넥티드 동의 차량의 Trip 자동 적재 — 도착지 H3 집계 파이프라인",
        "output": "디지털 트윈 데이터 뷰 — OSM·Carto 지도 위 H3 셀 단위 Trip 히트맵"
      },
      "desc": "커넥티드 차량의 주행 기록 적재 — 디지털 트윈 지도 뷰의 데이터 소스",
      "twinView": {
        "kind": "map",
        "label": "Trip 지도 — 도착지 H3 분포"
      },
      "status": "active"
    },
    {
      "id": "triageTelematicsSignal",
      "name": "텔레매틱스 신호 트리아지",
      "objectType": "telematicsEvent",
      "stage": "quality",
      "params": [
        {
          "id": "event_id",
          "type": "ref"
        },
        {
          "id": "severity",
          "type": "enum"
        }
      ],
      "effects": [
        "SAFETY → 즉시 안전 대응 프로세스",
        "패턴 → 품질 이슈 후보 클러스터링"
      ],
      "automation": {
        "before": "딜러 보고·콜센터 인입만으로 이상 신호 인지 — 주 단위 엑셀 취합",
        "after": "수집 즉시 심각도·트리아지 자동 분류 — SAFETY는 즉시 디스패치",
        "output": "DTC 신호 보드 (심각도 분포 · 트리아지 상태 · 이슈 연계)"
      },
      "twinView": {
        "kind": "board",
        "label": "DTC 신호 보드 — 심각도·트리아지"
      },
      "desc": "수집 신호(data_category=dtc)의 품질·안전 분류",
      "status": "active"
    },
    {
      "id": "openQualityIssue",
      "name": "품질 이슈 오픈",
      "objectType": "qualityIssue",
      "stage": "quality",
      "params": [
        {
          "id": "model_id",
          "type": "ref"
        },
        {
          "id": "component",
          "type": "string"
        },
        {
          "id": "evidence",
          "type": "ref[]"
        }
      ],
      "effects": [
        "qualityIssue 생성",
        "텔레매틱스·RO·VoC·소셜 근거 링크"
      ],
      "desc": "클레임률·DTC 급증·VoC/소셜 신호 탐지 시",
      "status": "active"
    },
    {
      "id": "launchQualityCampaign",
      "name": "개선 활동 발령",
      "objectType": "qualityCampaign",
      "stage": "quality",
      "params": [
        {
          "id": "issue_id",
          "type": "ref"
        },
        {
          "id": "remedy_type",
          "type": "enum(OTA/FSC/RECALL)"
        },
        {
          "id": "target_vins",
          "type": "int"
        }
      ],
      "effects": [
        "qualityCampaign 생성",
        "OTA → 대상 VIN 순차 적용",
        "FSC/RECALL → campaign RO 유도"
      ],
      "desc": "시정 방식 결정·발령 — 적용 누계 → 클레임 소멸 → 내부 CSI 회복",
      "twinView": {
        "kind": "sim",
        "label": "전략 트윈 — CSI 회복 곡선"
      },
      "status": "active"
    },
    {
      "id": "logFeatureUsage",
      "name": "기능 사용 신호 적재",
      "objectType": "featureUsageEvent",
      "stage": "quality",
      "params": [
        {
          "id": "ym",
          "type": "string"
        },
        {
          "id": "model_id",
          "type": "ref"
        },
        {
          "id": "signals",
          "type": "table"
        }
      ],
      "effects": [
        "featureUsageEvent 월 스냅샷 적재 (HDA·트레일러·FOTA·옵트인·DTC·Trip)",
        "학습 피처 스토어 갱신",
        "옵트인율이 커버리지(학습 가능 모수)를 결정"
      ],
      "automation": {
        "before": "기능 사용 데이터가 차량에만 있고 수집·집계 부재 — KPI 연관 분석 불가",
        "after": "커넥티드 동의 차량의 신호를 월 스냅샷으로 자동 적재 — 온톨로지 bound 마트",
        "output": "차량 데이터 전략 월드 — 신호 트렌드·차종 히트맵"
      },
      "desc": "차량 기능 사용·신호의 원장 적재 — 모든 학습의 데이터 기반",
      "status": "active"
    },
    {
      "id": "trainForecastModel",
      "name": "KPI 예측 모델 학습",
      "objectType": "mlModel",
      "stage": "plan",
      "params": [
        {
          "id": "target_kpi",
          "type": "ref"
        },
        {
          "id": "train_window",
          "type": "ym~ym"
        },
        {
          "id": "holdout_m",
          "type": "int"
        }
      ],
      "effects": [
        "mlModel 버전 생성 (시즌+추세 v0 → 피처 확장 로드맵)",
        "홀드아웃 검증 지표 기록",
        "포커스 그래프 FORECAST 구간 서빙"
      ],
      "automation": {
        "before": "미래 수치는 담당자 엑셀 추정 — 근거·재현성 없음",
        "after": "32개월 실적을 학습해 KPI별 예측 자동 산출 — 레버가 주입한 가상 데이터로 미래 재생성",
        "output": "V10 포커스 그래프 FORECAST(학습 v0) · 전략 월드 미래 12개월"
      },
      "desc": "실적 원장을 학습해 KPI 미래를 예측 — 전략 레버 강화의 기반",
      "status": "active"
    },
    {
      "id": "discoverKpiDrivers",
      "name": "KPI 드라이버 발굴",
      "objectType": "mlModel",
      "stage": "quality",
      "params": [
        {
          "id": "target_kpi",
          "type": "ref"
        },
        {
          "id": "feature_set",
          "type": "ref[]"
        },
        {
          "id": "method",
          "type": "enum(상관/중요도)"
        }
      ],
      "effects": [
        "차량 신호 × KPI 상관·중요도 산출",
        "유의 드라이버 → 전략 레버 후보 승격",
        "미연결 신호는 데이터 수집 프로젝트 제안"
      ],
      "automation": {
        "before": "KPI 하락의 원인을 회의체 추정으로 탐색 — 차량 데이터 미활용",
        "after": "HDA·DTC·옵트인 등 신호와 KPI의 연관을 자동 스캔 — 근거 있는 레버 설계",
        "output": "차량 데이터 전략 월드 — KPI 드라이버 랭킹 보드"
      },
      "desc": "주행·DTC·기능 사용 데이터에서 KPI에 영향을 주는 드라이버를 발굴",
      "status": "active"
    }
  ],
  "metrics": [
    {
      "id": "retailQty",
      "name": "소매 판매량",
      "formula": "count(retailSale)",
      "source": "agg_kpi.retail_qty",
      "unit": "대",
      "twinKpi": "retail"
    },
    {
      "id": "wholesaleQty",
      "name": "도매 판매량",
      "formula": "count(wholesale)",
      "source": "agg_kpi.wholesale_qty",
      "unit": "대"
    },
    {
      "id": "opProfit",
      "name": "영업이익",
      "formula": "Σ변동마진 − 인센티브 − 운송 − 품질 − 마케팅",
      "source": "agg_kpi.op_profit_usd",
      "unit": "USD",
      "twinKpi": "op"
    },
    {
      "id": "daysSupply",
      "name": "재고일수(DS)",
      "formula": "stock ÷ 소매 속도",
      "source": "agg_kpi.days_supply",
      "unit": "일",
      "twinKpi": "ds"
    },
    {
      "id": "csiExternal",
      "name": "외부 CSI",
      "formula": "외부기관 공시 (조작 불가)",
      "source": "csi_external.csi_score",
      "twinKpi": "csi"
    },
    {
      "id": "csiInternal",
      "name": "내부 CSI",
      "formula": "0.30·품질 + 0.25·커넥티드 + 0.25·서비스 + 0.20·인도",
      "source": "csi_internal"
    }
  ]
};
