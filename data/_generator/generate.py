#!/usr/bin/env python3
"""
디지털 트윈 샘플 데이터 생성기 (v7 전략 시뮬레이션 트윈용)
- 세계관: V6 가상 세계관 (실명 금지 원칙) — 차종 6종, 공장 5곳, 딜러 5지역
- 기간: 실적 2024-01 ~ 2026-08 (32개월), BP 2024-01 ~ 2027-12 (48개월)
- 파티션: data/<dataset>/<YYYY-MM>.csv  (월 파티션 — Play 재생 단위)
- 시드 고정(20260820): 재실행해도 동일 데이터
- 핵심 원칙: 실적 자체가 "수요 = 기저 × 가격탄력 × 인센티브 × 마케팅(adstock) × 공급제약"
  구조 모델 + 노이즈로 생성됨 → v7 시뮬레이션 모델이 같은 구조를 쓰므로 캘리브레이션이 성립.
"""
import csv, json, math, os, random, shutil

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))
SEED = 20260820
R = random.Random(SEED)

# ── 달력 ──────────────────────────────────────────────────────────
N_MONTHS = 48                      # 2024-01 .. 2027-12
NOW = 31                           # 2026-08 (마지막 실적월)
def ym(i): return f"{2024 + i // 12}-{i % 12 + 1:02d}"
MONTHS = [ym(i) for i in range(N_MONTHS)]
SEAS = [0.88, 0.90, 1.08, 0.98, 1.06, 1.00, 0.96, 1.10, 0.95, 0.94, 0.97, 1.15]

US_BASE = 58000                    # 미국 월 리테일 기저 (대)
DS_TARGET = 60                     # Days Supply 목표

# ── 마스터: 차종 / 트림 / 공장 / 지역 ─────────────────────────────
# msrp: 대당 권장소비자가, margin: 대당 변동마진(도매 기준), seg: 세그먼트
MODELS = [
    dict(id="TRN", name="Terron",    seg="대형 SUV",   plant="US-GA", share=0.24, msrp=52000, margin=4600, ev=0),
    dict(id="VST", name="Vista",     seg="중형 SUV",   plant="US-GA", share=0.26, msrp=38500, margin=3400, ev=0),
    dict(id="AUR", name="Aurora EV", seg="대형 EV SUV", plant="US-SV", share=0.08, msrp=58900, margin=3100, ev=1),
    dict(id="MRD", name="Meridian",  seg="중형 세단",  plant="MX-MT", share=0.16, msrp=31200, margin=2600, ev=0),
    dict(id="NOV", name="Nova",      seg="미니밴",     plant="KR-2",  share=0.13, msrp=44300, margin=3800, ev=0),
    dict(id="LUM", name="Lumen EV",  seg="준중형 EV CUV", plant="KR-1", share=0.13, msrp=42700, margin=2900, ev=1),
]
TRIMS = {
    "TRN": ["Core", "Prime", "Summit"], "VST": ["Core", "Prime", "Trail"],
    "AUR": ["Air", "Range", "Max"],     "MRD": ["Core", "Prime", "Sport"],
    "NOV": ["Core", "Prime", "Lounge"], "LUM": ["Air", "Range", "Sport"],
}
TRIM_W = [0.38, 0.44, 0.18]
TRIM_PRICE_F = [0.92, 1.00, 1.14]          # 트림별 MSRP 계수

PLANTS = [
    dict(id="KR-1",  name="국내 1공장",       country="KR", cap=10000, lead_m=2, ship="선박",      batch=800, wmi="VF1"),
    dict(id="KR-2",  name="국내 2공장",       country="KR", cap=10000, lead_m=2, ship="선박",      batch=800, wmi="VF2"),
    dict(id="US-GA", name="조지아 공장",      country="US", cap=36000, lead_m=0, ship="트럭·철도", batch=300, wmi="VF3"),
    dict(id="US-SV", name="사바나 EV 공장",   country="US", cap=10000, lead_m=0, ship="트럭·철도", batch=300, wmi="VF4"),
    dict(id="MX-MT", name="몬터레이 공장",    country="MX", cap=13000, lead_m=1, ship="철도·트럭", batch=300, wmi="VF5"),
]
PLANT_LEAD = {p["id"]: p["lead_m"] for p in PLANTS}
PLANT_CAP = {p["id"]: p["cap"] for p in PLANTS}
FREIGHT = {"KR-1": 1450, "KR-2": 1450, "US-GA": 380, "US-SV": 380, "MX-MT": 640}  # 대당 운송비 $

ZONES = [
    dict(id="west",      name="West",      dealers=168, share=0.26, ev_aff=1.35),
    dict(id="central",   name="Central",   dealers=141, share=0.17, ev_aff=0.75),
    dict(id="south",     name="South",     dealers=158, share=0.22, ev_aff=0.75),
    dict(id="northeast", name="Northeast", dealers=132, share=0.17, ev_aff=1.35),
    dict(id="southeast", name="Southeast", dealers=146, share=0.18, ev_aff=1.00),
]
# EV 친화도 정규화 계수 (모델별로 zone 가중치 합 = 1)
def zone_weights(md):
    if md["ev"]:
        raw = [z["share"] * z["ev_aff"] for z in ZONES]
    else:
        raw = [z["share"] for z in ZONES]
    s = sum(raw)
    return [r / s for r in raw]

SEGMENTS = ["대형 SUV", "중형 SUV", "대형 EV SUV", "중형 세단", "미니밴", "준중형 EV CUV"]

# ── 사양(스펙) 믹스: MY / 엔진 / 구동 / 색상 ──────────────────────
# v7 원인 분석 필터와 공유하는 결정적(무노이즈) 믹스 모델. JS(v7)와 동일식 유지.
COLORS = ["스노우 화이트", "미드나잇 블랙", "스틸 그레이", "실버", "오션 블루",
          "선셋 레드", "포레스트 그린", "샌드 베이지"]
COLOR_W = [0.24, 0.19, 0.16, 0.13, 0.10, 0.08, 0.05, 0.05]
ENGINES = {  # 차종별 파워트레인 2종 [기본, 상위]
    "TRN": ["3.5 가솔린", "2.5T 하이브리드"], "VST": ["2.5 가솔린", "1.6T 하이브리드"],
    "AUR": ["스탠다드 레인지", "롱레인지"],    "MRD": ["2.0 가솔린", "1.6T 하이브리드"],
    "NOV": ["3.5 가솔린", "1.6T 하이브리드"], "LUM": ["스탠다드 레인지", "롱레인지"],
}
ENG_P = dict(ice_base=0.30, ice_slope=0.008, ice_max=0.55,   # 상위(HEV) 침투
             ev_base=0.58, ev_slope=0.004, ev_max=0.72)      # 롱레인지 비중
DRIVE_AWD = {"TRN": 0.75, "VST": 0.45, "AUR": 0.55, "MRD": 0.20, "NOV": 0.35, "LUM": 0.45}
ZONE_AWD_AFF = {"west": 1.0, "central": 1.15, "south": 0.72, "northeast": 1.30, "southeast": 0.85}
MY_NEXT_SHARE = [0, 0, 0, 0, 0, 0, 0, 0.15, 0.40, 0.65, 0.85, 0.95]  # 8월~ 신형 MY 전환률

# 주입 이상 징후 (원인 분석 데모의 정답):
#  A1: 2026-03(i=26)~ VST FWD가 south/southeast에서 급락 (경쟁사 AWD 신차 공세, FWD 수요 -45%)
#  A2: 2026-04(i=27)~ EV 차종의 '스노우 화이트'가 west/northeast에서 하락, '스틸 그레이'로 이동 (-10%p)
ANOMALIES = [
    dict(type="drive", model="VST", zones=["south", "southeast"], start=26, ramp=3, fwd_factor=0.55),
    dict(type="color", ev_only=True, zones=["west", "northeast"], start=27, ramp=3,
         from_idx=0, to_idx=2, shift=0.10),
]

def mix_my(i):
    y, m = 2024 + i // 12, i % 12
    ns = MY_NEXT_SHARE[m]
    out = {}
    if 1 - ns > 0: out[y] = 1 - ns            # 당해 MY
    if ns > 0: out[y + 1] = ns                # 8월부터 익년형 MY 혼입
    return out

def mix_engine(mid, i):
    md = next(m for m in MODELS if m["id"] == mid)
    if md["ev"]: s2 = min(ENG_P["ev_max"], ENG_P["ev_base"] + ENG_P["ev_slope"] * i)
    else: s2 = min(ENG_P["ice_max"], ENG_P["ice_base"] + ENG_P["ice_slope"] * i)
    return [1 - s2, s2]

def mix_drive(mid, zid, i, plan=False):
    """plan=True: BP 생성용 — 이상 징후를 모르는 '계획 시점' 믹스."""
    awd = min(0.95, max(0.05, DRIVE_AWD[mid] * ZONE_AWD_AFF[zid]))
    fwd = 1 - awd
    if not plan:
        for a in ANOMALIES:
            if a["type"] == "drive" and a["model"] == mid and zid in a["zones"] and i >= a["start"]:
                t = min(1, (i - a["start"] + 1) / a["ramp"])
                fwd *= 1 - (1 - a["fwd_factor"]) * t
    s = awd + fwd
    return {"AWD": awd / s, "FWD": fwd / s}

def mix_color(mid, zid, i, plan=False):
    md = next(m for m in MODELS if m["id"] == mid)
    w = COLOR_W[:]
    if not plan:
        for a in ANOMALIES:
            if a["type"] == "color" and (md["ev"] if a.get("ev_only") else True) \
               and zid in a["zones"] and i >= a["start"]:
                t = min(1, (i - a["start"] + 1) / a["ramp"])
                w[a["from_idx"]] -= a["shift"] * t
                w[a["to_idx"]] += a["shift"] * t
    s = sum(w)
    return [x / s for x in w]

# 트림별 대당 마진 = unit_margin × msrp_factor (마진율 유지 가정). NPF = 믹스 가중 정규화.
NPF = sum(TRIM_W[k] * TRIM_PRICE_F[k] for k in range(3))
# CSI 차종 민감도: 서베이는 VIN 연계 → 차종 필터 가능. 캠페인 딥은 AUR 오너에 집중.
CSI_MF = {"AUR": 4.0, "default": 0.71}   # Σ(판매비중×mf) ≈ 1 이 되도록 설정

# ── 내부 고객만족도 지수 (100점) — 외부 공시 CSI와 별도로, 내부 데이터에 연계된
#    구성요소(품질 클레임·커넥티드 클레임·서비스 예약·인도)를 모델링해 회사가 직접
#    관리·개선하는 지수. 개선 활동(OTA 등)이 클레임을 소멸시키면 계산식에 의해 점수가
#    회복되고, 그 결과가 지연을 두고 외부 CSI에 반영된다는 가설. ──
CSI_PROJECTS = [
    dict(project_id="OTA-2606-LUM", name="커넥티드 SW 결함 OTA 시정", model="LUM",
         component="connected", target=10000, start=29,          # 2026-05 결함 → 06 OTA 개시
         applied={29: 3000, 30: 7000, 31: 9500},
         claim0=8.5, claims={29: 3.1, 30: 0.9, 31: 0.4}, score_per_claim=2.2),
    dict(project_id="FSC-2603-AUR", name="Aurora EV 필드 서비스 캠페인 조기 완결", model="AUR",
         component="quality", target=26000, start=27,
         applied={27: 8200, 28: 17800, 29: 23600},
         claim0=6.2, claims={27: 4.1, 28: 2.2, 29: 1.1}, score_per_claim=3.2),
]

def claim_rate(mid, i, comp):
    """건/1000대. 결함 발생 → 개선 활동 적용률에 따라 소멸."""
    if comp == "connected":
        if mid == "LUM":
            return {28: 8.5, 29: 3.1, 30: 0.9, 31: 0.4}.get(i, 0.6)
        return 0.6
    if mid == "AUR":                                   # quality: 캠페인 → FSC로 조기 소멸
        return {26: 6.2, 27: 4.1, 28: 2.2, 29: 1.1}.get(i, 1.2 if i > 29 else 2.0)
    return 2.0

def internal_scores(mid, i):
    """월 i 차종별 내부지수 구성요소. 각 항목은 내부 원장(클레임·예약·재고)과 1:1 연계."""
    cq = claim_rate(mid, i, "quality")
    cc = claim_rate(mid, i, "connected")
    delay = 3.2 + ((4.5 if mid == "AUR" else 1.2) if EV_CAMP <= i <= EV_CAMP + 3 else 0)
    ds = row_of(min(i, NOW), mid)["ds"]
    quality = 100 - 3.2 * cq                    # 워런티+캠페인 클레임률
    connected = 93.4 - 2.2 * cc                 # 커넥티드/OTA 클레임률
    service = 100 - 2.2 * delay                 # 딜러 서비스 예약 지연(일)
    delivery = 96 - 0.9 * max(0, 45 - ds) - 0.35 * max(0, ds - 75)   # 인도 가용성
    total = 0.30 * quality + 0.25 * connected + 0.25 * service + 0.20 * delivery
    return dict(quality=quality, connected=connected, service=service,
                delivery=delivery, total=total)

# ── 이벤트 (실적 구간에 주입) ──────────────────────────────────────
EV_KR = 18        # 2025-07 KR-1 설비 이상 → LUM 생산 -20% (2개월)
EV_CAMP = 26      # 2026-03 Aurora EV 품질 캠페인 → 수요 위축·품질비·CSI 하락

# ═══════════════ V9 라이프사이클 상수 — 연간 업무 사이클 데이터 ═══════════════
# 판매법인의 1년 사이클: 상품 준비 → BP·트림믹스·FOB → 마케팅 → 월 주문 → 판매
# → VoC·품질(TSB/OTA) → 서비스·Parts. 각 단계가 데이터 실체를 갖는다.

# 연간 업무 캘린더 (month_from/to: 1~12, cadence: annual=연 1회 창 / monthly / continuous)
BIZ_CALENDAR = [
    dict(id="PP-1",  phase="product",   name="차년도 상품·Feature 확정",      cadence="annual",  m_from=4,  m_to=7,  owner="본사 상품기획", output="product_plan"),
    dict(id="BP-1",  phase="bp",        name="차년도 사업계획 수립 (Wholesale 기준)", cadence="annual", m_from=8, m_to=10, owner="판매법인 기획", output="bp_target"),
    dict(id="BP-2",  phase="bp",        name="차년도 트림믹스 결정",           cadence="annual",  m_from=10, m_to=10, owner="판매법인 상품", output="bp_trim_mix"),
    dict(id="BP-3",  phase="bp",        name="생산법인 전달 · FOB 확정",       cadence="annual",  m_from=11, m_to=11, owner="법인간 협의",   output="bp_trim_mix"),
    dict(id="MKT-1", phase="marketing", name="연간 마케팅 플랜 확정",          cadence="annual",  m_from=12, m_to=1,  owner="마케팅",        output="marketing_media"),
    dict(id="MKT-2", phase="marketing", name="Feature 매체 제작 (분기 캠페인)", cadence="quarterly", m_from=0, m_to=0, owner="마케팅·에이전시", output="marketing_media"),
    dict(id="MKT-3", phase="marketing", name="매체 퍼포먼스 관리",             cadence="monthly", m_from=0,  m_to=0,  owner="마케팅",        output="marketing_media"),
    dict(id="ORD-1", phase="order",     name="월 생산 주문 (DoS Weight 배분)", cadence="monthly", m_from=0,  m_to=0,  owner="판매법인 오더", output="order_plan"),
    dict(id="SLS-1", phase="sales",     name="도매·소매 운영",                cadence="continuous", m_from=0, m_to=0, owner="세일즈·딜러",   output="agg_kpi"),
    dict(id="SLS-2", phase="sales",     name="연말 판매 프로그램",             cadence="annual",  m_from=11, m_to=12, owner="세일즈",        output="price_incentive"),
    dict(id="QLT-1", phase="quality",   name="VoC·품질/안전 카테고리 모니터링", cadence="continuous", m_from=0, m_to=0, owner="품질",       output="voc_category"),
    dict(id="QLT-2", phase="quality",   name="TSB·OTA 시정 조치",             cadence="event",   m_from=0,  m_to=0,  owner="품질·서비스",   output="quality_actions"),
    dict(id="SVC-1", phase="service",   name="Parts 가격 개정 (DN/Factory 균형)", cadence="annual", m_from=2, m_to=2, owner="부품",        output="parts_pnl"),
    dict(id="SVC-2", phase="service",   name="Parts 판매 · 워런티 정산",       cadence="monthly", m_from=0,  m_to=0,  owner="부품·서비스",   output="parts_pnl"),
    dict(id="PP-2",  phase="product",   name="모델이어(MY) 전환",             cadence="annual",  m_from=8,  m_to=9,  owner="상품·오더",     output="vehicle_master"),
]

# 상품 준비 (MY별 신차/신규 트림/Feature — 게이트 G1 기획→G2 개발→G3 인증→G4 런칭)
PRODUCT_PLAN = [
    # MY2026 (완결 — 과거 이력)
    dict(my=2026, model="LUM", typ="feature",   name="커넥티드 2.0 (OTA 진단)",   launch="2025-10", gate="G4", ready=100),
    dict(my=2026, model="TRN", typ="new_trim",  name="Summit Black 에디션",       launch="2025-11", gate="G4", ready=100),
    dict(my=2026, model="AUR", typ="feature",   name="배터리 프리컨디셔닝",        launch="2025-09", gate="G4", ready=100),
    # MY2027 (NOW=2026-08 현재 준비 중 — 상품 단계의 현재 상태)
    dict(my=2027, model="SOL", typ="new_model", name="Solara EV (준중형 EV 세단)", launch="2027-03", gate="G2", ready=45),
    dict(my=2027, model="TRN", typ="new_trim",  name="X-Pro (오프로드 트림)",      launch="2026-11", gate="G3", ready=78),
    dict(my=2027, model="LUM", typ="feature",   name="OTA 2.0 플랫폼",            launch="2026-10", gate="G3", ready=85),
    dict(my=2027, model="AUR", typ="feature",   name="ADAS 3.0 하이웨이 어시스트", launch="2027-01", gate="G2", ready=60),
    dict(my=2027, model="VST", typ="my_change", name="MY27 연식변경 (12.3인치 인포테인먼트)", launch="2026-09", gate="G4", ready=96),
    dict(my=2027, model="NOV", typ="feature",   name="2열 라운지 시트",           launch="2026-12", gate="G3", ready=72),
]

# 트림믹스 계획: MY별 계획 믹스 (기본 TRIM_W 대비 시프트). EV는 상위 트림 강화.
def trim_mix_plan(mid, my):
    md = next(m for m in MODELS if m["id"] == mid)
    shift = 0.03 if md["ev"] else 0.015
    k = min(my - 2024, 3)
    w = [TRIM_W[0] - shift * k, TRIM_W[1], TRIM_W[2] + shift * k]
    s = sum(w)
    return [x / s for x in w]

FOB_RATIO = 0.62          # FOB ≈ MSRP × 0.62 (생산법인 인도가)
FOB_ESC = 1.025           # 연간 인상률

# 마케팅 매체 (Feature 캠페인): 매체별 배분·CPM·CTR·CVR — 퍼포먼스 관리 지표
MEDIA = [
    dict(id="TV",   name="TV·CTV",  w=0.40, cpm=32.0, ctr=0.0, cvr=0.0),
    dict(id="DIG",  name="디지털",   w=0.30, cpm=9.5,  ctr=0.9, cvr=1.6),
    dict(id="SOC",  name="소셜",     w=0.18, cpm=7.2,  ctr=1.4, cvr=0.9),
    dict(id="SRCH", name="검색",     w=0.12, cpm=21.0, ctr=3.4, cvr=4.2),
]
# 차종별 주력 Feature (연도 후반 인덱스 1로 전환 — 신규 Feature 캠페인)
MKT_FEATURES = {
    "TRN": ["V6 토잉 패키지", "X-Pro 오프로드"],
    "VST": ["하이브리드 연비", "12.3인치 인포테인먼트"],
    "AUR": ["롱레인지 배터리", "ADAS 3.0"],
    "MRD": ["스포츠 다이내믹", "가치 패키지"],
    "NOV": ["패밀리 라운지 시트", "슬라이딩 편의"],
    "LUM": ["V2L 파워", "OTA 2.0 커넥티드"],
}

# VoC 카테고리 (품질/안전 모니터링 축) — 기본 구성비
VOC_CATS = [
    ("파워트레인", 0.14), ("전장/배터리", 0.13), ("커넥티드/SW", 0.10), ("바디/내장", 0.15),
    ("샤시/조향", 0.11), ("안전/ADAS", 0.06), ("인포테인먼트", 0.13), ("공조", 0.08), ("기타", 0.10),
]
# 카테고리 스파이크 주입 (스토리): (model, category, {i: 가중배율}) — TSB/OTA 조치와 연동
VOC_SPIKES = [
    ("LUM", "커넥티드/SW", {28: 4.2, 29: 2.4, 30: 1.5, 31: 1.1}),          # SW 결함 → OTA로 소멸
    ("AUR", "전장/배터리", {26: 2.9, 27: 2.3, 28: 1.7, 29: 1.3}),          # 품질 캠페인 → FSC
    ("AUR", "안전/ADAS",   {26: 2.2, 27: 1.8, 28: 1.4, 29: 1.1}),
    ("TRN", "파워트레인",  {15: 2.1, 16: 1.9, 17: 1.5, 18: 1.2}),          # 오일 시일 → TSB
    ("MRD", "공조",        {25: 2.4, 26: 1.8, 27: 1.3}),                    # 블로어 소음 → TSB
    ("VST", "샤시/조향",   {30: 1.9, 31: 2.6}),                             # ★신규 탐지 (조치 미배정)
]

# 품질 조치 원장 (TSB / OTA / FSC / 조사) — VoC 스파이크에 대응하는 액션
QUALITY_ACTIONS = [
    dict(id="OTA-2606-LUM", typ="OTA", model="LUM", cat="커넥티드/SW", title="커넥티드 SW 결함 OTA 시정",
         detected="2026-05", target=10000, months={29: 3000, 30: 7000, 31: 9500},
         claim0=8.5, claims={29: 3.1, 30: 0.9, 31: 0.4}),
    dict(id="FSC-2603-AUR", typ="FSC", model="AUR", cat="전장/배터리", title="Aurora EV 필드 서비스 캠페인",
         detected="2026-03", target=26000, months={27: 8200, 28: 17800, 29: 23600},
         claim0=6.2, claims={27: 4.1, 28: 2.2, 29: 1.1}),
    dict(id="TSB-2504-TRN", typ="TSB", model="TRN", cat="파워트레인", title="오일 시일 누유 점검·교환 TSB",
         detected="2025-04", target=5200, months={15: 900, 16: 2400, 17: 4100, 18: 5000},
         claim0=3.8, claims={15: 3.1, 16: 2.4, 17: 1.7, 18: 1.4}),
    dict(id="TSB-2602-MRD", typ="TSB", model="MRD", cat="공조", title="블로어 모터 소음 TSB",
         detected="2026-02", target=3100, months={25: 600, 26: 1900, 27: 2900},
         claim0=2.9, claims={25: 2.3, 26: 1.6, 27: 1.1}),
    dict(id="INV-2608-VST", typ="조사", model="VST", cat="샤시/조향", title="조향 이음 신규 이슈 원인 조사",
         detected="2026-08", target=0, months={31: 0},
         claim0=2.6, claims={31: 2.6}),
]

# Parts 손익 — UIO(운행 차량) 기반. 워런티/캠페인 Parts 가격은 Dealer Net과 Factory
# 정산 기준 사이 균형이 필요 (gap>0: 딜러 유리 → 워런티 정산 시 판매법인 부담).
PARTS_UIO = 2_600_000          # 전체 UIO (누적 보유 대수)
PARTS_CATS = [
    # (카테고리, cp수요비중, 워런티비중, DN지수 초기, Factory지수)
    ("엔진/PT",    0.20, 0.24, 112, 100), ("전장/배터리", 0.14, 0.30, 118, 100),
    ("바디",       0.13, 0.10, 108, 100), ("샤시",       0.12, 0.16, 110, 100),
    ("소모품",     0.29, 0.12, 104, 100), ("액세서리",   0.12, 0.08, 106, 100),
]
PARTS_REPRICE = 25             # 2026-02 Parts 가격 개정 (DN/Factory 갭 축소)
CP_USD_PER_UIO = 3.2           # 고객부담 정비 Parts $/UIO/월
SC_MARGIN = dict(cp=0.26, warranty=0.08, campaign=0.03)   # 채널별 판매법인 마진율

# ═══════════════ V10 거버넌스 상수 — 목표 트리 · 워크플로우 게이트 · AI 에이전트 · 프로젝트 ═══════════════
# 근거: docs/oem-us-sales-process-research.md §3, docs/twin-world-consulting-review.md §3.
# 게이트 상태·프로젝트 리뷰는 규칙 기반(난수 없음) — 승인 이력은 감사 가능해야 한다.

# 회사 KPI 트리: 회사 목표(1년 관리) = 3영역(재무 37 · 사업 35 · 지속경영 25, 가중치 합 97)
# → 14개 CEO KPI → 다운스트림 노드(앱폴더 계층, folder/metric). 온톨로지 데이터에서
# 한 단계씩 올라오는 상향 롤업: leaf(bind) → folder → KPI → 영역 → CEO 종합.
# bind = 프론트 계산 키(''=미연결 → 데이터 수집 프로젝트 신설 대상), lever = 전략 레버 키.
CEO_TREE = [
    # ── 영역 (level=area) ──
    dict(id="AR-FIN", parent="",  lv="area", kind="folder", name="재무",     short="재무",  w=37,  bind="", unit="", dir="+", lever=""),
    dict(id="AR-BIZ", parent="",  lv="area", kind="folder", name="사업",     short="사업",  w=35,  bind="", unit="", dir="+", lever=""),
    dict(id="AR-ESG", parent="",  lv="area", kind="folder", name="지속경영", short="지속경영", w=25, bind="", unit="", dir="+", lever=""),
    # ── 재무 KPI (5+5+12+15 = 37) ──
    dict(id="KPI-ASP",   parent="AR-FIN", lv="kpi", kind="folder", name="ASP (인센티브 차감 후)", short="ASP",      w=5,  bind="asp",   unit="$",  dir="+", lever=""),
    dict(id="KPI-RECUR", parent="AR-FIN", lv="kpi", kind="folder", name="경상이익률",             short="경상이익", w=5,  bind="recur", unit="%",  dir="+", lever=""),
    dict(id="KPI-COMB",  parent="AR-FIN", lv="kpi", kind="folder", name="합산손익",               short="합산손익",  w=12, bind="comb",  unit="$",  dir="+", lever=""),
    dict(id="KPI-COMBR", parent="AR-FIN", lv="kpi", kind="folder", name="합산손익률",             short="합산손익률", w=15, bind="combr", unit="%",  dir="+", lever=""),
    # ── 사업 KPI (10+10+10+5 = 35) ──
    dict(id="KPI-WS",    parent="AR-BIZ", lv="kpi", kind="folder", name="도매판매량",               short="도매판매",  w=10, bind="ws",    unit="대", dir="+", lever=""),
    dict(id="KPI-SUV",   parent="AR-BIZ", lv="kpi", kind="folder", name="볼륨 SUV 육성 (소매)",     short="SUV육성",   w=10, bind="suv",   unit="대", dir="+", lever=""),
    dict(id="KPI-SHARE", parent="AR-BIZ", lv="kpi", kind="folder", name="시장점유율",               short="점유율", w=10, bind="share", unit="%",  dir="+", lever=""),
    dict(id="KPI-EV",    parent="AR-BIZ", lv="kpi", kind="folder", name="친환경 소매판매량 (소매)", short="친환경", w=5,  bind="ev",    unit="대", dir="+", lever=""),
    # ── 지속경영 KPI (5+5+3.5+3.5+3+5 = 25) ──
    dict(id="KPI-GREEN", parent="AR-ESG", lv="kpi", kind="folder", name="그린워싱",           short="그린워싱",  w=5,   bind="",       unit="건", dir="-", lever=""),
    dict(id="KPI-FSI",   parent="AR-ESG", lv="kpi", kind="folder", name="Full SI 2.0",        short="Full SI",   w=5,   bind="",       unit="%",  dir="+", lever=""),
    dict(id="KPI-CSIS",  parent="AR-ESG", lv="kpi", kind="folder", name="고객만족도 (서비스)", short="CS서비스", w=3.5, bind="csisvc", unit="점", dir="+", lever=""),
    dict(id="KPI-CSIP",  parent="AR-ESG", lv="kpi", kind="folder", name="고객만족도 (판매)",   short="CS판매", w=3.5, bind="csidlv", unit="점", dir="+", lever=""),
    dict(id="KPI-SEC",   parent="AR-ESG", lv="kpi", kind="folder", name="보안",               short="보안",      w=3,   bind="",       unit="건", dir="-", lever=""),
    dict(id="KPI-BRAND", parent="AR-ESG", lv="kpi", kind="folder", name="브랜드트래커",        short="브랜드",    w=5,   bind="brand",  unit="점", dir="+", lever=""),
    # ── 다운스트림: ASP ──
    dict(id="ND-ASP-MIX", parent="KPI-ASP", lv="node", kind="metric", name="트림 믹스 프리미엄", short="믹스", w=0, bind="mixprem", unit="$", dir="+", lever=""),
    dict(id="ND-ASP-INC", parent="KPI-ASP", lv="node", kind="metric", name="대당 인센티브",      short="인센티브", w=0, bind="incunit", unit="$", dir="-", lever=""),
    dict(id="ND-ASP-FX",  parent="KPI-ASP", lv="node", kind="metric", name="환율 영향",          short="환율", w=0, bind="", unit="$", dir="~", lever=""),
    # ── 다운스트림: 경상이익률 (예시 딥 체인 — 오피스 관리비 → 전력사용량) ──
    dict(id="ND-OPEX",    parent="KPI-RECUR", lv="node", kind="folder", name="오피스 관리비",  short="관리비", w=0, bind="opex", unit="$", dir="-", lever=""),
    dict(id="ND-ENERGY",  parent="ND-OPEX",   lv="node", kind="metric", name="전력사용량",     short="전력", w=0, bind="energy", unit="$", dir="-", lever="hvac"),
    dict(id="ND-LEASE",   parent="ND-OPEX",   lv="node", kind="metric", name="임차·시설",      short="임차", w=0, bind="lease", unit="$", dir="-", lever=""),
    dict(id="ND-SUPPLY",  parent="ND-OPEX",   lv="node", kind="metric", name="소모품·기타",    short="소모품", w=0, bind="", unit="$", dir="-", lever=""),
    dict(id="ND-PARTS",   parent="KPI-RECUR", lv="node", kind="metric", name="Parts 손익",     short="Parts", w=0, bind="parts", unit="k$", dir="+", lever=""),
    dict(id="ND-LOGI",    parent="KPI-RECUR", lv="node", kind="metric", name="물류·운송비",    short="물류비", w=0, bind="freight", unit="$", dir="-", lever=""),
    dict(id="ND-FINCOST", parent="KPI-RECUR", lv="node", kind="metric", name="금융 비용",      short="금융비용", w=0, bind="", unit="$", dir="-", lever=""),
    # ── 다운스트림: 합산손익·합산손익률 ──
    dict(id="ND-OP",      parent="KPI-COMB",  lv="node", kind="metric", name="영업이익 (판매법인)", short="영업이익", w=0, bind="op", unit="$", dir="+", lever=""),
    dict(id="ND-CAPTIVE", parent="KPI-COMB",  lv="node", kind="metric", name="금융법인 손익 (캡티브)", short="캡티브", w=0, bind="captive", unit="$", dir="+", lever=""),
    dict(id="ND-REV",     parent="KPI-COMBR", lv="node", kind="metric", name="도매 매출",       short="매출", w=0, bind="rev", unit="$", dir="+", lever=""),
    # ── 다운스트림: 도매판매량 ──
    dict(id="ND-ORD",  parent="KPI-WS", lv="node", kind="metric", name="월 생산 주문",    short="주문", w=0, bind="ord", unit="대", dir="+", lever=""),
    dict(id="ND-DS",   parent="KPI-WS", lv="node", kind="metric", name="재고 일수 (DS)",  short="DS", w=0, bind="ds", unit="일", dir="~", lever=""),
    dict(id="ND-PIPE", parent="KPI-WS", lv="node", kind="metric", name="해상 파이프라인", short="파이프라인", w=0, bind="", unit="대", dir="~", lever=""),
    # ── 다운스트림: SUV 육성 ──
    dict(id="ND-TRN",    parent="KPI-SUV", lv="node", kind="metric", name="Terron 소매 (대형 SUV)", short="TRN", w=0, bind="m_TRN", unit="대", dir="+", lever=""),
    dict(id="ND-VST",    parent="KPI-SUV", lv="node", kind="metric", name="Vista 소매 (중형 SUV)",  short="VST", w=0, bind="m_VST", unit="대", dir="+", lever=""),
    dict(id="ND-SUVINC", parent="KPI-SUV", lv="node", kind="metric", name="SUV 인센티브 효율",      short="SUV인센", w=0, bind="suvinc", unit="$", dir="-", lever=""),
    # ── 다운스트림: 시장점유율 ──
    dict(id="ND-IND",  parent="KPI-SHARE", lv="node", kind="metric", name="산업 수요 (SAAR)",  short="산업수요", w=0, bind="industry", unit="대", dir="~", lever=""),
    dict(id="ND-COMP", parent="KPI-SHARE", lv="node", kind="metric", name="경쟁사 런칭 모니터링", short="경쟁", w=0, bind="", unit="건", dir="~", lever=""),
    # ── 다운스트림: 친환경 ──
    dict(id="ND-AUR", parent="KPI-EV", lv="node", kind="metric", name="Aurora EV 소매", short="AUR", w=0, bind="m_AUR", unit="대", dir="+", lever=""),
    dict(id="ND-LUM", parent="KPI-EV", lv="node", kind="metric", name="Lumen EV 소매",  short="LUM", w=0, bind="m_LUM", unit="대", dir="+", lever=""),
    dict(id="ND-CHG", parent="KPI-EV", lv="node", kind="metric", name="충전 인프라 파트너십", short="충전", w=0, bind="", unit="건", dir="+", lever=""),
    # ── 다운스트림: 지속경영 ──
    dict(id="ND-GREEN-AD", parent="KPI-GREEN", lv="node", kind="metric", name="광고 환경 표기 심의", short="광고심의", w=0, bind="", unit="건", dir="-", lever=""),
    dict(id="ND-FSI-DLR",  parent="KPI-FSI",   lv="node", kind="metric", name="딜러 SI 2.0 적용률",  short="딜러SI", w=0, bind="", unit="%", dir="+", lever=""),
    dict(id="ND-VOC",   parent="KPI-CSIS", lv="node", kind="metric", name="VoC·클레임 발생률", short="VoC", w=0, bind="voc", unit="/1k", dir="-", lever=""),
    dict(id="ND-CAMP",  parent="KPI-CSIS", lv="node", kind="metric", name="품질 캠페인 커버리지", short="캠페인", w=0, bind="camp", unit="%", dir="+", lever=""),
    dict(id="ND-DLV",   parent="KPI-CSIP", lv="node", kind="metric", name="인도 리드타임 지수", short="인도", w=0, bind="csidlv", unit="점", dir="+", lever=""),
    dict(id="ND-DEXP",  parent="KPI-CSIP", lv="node", kind="metric", name="딜러 구매 경험",     short="구매경험", w=0, bind="", unit="점", dir="+", lever=""),
    dict(id="ND-SECP",  parent="KPI-SEC",  lv="node", kind="metric", name="차량 SW 보안 패치",  short="SW패치", w=0, bind="", unit="%", dir="+", lever=""),
    dict(id="ND-SECIT", parent="KPI-SEC",  lv="node", kind="metric", name="IT 침해 시도 대응",  short="IT보안", w=0, bind="", unit="건", dir="-", lever=""),
    dict(id="ND-ADST",  parent="KPI-BRAND", lv="node", kind="metric", name="광고 인지 잔존 (adstock)", short="인지", w=0, bind="adstock", unit="점", dir="+", lever=""),
    dict(id="ND-SOC",   parent="KPI-BRAND", lv="node", kind="metric", name="소셜 감성 지수",   short="소셜", w=0, bind="", unit="점", dir="+", lever=""),
]

# ── 시설 에너지 (전력사용량 leaf의 데이터 실체) — HQ 캠퍼스 동관/서관 × 3층 × 구역 ──
# (building, floor, zone_id, zone_name, zone_type, area_m2)
# zone_type: 사무/회의/공용/항온(서버실 — 항온 유지, HVAC 레버 제외)
OFFICE_ZONES = [
    ("동관", 1, "E1-LOB", "로비·안내",        "공용", 900),
    ("동관", 1, "E1-CAF", "카페테리아",       "공용", 700),
    ("동관", 1, "E1-OFA", "사무 A",           "사무", 1400),
    ("동관", 1, "E1-MTG", "회의실 존",        "회의", 600),
    ("동관", 1, "E1-SRV", "서버실",           "항온", 400),
    ("동관", 2, "E2-OFA", "사무 A",           "사무", 1500),
    ("동관", 2, "E2-OFB", "사무 B",           "사무", 1300),
    ("동관", 2, "E2-MTG", "회의실 존",        "회의", 500),
    ("동관", 2, "E2-COM", "공용",             "공용", 300),
    ("동관", 3, "E3-OFA", "사무 A",           "사무", 1500),
    ("동관", 3, "E3-OFB", "사무 B",           "사무", 1200),
    ("동관", 3, "E3-EXE", "임원실",           "사무", 600),
    ("동관", 3, "E3-COM", "공용",             "공용", 300),
    ("서관", 1, "W1-TRN", "교육장",           "회의", 1100),
    ("서관", 1, "W1-SHW", "전시·딜러 라운지", "공용", 900),
    ("서관", 1, "W1-OFA", "사무 A",           "사무", 1000),
    ("서관", 1, "W1-COM", "공용",             "공용", 400),
    ("서관", 2, "W2-OFA", "사무 A",           "사무", 1400),
    ("서관", 2, "W2-OFB", "사무 B",           "사무", 1200),
    ("서관", 2, "W2-MTG", "회의실 존",        "회의", 500),
    ("서관", 2, "W2-COM", "공용",             "공용", 300),
    ("서관", 3, "W3-CC",  "콜센터",           "사무", 1300),
    ("서관", 3, "W3-OFA", "사무 A",           "사무", 1100),
    ("서관", 3, "W3-COM", "공용",             "공용", 400),
]
# 구역 타입별 배율: (HVAC 배율, 기저 배율, 소모품 배율, 설정온도) — 항온은 레버 제외
ZTYPE = {
    "사무": dict(hvac=1.0, base=1.0, sup=1.0, temp=22.0),
    "회의": dict(hvac=0.9, base=0.9, sup=0.8, temp=22.5),
    "공용": dict(hvac=0.8, base=1.1, sup=1.3, temp=23.0),
    "항온": dict(hvac=0.6, base=7.0, sup=0.5, temp=20.0),   # 서버실: 기저(IT부하) 큼
}
# HVAC 수요 곡선 (월별, 냉방 여름 피크) · 요금 · 레버 감도 — JS 미러와 동일 상수
HVAC_F = [0.55, 0.50, 0.60, 0.80, 1.05, 1.35, 1.60, 1.65, 1.30, 0.90, 0.70, 0.60]
ENERGY = dict(rate_peak=0.29, rate_off=0.115,     # $/kWh (피크/비피크)
              hvac_kwh_m2=11.0, base_kwh_m2=8.0,  # 월 원단위 (HVAC는 HVAC_F 배율)
              peak_share=0.58,                    # 피크 시간대 사용 비중
              degc_sens=0.05,                     # 냉방 설정 +1°C당 HVAC 피크 -5%
              precool_shift=0.12,                 # 사전 예냉 -2°C 시 피크→비피크 이동 비중
              precool_penalty=0.25,               # 예냉 추가 소비 (이동량 대비)
              cool_months=(5, 6, 7, 8, 9),        # 냉방 전략 적용 월
              offseason_factor=0.35,              # 비냉방기 난방 전략 효과 배율
              sup_rate=5.2,                       # 소모품·기타 추정 $/m²/월 (미연결 — 예산 모델)
              # 캠퍼스 전력 흐름 (주차장 태양광 캐노피 · EV 충전기) — 흐름도 모델 상수
              solar_kwp=850,                                          # 태양광 설비 용량 kWp
              solar_cf=[0.13, 0.15, 0.18, 0.21, 0.23, 0.24,           # 월별 이용률 (720h 기준)
                        0.23, 0.22, 0.20, 0.17, 0.13, 0.11],
              ev_chargers=36, ev_kwh_mo=1150, ev_growth=0.02)         # 충전기 수·기당 kWh/월·월 성장
RENT_RATE = {"동관": 40, "서관": 34}              # 임차 단가 $/m²/월 (항온존 +10 설비 가산)
OPEX_FIXED_ETC = 115_000                          # 소모품·기타 (미연결 — 추정치, V10 opex 구성)
def zone_rent(bld, ztype, area):
    return area * (RENT_RATE[bld] + (10 if ztype == "항온" else 0))
OPEX_LEASE = sum(zone_rent(b, t, a) for b, f, zid, zn, t, a in OFFICE_ZONES)   # 임차 합 (단일 소스)
CAPTIVE_PEN = 0.55                                # 캡티브 금융 침투율
CAPTIVE_UNIT = 620                                # 금융법인 대당 손익 $
IND_BASE = {"대형 SUV": 195000, "중형 SUV": 260000, "대형 EV SUV": 48000,
            "중형 세단": 150000, "미니밴": 62000, "준중형 EV CUV": 85000}   # market_industry와 동일

# AI 에이전트 레지스트리 — 위임 가능 업무 (사람은 승인·예외만: 가이드 §9 P4)
AI_AGENTS = [
    dict(id="AGT-ORD", name="주문 배분 에이전트",     scope="ORD-1", task="DoS Weight 셀 배분 초안 생성", acc=97.2),
    dict(id="AGT-VOC", name="VoC 분류 에이전트",      scope="QLT-1", task="VoC 카테고리·심각도 자동 분류", acc=94.8),
    dict(id="AGT-MED", name="매체 예산 에이전트",     scope="MKT-3", task="CPM·CTR 기반 예산 재배분",     acc=91.5),
    dict(id="AGT-VIN", name="캠페인 VIN 추출 에이전트", scope="QLT-2", task="조치 대상 VIN 추출",          acc=99.6),
    dict(id="AGT-BP",  name="BP 초안 에이전트",       scope="BP-1",  task="믹스 모델 기반 BP 초안 생성",  acc=89.0),
]

# 활동별 워크플로우 게이트 체인: (gate_id, 이름, 유형 hitl|ai|auto, 승인자/에이전트)
# HITL 판정 근거는 리서치 §3.4 — 손익 확약·안전(규제)·딜러 관계 결정은 사람이 승인.
WORKFLOW_GATES = {
    "PP-1":  [("G1", "Feature 게이트 심사",        "hitl", "상품위원회")],
    "PP-2":  [("G1", "MY 코드 전환",               "auto", "시스템")],
    "BP-1":  [("G1", "BP 초안 생성",               "ai",   "AGT-BP"),
              ("G2", "계획 검토",                  "hitl", "기획 임원"),
              ("G3", "BP 승인",                    "hitl", "법인장")],
    "BP-2":  [("G1", "트림믹스 초안",              "ai",   "AGT-BP"),
              ("G2", "트림믹스 확정",              "hitl", "상품 임원")],
    "BP-3":  [("G1", "FOB 협의 승인",              "hitl", "법인장"),
              ("G2", "생산법인 전송",              "auto", "시스템")],
    "MKT-1": [("G1", "연간 플랜 초안",             "ai",   "AGT-MED"),
              ("G2", "플랜 승인",                  "hitl", "CMO")],
    "MKT-2": [("G1", "크리에이티브 검수",          "hitl", "마케팅"),
              ("G2", "런칭 배포",                  "auto", "시스템")],
    "MKT-3": [("G1", "예산 재배분",                "ai",   "AGT-MED")],
    "ORD-1": [("G1", "DoS Weight 배분 초안",       "ai",   "AGT-ORD"),
              ("G2", "주문 승인",                  "hitl", "오더 매니저"),
              ("G3", "생산법인 전송",              "auto", "시스템")],
    "SLS-1": [("G1", "도매·소매 정산",             "auto", "시스템")],
    "SLS-2": [("G1", "프로그램 승인",              "hitl", "세일즈 임원")],
    "QLT-1": [("G1", "VoC 분류·이슈 감지",         "ai",   "AGT-VOC")],
    "QLT-2": [("G1", "조치 결정 (리콜/OTA/TSB)",   "hitl", "품질위원회"),
              ("G2", "대상 VIN 추출",              "ai",   "AGT-VIN"),
              ("G3", "완결 판정",                  "hitl", "품질")],
    "SVC-1": [("G1", "가격 개정 승인",             "hitl", "부품 임원")],
    "SVC-2": [("G1", "워런티 정산",                "auto", "시스템")],
}

# ═══════════════ 차량 신호 (feature_usage) — 주행·DTC·기능 사용 월 스냅샷 ═══════════════
# IT 전략 월드(차량 데이터)의 원장이자 온톨로지 featureUsageEvent 바인딩·mlModel 학습 피처.
# KPI 영향이 데이터 안에 실재하도록 설계: LUM DTC 스파이크(커넥티드 결함)가 내부 CSI
# 하락(CSI_PROJECTS OTA-2606-LUM)과 같은 달에 발생하고 OTA 적용으로 소멸, AUR은 FSC 스토리.
# HDA 사용률·커넥티드 옵트인은 우상향(브랜드·CS 우호), 트레일러 모드는 견인 차종 한정.
VD_FEATURE = {  # (hda0, hda_slope, trailer0, dtc_base, trip_f)
    "TRN": (22, 0.55, 18.0, 6.5, 1.15), "VST": (18, 0.50, 6.0, 5.8, 1.05),
    "AUR": (34, 0.80, 2.0, 8.6, 0.95),  "MRD": (12, 0.45, 0.5, 5.2, 0.95),
    "NOV": (16, 0.50, 9.0, 6.1, 1.10),  "LUM": (30, 0.75, 1.0, 6.8, 0.90),
}
VD_COLS = ["ym", "model_id", "hda_usage_pct", "trailer_mode_pct", "fota_install_pct",
           "connected_optin_pct", "dtc_per_1k", "trips_per_vehicle"]

def vdata_rows(i):
    """DTC/1k는 내부지수가 쓰는 claim_rate와 동일 소스에서 파생 — 차량 신호 ↔ KPI(CSI)의
    인과가 데이터 안에 실재해서 드라이버 발굴(상관)이 근거를 갖는다."""
    rng = random.Random(SEED * 7 + i)
    rows = []
    for md in MODELS:
        h0, hs, tr0, dtc0, tf = VD_FEATURE[md["id"]]
        hda = min(68, h0 + hs * i) * (1 + rng.gauss(0, 0.02))
        trailer = (tr0 + 0.06 * i if tr0 >= 5 else tr0) * (1 + rng.gauss(0, 0.03))
        fota = min(97, 55 + 0.9 * i + (10 if md["id"] == "LUM" and i >= 30 else 0))
        optin = min(82, 52 + 0.7 * i + (8 if md["ev"] else 0))
        ev = claim_rate(md["id"], i, "connected") + claim_rate(md["id"], i, "quality")
        dtc = max(1.5, dtc0 - 0.02 * i + 0.9 * (ev - 2.6)) * (1 + rng.gauss(0, 0.02))
        trips = 36 * tf * SEAS[i % 12] * (1 + 0.004 * i) * (1 + rng.gauss(0, 0.02))
        rows.append([MONTHS[i], md["id"], round(hda, 1), round(trailer, 1), round(fota, 1),
                     round(optin, 1), round(dtc, 2), round(trips, 1)])
    return rows

def gen_vdata():
    for i in range(NOW + 1):
        write_csv(os.path.join(ROOT, "feature_usage", f"{MONTHS[i]}.csv"), VD_COLS, vdata_rows(i))

# 프로젝트 원장 — 목표 노드 아래 Top-down으로 구성된 실행 단위.
# links = 온톨로지 객체 키("type:id"), start/end = 월 인덱스, metric = 리뷰 측정 지표.
PROJECTS = [
    dict(id="PRJ-OTA-LUM",  name="루멘 커넥티드 OTA 품질 회복",  goal="ND-VOC",  tmpl="quality",
         model="LUM", start=29, end=31, status="완결",
         metric="클레임/1k", expect=0.5, links=["model:LUM", "qualityCampaign:OTA-2606-LUM", "qualityIssue:QI-2605-LUM-CONN"]),
    dict(id="PRJ-FSC-AUR",  name="Aurora EV 필드 서비스 캠페인", goal="ND-CAMP", tmpl="quality",
         model="AUR", start=27, end=29, status="완결",
         metric="캠페인 적용률 %", expect=90.0, links=["model:AUR", "qualityCampaign:FSC-2603-AUR"]),
    dict(id="PRJ-GRAY-ORD", name="그레이 색상 수요 대응 증산",   goal="ND-DS",   tmpl="order",
         model="LUM", start=29, end=None, status="진행중",
         metric="NE 그레이 Weight", expect=1.20, links=["model:LUM", "salesZone:northeast"]),
    dict(id="PRJ-EV-SOUTH", name="남부 EV 인지 캠페인",          goal="KPI-EV",  tmpl="media",
         model="AUR", start=30, end=None, status="진행중",
         metric="AUR 남부 소매(대)", expect=1350.0, links=["model:AUR", "salesZone:south", "marketingCampaign:MK-AUR"]),
    dict(id="PRJ-PARTS-BAL", name="Parts DN/Factory 갭 개선",    goal="ND-PARTS", tmpl="parts",
         model="", start=25, end=25, status="완결",
         metric="평균 갭 %", expect=4.5, links=["salesCompany:SC-US"]),
    dict(id="PRJ-SOL-LAUNCH", name="Solara EV 런칭 준비",        goal="KPI-SHARE", tmpl="product",
         model="SOL", start=25, end=None, status="진행중",
         metric="런칭 준비율 %", expect=100.0, links=["model:SOL", "plant:US-SV"]),
]

# 프로젝트 컴포저 템플릿 — 새 프로젝트 추가 시 기대 임팩트 산식의 파라미터
PRJ_TEMPLATES = [
    dict(id="order",    name="증산/감산 (DoS Weight)", goal="ND-DS",     desc="지역×색상 Weight 조정으로 재고 정상화"),
    dict(id="incent",   name="인센티브 프로그램",       goal="KPI-WS",    desc="가격탄력 기반 판매 증분 — 이익 트레이드오프"),
    dict(id="media",    name="매체 강화 캠페인",        goal="KPI-SHARE", desc="adstock 로그 체감 모델로 수요 증분"),
    dict(id="quality",  name="품질 조치 (TSB/OTA)",     goal="KPI-CSIS",  desc="클레임 소멸 → 내부 지수 회복"),
    dict(id="parts",    name="Parts 가격 프로그램",     goal="ND-PARTS",  desc="DN/Factory 갭 조정 → 워런티 마진"),
    dict(id="facility", name="에너지 전략 레버",        goal="ND-ENERGY", desc="피크 설정온도·예냉 전략으로 관리비 절감"),
    dict(id="data",     name="데이터 수집·바인딩",      goal="",          desc="미연결 지표의 데이터 파이프라인 구축 → 레버 신설"),
]

# ── 전략 입력 히스토리 (레버가 과거에 실제로 움직였음을 데이터에 남김) ──
def incentive_of(mi, i):
    """대당 인센티브 $. 연말 밀어내기·재고 소진 프로그램 반영."""
    base = 1200 + 250 * (1 - SEAS[i % 12])            # 비수기일수록 인센티브↑
    md = MODELS[mi]
    if i % 12 == 10 or i % 12 == 11: base += 500      # 11·12월 연말 프로그램
    if md["id"] == "MRD" and 20 <= i <= 23: base += 700   # 2025 하반기 세단 재고 소진
    if md["id"] == "AUR" and EV_CAMP <= i <= EV_CAMP + 3: base += 900  # 캠페인 방어
    if md["ev"]: base += 300                           # EV 보조 프로그램
    return round(base / 25) * 25

def marketing_of(mi, i):
    """모델별 월 마케팅비 $M. 신차 런칭·캠페인 방어 포함."""
    md = MODELS[mi]
    base = 45.0 * md["share"] * (0.9 + 0.2 * SEAS[i % 12])
    if md["id"] == "AUR" and 12 <= i <= 15: base *= 1.9   # 2025 상반기 AUR 판촉 캠페인
    if md["id"] == "AUR" and EV_CAMP <= i <= EV_CAMP + 2: base *= 1.4
    return base

MKT_BASE = {m["id"]: 45.0 * m["share"] for m in MODELS}   # adstock 기준 지출

PRICE_ELAST = 1.6         # 가격탄력성 (자동차 -1~-2 문헌 범위)
INC_REF = 1200            # 기준 인센티브
ADSTOCK = 0.5             # 마케팅 이월률

def demand_model(mi, i, adstock_prev, rnd):
    """구조적 수요 모델 — v7 JS 시뮬레이터와 동일 구조."""
    md = MODELS[mi]
    growth = 1 + 0.055 * (i // 12) + 0.002 * (i % 12)
    if md["ev"]: growth += 0.04 * (i // 12)            # EV 침투 가속
    base = US_BASE * md["share"] * SEAS[i % 12] * growth
    # 가격 레버: 실거래가 = MSRP - 인센티브
    inc = incentive_of(mi, i)
    price_f = ((md["msrp"] - inc) / (md["msrp"] - INC_REF)) ** (-PRICE_ELAST)
    # 마케팅 adstock + 포화(로그 체감)
    spend = marketing_of(mi, i)
    ad = spend + ADSTOCK * adstock_prev
    mkt_f = 1 + 0.10 * math.log(max(ad, 1) / (MKT_BASE[md["id"]] * (1 + ADSTOCK))) / math.log(2)
    mkt_f = max(0.85, min(1.25, mkt_f))
    # 품질 캠페인 수요 위축
    camp_f = 1.0
    if md["id"] == "AUR":
        camp_f = {EV_CAMP: 0.90, EV_CAMP + 1: 0.93, EV_CAMP + 2: 0.96}.get(i, 1.0)
    noise = 1 + rnd.gauss(0, 0.025)
    return base * price_f * mkt_f * camp_f * noise, ad, inc, spend

# ── 월 루프: 수요→소매→도매(재고 수렴)→생산(리드 시프트)→주문 역산 ──
def build_series():
    rows = []                       # 모델×월 국가 단위 원장
    stock = {m["id"]: US_BASE * m["share"] * 2.0 for m in MODELS}   # 초기 재고 = 2개월치
    adstock_prev = {m["id"]: MKT_BASE[m["id"]] for m in MODELS}
    retail_hist = {m["id"]: [] for m in MODELS}

    for i in range(NOW + 1):
        for mi, md in enumerate(MODELS):
            demand, ad, inc, spend = demand_model(mi, i, adstock_prev[md["id"]], R)
            adstock_prev[md["id"]] = ad
            # 소매는 수요와 재고 가용성의 최소치 (재고 부족 시 판매 기회 손실)
            avail_f = min(1.0, stock[md["id"]] / max(demand * 0.9, 1))
            retail = demand * (0.75 + 0.25 * avail_f)
            retail = min(retail, stock[md["id"]] * 0.95)
            retail_hist[md["id"]].append(retail)
            # 도매 = 수요 + 재고 갭 수렴 (목표 DS 60일)
            ma3 = sum(retail_hist[md["id"]][-3:]) / len(retail_hist[md["id"]][-3:])
            target_stock = ma3 * DS_TARGET / 30.4
            desired_ws = max(0, demand + (target_stock - stock[md["id"]]) * 0.5)
            # 공급 제약: 생산은 리드타임 전에 결정됨 + 설비 이벤트
            supply_f = 1.0
            lead = PLANT_LEAD[md["plant"]]
            prod_month = i - lead
            if md["plant"] == "KR-1" and prod_month in (EV_KR, EV_KR + 1):
                supply_f = 0.80 if prod_month == EV_KR else 0.90
            cap = PLANT_CAP[md["plant"]]
            ws = min(desired_ws * supply_f, cap * 1.05)
            stock[md["id"]] = max(0, stock[md["id"]] + ws - retail)
            ds = stock[md["id"]] / max(retail / 30.4, 1)
            rows.append(dict(i=i, ym=MONTHS[i], model=md["id"], demand=demand,
                             retail=retail, wholesale=ws, stock=stock[md["id"]],
                             ds=ds, incentive=inc, mkt_spend=spend))
    return rows

SERIES = build_series()
def row_of(i, mid):
    return next(r for r in SERIES if r["i"] == i and r["model"] == mid)

# ── BP (사업계획): 연 총량 → 월 배분. 미래 48개월 전체 ─────────────
BP_YEAR = {2024: 700000, 2025: 745000, 2026: 790000, 2027: 850000}
def bp_retail(mi, i):
    md = MODELS[mi]
    share = md["share"] * (1 + (0.06 if md["ev"] else -0.012) * (i // 12))
    return BP_YEAR[2024 + i // 12] / 12 * SEAS[i % 12] * share

# ── 파일 유틸 ─────────────────────────────────────────────────────
def write_csv(path, header, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)

def q(x): return int(round(x))
def f1(x): return round(x, 1)

# ═══════════════ 마스터 (파티션 없음) ═══════════════
def gen_master():
    d = os.path.join(ROOT, "master")
    write_csv(os.path.join(d, "dim_model.csv"),
              ["model_id", "model_name", "segment", "primary_plant_id", "msrp_usd", "unit_margin_usd", "is_ev"],
              [[m["id"], m["name"], m["seg"], m["plant"], m["msrp"], m["margin"], m["ev"]] for m in MODELS])
    write_csv(os.path.join(d, "dim_trim.csv"),
              ["model_id", "trim_id", "trim_name", "mix_weight", "msrp_factor"],
              [[m["id"], f"{m['id']}-{t[:2].upper()}", t, TRIM_W[ti], TRIM_PRICE_F[ti]]
               for m in MODELS for ti, t in enumerate(TRIMS[m["id"]])])
    write_csv(os.path.join(d, "dim_plant.csv"),
              ["plant_id", "plant_name", "country", "cap_month", "lead_month", "ship_mode", "batch_size", "wmi", "freight_usd_per_unit"],
              [[p["id"], p["name"], p["country"], p["cap"], p["lead_m"], p["ship"], p["batch"], p["wmi"], FREIGHT[p["id"]]] for p in PLANTS])
    write_csv(os.path.join(d, "dim_zone.csv"),
              ["zone_id", "zone_name", "dealer_cnt", "pop_share", "ev_affinity"],
              [[z["id"], z["name"], z["dealers"], z["share"], z["ev_aff"]] for z in ZONES])
    write_csv(os.path.join(d, "dim_sales_company.csv"),
              ["company_id", "company_name", "market", "twin_level"],
              [["SC-US", "미국판매법인", "US", "full"],
               ["SC-CA", "캐나다판매법인", "CA", "aggregate"],
               ["SC-MX", "멕시코판매법인", "MX", "aggregate"]])
    write_csv(os.path.join(d, "dim_route.csv"),
              ["route_id", "plant_id", "legs", "total_lead_days"],
              [["KR1-W", "KR-1", "공장→국내수출항(2d)→해상(18d)→서부수입항(3d)→내륙철도(9d)", 32],
               ["KR2-W", "KR-2", "공장→국내수출항(2d)→해상(18d)→서부수입항(3d)→내륙철도(9d)", 32],
               ["GA-D",  "US-GA", "공장→상차(1d)→트럭·철도(3d)", 4],
               ["SV-D",  "US-SV", "공장→상차(1d)→트럭·철도(3d)", 4],
               ["MX-D",  "MX-MT", "공장→철도(7d)→통관(1d)→트럭(2d)", 10]])

# ═══════════════ 월 파티션 팩트 ═══════════════
def month_rng(i, tag):
    # 주의: 내장 hash()는 프로세스마다 salt가 달라 재현이 깨진다 → crc32로 고정
    import zlib
    return random.Random(SEED * 1000 + i * 37 + zlib.crc32(tag.encode()) % 997)

def gen_month(i):
    """실적월 i의 모든 데이터셋 파일 생성."""
    m = MONTHS[i]
    rng = month_rng(i, "zone")

    # 1) agg_kpi: 통합 KPI 큐브 — 모든 KPI(판매·도매·영업이익·재고·DS·CSI)를
    #    "공통 차원 컬럼"(ym, zone, model, MY, trim, engine, drivetrain, color)으로 집계.
    #    실 파이프라인에선 vin_* 원장 × vehicle_master 조인 → group-by 로 생성되는 산출물이다.
    rows_kpi = []
    camp_dip_m = {EV_CAMP: 4.5, EV_CAMP + 1: 3.6, EV_CAMP + 2: 2.2, EV_CAMP + 3: 1.1}.get(i, 0)
    for md in MODELS:
        r = row_of(i, md["id"])
        camp = md["id"] == "AUR" and EV_CAMP <= i <= EV_CAMP + 3
        M = r["wholesale"] * md["margin"]
        costs = (r["retail"] * r["incentive"] + r["wholesale"] * FREIGHT[md["plant"]]
                 + r["retail"] * 120 + (14e6 if camp else 0) + r["mkt_spend"] * 1e6)
        zw = zone_weights(md)
        eng = mix_engine(md["id"], i)
        myx = mix_my(i)
        mf = CSI_MF.get(md["id"], CSI_MF["default"])
        for zi, z in enumerate(ZONES):
            drv = mix_drive(md["id"], z["id"], i)
            cmx = mix_color(md["id"], z["id"], i)
            zf = 1.3 if z["ev_aff"] > 1 else 0.8
            csi = round(88.5 - camp_dip_m * zf * mf, 1)
            for my, ms in myx.items():
                for ti, t in enumerate(TRIMS[md["id"]]):
                    for ei, en in enumerate(ENGINES[md["id"]]):
                        for dk, dv in drv.items():
                            for ci, c in enumerate(COLORS):
                                fv = zw[zi] * ms * TRIM_W[ti] * eng[ei] * dv * cmx[ci]
                                fm = zw[zi] * ms * (TRIM_W[ti] * TRIM_PRICE_F[ti] / NPF) * eng[ei] * dv * cmx[ci]
                                ret_c = r["retail"] * fv
                                stk_c = r["stock"] * fv
                                if ret_c < 0.5 and stk_c < 0.5:
                                    continue
                                rows_kpi.append([m, z["id"], md["id"], my,
                                                 f"{md['id']}-{t[:2].upper()}", en, dk, c,
                                                 q(ret_c), q(r["wholesale"] * fv),
                                                 q(M * fm), q(M * fm - costs * fv),
                                                 q(stk_c), q(stk_c / max(ret_c / 30.4, 0.1)), csi])
    write_csv(os.path.join(ROOT, "agg_kpi", f"{m}.csv"),
              ["ym", "zone_id", "model_id", "model_year", "trim_id", "engine", "drivetrain", "color",
               "retail_qty", "wholesale_qty", "variable_margin_usd", "op_profit_usd",
               "stock_qty", "days_supply", "csi_score"], rows_kpi)

    # 2) production: plant×model (WS를 리드타임만큼 미래로 시프트한 것이 그 달의 생산)
    rows_pd = []
    for p in PLANTS:
        p_models = [md for md in MODELS if md["plant"] == p["id"]]
        tot = 0
        for md in p_models:
            fut = i + p["lead_m"]
            ws_fut = row_of(fut, md["id"])["wholesale"] if fut <= NOW else row_of(NOW, md["id"])["wholesale"]
            supply_f = 1.0
            if p["id"] == "KR-1" and i in (EV_KR, EV_KR + 1):
                supply_f = 0.80 if i == EV_KR else 0.90
            qty = q(ws_fut * supply_f)
            tot += qty
            rows_pd.append([m, p["id"], md["id"], qty, p["cap"], 0])
        for row in rows_pd:
            if row[1] == p["id"]:
                row[5] = f1(tot / p["cap"] * 100)
    write_csv(os.path.join(ROOT, "production", f"{m}.csv"),
              ["ym", "plant_id", "model_id", "prod_qty", "plant_cap_month", "plant_util_pct"], rows_pd)

    # 3) orders (도매 역산 추정 — 주문 원천 미보유)
    rows_od = []
    for md in MODELS:
        lead = PLANT_LEAD[md["plant"]]
        src = min(i + lead, NOW)
        r = row_of(src, md["id"])
        for ti, t in enumerate(TRIMS[md["id"]]):
            rows_od.append([m, md["id"], f"{md['id']}-{t[:2].upper()}",
                            q(r["wholesale"] * TRIM_W[ti]), DS_TARGET, 1])
    write_csv(os.path.join(ROOT, "orders", f"{m}.csv"),
              ["ym_order", "model_id", "trim_id", "order_qty", "target_ds_days", "estimated"], rows_od)

    # 4) logistics_intransit: route별 운송 중 물량
    rows_lg = []
    for p in PLANTS:
        p_models = [md for md in MODELS if md["plant"] == p["id"]]
        lead_days = {"KR-1": 32, "KR-2": 32, "US-GA": 4, "US-SV": 4, "MX-MT": 10}[p["id"]]
        for md in p_models:
            r = row_of(i, md["id"])
            in_transit = r["wholesale"] * lead_days / 30.4
            rows_lg.append([m, f"{p['id']}→US", p["id"], md["id"], q(in_transit), lead_days,
                            math.ceil(in_transit / p["batch"])])
    write_csv(os.path.join(ROOT, "logistics_intransit", f"{m}.csv"),
              ["ym", "route", "plant_id", "model_id", "in_transit_qty", "avg_lead_days", "batch_cnt"], rows_lg)

    # 5) price_incentive (전략 입력 — 레버 히스토리)
    rows_pi = []
    for mi, md in enumerate(MODELS):
        r = row_of(i, md["id"])
        for ti, t in enumerate(TRIMS[md["id"]]):
            rows_pi.append([m, md["id"], f"{md['id']}-{t[:2].upper()}",
                            q(md["msrp"] * TRIM_PRICE_F[ti]), q(r["incentive"]),
                            "연말 프로그램" if i % 12 >= 10 else ("캠페인 방어" if md["id"] == "AUR" and EV_CAMP <= i <= EV_CAMP + 3 else "기본")])
    write_csv(os.path.join(ROOT, "price_incentive", f"{m}.csv"),
              ["ym", "model_id", "trim_id", "msrp_usd", "incentive_usd_per_unit", "program_note"], rows_pi)

    # 6) marketing_spend (전략 입력)
    rows_mk = []
    for mi, md in enumerate(MODELS):
        spend = marketing_of(mi, i)
        rows_mk.append([m, md["id"], f1(spend), f1(spend * 0.55), f1(spend * 0.30), f1(spend * 0.15)])
    write_csv(os.path.join(ROOT, "marketing_spend", f"{m}.csv"),
              ["ym", "model_id", "spend_musd", "media_musd", "digital_musd", "event_musd"], rows_mk)

    # 7) market_industry (외부 시장)
    rng2 = month_rng(i, "mkt")
    rows_mi = []
    ind_base = IND_BASE
    for seg in SEGMENTS:
        ind = ind_base[seg] * SEAS[i % 12] * (1 + 0.03 * (i // 12)) * (1 + rng2.gauss(0, 0.03))
        if "EV" in seg: ind *= 1 + 0.18 * (i // 12)
        our = sum(row_of(i, md["id"])["retail"] for md in MODELS if md["seg"] == seg)
        rows_mi.append([m, seg, q(ind), f1(our / ind * 100), 1 if (seg == "대형 EV SUV" and i == 24) else 0])
    write_csv(os.path.join(ROOT, "market_industry", f"{m}.csv"),
              ["ym", "segment", "industry_qty", "brand_share_pct", "competitor_launch"], rows_mi)

    # 8) service_quality: zone×model — VoC·정비 부하·캠페인
    rng3 = month_rng(i, "svc")
    rows_sv = []
    for md in MODELS:
        r = row_of(i, md["id"])
        camp = md["id"] == "AUR" and EV_CAMP <= i <= EV_CAMP + 3
        zw = zone_weights(md)
        for zi, z in enumerate(ZONES):
            uio = 260000 * md["share"] * (1 + 0.03 * i / 12) * zw[zi] / z["share"] * z["share"]
            voc = uio * 0.004 * (2.1 if camp else 1.0) * (1 + rng3.gauss(0, 0.08))
            svc_in = uio * 0.021 * (1.26 if camp else 1.0)
            delay = 3.2 + (4.5 if camp else 0) + rng3.gauss(0, 0.5)
            rows_sv.append([m, z["id"], md["id"], q(voc), q(svc_in), f1(max(1, delay)),
                            q(svc_in * 0.30) if camp else 0])
    write_csv(os.path.join(ROOT, "service_quality", f"{m}.csv"),
              ["ym", "zone_id", "model_id", "voc_cnt", "service_in_cnt", "booking_delay_days", "campaign_repair_cnt"], rows_sv)

    # 9) csi_external: 외부기관 공시 CSI (zone×model — 서베이 응답이 VIN 연계)
    rows_cs = []
    for z in ZONES:
        zf = 1.3 if z["ev_aff"] > 1 else 0.8
        for md in MODELS:
            mf = CSI_MF.get(md["id"], CSI_MF["default"])
            base = 88.5 - camp_dip_m * zf * mf + rng3.gauss(0, 0.4)
            n_resp = q(row_of(i, md["id"])["retail"] * zone_weights(md)[ZONES.index(z)] * 0.18)
            rows_cs.append([m, z["id"], md["id"], f1(base), f1(base - 1.2), f1(base + 0.8), n_resp])
    write_csv(os.path.join(ROOT, "csi_external", f"{m}.csv"),
              ["ym", "zone_id", "model_id", "csi_score", "csi_sales_exp", "csi_service_exp", "resp_cnt"], rows_cs)

    # 9.5) csi_internal: 내부 고객만족도 지수 (100점) — 내부 데이터 연계 구성요소 모델링
    rows_ci = []
    for md in MODELS:
        sc = internal_scores(md["id"], i)
        rows_ci.append([m, md["id"], f1(sc["quality"]), f1(sc["service"]),
                        f1(sc["delivery"]), f1(sc["connected"]), f1(sc["total"])])
    write_csv(os.path.join(ROOT, "csi_internal", f"{m}.csv"),
              ["ym", "model_id", "score_quality", "score_service", "score_delivery",
               "score_connected", "csi_internal_score"], rows_ci)

    # 9.7) csi_actions: 개선 활동 원장 (프로젝트 → 대상 VIN → 적용 → 클레임 소멸 → 점수 기여)
    rows_ca = []
    for p in CSI_PROJECTS:
        if i in p["applied"]:
            claim_now = p["claims"][i]
            gain = f1((p["claim0"] - claim_now) * p["score_per_claim"])
            rows_ca.append([m, p["project_id"], p["name"], p["model"], p["component"],
                            p["target"], p["applied"][i], p["claim0"], claim_now, gain])
    if rows_ca or i == 0:
        write_csv(os.path.join(ROOT, "csi_actions", f"{m}.csv"),
                  ["ym", "project_id", "project_name", "model_id", "component",
                   "target_vins", "applied_vins_cum", "claim_per_1k_before", "claim_per_1k_now",
                   "score_impact"], rows_ca)

    # 10) financials_pnl: model 단위 손익
    rows_fn = []
    for mi, md in enumerate(MODELS):
        r = row_of(i, md["id"])
        camp = md["id"] == "AUR" and EV_CAMP <= i <= EV_CAMP + 3
        revenue = r["wholesale"] * (md["msrp"] * 0.97)          # 도매가 ≈ MSRP 97%
        margin = r["wholesale"] * md["margin"]
        inc_cost = r["retail"] * r["incentive"]
        transport = r["wholesale"] * FREIGHT[md["plant"]]
        quality = r["retail"] * 120 + (14e6 if camp else 0)
        mkt = r["mkt_spend"] * 1e6
        op = margin - inc_cost - transport - quality - mkt
        rows_fn.append([m, md["id"], q(revenue), q(margin), q(inc_cost), q(transport),
                        q(quality), q(mkt), q(op)])
    write_csv(os.path.join(ROOT, "financials_pnl", f"{m}.csv"),
              ["ym", "model_id", "revenue_usd", "variable_margin_usd", "incentive_cost_usd",
               "transport_cost_usd", "quality_cost_usd", "marketing_cost_usd", "op_profit_usd"], rows_fn)

# ═══════════════ V9 라이프사이클 데이터셋 ═══════════════
# 각 *_rows(i) 함수는 순수 계산(월별 시드 고정) — CSV 기록과 JS 번들이 같은 값을 공유한다.

def clampf(x, a, b): return max(a, min(b, x))

def gen_lifecycle_master():
    d = os.path.join(ROOT, "master")
    write_csv(os.path.join(d, "biz_calendar.csv"),
              ["activity_id", "phase", "activity_name", "cadence", "month_from", "month_to", "owner", "output_dataset"],
              [[a["id"], a["phase"], a["name"], a["cadence"], a["m_from"], a["m_to"], a["owner"], a["output"]] for a in BIZ_CALENDAR])
    write_csv(os.path.join(d, "product_plan.csv"),
              ["model_year", "model_id", "item_type", "item_name", "target_launch_ym", "gate", "ready_pct"],
              [[p["my"], p["model"], p["typ"], p["name"], p["launch"], p["gate"], p["ready"]] for p in PRODUCT_PLAN])

def bp_trim_mix_rows(my):
    """계획 MY의 트림믹스 결정안 + FOB. NOW(2026-08) 기준: ~2026 확정, 2027 수립 중."""
    decided = f"{my - 1}-11" if my <= 2026 else ""
    status = "FOB 확정" if my <= 2026 else "수립 중 (BP-1)"
    esc = FOB_ESC ** (my - 2024)
    rows = []
    for md in MODELS:
        share = md["share"] * (1 + (0.06 if md["ev"] else -0.012) * (my - 2024))
        ws_y = BP_YEAR.get(my, BP_YEAR[2027]) * share * 1.02
        plan = trim_mix_plan(md["id"], my)
        prev = trim_mix_plan(md["id"], my - 1)
        for ti, t in enumerate(TRIMS[md["id"]]):
            fob = md["msrp"] * TRIM_PRICE_F[ti] * FOB_RATIO * esc
            fob_prev = md["msrp"] * TRIM_PRICE_F[ti] * FOB_RATIO * (esc / FOB_ESC)
            rows.append([my, md["id"], f"{md['id']}-{t[:2].upper()}",
                         f1(prev[ti] * 100), f1(plan[ti] * 100), q(ws_y * plan[ti]),
                         q(fob), q(fob_prev), md["plant"], status, decided])
    if my == 2027:   # 신차 Solara EV — product_plan G2 단계, 계획 물량만 존재
        for tid, tname, mw, pf in [("SOL-AI", "Air", 0.60, 0.95), ("SOL-RA", "Range", 0.40, 1.08)]:
            fob = 36900 * pf * FOB_RATIO * esc
            rows.append([my, "SOL", tid, 0.0, f1(mw * 100), q(18000 * 1.02 * mw),
                         q(fob), 0, "US-SV", "수립 중 (BP-1)", ""])
    return rows

def gen_bp_trim_mix():
    for my in (2025, 2026, 2027):
        write_csv(os.path.join(ROOT, "bp_trim_mix", f"{my}.csv"),
                  ["plan_my", "model_id", "trim_id", "mix_prev_pct", "mix_plan_pct", "plan_ws_qty",
                   "fob_usd", "fob_prev_usd", "plant_id", "status", "decided_ym"],
                  bp_trim_mix_rows(my))

def media_rows(i):
    """마케팅 매체 원장: 분기 캠페인 × Feature × 매체 — 제작·집행·퍼포먼스."""
    rngm = month_rng(i, "media")
    rows = []
    qn = (i % 12) // 3 + 1
    for mi, md in enumerate(MODELS):
        spend = marketing_of(mi, i)
        feat = MKT_FEATURES[md["id"]][1 if i >= 24 else 0]
        camp_id = f"{md['id']}-{24 + i // 12}Q{qn}"
        flight = i % 3 + 1                     # 분기 내 1=제작·런칭, 2=집행, 3=최적화
        for md2 in MEDIA:
            sp = spend * md2["w"]
            imps = sp * 1000 / md2["cpm"]                       # 백만 임프레션
            ctr = md2["ctr"] * (1 + rngm.gauss(0, 0.05)) if md2["ctr"] else 0
            clicks = imps * 10 * ctr                            # 천 클릭
            status = "제작·런칭" if flight == 1 else ("집행중" if flight == 2 else "집행중(최적화)")
            rows.append([MONTHS[i], camp_id, md["id"], feat, md2["id"],
                         f"{feat} {md2['name']} 크리에이티브", f1(sp), f1(imps), q(clicks),
                         round(ctr, 2), md2["cpm"], status])
    return rows

def voc_spike_mult(mid, cat, i):
    for m, c, mp in VOC_SPIKES:
        if m == mid and c == cat and i in mp:
            return mp[i]
    return 1.0

def voc_rows(i):
    """VoC 카테고리 원장 — 품질/안전 모니터링 파이프라인의 입력."""
    rng4 = month_rng(i, "voc")
    rows = []
    for md in MODELS:
        uio_m = 260000 * md["share"] * (1 + 0.03 * i / 12)
        camp = md["id"] == "AUR" and EV_CAMP <= i <= EV_CAMP + 3
        total = uio_m * 0.004 * (2.1 if camp else 1.0)
        for cat, w in VOC_CATS:
            mult = voc_spike_mult(md["id"], cat, i)
            cnt = total * w * mult * (1 + rng4.gauss(0, 0.06))
            rate = cnt / (uio_m / 1000)
            sev = "high" if mult >= 1.8 else ("med" if mult > 1.25 else "low")
            safety = 1 if cat == "안전/ADAS" and mult > 1.2 else 0
            rows.append([MONTHS[i], md["id"], cat, q(cnt), f1(rate), sev, safety])
    return rows

def qa_rows(i):
    """품질 조치 원장 (TSB/OTA/FSC/조사) — VoC 스파이크에 대응."""
    rows = []
    for a in QUALITY_ACTIONS:
        if i in a["months"]:
            applied = a["months"][i]
            claim = a["claims"][i]
            if a["typ"] == "조사":
                status = "원인 조사중"
            elif a["target"] and applied >= a["target"] * 0.95:
                status = "완결"
            else:
                status = "조치중"
            rows.append([MONTHS[i], a["id"], a["typ"], a["model"], a["cat"], a["title"],
                         a["detected"], a["target"], applied, a["claim0"], claim, status])
    return rows

def parts_rows(i):
    """Parts 손익 + Dealer Net/Factory 균형. 워런티·캠페인 Parts 가격 갭이 크면
    (딜러 유리) 판매법인 워런티 마진이 압박된다 → 2026-02 가격 개정으로 갭 축소."""
    uio = PARTS_UIO * (1 + 0.035 * i / 12)
    seasf = 1 + 0.05 * (SEAS[i % 12] - 1)
    camp = EV_CAMP <= i <= EV_CAMP + 3
    rows = []
    for cat, cpw, ww, dn0, fac in PARTS_CATS:
        cp = uio * CP_USD_PER_UIO * cpw * seasf / 1000                     # k$
        w_load = 1.6 if (camp and cat == "전장/배터리") else 1.0
        for m, c, mp in VOC_SPIKES:                                        # TSB 부하 → 워런티 수요
            catmap = {"파워트레인": "엔진/PT", "공조": "전장/배터리", "커넥티드/SW": "전장/배터리",
                      "전장/배터리": "전장/배터리", "샤시/조향": "샤시"}
            if catmap.get(c) == cat and i in mp:
                w_load = max(w_load, 1 + (mp[i] - 1) * 0.35)
        warranty = uio * 1.35 * ww * w_load / 1000
        campaign = 0.0
        if camp and cat == "전장/배터리":
            campaign = 14000 * 0.42                                        # 캠페인 품질비 중 Parts 몫 k$
        elif cat == "엔진/PT" and 15 <= i <= 18:
            campaign = 450
        gap0 = dn0 - fac
        dn = fac + gap0 * (0.4 if i >= PARTS_REPRICE else 1.0)
        gap_pct = (dn - fac) / fac * 100
        m_w = SC_MARGIN["warranty"] - max(0, gap_pct - 4) * 0.004          # 갭↑ → 워런티 마진↓
        tot = cp + warranty + campaign
        blended = (cp * SC_MARGIN["cp"] + warranty * m_w + campaign * SC_MARGIN["campaign"]) / tot
        rows.append([MONTHS[i], cat, q(cp), q(warranty), q(campaign),
                     f1(dn), fac, f1(gap_pct), round(blended * 100, 1)])
    return rows

# 지역별 딜러 재고 편중 (관행적 과다/과소 보유) — 지역 DS 차이 → Weight 보정의 재료
ZONE_STOCK_BIAS = {"west": 1.08, "central": 0.93, "south": 1.04, "northeast": 0.90, "southeast": 1.05}

def order_plan_rows(i):
    """월 생산 주문 실행: 차종×지역×트림×색상 셀별
    주문 = 차종 총주문 × (retail MA3 × DoS Weight) 정규화 배분.
    재고 믹스 = 2~4개월 전 주문분 믹스 평균 → 색상 수요 이동(A2) 시 재고가 옛 믹스에
    묶여 DS 괴리 발생 → Weight가 주문을 보정한다. 지역 편중(ZONE_STOCK_BIAS)도 동일 원리.
    v9 프론트가 동일 수식을 JS로 실행한다 — 수식 변경 시 양쪽 동시 수정."""
    rows = []
    for md in MODELS:
        lead = PLANT_LEAD[md["plant"]]
        src = min(i + lead, NOW)
        total = row_of(src, md["id"])["wholesale"]
        zw = zone_weights(md)
        stock_i = row_of(i, md["id"])["stock"]
        cells = []
        for zi, z in enumerate(ZONES):
            lag = [max(0, i - k) for k in (2, 3, 4)]          # 재고 = 2~4개월 전 주문분
            cmx_stk = [sum(mix_color(md["id"], z["id"], j)[ci] for j in lag) / 3
                       for ci in range(len(COLORS))]
            bias = ZONE_STOCK_BIAS[z["id"]]
            for ti in range(3):
                base_f = zw[zi] * TRIM_W[ti]
                for ci in range(len(COLORS)):
                    ma3 = sum(row_of(j, md["id"])["retail"] * base_f * mix_color(md["id"], z["id"], j)[ci]
                              for j in range(max(0, i - 2), i + 1)) / min(3, i + 1)
                    stk_raw = base_f * cmx_stk[ci] * bias
                    cells.append([zi, ti, ci, ma3, stk_raw])
        raw_sum = sum(c[4] for c in cells)
        for c in cells:                                        # 총 재고 보존 정규화
            c[4] = stock_i * c[4] / raw_sum
        scored = []
        for zi, ti, ci, ma3, stk in cells:
            ds = stk / max(ma3 / 30.4, 0.01)
            w = clampf(DS_TARGET / ds, 0.6, 1.6)
            scored.append((zi, ti, ci, ma3, stk, ds, w, ma3 * w))
        ssum = sum(c[7] for c in scored)
        for zi, ti, ci, ma3, stk, ds, w, score in scored:
            rows.append([MONTHS[i], md["id"], ZONES[zi]["id"],
                         f"{md['id']}-{TRIMS[md['id']][ti][:2].upper()}", COLORS[ci],
                         f1(ma3), q(stk), f1(ds), round(w, 2),
                         q(total * score / ssum), MONTHS[min(i + lead, N_MONTHS - 1)]])
    return rows

def gen_lifecycle_month(i):
    m = MONTHS[i]
    write_csv(os.path.join(ROOT, "marketing_media", f"{m}.csv"),
              ["ym", "campaign_id", "model_id", "feature_focus", "medium", "asset_name",
               "spend_musd", "impressions_m", "clicks_k", "ctr_pct", "cpm_usd", "status"], media_rows(i))
    write_csv(os.path.join(ROOT, "voc_category", f"{m}.csv"),
              ["ym", "model_id", "category", "voc_cnt", "voc_per_1k_uio", "severity", "safety_flag"], voc_rows(i))
    qa = qa_rows(i)
    if qa or i == 0:
        write_csv(os.path.join(ROOT, "quality_actions", f"{m}.csv"),
                  ["ym", "action_id", "action_type", "model_id", "category", "title", "detected_ym",
                   "target_vins", "applied_vins_cum", "claim_per_1k_before", "claim_per_1k_now", "status"], qa)
    write_csv(os.path.join(ROOT, "parts_pnl", f"{m}.csv"),
              ["ym", "part_category", "cp_sales_kusd", "warranty_sales_kusd", "campaign_sales_kusd",
               "dealer_net_idx", "factory_price_idx", "gap_pct", "sc_margin_pct"], parts_rows(i))
    write_csv(os.path.join(ROOT, "order_plan", f"{m}.csv"),
              ["ym_order", "model_id", "zone_id", "trim_id", "color", "retail_ma3", "stock_qty",
               "ds_days", "dos_weight", "order_qty", "prod_ym"], order_plan_rows(i))

# ═══════════════ V10 거버넌스 데이터셋 — 게이트 원장 · 프로젝트 리뷰 ═══════════════

def act_active(a, i):
    """v9 actState의 'active' 판정과 동일 규칙 (미러 — 변경 시 양쪽 동시 수정)."""
    m = i % 12 + 1
    c = a["cadence"]
    if c == "annual":
        return a["m_from"] <= m <= a["m_to"] if a["m_from"] <= a["m_to"] else (m >= a["m_from"] or m <= a["m_to"])
    if c == "quarterly": return m in (1, 4, 7, 10)
    if c in ("monthly", "continuous"): return True
    if c == "event": return bool(qa_rows(i))
    return False

def win_pos(a, i):
    """연간 활동의 실행 창 내 경과 개월 (0부터)."""
    if a["cadence"] != "annual": return 0
    m = i % 12 + 1
    return m - a["m_from"] if a["m_from"] <= a["m_to"] else (m - a["m_from"] if m >= a["m_from"] else m + 12 - a["m_from"])

def gate_rows(i):
    """워크플로우 게이트 원장: 활동이 활성인 달의 게이트 상태.
    과거 월(i<NOW)은 완결된 감사 이력(승인/실행완료), 현재 월(i=NOW)은 라이브 큐 —
    선행 AI/자동 게이트 완료 → 다음 HITL 게이트 검토대기 → 이후 예정. 난수 없음."""
    rows = []
    for a in BIZ_CALENDAR:
        if not act_active(a, i): continue
        gates = WORKFLOW_GATES[a["id"]]
        if a["cadence"] == "event":                     # QLT-2: 조치 원장 상태로 판정
            qa = qa_rows(i)
            has_inv = any(r[11] == "원인 조사중" for r in qa)
            has_run = any(r[11] in ("조치중", "완결") for r in qa)
            has_done = any(r[11] == "완결" for r in qa)
            sts = ["검토대기" if has_inv else "승인",
                   "실행완료" if has_run else "예정",
                   "승인" if has_done else ("검토대기" if has_run and i == NOW else "예정")]
        else:
            lead = 0
            for g in gates:
                if g[2] == "hitl": break
                lead += 1
            done = len(gates) if i < NOW else min(len(gates) - 1, lead + win_pos(a, i))
            sts = []
            for k, g in enumerate(gates):
                if k < done: sts.append("승인" if g[2] == "hitl" else "실행완료")
                elif k == done: sts.append("검토대기" if g[2] == "hitl" else "실행중")
                else: sts.append("예정")
        for k, g in enumerate(gates):
            rows.append([MONTHS[i], a["id"], a["phase"], k + 1, g[0], g[1], g[2], g[3], sts[k]])
    return rows

def prj_actual(p, i):
    """프로젝트 월별 실측값 — 기존 데이터 함수에서 파생 (결정적, 원장과 동일 소스)."""
    pid = p["id"]
    if pid == "PRJ-OTA-LUM":
        return QUALITY_ACTIONS[0]["claims"].get(i)
    if pid == "PRJ-FSC-AUR":
        a = next(x for x in QUALITY_ACTIONS if x["id"] == "FSC-2603-AUR")
        ap = a["months"].get(i)
        return None if ap is None else round(ap / a["target"] * 100, 1)
    if pid == "PRJ-GRAY-ORD":
        tid = f"LUM-{TRIMS['LUM'][0][:2].upper()}"
        for r in order_plan_rows(i):
            if r[1] == "LUM" and r[2] == "northeast" and r[3] == tid and r[4] == COLORS[2]:
                return r[8]
        return None
    if pid == "PRJ-EV-SOUTH":
        md = next(m for m in MODELS if m["id"] == "AUR")
        si = next(zi for zi, z in enumerate(ZONES) if z["id"] == "south")
        return q(row_of(i, "AUR")["retail"] * zone_weights(md)[si])
    if pid == "PRJ-PARTS-BAL":
        rows = parts_rows(i)
        return round(sum(r[7] for r in rows) / len(rows), 1)
    if pid == "PRJ-SOL-LAUNCH":
        return f1(min(45.0, 20.0 + 25.0 * (i - 25) / 6))
    return None

PRJ_LOWER_BETTER = {"PRJ-OTA-LUM", "PRJ-PARTS-BAL"}      # 낮을수록 좋은 지표

def project_review_rows(i):
    """프로젝트 월별 리뷰 원장: 기대 vs 실측 → 판정 (데이터가 쌓이고 결과를 리뷰한다)."""
    rows = []
    for p in PROJECTS:
        if i < p["start"] or (p["end"] is not None and i > p["end"]): continue
        act = prj_actual(p, i)
        if act is None: continue
        reached = act <= p["expect"] if p["id"] in PRJ_LOWER_BETTER else act >= p["expect"]
        rows.append([MONTHS[i], p["id"], p["name"], p["goal"], p["metric"],
                     p["expect"], act, "달성" if reached else "진행중"])
    return rows

def facility_rows(i):
    """시설 에너지 원장: 캠퍼스 동관/서관 × 3층 × 구역별 월 전력.
    kwh_peak_hvac = 피크 중 HVAC 몫(항온존 0) — 전략 레버(설정온도·예냉)의 대상.
    절감액은 전략 월드(v10-opex-sim)가 ENERGY·ZTYPE 상수 미러로 직접 계산한다."""
    rng = month_rng(i, "energy")
    m = i % 12
    rows = []
    for bld, fl, zid, zname, zt, area in OFFICE_ZONES:
        zc = ZTYPE[zt]
        hvac = ENERGY["hvac_kwh_m2"] * HVAC_F[m] * area * zc["hvac"] * (1 + rng.gauss(0, 0.04))
        base = ENERGY["base_kwh_m2"] * area * zc["base"] * (1 + rng.gauss(0, 0.02))
        kwh = hvac + base
        peak = kwh * ENERGY["peak_share"]
        off = kwh - peak
        hvac_peak = 0.0 if zt == "항온" else hvac * ENERGY["peak_share"]   # 레버 대상
        cool = (m + 1) in ENERGY["cool_months"]
        temp = zc["temp"] if (cool or zt == "항온") else zc["temp"] + 1.0   # 난방기 설정 상향
        cost = peak * ENERGY["rate_peak"] + off * ENERGY["rate_off"]
        rows.append([MONTHS[i], bld, fl, zid, zname, zt, area, round(temp, 1),
                     q(peak), q(off), q(hvac_peak), q(cost)])
    return rows

FAC_COLS = ["ym", "building", "floor", "zone_id", "zone_name", "zone_type", "area_m2",
            "temp_set_c", "kwh_peak", "kwh_off", "kwh_peak_hvac", "cost_usd"]

def gen_governance():
    d = os.path.join(ROOT, "governance")
    write_csv(os.path.join(d, "ceo_tree.csv"),
              ["node_id", "parent_id", "level", "kind", "node_name", "short_name",
               "weight_pct", "bind", "unit", "direction", "lever"],
              [[g["id"], g["parent"], g["lv"], g["kind"], g["name"], g["short"],
                g["w"], g["bind"], g["unit"], g["dir"], g["lever"]] for g in CEO_TREE])
    write_csv(os.path.join(d, "office_zones.csv"),
              ["building", "floor", "zone_id", "zone_name", "zone_type", "area_m2", "rent_usd_month"],
              [[b, f, zid, zn, t, a, q(zone_rent(b, t, a))] for b, f, zid, zn, t, a in OFFICE_ZONES])
    for i in range(NOW + 1):
        write_csv(os.path.join(ROOT, "facility_energy", f"{MONTHS[i]}.csv"),
                  FAC_COLS, facility_rows(i))
    write_csv(os.path.join(d, "ai_agents.csv"),
              ["agent_id", "agent_name", "scope_activity", "task", "accuracy_pct"],
              [[a["id"], a["name"], a["scope"], a["task"], a["acc"]] for a in AI_AGENTS])
    write_csv(os.path.join(d, "projects.csv"),
              ["project_id", "project_name", "goal_node", "template", "model_id",
               "start_ym", "end_ym", "status", "metric", "expect_value", "linked_objects"],
              [[p["id"], p["name"], p["goal"], p["tmpl"], p["model"], MONTHS[p["start"]],
                MONTHS[p["end"]] if p["end"] is not None else "", p["status"], p["metric"],
                p["expect"], "|".join(p["links"])] for p in PROJECTS])
    for i in range(NOW + 1):
        write_csv(os.path.join(d, "workflow_gates", f"{MONTHS[i]}.csv"),
                  ["ym", "activity_id", "phase", "gate_seq", "gate_id", "gate_name",
                   "gate_type", "owner", "status"], gate_rows(i))
        pr = project_review_rows(i)
        if pr:
            write_csv(os.path.join(d, "project_reviews", f"{MONTHS[i]}.csv"),
                      ["ym", "project_id", "project_name", "goal_node", "metric",
                       "expect_value", "actual_value", "verdict"], pr)

# ═══════════════ Upstream: VIN 원장 + 차량 마스터 (1:50 축소 샘플) ═══════════════
# 원칙: 필터 속성(차종·MY·트림·엔진·구동·색상)은 차량 마스터가 보유하고,
# 판매량은 vin_retail, 도매/영업이익은 vin_wholesale이 VIN 단위로 보유한다.
# downstream 집계(agg_kpi)는 "원장 × 마스터 조인 → group-by"로 생성된다.
SAMPLE = 50          # 샘플 축소 배율 (실 시스템은 전량)
YEAR_CODE = {2024: "R", 2025: "S", 2026: "T", 2027: "V", 2028: "W"}

def gen_vins():
    rngv = random.Random(SEED + 777)
    masters, ws_rows, rt_rows = {}, {}, {}
    seq = 0
    zlist = [z["id"] for z in ZONES]
    for i in range(NOW + 1):
        for mi, md in enumerate(MODELS):
            r = row_of(i, md["id"])
            n = q(r["wholesale"] / SAMPLE)
            zw = zone_weights(md)
            eng = mix_engine(md["id"], i)
            myx = list(mix_my(i).items())
            plant = next(p for p in PLANTS if p["id"] == md["plant"])
            prod_i = max(0, i - plant["lead_m"])
            for _ in range(n):
                zid = rngv.choices(zlist, weights=zw)[0]
                drv = mix_drive(md["id"], zid, i)
                cmx = mix_color(md["id"], zid, i)
                my = rngv.choices([y for y, _ in myx], weights=[s for _, s in myx])[0]
                ti = rngv.choices([0, 1, 2], weights=TRIM_W)[0]
                ei = rngv.choices([0, 1], weights=eng)[0]
                dk = rngv.choices(["AWD", "FWD"], weights=[drv["AWD"], drv["FWD"]])[0]
                ci = rngv.choices(range(len(COLORS)), weights=cmx)[0]
                seq += 1
                vin = (f"{plant['wmi']}{md['id'][0]}{'CPS'[ti]}{dk[0]}{chr(65 + ci)}X"
                       f"{YEAR_CODE[my]}{plant['id'][0]}{seq:07d}")
                trim_id = f"{md['id']}-{TRIMS[md['id']][ti][:2].upper()}"
                msrp_t = md["msrp"] * TRIM_PRICE_F[ti]
                margin_u = md["margin"] * TRIM_PRICE_F[ti] / NPF
                masters.setdefault(prod_i, []).append(
                    [MONTHS[prod_i], vin, md["id"], my, trim_id, ENGINES[md["id"]][ei], dk,
                     COLORS[ci], plant["id"], zid, q(msrp_t)])
                ws_rows.setdefault(i, []).append(
                    [MONTHS[i], vin, zid, q(msrp_t * 0.97), q(margin_u), FREIGHT[md["plant"]]])
                lag = rngv.choices([0, 1, 2], weights=[0.55, 0.35, 0.10])[0]
                rm = i + lag
                if rm <= NOW:
                    inc = incentive_of(mi, rm)
                    rt_rows.setdefault(rm, []).append(
                        [MONTHS[rm], vin, zid, f"{MONTHS[rm]}-{rngv.randint(1, 28):02d}",
                         "fleet" if rngv.random() < 0.06 else "retail",
                         q(msrp_t - inc), q(inc)])
    for i, rows in masters.items():
        write_csv(os.path.join(ROOT, "vehicle_master", f"{MONTHS[i]}.csv"),
                  ["prod_ym", "vin", "model_id", "model_year", "trim_id", "engine",
                   "drivetrain", "color", "plant_id", "dest_zone_id", "msrp_usd"], rows)
    for i, rows in ws_rows.items():
        write_csv(os.path.join(ROOT, "vin_wholesale", f"{MONTHS[i]}.csv"),
                  ["ws_ym", "vin", "zone_id", "wholesale_price_usd", "variable_margin_usd",
                   "freight_usd"], rows)
    for i, rows in rt_rows.items():
        write_csv(os.path.join(ROOT, "vin_retail", f"{MONTHS[i]}.csv"),
                  ["retail_ym", "vin", "zone_id", "retail_date", "channel",
                   "txn_price_usd", "incentive_usd"], rows)

def gen_bp():
    for i in range(N_MONTHS):
        m = MONTHS[i]
        rows, rows_attr = [], []
        for mi, md in enumerate(MODELS):
            br = bp_retail(mi, i)
            bw = br * 1.02
            bp_inc = 1200 + 250 * (1 - SEAS[i % 12])
            M = bw * md["margin"]
            costs = br * bp_inc + bw * FREIGHT[md["plant"]] + br * 120 + MKT_BASE[md["id"]] * 1e6 * SEAS[i % 12]
            op = M - costs
            rows.append([m, md["id"], q(br), q(bw), q(op), 88.5, DS_TARGET])
            # 상향식 BP 큐브: 같은 믹스 모델(계획 시점 = 이상 징후 미반영)로 agg_kpi와
            # "동일한 공통 차원 컬럼"까지 생성 → 어떤 필터 조합에도 "BP 대비"가 성립.
            zw = zone_weights(md)
            eng = mix_engine(md["id"], i)
            myx = mix_my(i)
            for zi, z in enumerate(ZONES):
                drv = mix_drive(md["id"], z["id"], i, plan=True)
                cmx = mix_color(md["id"], z["id"], i, plan=True)
                for my, ms in myx.items():
                    for ti, t in enumerate(TRIMS[md["id"]]):
                        for ei, en in enumerate(ENGINES[md["id"]]):
                            for dk, dv in drv.items():
                                for ci, c in enumerate(COLORS):
                                    fv = zw[zi] * ms * TRIM_W[ti] * eng[ei] * dv * cmx[ci]
                                    if br * fv < 0.5:
                                        continue
                                    fm = zw[zi] * ms * (TRIM_W[ti] * TRIM_PRICE_F[ti] / NPF) * eng[ei] * dv * cmx[ci]
                                    rows_attr.append([m, z["id"], md["id"], my,
                                                      f"{md['id']}-{t[:2].upper()}", en, dk, c,
                                                      q(br * fv), q(bw * fv), q(M * fm - costs * fv)])
        write_csv(os.path.join(ROOT, "bp_target", f"{m}.csv"),
                  ["ym", "model_id", "bp_retail_qty", "bp_wholesale_qty", "bp_op_profit_usd", "bp_csi", "bp_ds_days"], rows)
        write_csv(os.path.join(ROOT, "agg_kpi_bp", f"{m}.csv"),
                  ["ym", "zone_id", "model_id", "model_year", "trim_id", "engine", "drivetrain", "color",
                   "bp_retail_qty", "bp_wholesale_qty", "bp_op_profit_usd"], rows_attr)

# ═══════════════ v7 프론트 번들 (data/ 집계 → JS) ═══════════════
def gen_bundle():
    """data/의 실적을 v7 HTML이 file://로 로드할 수 있게 JS 번들로 집계."""
    bundle = dict(
        meta=dict(seed=SEED, months=MONTHS, now=NOW, seas=SEAS, us_base=US_BASE,
                  ds_target=DS_TARGET, price_elast=PRICE_ELAST, inc_ref=INC_REF,
                  adstock=ADSTOCK, ev_kr=EV_KR, ev_camp=EV_CAMP,
                  bp_year=BP_YEAR),
        models=MODELS, plants=PLANTS, zones=ZONES,
        trims={m["id"]: TRIMS[m["id"]] for m in MODELS},
        trim_w=TRIM_W, freight=FREIGHT, mkt_base=MKT_BASE,
        attrs=dict(colors=COLORS, color_w=COLOR_W, engines=ENGINES, eng_p=ENG_P,
                   drive_awd=DRIVE_AWD, zone_awd_aff=ZONE_AWD_AFF,
                   my_next=MY_NEXT_SHARE, anomalies=ANOMALIES,
                   csi_mf=CSI_MF),
        trim_pf=TRIM_PRICE_F, npf=NPF,
        actual=[], bp=[],
    )
    for i in range(NOW + 1):
        month = dict(ym=MONTHS[i], models={})
        camp_dip = {EV_CAMP: 4.5, EV_CAMP + 1: 3.6, EV_CAMP + 2: 2.2, EV_CAMP + 3: 1.1}.get(i, 0)
        month["csi"] = round(88.5 - camp_dip, 1)
        for md in MODELS:
            r = row_of(i, md["id"])
            camp = md["id"] == "AUR" and EV_CAMP <= i <= EV_CAMP + 3
            quality = r["retail"] * 120 + (14e6 if camp else 0)
            op = (r["wholesale"] * md["margin"] - r["retail"] * r["incentive"]
                  - r["wholesale"] * FREIGHT[md["plant"]] - quality - r["mkt_spend"] * 1e6)
            month["models"][md["id"]] = dict(
                retail=q(r["retail"]), ws=q(r["wholesale"]), stock=q(r["stock"]),
                ds=f1(r["ds"]), inc=q(r["incentive"]), mkt=f1(r["mkt_spend"]),
                op=q(op), demand=q(r["demand"]))
        bundle["actual"].append(month)
    for i in range(N_MONTHS):
        month = dict(ym=MONTHS[i], models={})
        for mi, md in enumerate(MODELS):
            br = bp_retail(mi, i)
            bw = br * 1.02
            bp_inc = 1200 + 250 * (1 - SEAS[i % 12])
            op = bw * md["margin"] - br * bp_inc - bw * FREIGHT[md["plant"]] - br * 120 - MKT_BASE[md["id"]] * 1e6 * SEAS[i % 12]
            month["models"][md["id"]] = dict(retail=q(br), ws=q(bw), op=q(op))
        bundle["bp"].append(month)
    # 내부 고객만족도 지수 (회사 관리 지표) + 개선 활동 — CUST 패널용
    bundle["csi_internal"] = []
    for i in range(NOW + 1):
        comp = dict(quality=0.0, service=0.0, delivery=0.0, connected=0.0, total=0.0)
        wsum = 0.0
        per_model = {}
        for md in MODELS:
            sc = internal_scores(md["id"], i)
            w = row_of(i, md["id"])["retail"]
            wsum += w
            for k in comp: comp[k] += sc[k] * w
            per_model[md["id"]] = round(sc["total"], 1)
        entry = {k: round(v / wsum, 1) for k, v in comp.items()}
        entry.update(ym=MONTHS[i], models=per_model)
        bundle["csi_internal"].append(entry)
    bundle["csi_actions"] = [
        dict(project_id=p["project_id"], name=p["name"], model=p["model"],
             component=p["component"], target=p["target"], claim0=p["claim0"],
             months={MONTHS[k]: dict(applied=p["applied"][k], claim=p["claims"][k])
                     for k in p["applied"]})
        for p in CSI_PROJECTS
    ]
    # ── V9 라이프사이클 번들: CSV와 동일한 *_rows() 계산 결과를 그대로 수록.
    #    order_plan은 미수록 — v9 프론트가 동일 수식(JS)으로 트윈 안에서 직접 실행한다.
    def flat(fn):
        return [r for i in range(NOW + 1) for r in fn(i)]
    bundle["lifecycle"] = dict(
        calendar=[dict(id=a["id"], phase=a["phase"], name=a["name"], cadence=a["cadence"],
                       m_from=a["m_from"], m_to=a["m_to"], owner=a["owner"], output=a["output"])
                  for a in BIZ_CALENDAR],
        product_plan=[dict(my=p["my"], model=p["model"], typ=p["typ"], name=p["name"],
                           launch=p["launch"], gate=p["gate"], ready=p["ready"]) for p in PRODUCT_PLAN],
        trim_mix=dict(
            cols=["plan_my", "model_id", "trim_id", "mix_prev_pct", "mix_plan_pct", "plan_ws_qty",
                  "fob_usd", "fob_prev_usd", "plant_id", "status", "decided_ym"],
            rows={my: bp_trim_mix_rows(my) for my in (2025, 2026, 2027)}),
        media=dict(cols=["ym", "campaign_id", "model_id", "feature_focus", "medium", "asset_name",
                         "spend_musd", "impressions_m", "clicks_k", "ctr_pct", "cpm_usd", "status"],
                   rows=flat(media_rows)),
        voc=dict(cols=["ym", "model_id", "category", "voc_cnt", "voc_per_1k_uio", "severity", "safety_flag"],
                 rows=flat(voc_rows)),
        actions=dict(cols=["ym", "action_id", "action_type", "model_id", "category", "title", "detected_ym",
                           "target_vins", "applied_vins_cum", "claim_per_1k_before", "claim_per_1k_now", "status"],
                     rows=flat(qa_rows)),
        parts=dict(cols=["ym", "part_category", "cp_sales_kusd", "warranty_sales_kusd", "campaign_sales_kusd",
                         "dealer_net_idx", "factory_price_idx", "gap_pct", "sc_margin_pct"],
                   rows=flat(parts_rows)),
        meta=dict(media=MEDIA, features=MKT_FEATURES, voc_cats=VOC_CATS,
                  parts_cats=PARTS_CATS, parts_reprice=PARTS_REPRICE, parts_uio=PARTS_UIO,
                  sc_margin=SC_MARGIN, cp_usd_per_uio=CP_USD_PER_UIO,
                  fob_ratio=FOB_RATIO, fob_esc=FOB_ESC,
                  zone_stock_bias=ZONE_STOCK_BIAS),
    )
    # ── V10 거버넌스 번들: CEO KPI 트리·게이트 원장·AI 에이전트·프로젝트 리뷰 (CSV와 동일 소스)
    bundle["governance"] = dict(
        ceo_tree=[dict(id=g["id"], parent=g["parent"], lv=g["lv"], kind=g["kind"],
                       name=g["name"], short=g["short"], w=g["w"], bind=g["bind"],
                       unit=g["unit"], dir=g["dir"], lever=g["lever"]) for g in CEO_TREE],
        facility=dict(cols=FAC_COLS, rows=flat(facility_rows)),
        zones=[dict(bld=b, fl=f, id=zid, name=zn, typ=t, area=a, rent=q(zone_rent(b, t, a)))
               for b, f, zid, zn, t, a in OFFICE_ZONES],
        energy=dict(**{k: (list(v) if isinstance(v, tuple) else v) for k, v in ENERGY.items()},
                    hvac_f=HVAC_F, ztype=ZTYPE, rent_rate=RENT_RATE,
                    opex_lease=OPEX_LEASE, opex_fixed_etc=OPEX_FIXED_ETC,
                    captive_pen=CAPTIVE_PEN, captive_unit=CAPTIVE_UNIT,
                    ind_base=IND_BASE),
        agents=AI_AGENTS,
        gates=dict(cols=["ym", "activity_id", "phase", "gate_seq", "gate_id", "gate_name",
                         "gate_type", "owner", "status"],
                   rows=flat(gate_rows)),
        projects=[dict(id=p["id"], name=p["name"], goal=p["goal"], tmpl=p["tmpl"],
                       model=p["model"], start=p["start"], end=p["end"], status=p["status"],
                       metric=p["metric"], expect=p["expect"], links=p["links"],
                       lower="1" if p["id"] in PRJ_LOWER_BETTER else "")
                  for p in PROJECTS],
        reviews=dict(cols=["ym", "project_id", "project_name", "goal_node", "metric",
                           "expect_value", "actual_value", "verdict"],
                     rows=flat(project_review_rows)),
        templates=PRJ_TEMPLATES,
    )
    bundle["vdata"] = dict(cols=VD_COLS, rows=flat(vdata_rows))
    out = os.path.join(ROOT, "..", "prototypes", "v7-data.js")
    with open(out, "w", encoding="utf-8") as f:
        f.write("// 자동 생성 파일 — data/_generator/generate.py 가 data/ 와 동일 소스에서 생성\n")
        f.write("window.TWIN_DATA = ")
        json.dump(bundle, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")

def main():
    # 기존 파티션 정리 후 재생성 (마스터·생성기 제외)
    for ds in ["retail_sales", "dealer_stock", "wholesale", "production", "orders",
               "logistics_intransit", "price_incentive", "marketing_spend",
               "market_industry", "service_quality", "csi", "financials_pnl",
               "retail_sales_attr", "retail_color_mix", "financials_pnl_attr",
               "bp_target", "bp_target_attr", "master",
               "agg_kpi", "agg_kpi_bp", "csi_external", "csi_internal", "csi_actions",
               "vehicle_master", "vin_retail", "vin_wholesale",
               "bp_trim_mix", "marketing_media", "voc_category", "quality_actions",
               "parts_pnl", "order_plan", "governance", "facility_energy", "feature_usage"]:
        p = os.path.join(ROOT, ds)
        if os.path.isdir(p): shutil.rmtree(p)
    gen_master()
    gen_vdata()
    gen_lifecycle_master()
    gen_bp_trim_mix()
    for i in range(NOW + 1):
        gen_month(i)
        gen_lifecycle_month(i)
    gen_vins()
    gen_bp()
    gen_governance()
    gen_bundle()
    n_files = sum(len(fs) for _, _, fs in os.walk(ROOT))
    print(f"완료: data/ 아래 {n_files}개 파일 생성")
    print("  Upstream: vehicle_master + vin_wholesale/vin_retail (1:50 샘플)")
    print("  Downstream: agg_kpi(통합 KPI 큐브) + agg_kpi_bp(상향식 BP 큐브) — 공통 차원 컬럼 통일")
    print("  CSI: csi_external(공시) + csi_internal(내부지수 100점) + csi_actions(개선 활동)")
    print("  라이프사이클: biz_calendar·product_plan·bp_trim_mix(FOB)·marketing_media"
          "·order_plan(DoS Weight)·voc_category·quality_actions(TSB/OTA)·parts_pnl(DN/Factory)")

if __name__ == "__main__":
    main()
