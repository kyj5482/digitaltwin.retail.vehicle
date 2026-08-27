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
    return random.Random(SEED * 1000 + i * 37 + hash(tag) % 997)

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
    ind_base = {"대형 SUV": 195000, "중형 SUV": 260000, "대형 EV SUV": 48000,
                "중형 세단": 150000, "미니밴": 62000, "준중형 EV CUV": 85000}
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
               "vehicle_master", "vin_retail", "vin_wholesale"]:
        p = os.path.join(ROOT, ds)
        if os.path.isdir(p): shutil.rmtree(p)
    gen_master()
    for i in range(NOW + 1):
        gen_month(i)
    gen_vins()
    gen_bp()
    gen_bundle()
    n_files = sum(len(fs) for _, _, fs in os.walk(ROOT))
    print(f"완료: data/ 아래 {n_files}개 파일 생성")
    print("  Upstream: vehicle_master + vin_wholesale/vin_retail (1:50 샘플)")
    print("  Downstream: agg_kpi(통합 KPI 큐브) + agg_kpi_bp(상향식 BP 큐브) — 공통 차원 컬럼 통일")
    print("  CSI: csi_external(공시) + csi_internal(내부지수 100점) + csi_actions(개선 활동)")

if __name__ == "__main__":
    main()
