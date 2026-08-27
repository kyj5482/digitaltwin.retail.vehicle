#!/usr/bin/env node
/**
 * 로컬 정적 서버 — CloudFront 배포 환경 재현용 (외부 의존성 없음)
 *
 * 원칙: 요청 URI를 절대 재작성하지 않는다.
 *  - 기본 모드:   /prototypes/v7-strategy-sim-twin.html → ./prototypes/v7-strategy-sim-twin.html
 *  - 프리픽스 모드: CloudFront가 /<prefix>/... 경로로 서비스하는 경우를 그대로 재현.
 *    프리픽스가 없는 요청은 404 — 절대 경로(/...)로 API를 호출하는 코드를
 *    로컬에서 즉시 잡아내기 위함. 모든 리소스/API 호출은 상대 경로를 유지할 것.
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
