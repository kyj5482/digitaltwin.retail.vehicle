// =============================================================================
// v7-ontology-instances.js — 온톨로지 샘플 인스턴스 빌더 (시드 고정, 결정적)
// =============================================================================
// 탐색기에서 "객체 → 링크 순회" 를 보여주기 위한 표본 객체 저장소.
// 마스터·집계는 v7-data.js(TWIN_DATA)와 동일 값을 사용하고, VIN 체인(검사·운송·
// 도매·소매·케어·텔레매틱스)은 시드 고정 PRNG로 결정적으로 전개한다.
// 실환경에서는 이 빌더 대신 parquet 마트를 온톨로지 바인딩(datasource.path)으로
// 직접 조회한다 — 저장소 인터페이스(obj/link)는 동일하게 유지.
// =============================================================================
window.buildOntologyInstances = function (TD) {
  'use strict';
  // ── 시드 고정 PRNG (mulberry32) ────────────────────────────────────────────
  let _s = 20260826;
  const rnd = () => { _s |= 0; _s = (_s + 0x6D2B79F5) | 0; let t = Math.imul(_s ^ (_s >>> 15), 1 | _s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (arr, w) => { // 가중 선택
    if (!w) return arr[Math.floor(rnd() * arr.length)];
    let r = rnd() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < arr.length; i++) { r -= w[i]; if (r <= 0) return arr[i]; }
    return arr[arr.length - 1];
  };
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));

  // ── 저장소 ───────────────────────────────────────────────────────────────
  const DB = { objects: {}, order: [], links: [] };
  const key = (t, id) => t + ':' + id;
  function put(type, id, title, props) {
    const k = key(type, id);
    if (!DB.objects[k]) { DB.objects[k] = { type, id, title, props }; DB.order.push(k); }
    return k;
  }
  function link(lt, fromK, toK) { if (fromK && toK) DB.links.push({ lt, from: fromK, to: toK }); }

  const NOW = TD.meta.months[TD.meta.now]; // '2026-08'
  const ymAdd = (ym, d) => { const [y, m] = ym.split('-').map(Number); const t = y * 12 + (m - 1) + d; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`; };
  const ymDiff = (a, b) => { const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number); return (y2 * 12 + m2) - (y1 * 12 + m1); };

  // ══ 1. 조직 ═══════════════════════════════════════════════════════════════
  const SC = [['SC-US', '미국판매법인', 'US', 'full'], ['SC-CA', '캐나다판매법인', 'CA', 'aggregate'], ['SC-MX', '멕시코판매법인', 'MX', 'aggregate']];
  SC.forEach(([id, nm, mk, lv]) => put('salesCompany', id, nm, { company_id: id, company_name: nm, market: mk, twin_level: lv }));
  const kSCUS = key('salesCompany', 'SC-US');

  // 시장 스냅샷 — 경쟁·시장 축 (외부 구독 데이터. 최근 12개월, 결정적 수식)
  for (let d = 11; d >= 0; d--) {
    const ym = ymAdd(NOW, -d);
    const mi = Number(ym.slice(5)) - 1;
    const k = put('marketSnapshot', 'MKT-' + ym, ym + ' 시장', {
      snapshot_id: 'MKT-' + ym, ym,
      saar_units: Math.round(15500 + 900 * Math.sin(2 * Math.PI * mi / 12) + 350 * (rnd() - 0.5)) * 1000,
      own_share_pct: Math.round((8.6 + 0.5 * Math.sin(2 * Math.PI * (mi + 2) / 12) + 0.6 * rnd()) * 100) / 100,
      seg_suv_share_pct: Math.round((6.8 + 0.7 * Math.sin(2 * Math.PI * (mi + 4) / 12) + 0.5 * rnd()) * 100) / 100,
      comp_avg_incentive_usd: Math.round(1450 + 600 * Math.sin(2 * Math.PI * (mi + 6) / 12) + 350 * rnd()),
      comp_launch_cnt: ri(0, 1),
    });
    link('marketOfSc', k, kSCUS);
  }

  const PCS = [
    ['PC-KR', '국내생산법인', 'KR', 'CIF 서부수입항', ['KR-1', 'KR-2']],
    ['PC-GA', '조지아생산법인', 'US', 'FOB 공장', ['US-GA']],
    ['PC-SV', '사바나생산법인', 'US', 'FOB 공장', ['US-SV']],
    ['PC-MX', '멕시코생산법인', 'MX', 'DAP 통관', ['MX-MT']],
  ];
  const plantPC = {};
  PCS.forEach(([id, nm, c, inco, plants]) => {
    const k = put('productionCompany', id, nm, { pc_id: id, pc_name: nm, country: c, incoterms: inco, transfer_price_basis: '도매가 − 판매법인 변동마진' });
    plants.forEach(p => plantPC[p] = k);
    link('scBuysFromPc', kSCUS, k);
  });

  TD.plants.forEach(p => {
    const k = put('plant', p.id, p.name, { plant_id: p.id, plant_name: p.name, country: p.country, cap_month: p.cap, lead_month: p.lead_m, ship_mode: p.ship, batch_size: p.batch, wmi: p.wmi, freight_usd_per_unit: TD.freight[p.id] });
    link('pcOwnsPlant', plantPC[p.id], k);
  });

  // 시설·전력 계측 — 관리비(경상이익률 다운스트림)의 물리 실체 (governance.facility에서 구축)
  if (TD.governance && TD.governance.facility) {
    const F = TD.governance.facility;
    const ci = Object.fromEntries(F.cols.map((c, k) => [c, k]));
    const nowRows = F.rows.filter(r => r[ci.ym] === NOW);
    const FIDS = { '동관': 'FC-EAST', '서관': 'FC-WEST' };
    const byBld = {};
    nowRows.forEach(r => (byBld[r[ci.building]] = byBld[r[ci.building]] || []).push(r));
    Object.entries(byBld).forEach(([bld, rows]) => {
      const fid = FIDS[bld] || 'FC-' + bld;
      const kF = put('facility', fid, bld, {
        facility_id: fid, facility_name: bld,
        floors: new Set(rows.map(r => r[ci.floor])).size,
        area_m2: rows.reduce((s, r) => s + r[ci.area_m2], 0),
      });
      link('scOperatesFacility', kF, kSCUS);
      rows.forEach(r => {
        const mid = `EM-${r[ci.zone_id]}`;
        const nm = `${bld} ${r[ci.floor]}F ${r[ci.zone_name]}`;
        const kM = put('energyMeter', mid, nm, {
          meter_id: mid, meter_name: nm, floor: r[ci.floor],
          temp_set_c: r[ci.temp_set_c], kwh_peak: r[ci.kwh_peak], cost_usd: r[ci.cost_usd],
        });
        link('meterOfFacility', kM, kF);
      });
    });
  }

  // 지역사무소 — 판매법인의 지역 조직 (딜러 관리·배분·지역 마케팅의 현장 주체)
  const OFFICE_CITY = { west: 'Irvine, CA', central: 'Chicago, IL', south: 'Dallas, TX', northeast: 'Parsippany, NJ', southeast: 'Atlanta, GA' };
  TD.zones.forEach(z => {
    const k = put('salesZone', z.id, z.name, { zone_id: z.id, zone_name: z.name, office_city: OFFICE_CITY[z.id], dealer_cnt: z.dealers, pop_share: z.share, ev_affinity: z.ev_aff });
    link('zoneOfficeOfSc', k, kSCUS);
  });

  // 딜러 표본 — 지역당 4개 (전국 745개 중 표본)
  const DEALER_NAMES = {
    west: ['Pacific Crest Motors', 'Golden State Auto', 'Sierra Summit Motors', 'Bayline Vehicles'],
    central: ['Prairie Wind Auto', 'Great Lakes Motors', 'Heartland Drive', 'Twin Rivers Auto'],
    south: ['Lone Star Motors', 'Gulf Coast Auto', 'Bluebonnet Drive', 'Rio Grande Motors'],
    northeast: ['Liberty Harbor Auto', 'Granite State Motors', 'Hudson Line Auto', 'Beacon Hill Motors'],
    southeast: ['Peachtree Motors', 'Palmetto Auto', 'Everglade Drive', 'Blue Ridge Motors'],
  };
  const CITY = { west: ['Sacramento, CA', 'Portland, OR', 'Phoenix, AZ', 'Denver, CO'], central: ['Chicago, IL', 'Minneapolis, MN', 'Kansas City, MO', 'Columbus, OH'], south: ['Dallas, TX', 'Houston, TX', 'San Antonio, TX', 'Oklahoma City, OK'], northeast: ['Newark, NJ', 'Boston, MA', 'Albany, NY', 'Philadelphia, PA'], southeast: ['Atlanta, GA', 'Charlotte, NC', 'Orlando, FL', 'Nashville, TN'] };
  const ZP = { west: 'W', central: 'C', south: 'S', northeast: 'N', southeast: 'E' }; // 지역 고유 접두어
  const dealersByZone = {};
  TD.zones.forEach(z => {
    dealersByZone[z.id] = [];
    for (let i = 0; i < 4; i++) {
      const id = `D-${ZP[z.id]}${String(i * 37 + 12).padStart(3, '0')}`;
      const k = put('dealer', id, DEALER_NAMES[z.id][i], {
        dealer_id: id, dealer_name: DEALER_NAMES[z.id][i], zone_id: z.id, city: CITY[z.id][i],
        grade: pick(['A', 'A', 'B', 'C']), ssi_score: (86 + rnd() * 8).toFixed(1),
        service_stalls: ri(8, 22), floorplan_line: ri(10, 24) * 1000000,
      });
      link('dealerInZone', k, key('salesZone', z.id));
      link('scManagesDealer', kSCUS, k);
      dealersByZone[z.id].push(k);
    }
  });

  // ══ 2. 제품 ═══════════════════════════════════════════════════════════════
  TD.models.forEach(m => {
    const k = put('model', m.id, m.name, { model_id: m.id, model_name: m.name, segment: m.seg, primary_plant_id: m.plant, msrp_usd: m.msrp, unit_margin_usd: m.margin, is_ev: m.ev });
    (TD.trims[m.id] || []).forEach((tn, i) => {
      const tid = `${m.id}-${tn.slice(0, 2).toUpperCase()}`;
      const tk = put('trim', tid, `${m.name} ${tn}`, { trim_id: tid, model_id: m.id, trim_name: tn, mix_weight: TD.trim_w[i], msrp_factor: TD.trim_pf[i] });
      link('trimOfModel', tk, k);
    });
  });

  // ══ 3. 계획 · 발주 ════════════════════════════════════════════════════════
  const bpNow = TD.bp.find(b => b.ym === NOW);
  TD.models.forEach(m => {
    const b = bpNow.models[m.id];
    const k = put('businessPlan', `${NOW}+${m.id}`, `BP ${NOW} ${m.name}`, {
      ym: NOW, model_id: m.id, bp_retail_qty: b.retail, bp_wholesale_qty: b.ws, bp_op_profit_usd: b.op, bp_csi: 88.5, bp_ds_days: TD.meta.ds_target,
    });
    link('bpForModel', k, key('model', m.id));
  });

  const prByKey = {};
  ['-2', '-1', '0'].forEach(off => {
    const ym = ymAdd(NOW, +off);
    const act = TD.actual.find(a => a.ym === ym);
    TD.models.forEach(m => {
      const id = `PR-${ym}-${m.id}`;
      const status = off === '0' ? 'CONFIRMED' : (off === '-1' ? 'IN_PRODUCTION' : 'COMPLETED');
      const k = put('productionRequest', id, id, {
        request_id: id, order_ym: ym, model_id: m.id, trim_id: '(전 트림)', order_qty: act ? act.models[m.id].ws : 0,
        target_ds_days: TD.meta.ds_target, status, estimated: 1,
      });
      link('scSubmitsPr', kSCUS, k);
      link('prToPlant', k, key('plant', m.plant));
      link('prForModel', k, key('model', m.id));
      prByKey[`${ym}|${m.id}`] = k;
    });
  });

  // ══ 4. 물류 마스터 ════════════════════════════════════════════════════════
  const ROUTES = [
    ['KR1-W', 'KR-1', '공장→국내수출항(2d)→해상(18d)→서부수입항(3d)→내륙철도(9d)', 32],
    ['KR2-W', 'KR-2', '공장→국내수출항(2d)→해상(18d)→서부수입항(3d)→내륙철도(9d)', 32],
    ['GA-D', 'US-GA', '공장→상차(1d)→트럭·철도(3d)', 4],
    ['SV-D', 'US-SV', '공장→상차(1d)→트럭·철도(3d)', 4],
    ['MX-D', 'MX-MT', '공장→철도(7d)→통관(1d)→트럭(2d)', 10],
  ];
  const routeByPlant = {};
  ROUTES.forEach(([id, pl, legs, lead]) => {
    const k = put('transportRoute', id, id, { route_id: id, plant_id: pl, legs, total_lead_days: lead });
    link('routeFromPlant', k, key('plant', pl));
    routeByPlant[pl] = { k, id, lead };
  });

  const shipByPlant = {}; // 공장별 현재 운항 배치 1개
  TD.plants.forEach(p => {
    const rt = routeByPlant[p.id];
    const mode = p.country === 'KR' ? '선박→철도' : (p.id === 'MX-MT' ? '철도→트럭' : '트럭·철도');
    const id = `SH-${NOW}-${rt.id.replace('-', '')}-${ri(1, 4)}`;
    const day = ri(2, 12);
    const k = put('shipment', id, id, {
      shipment_id: id, route_id: rt.id, mode, vin_qty: p.batch,
      depart_date: `${NOW}-${String(day).padStart(2, '0')}`, eta_date: `${ymAdd(NOW, 1)}-${String(ri(1, 12)).padStart(2, '0')}`,
      current_leg: p.country === 'KR' ? `해상 (${ri(4, 16)}/18일차)` : '내륙 이동 중', status: 'IN_TRANSIT',
    });
    link('shipmentOnRoute', k, key('transportRoute', rt.id));
    shipByPlant[p.id] = k;
  });

  // ══ 5. 판매 프로그램 ══════════════════════════════════════════════════════
  const actNow = TD.actual.find(a => a.ym === NOW);
  const ipKeys = {};
  const IPS = [
    ['IP-2508-MRD-CASH', 'Meridian 재고 소진 캐시', 'customer cash', 'MRD', 700, '2025-08', '2025-11', 'CLOSED'],
    ['IP-2511-ALL-YE', '연말 인센티브 (전 차종)', 'customer cash', '(전 차종)', 500, '2025-11', '2025-12', 'CLOSED'],
    ['IP-2603-AUR-APR', 'Aurora EV 저리 할부 지원', 'APR 지원', 'AUR', Math.round(actNow.models.AUR.inc * 0.6), '2026-03', NOW, 'ACTIVE'],
    ['IP-2606-LUM-LEASE', 'Lumen EV 리스 지원', '리스 지원', 'LUM', Math.round(actNow.models.LUM.inc * 0.5), '2026-06', NOW, 'ACTIVE'],
    ['IP-2608-BRAND-CASH', '브랜드 표준 캐시', 'customer cash', '(전 차종)', TD.meta.inc_ref, '2026-01', NOW, 'ACTIVE'],
  ];
  IPS.forEach(([id, nm, ty, md, amt, s, e, st]) => {
    const k = put('incentiveProgram', id, nm, { program_id: id, program_name: nm, incentive_type: ty, model_id: md, amount_usd: amt, start_ym: s, end_ym: e, status: st });
    if (md !== '(전 차종)') link('ipForModel', k, key('model', md));
    link('ipFundedBySc', k, kSCUS);   // 재무: 충당부채·정산 재원 주체
    ipKeys[md] = ipKeys[md] || []; ipKeys[md].push(k);
  });

  // 마케팅 2층 구조 — ① 판매법인 브랜드(전 차종) ② 판매법인 차종별 ③ 딜러 지역 광고(co-op)
  const brandId = `MK-${NOW.replace('-', '').slice(2)}-BRAND`;
  const brandK = put('marketingCampaign', brandId, `${NOW} 전사 브랜드 캠페인`, {
    campaign_id: brandId, campaign_name: `${NOW} 전사 브랜드 캠페인 (우산)`, tier: 'brand', model_id: '(전 차종)',
    channel: 'media 70% · digital 25% · event 5%', spend_musd: 6.5, ym: NOW,
  });
  link('mkBySc', brandK, kSCUS);
  TD.models.forEach(m => {
    const id = `MK-${NOW.replace('-', '').slice(2)}-${m.id}`;
    const k = put('marketingCampaign', id, `${m.name} ${NOW} 캠페인`, {
      campaign_id: id, campaign_name: `${m.name} ${NOW} 차종 리테일 캠페인`, tier: 'model', model_id: m.id,
      channel: 'media 55% · digital 35% · event 10%', spend_musd: +actNow.models[m.id].mkt.toFixed(1), ym: NOW,
    });
    link('mkForModel', k, key('model', m.id));
    link('mkBySc', k, kSCUS);
  });
  TD.zones.forEach(z => {
    const dk = dealersByZone[z.id][0];
    const dId = DB.objects[dk].id;
    const id = `MK-${NOW.replace('-', '').slice(2)}-LOC-${ZP[z.id]}`;
    const k = put('marketingCampaign', id, `${DB.objects[dk].title} 지역 광고`, {
      campaign_id: id, campaign_name: `${DB.objects[dk].title} ${NOW} 지역 광고 (로컬 미디어·이벤트)`,
      tier: 'dealer_local', dealer_id: dId, zone_id: z.id, coop_rate: 0.5,
      channel: 'local media 60% · digital 30% · event 10%', spend_musd: +(0.2 + rnd() * 0.3).toFixed(2), ym: NOW,
    });
    link('mkByDealer', k, dk);
    link('mkInZone', k, key('salesZone', z.id));
  });

  // ══ 6. 품질 이슈 · 개선 활동 (csi_actions 원장과 동일 스토리) ═══════════════
  const QIS = [
    ['QI-2605-LUM-CONN', 'Lumen EV 커넥티드 SW 결함', 'LUM', 'connected', '텔레매틱스 DTC 급증 + 클레임', false, 8.5, 'REMEDY_DEPLOYED'],
    ['QI-2602-AUR-QUAL', 'Aurora EV 구동계 품질 이슈', 'AUR', 'driveline', '워런티 클레임 클러스터', false, 6.2, 'CAMPAIGN_CLOSED'],
  ];
  QIS.forEach(([id, nm, md, comp, src, sf, cl, st]) => {
    const k = put('qualityIssue', id, nm, { issue_id: id, issue_name: nm, model_id: md, component: comp, detect_source: src, safety_flag: sf, claim_per_1k: cl, status: st });
    link('issueOnModel', k, key('model', md));
  });
  const qcByModel = {};
  TD.csi_actions.forEach(a => {
    const mkeys = Object.keys(a.months).sort();
    const last = a.months[mkeys[mkeys.length - 1]];
    const k = put('qualityCampaign', a.project_id, a.name, {
      project_id: a.project_id, project_name: a.name, remedy_type: a.project_id.startsWith('OTA') ? 'OTA' : 'FSC',
      model_id: a.model, component: a.component, target_vins: a.target,
      applied_vins_cum: last.applied, claim_per_1k_before: a.claim0, claim_per_1k_now: last.claim,
      score_impact: '+' + ((a.claim0 - last.claim) * 2.2).toFixed(1),
    });
    link('qcRemediesIssue', k, key('qualityIssue', a.model === 'LUM' ? 'QI-2605-LUM-CONN' : 'QI-2602-AUR-QUAL'));
    qcByModel[a.model] = k;
  });

  // ── 소셜 포스트 — VoC와 동일 분류체계(표준 taxonomy)로 자동 분류된 소셜 발화 표본 ──
  const SOCIAL = [
    ['X',       'LUM', '품질-커넥티드SW', 'NEG', 'QI-2605-LUM-CONN'],
    ['reddit',  'LUM', '품질-커넥티드SW', 'NEG', 'QI-2605-LUM-CONN'],
    ['youtube', 'AUR', '품질-구동계',     'NEG', 'QI-2602-AUR-QUAL'],
    ['forum',   'AUR', '상품성-주행거리', 'NEU', null],
    ['X',       'TRN', '상품성-디자인',   'POS', null],
    ['reddit',  'VST', '상품성-가격',     'NEU', null],
    ['youtube', 'TRN', '상품성-기능',     'POS', null],
    ['forum',   'MRD', '서비스-예약지연', 'NEG', null],
  ];
  let postSeq = 84000;
  SOCIAL.forEach(([platform, md, category, senti, issueId]) => {
    const id = `SP-${NOW.replace('-', '').slice(2)}-${postSeq += 40}`;
    const k = put('socialPost', id, id, {
      post_id: id, platform, model_id: md, category, sentiment: senti,
      engagement: ri(40, 900), posted_at: `${NOW}-${String(ri(2, 26)).padStart(2, '0')}`,
    });
    link('postAboutModel', k, key('model', md));
    if (issueId) link('postEvidencesIssue', k, key('qualityIssue', issueId));
  });

  // ══ 7. 차량 체인 — 차종당 10대, 수명주기 단계 분포 ═══════════════════════════
  // 텔레매틱스 Trip 도착지 후보 (지역사무소 관할 주요 도시 GPS — 지도 뷰에서 H3 r7로 변환)
  const ZONE_DEST = {
    west: [[34.05, -118.24], [37.77, -122.42], [33.45, -112.07], [47.61, -122.33]],
    central: [[41.88, -87.63], [44.98, -93.27], [39.10, -94.58]],
    south: [[32.78, -96.80], [29.76, -95.37], [29.42, -98.49]],
    northeast: [[40.71, -74.01], [42.36, -71.06], [39.95, -75.17]],
    southeast: [[33.75, -84.39], [35.23, -80.84], [28.54, -81.38]],
  };
  const STAGES = ['PRODUCED', 'IN_TRANSIT', 'AT_PORT', 'ALLOCATED', 'DEALER_STOCK', 'DEALER_STOCK', 'RETAILED', 'IN_SERVICE', 'IN_SERVICE', 'IN_SERVICE'];
  const ORDERV = { PRODUCED: 0, IN_TRANSIT: 1, AT_PORT: 2, ALLOCATED: 3, DEALER_STOCK: 4, RETAILED: 5, IN_SERVICE: 6 };
  const allocAgg = {}; // dealer|model → {k, qty}
  let vinSeq = 31000, custSeq = 58200, teSeq = 4400, vocSeq = 1100;

  TD.models.forEach(m => {
    const plant = TD.plants.find(p => p.id === m.plant);
    const overseas = plant.country !== 'US';
    const engines = TD.attrs.engines[m.id];
    for (let i = 0; i < 10; i++) {
      let state = STAGES[i];
      if (!overseas && state === 'AT_PORT') state = 'ALLOCATED'; // 내륙 생산분은 항만 없음
      const so = ORDERV[state];
      const trimName = pick(TD.trims[m.id], TD.trim_w);
      const trimIdx = TD.trims[m.id].indexOf(trimName);
      const trimId = `${m.id}-${trimName.slice(0, 2).toUpperCase()}`;
      const zone = pick(TD.zones, TD.zones.map(z => z.share * (m.ev ? z.ev_aff : 1))).id;
      const prodYm = ymAdd(NOW, so >= 5 ? -ri(3, 6) : (so >= 3 ? -2 : (overseas ? -1 : 0)));
      const vin = `${plant.wmi}${m.id[0]}CA${String.fromCharCode(65 + i)}XTU00${String(vinSeq += 7)}`.slice(0, 17).padEnd(17, '0');
      const msrp = Math.round(m.msrp * TD.trim_pf[trimIdx] / 100) * 100;
      const vk = put('vehicle', vin, vin, {
        vin, model_id: m.id, model_year: 2026, trim_id: trimId, engine: engines[i % engines.length],
        drivetrain: m.ev ? pick(['AWD', 'RWD']) : pick(['AWD', 'FWD']), color: pick(TD.attrs.colors, TD.attrs.color_w),
        plant_id: m.plant, prod_ym: prodYm, dest_zone_id: zone, msrp_usd: msrp, state,
      });
      link('vehicleModel', vk, key('model', m.id));
      link('vehicleTrim', vk, key('trim', trimId));
      link('plantBuildsVehicle', key('plant', m.plant), vk);
      link('vehicleDestZone', vk, key('salesZone', zone));
      const pr = prByKey[`${prodYm}|${m.id}`]; if (pr) link('prFulfilledBy', vk, pr);

      // 검사 게이트 — 통과한 전이마다 기록 (첫 차량 1대는 G2 HOLD 사례)
      function insp(gate, gname, org, ym, hold) {
        const id = `IN-${vin.slice(0, 3)}${vin.slice(-5)}-${gate}`;
        const k = put('inspection', id, `${gate} ${gname}`, {
          inspection_id: id, vin, gate: `${gate}-${gname}`, result: hold ? 'HOLD→PASS' : 'PASS',
          inspector_org: org, found_issue: hold ? '도장 스크래치 — 보수 후 재검 PASS' : '-',
          inspected_at: `${ym}-${String(ri(2, 26)).padStart(2, '0')}`,
        });
        link('inspectionOfVehicle', k, vk);
      }
      if (so >= 1) insp('G1', '공장출하(PDI)', `${plant.name} 품질부`, prodYm, false);
      if (so >= 3 && overseas) insp('G2', '항만인수(VPC)', '수입항 VPC', ymAdd(prodYm, 1), m.id === 'LUM' && i === 5);
      if (so >= 4) insp('G3', '딜러인수', '인수 딜러', ymAdd(prodYm, overseas ? 1 : 0), false);
      if (so >= 5) insp('G4', '인도전점검(PDS)', '판매 딜러', ymAdd(prodYm, overseas ? 2 : 1), false);

      if (state === 'IN_TRANSIT') link('vehicleOnShipment', vk, shipByPlant[m.plant]);

      if (so >= 3) { // 배분 확정 → allocation 집계 객체
        const dk = dealersByZone[zone][i % 4];
        const dId = DB.objects[dk].id;
        const aid = `AL-${NOW}-${dId}-${m.id}`;
        if (!allocAgg[aid]) {
          const ak = put('allocation', aid, aid, { alloc_id: aid, alloc_ym: NOW, dealer_id: dId, model_id: m.id, alloc_qty: 0, method: '실적·DS 가중', status: 'CONFIRMED' });
          link('allocToDealer', ak, dk); link('allocForModel', ak, key('model', m.id));
          allocAgg[aid] = ak;
        }
        DB.objects[allocAgg[aid]].props.alloc_qty += ri(8, 22);
        link('vehicleAllocated', vk, allocAgg[aid]);

        if (so >= 4) { // 도매 = 이익 실현 + 법인간 매입 (원가측)
          const wsYm = ymAdd(prodYm, overseas ? 2 : 1);
          const wsPrice = Math.round(msrp * 0.97);
          const margin = Math.round(m.margin * TD.trim_pf[trimIdx]);
          const wsk = put('wholesale', vin, `WS ${vin.slice(-6)}`, {
            vin, ws_ym: wsYm, zone_id: zone, wholesale_price_usd: wsPrice, variable_margin_usd: margin, freight_usd: TD.freight[m.plant],
          });
          link('wsOfVehicle', wsk, vk); link('wsToDealer', wsk, dk);
          const ick = put('vehiclePurchase', vin, `매입 ${vin.slice(-6)}`, {
            vin, seller_pc_id: DB.objects[plantPC[m.plant]].id, buyer_sc_id: 'SC-US',
            transfer_price_usd: wsPrice - margin, invoice_ym: ymAdd(wsYm, overseas ? -1 : 0),
          });
          link('purchaseOfVehicle', ick, vk); link('purchaseFromPc', ick, plantPC[m.plant]);
          // 재무·정산 관계 — 도매 시점 매출 귀속·원가 대응·매입 법인 (finance 액션 순회 경로)
          link('wsSettlesToSc', wsk, kSCUS);
          link('wsCostBasis', wsk, ick);
          link('purchaseBySc', ick, kSCUS);

          if (so >= 5) { // 소매 + 고객 + 인센티브 적용
            const rYm = ymAdd(wsYm, ri(0, 2)); const inc = actNow.models[m.id].inc + ri(-150, 150);
            const cid = `C-${custSeq += 13}`;
            const ck = put('customer', cid, cid, { customer_id: cid, zone_id: zone, owned_since: `${rYm}-${String(ri(2, 27)).padStart(2, '0')}`, connected_optin: rnd() < 0.8 });
            const rsk = put('retailSale', vin, `RS ${vin.slice(-6)}`, {
              vin, retail_ym: rYm, retail_date: `${rYm}-${String(ri(2, 27)).padStart(2, '0')}`, zone_id: zone,
              channel: rnd() < 0.9 ? 'retail' : 'fleet', txn_price_usd: msrp - inc, incentive_usd: inc,
            });
            link('rsOfVehicle', rsk, vk); link('rsByDealer', rsk, dk); link('rsToCustomer', rsk, ck);
            link('customerOwnsVehicle', ck, vk);
            (ipKeys[m.id] || []).concat(ipKeys['(전 차종)'] || []).filter(k => DB.objects[k].props.status === 'ACTIVE')
              .forEach(k => link('rsUsedIncentive', rsk, k));

            if (state === 'IN_SERVICE') buildCareChain(vk, vin, m, dk, zone, rYm, i, ck);
          }
        }
      }
    }
  });

  // ── 케어·커넥티드 체인 (운행 중 차량) ─────────────────────────────────────
  function buildCareChain(vk, vin, m, dk, zone, rYm, i, ck) {
    const dId = DB.objects[dk].id;
    // 주행 기록 (data_category=trip) — 커넥티드 동의 차량의 텔레매틱스.
    // 도착지는 주 도시(첫 후보) 가중 + 45%는 도심 셀 정중앙 → H3 셀별 카운트에 농도 차이가 생긴다.
    if (DB.objects[ck].props.connected_optin) {
      const dests = ZONE_DEST[zone];
      const w = dests.map((_, di) => di === 0 ? 3 : 1);   // 주 도시 3배 가중
      for (let t = 0; t < 6; t++) {
        const d = pick(dests, w);
        const exact = rnd() < 0.45;                        // 도심 핫셀 집중
        const tYm = ymAdd(NOW, -ri(0, Math.min(5, Math.max(0, ymDiff(rYm, NOW)))));   // 소매월~현재월 분산
        const tid = `TE-TRIP-${String(teSeq += 17).padStart(6, '0')}`;
        const tk = put('telematicsEvent', tid, tid, {
          event_id: tid, vin, ts: `${tYm}-${String(ri(2, 27)).padStart(2, '0')}T${String(ri(7, 21)).padStart(2, '0')}:${String(ri(10, 55)).padStart(2, '0')}:00Z`,
          data_category: 'trip', trip_km: +(3 + rnd() * 40).toFixed(1), trip_min: ri(8, 70),
          dest_lat: +(d[0] + (exact ? 0 : (rnd() - 0.5) * 0.5)).toFixed(4),
          dest_lon: +(d[1] + (exact ? 0 : (rnd() - 0.5) * 0.5)).toFixed(4),
        });
        link('teFromVehicle', tk, vk);
      }
    }
    // LUM: 커넥티드 SW 결함 스토리 — 텔레매틱스 DTC → 이슈 근거 → OTA 시정
    if (m.id === 'LUM') {
      const tid = `TE-${NOW.replace('-', '').slice(2)}${String(ri(10, 28)).padStart(2, '0')}-${String(teSeq += 17).padStart(6, '0')}`;
      const tk = put('telematicsEvent', tid, tid, {
        event_id: tid, vin, ts: `2026-0${ri(5, 6)}-${String(ri(2, 27)).padStart(2, '0')}T${String(ri(6, 21)).padStart(2, '0')}:${String(ri(10, 55))}:05Z`,
        data_category: 'dtc', dtc_code: 'U3100-17', severity: 'MEDIUM', triage_status: 'LINKED_TO_ISSUE',
      });
      link('teFromVehicle', tk, vk);
      link('teEvidencesIssue', tk, key('qualityIssue', 'QI-2605-LUM-CONN'));
      if (i % 3 === 1) { // 일부는 OTA 전 워런티 RO 발생
        makeRO(vin, vk, dk, dId, 'warranty', '인포테인먼트/커넥티드', ymAdd(rYm, 1), 'QI-2605-LUM-CONN');
      }
      if (i % 4 === 2) makeVoc(vin, vk, ck, '품질-커넥티드SW', 'HIGH', 'QI-2605-LUM-CONN');
    }
    // AUR: 구동계 VoC
    if (m.id === 'AUR' && i % 3 === 0) makeVoc(vin, vk, ck, '품질-구동계', 'MEDIUM', 'QI-2602-AUR-QUAL');
    // 일반: 서비스 예약 지연 VoC
    if (i % 5 === 4) makeVoc(vin, vk, ck, '서비스-예약지연', 'LOW', null);
    // AUR: 품질 캠페인(FSC) RO
    if (m.id === 'AUR' && i % 2 === 0) {
      makeRO(vin, vk, dk, dId, 'campaign', '구동계 (FSC-2603-AUR)', '2026-0' + ri(3, 6), 'QI-2602-AUR-QUAL', qcByModel['AUR']);
    }
    // 일반: 고객 페이 정기 정비
    if (i % 3 === 2) makeRO(vin, vk, dk, dId, 'customer_pay', '정기 점검·소모품', ymAdd(rYm, ri(2, 5)), null);
    // 안전 신호 사례 1건 (TRN 마지막 차량)
    if (m.id === 'TRN' && i === 9) {
      const tid = `TE-SAFE-${String(teSeq += 17).padStart(6, '0')}`;
      const tk = put('telematicsEvent', tid, tid, {
        event_id: tid, vin, ts: `${NOW}-14T08:31:22Z`, data_category: 'dtc', dtc_code: 'C1201-04',
        severity: 'SAFETY', triage_status: 'DISPATCHED(안전 대응)',
      });
      link('teFromVehicle', tk, vk);
    }
  }
  // VoC 티켓 — 표준 분류체계(소셜과 공용)로 자동 분류된 고객의 소리
  function makeVoc(vin, vk, ck, category, severity, issueId) {
    const id = `VOC-${NOW.replace('-', '').slice(2)}-${String(vocSeq += 21).padStart(5, '0')}`;
    const k = put('vocTicket', id, id, {
      voc_id: id, customer_id: DB.objects[ck].id, vin,
      channel: pick(['call', 'dealer', 'app', 'email']), category, sentiment: 'NEG', severity,
      status: issueId ? 'LINKED_TO_ISSUE' : 'CLASSIFIED', opened_at: `${NOW}-${String(ri(2, 26)).padStart(2, '0')}`,
    });
    link('vocFromCustomer', k, ck);
    link('vocOfVehicle', k, vk);
    if (issueId) link('vocEvidencesIssue', k, key('qualityIssue', issueId));
  }
  function makeRO(vin, vk, dk, dId, pay, comp, ym, issueId, qcK) {
    const id = `RO-${dId}-${ym.replace('-', '').slice(2)}${String(ri(10, 28))}-${ri(1, 9)}`;
    const labor = ri(9, 40) * 10, parts = pay === 'customer_pay' ? ri(4, 20) * 10 : ri(15, 60) * 10;
    const rk = put('repairOrder', id, id, {
      ro_id: id, vin, dealer_id: dId, pay_type: pay, component: comp, labor_usd: labor, parts_usd: parts,
      booking_delay_days: ri(1, 7), opened_at: `${ym}-${String(ri(2, 27)).padStart(2, '0')}`, status: 'CLOSED',
    });
    link('roOfVehicle', rk, vk); link('roAtDealer', rk, dk);
    if (issueId) link('roEvidencesIssue', rk, key('qualityIssue', issueId));
    if (qcK) link('roUnderCampaign', rk, qcK);
    if (pay !== 'customer_pay') { // 워런티/캠페인 → 정산 클레임
      const wc = put('warrantyClaim', 'WC-' + id, 'WC-' + id, {
        claim_id: 'WC-' + id, ro_id: id, claim_usd: labor + parts, decision: 'APPROVED', paid_ym: ymAdd(ym, 1),
      });
      link('claimOfRo', wc, rk); link('claimPaidBySc', wc, kSCUS);
    }
  }

  // ══ 학습 기반 — 차량 기능 사용 스냅샷(feature_usage 마트) + 학습 모델 레지스트리 ══
  if (TD.vdata) {
    const vc = Object.fromEntries(TD.vdata.cols.map((c, k) => [c, k]));
    let firstFu = null;
    TD.vdata.rows.filter(r => r[vc.ym] === NOW).forEach(r => {
      const mid = r[vc.model_id];
      const id = `FU-${NOW}-${mid}`;
      const fk = put('featureUsageEvent', id, id, {
        usage_key: id, ym: NOW, model_id: mid,
        hda_usage_pct: r[vc.hda_usage_pct], trailer_mode_pct: r[vc.trailer_mode_pct],
        fota_install_pct: r[vc.fota_install_pct], connected_optin_pct: r[vc.connected_optin_pct],
        dtc_per_1k: r[vc.dtc_per_1k], trips_per_vehicle: r[vc.trips_per_vehicle],
      });
      if (!firstFu) firstFu = fk;
      link('usageOfModel', fk, key('model', mid));
    });
    const anyTe = DB.order.find(k => k.startsWith('telematicsEvent:'));
    const mFcst = put('mlModel', 'ML-KPI-FCST-V0', 'KPI 시계열 예측 v0', {
      ml_model_id: 'ML-KPI-FCST-V0', ml_name: 'KPI 시계열 예측 v0', task: 'forecast',
      algo: '시즌 지수 + 선형 추세', target: '회사 KPI 14종 + 다운스트림 지표',
      train_window: `${TD.meta.months[0]}~${NOW} (32개월)`, quality_metric: 'MAPE 6.2% (홀드아웃 6개월)',
      status: 'serving',
    });
    const mDrv = put('mlModel', 'ML-DRIVER-DISC-V0', 'KPI 드라이버 발굴 v0', {
      ml_model_id: 'ML-DRIVER-DISC-V0', ml_name: 'KPI 드라이버 발굴 v0', task: 'driver-discovery',
      algo: '피어슨 상관 + 중요도 랭킹', target: '차량 신호 → CS·VoC·브랜드 KPI',
      train_window: `${TD.meta.months[0]}~${NOW} (32개월)`, quality_metric: '유의 드라이버 3종 (|r|≥0.5)',
      status: 'serving',
    });
    if (firstFu) { link('mlTrainsOnUsage', mFcst, firstFu); link('mlTrainsOnUsage', mDrv, firstFu); }
    if (anyTe) { link('mlTrainsOnTelematics', mDrv, anyTe); link('mlTrainsOnTelematics', mFcst, anyTe); }
    link('mlPredictsFor', mFcst, kSCUS); link('mlPredictsFor', mDrv, kSCUS);
  }

  // ── 인덱스 구성 ──────────────────────────────────────────────────────────
  const byType = {};
  DB.order.forEach(k => { const o = DB.objects[k]; (byType[o.type] = byType[o.type] || []).push(k); });
  const linksFrom = {}, linksTo = {};
  DB.links.forEach(l => {
    (linksFrom[l.from] = linksFrom[l.from] || []).push(l);
    (linksTo[l.to] = linksTo[l.to] || []).push(l);
  });
  return { objects: DB.objects, order: DB.order, links: DB.links, byType, linksFrom, linksTo };
};
