#!/usr/bin/env node
/**
 * 로컬 정적 서버 + 서빙 API — CloudFront 배포 환경 재현용
 *
 * 원칙: 요청 URI를 절대 재작성하지 않는다.
 *  - 기본 모드:   /prototypes/v7-strategy-sim-twin.html → ./prototypes/v7-strategy-sim-twin.html
 *  - 프리픽스 모드: CloudFront가 /<prefix>/... 경로로 서비스하는 경우를 그대로 재현.
 *    프리픽스가 없는 요청은 404 — 절대 경로(/...)로 API를 호출하는 코드를
 *    로컬에서 즉시 잡아내기 위함. 모든 리소스/API 호출은 상대 경로를 유지할 것.
 *
 * 서빙 API (/api/*): data_new/ 온톨로지 마트(Parquet)를 DuckDB로 질의한다.
 *  - 질의는 data_new/semantic/semantic-layer.json (시멘틱 정본)의 mart 바인딩 선언만 참조한다.
 *  - 폐루프 v0: POST /api/actions/approveWarrantyClaim → data_new/ledger/action_log.jsonl
 *    append(원장) → 이후 조회에 오버레이 반영.
 *  - 선택 의존성 @duckdb/node-api 가 없으면 /api 는 503, 정적 서빙은 그대로 동작한다.
 *
 * 사용법:
 *   node server.js                                  # http://localhost:8080/
 *   node server.js --port 3000                      # 포트 변경
 *   node server.js --prefix /digitaltwin            # http://localhost:8080/digitaltwin/
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

const args = process.argv.slice(2);
function argVal(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const PORT = parseInt(argVal('--port', process.env.PORT || '8080'), 10);
let PREFIX = argVal('--prefix', process.env.URL_PREFIX || '');
if (PREFIX && !PREFIX.startsWith('/')) PREFIX = '/' + PREFIX;
PREFIX = PREFIX.replace(/\/+$/, '');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function send(res, code, body, headers) {
  res.writeHead(code, Object.assign({ 'Cache-Control': 'no-store' }, headers));
  res.end(body);
}

/* ═══════════ 서빙 API — 시멘틱 레이어 선언 위의 DuckDB 질의 ═══════════ */

const SEMANTIC_PATH = path.join(ROOT, 'data_new', 'semantic', 'semantic-layer.json');
const LEDGER_PATH = path.join(ROOT, 'data_new', 'ledger', 'action_log.jsonl');

// BigInt(DuckDB COUNT 등) → Number 로 직렬화
const jsonBody = obj => JSON.stringify(obj, (k, v) => typeof v === 'bigint' ? Number(v) : v);
const sendJson = (res, code, obj) =>
  send(res, code, jsonBody(obj), { 'Content-Type': 'application/json; charset=utf-8' });

let duckdbConn = null;   // 지연 초기화 — 최초 /api 요청 시 1회
let duckdbErr = null;
async function getConn() {
  if (duckdbConn || duckdbErr) return duckdbConn;
  try {
    const { DuckDBInstance } = require('@duckdb/node-api');
    const inst = await DuckDBInstance.create(':memory:');
    duckdbConn = await inst.connect();
  } catch (e) {
    duckdbErr = `DuckDB 미설치 — npm i --no-save @duckdb/node-api (${e.message})`;
  }
  return duckdbConn;
}
function loadSemantic() {
  return JSON.parse(fs.readFileSync(SEMANTIC_PATH, 'utf8'));
}
// datasource 는 시멘틱 레이어 선언값만 사용 — 저장소 상대 경로를 검증 후 질의에 인용
function dsPath(ds) {
  if (!/^data_new\/[\w/.-]+\.parquet$/.test(ds)) throw new Error(`datasource 형식 오류: ${ds}`);
  return ds.replace(/'/g, "''");
}
async function queryRows(sql) {
  const con = await getConn();
  if (!con) throw new Error(duckdbErr);
  const res = await con.run(sql);
  return res.getRowObjects();
}

// 액션 원장 — append-only jsonl (폐루프 v0). 최신 이벤트가 상태를 결정한다.
function readLedger() {
  if (!fs.existsSync(LEDGER_PATH)) return [];
  return fs.readFileSync(LEDGER_PATH, 'utf8').split(/\n/).filter(Boolean).map(l => JSON.parse(l));
}
function appendLedger(entry) {
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.appendFileSync(LEDGER_PATH, JSON.stringify(entry) + '\n');
}
function claimOverlay(rows) {   // warrantyClaim 상태에 원장 이벤트 오버레이
  const last = new Map();
  for (const e of readLedger()) if (e.action === 'approveWarrantyClaim') last.set(e.objectId, e);
  return rows.map(r => {
    const e = last.get(r.object_id);
    return e ? { ...r, claim_status: e.decision, ledger_ts: e.ts, ledger_actor: e.actor } : r;
  });
}

async function handleApi(req, res, pathname, query) {
  const sem = loadSemantic();

  if (pathname === '/api/health') {
    const con = await getConn();
    return sendJson(res, 200, {
      ok: !!con, duckdb: !!con, error: duckdbErr || undefined,
      semanticVersion: sem.version, entity: sem.entity, ledgerEvents: readLedger().length,
    });
  }
  if (pathname === '/api/semantic') return sendJson(res, 200, sem);

  if (pathname === '/api/kpi/monthly') {
    const rows = await queryRows(
      `SELECT * FROM read_parquet('${dsPath(sem.kpiBindings.datasource)}') ORDER BY ym`);
    return sendJson(res, 200, { grain: sem.kpiBindings.grain, fields: sem.kpiBindings.fields, rows });
  }

  // 일 펄스 — 일 그레인 심박 (소매·도매·VoC·인센티브 소진). 기준일 = 데이터 마감월 말.
  if (pathname === '/api/pulse/daily') {
    const ASOF = '2026-08-28';   // 프로토타입 기준일 — 마감월(closeMonthlyFinance)과 정렬
    const days = Math.min(Math.max(parseInt(query.get('days') || '14', 10) || 14, 2), 60);
    const src = id => dsPath(sem.objectTypes.find(o => o.id === id).mart.path);
    const rows = await queryRows(`
      WITH days AS (SELECT unnest(generate_series(DATE '${ASOF}' - INTERVAL ${days - 1} DAY,
                                                  DATE '${ASOF}', INTERVAL 1 DAY))::DATE d),
      rt AS (SELECT retail_date::DATE d, count(*) n, avg(incentive_usd) inc
             FROM read_parquet('${src('retailSale')}') GROUP BY 1),
      ws AS (SELECT invoice_date::DATE d, count(*) n FROM read_parquet('${src('wholesale')}') GROUP BY 1),
      vc AS (SELECT created_date::DATE d, count(*) n FROM read_parquet('${src('vocTicket')}') GROUP BY 1)
      SELECT cast(days.d AS VARCHAR) d, coalesce(rt.n,0) retail_units,
             cast(coalesce(rt.inc,0) AS INT) avg_incentive_usd,
             coalesce(ws.n,0) wholesale_units, coalesce(vc.n,0) voc_count
      FROM days LEFT JOIN rt USING (d) LEFT JOIN ws USING (d) LEFT JOIN vc USING (d)
      ORDER BY days.d`);
    return sendJson(res, 200, { asof: ASOF, days, rows });
  }

  // 딜러 스코어 — 소매·인센티브·VoC율 (40_serve Q3 의 정규화 버전 — 팬아웃 없는 서브쿼리 집계)
  if (pathname === '/api/dealers/score') {
    const limit = Math.min(parseInt(query.get('limit') || '8', 10) || 8, 100);
    const order = query.get('order') === 'bottom' ? 'ASC' : 'DESC';
    const src = id => dsPath(sem.objectTypes.find(o => o.id === id).mart.path);
    const rows = await queryRows(`
      WITH rt AS (SELECT dealer_id, count(*) n, avg(incentive_usd) inc
                  FROM read_parquet('${src('retailSale')}') GROUP BY 1),
      vc AS (SELECT dealer_id, count(*) n FROM read_parquet('${src('vocTicket')}') GROUP BY 1)
      SELECT d.object_id dealer_id, d.title, coalesce(rt.n,0) retail_units,
             cast(coalesce(rt.inc,0) AS INT) avg_incentive_usd, coalesce(vc.n,0) voc_count,
             round(coalesce(vc.n,0)*1.0/greatest(coalesce(rt.n,0),1),3) voc_rate
      FROM read_parquet('${src('dealer')}') d
      LEFT JOIN rt ON rt.dealer_id=d.object_id
      LEFT JOIN vc ON vc.dealer_id=d.object_id
      ORDER BY retail_units ${order}, dealer_id LIMIT ${limit}`);
    return sendJson(res, 200, { order: order === 'DESC' ? 'top' : 'bottom', rows });
  }

  const mObj = pathname.match(/^\/api\/objects\/(\w+)$/);
  if (mObj) {
    const t = sem.objectTypes.find(o => o.id === mObj[1]);
    if (!t) return sendJson(res, 404, { error: `objectType 미선언: ${mObj[1]}` });
    if (!t.mart) return sendJson(res, 404, { error: `마트 미바인딩 (mart 없음 — 프로토타입 datasource 만 존재): ${t.id}` });
    const limit = Math.min(parseInt(query.get('limit') || '100', 10) || 100, 1000);
    const ym = query.get('ym');
    if (ym && !/^\d{4}-\d{2}$/.test(ym)) return sendJson(res, 400, { error: 'ym 형식: YYYY-MM' });
    let rows = await queryRows(
      `SELECT * FROM read_parquet('${dsPath(t.mart.path)}')` +
      (ym ? ` WHERE ym='${ym}'` : '') + ` LIMIT ${limit + 1000}`);   // 오버레이 후 필터 여유분
    if (t.id === 'warrantyClaim') rows = claimOverlay(rows);
    const status = query.get('status');
    if (status && /^\w+$/.test(status)) rows = rows.filter(r => r.claim_status === status || r.status === status);
    return sendJson(res, 200, { objectType: t.id, count: rows.length, rows: rows.slice(0, limit) });
  }

  const mVin = pathname.match(/^\/api\/vin\/([A-Z0-9]+)\/chain$/);
  if (mVin) {
    const vin = mVin[1];
    const src = id => dsPath(sem.objectTypes.find(o => o.id === id).mart.path);
    const rows = await queryRows(`
      SELECT 'vehicle' step, object_id id, prod_ym detail, 1 seq FROM read_parquet('${src('vehicle')}') WHERE object_id='${vin}'
      UNION ALL SELECT 'purchase', object_id, cast(purchase_price_usd AS VARCHAR), 2 FROM read_parquet('${src('vehiclePurchase')}') WHERE vin='${vin}'
      UNION ALL SELECT 'wholesale', object_id, invoice_id, 3 FROM read_parquet('${src('wholesale')}') WHERE vin='${vin}'
      UNION ALL SELECT 'shipment', object_id, cast(ship_date AS VARCHAR), 4 FROM read_parquet('${src('shipment')}') WHERE vin='${vin}'
      UNION ALL SELECT 'retailSale', object_id, cast(retail_price_usd AS VARCHAR), 5 FROM read_parquet('${src('retailSale')}') WHERE vin='${vin}'
      UNION ALL SELECT 'vocTicket', object_id, defect_group, 6 FROM read_parquet('${src('vocTicket')}') WHERE vin='${vin}'
      ORDER BY seq`);
    return sendJson(res, 200, { vin, chain: rows });
  }

  const mAct = pathname.match(/^\/api\/actions\/(\w+)$/);
  if (mAct && req.method === 'POST') {
    const act = sem.actionTypes.find(a => a.id === mAct[1] && a.gate);   // 원장 게이트 선언 액션만
    if (!act) return sendJson(res, 404, { error: `actionType 미선언 (또는 gate 미선언): ${mAct[1]}` });
    if (act.id !== 'approveWarrantyClaim')
      return sendJson(res, 501, { error: `미구현 액션 (폐루프 v0 은 approveWarrantyClaim 만): ${act.id}` });
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 65536) return sendJson(res, 413, { error: 'body 초과' }); }
    let p; try { p = JSON.parse(body || '{}'); } catch { return sendJson(res, 400, { error: 'JSON 파싱 실패' }); }
    const objectId = String(p.objectId || '');
    const decision = String(p.decision || '');
    if (!/^[A-Z0-9-]+$/.test(objectId)) return sendJson(res, 400, { error: 'objectId 필요 (예: QM00000123)' });
    if (!['APPR', 'REJ'].includes(decision)) return sendJson(res, 400, { error: "decision 은 'APPR' | 'REJ'" });
    const t = sem.objectTypes.find(o => o.id === act.objectType);
    const found = claimOverlay(await queryRows(
      `SELECT * FROM read_parquet('${dsPath(t.mart.path)}') WHERE object_id='${objectId}'`));
    if (!found.length) return sendJson(res, 404, { error: `클레임 없음: ${objectId}` });
    if (found[0].claim_status !== 'PEND')
      return sendJson(res, 409, { error: `PEND 상태가 아님 (현재 ${found[0].claim_status})` });
    const entry = {
      ts: new Date().toISOString(), action: act.id, gate: act.gate,
      objectId, decision, actor: String(p.actor || 'anonymous').slice(0, 64),
      prevStatus: found[0].claim_status,
    };
    appendLedger(entry);
    const after = claimOverlay(found)[0];
    return sendJson(res, 200, { ok: true, entry, object: after });
  }

  return sendJson(res, 404, { error: `알 수 없는 API: ${pathname}` });
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    return send(res, 400, 'Bad Request', { 'Content-Type': 'text/plain' });
  }

  // 프리픽스 모드: CloudFront와 동일하게 프리픽스가 붙은 URI만 유효
  if (PREFIX) {
    if (pathname === PREFIX) {
      return send(res, 301, '', { Location: PREFIX + '/' });
    }
    if (!pathname.startsWith(PREFIX + '/')) {
      return send(res, 404,
        `404 — 이 서버는 ${PREFIX}/ 하위 URI만 서비스합니다 (CloudFront 프리픽스 재현). ` +
        '절대 경로 대신 상대 경로로 호출하세요.\n',
        { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    // 오리진 매핑(CloudFront origin path와 동일 개념) — 클라이언트 URI는 그대로 유지됨
    pathname = pathname.slice(PREFIX.length);
  }

  // 서빙 API — 시멘틱 레이어 위의 DuckDB 질의 (실패해도 정적 서빙은 영향 없음)
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    const query = new URL(req.url, 'http://x').searchParams;
    handleApi(req, res, pathname, query)
      .catch(e => sendJson(res, duckdbErr ? 503 : 500, { error: e.message }));
    return;
  }

  let filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    return send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain' });
  }

  let stat;
  try { stat = fs.statSync(filePath); } catch { stat = null; }

  if (stat && stat.isDirectory()) {
    if (!pathname.endsWith('/')) {
      return send(res, 301, '', { Location: PREFIX + pathname + '/' });
    }
    filePath = path.join(filePath, 'index.html');
    try { stat = fs.statSync(filePath); } catch { stat = null; }
  }

  if (!stat || !stat.isFile()) {
    return send(res, 404, `404 Not Found: ${PREFIX}${pathname}\n`,
      { 'Content-Type': 'text/plain; charset=utf-8' });
  }

  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Cache-Control': 'no-store' });
  fs.createReadStream(filePath).pipe(res);
});

// 포트 점유 시(EADDRINUSE) 다음 포트로 자동 이동 — 최대 20회 시도
let port = PORT;
let attempts = 0;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && attempts < 20) {
    attempts++;
    console.log(`포트 ${port} 사용 중 → ${port + 1} 시도`);
    port++;
    server.listen(port);
  } else {
    console.error(err.message);
    process.exit(1);
  }
});

server.listen(port, () => {
  const base = `http://localhost:${port}${PREFIX}`;
  console.log(`디지털 트윈 프로토타입 서버 실행 중`);
  console.log(`  인덱스:  ${base}/`);
  console.log(`  예시:    ${base}/prototypes/v7-strategy-sim-twin.html`);
  if (PREFIX) console.log(`  (프리픽스 모드: ${PREFIX} — 프리픽스 없는 요청은 404)`);
});
