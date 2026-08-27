// =============================================================================
// hover.test.mjs — 온톨로지 그래프 호버 하이라이트 동작 테스트 (Playwright + node:test)
// 실행: prototypes/tests/run-tests.sh  (LD_LIBRARY_PATH로 chromium 시스템 라이브러리 주입)
//
// 검증 대상 (v7-ontology-explorer.html 탭1 그래프):
//  1. 노드 호버 = closedNeighborhood 'hi' + 나머지 'dim' (그룹/평면 제외) — 정확한 집합
//  2. 깜빡임 없음 — 노드→노드 스윕(빠름/느림 모두)에서 전체 해제(clear)가 발생하지 않음
//  3. 배경에 멈추면 해제, 노드 이탈 후 즉시 복귀하면 해제 없음
//  4. 컨테이너 이탈 = 즉시 해제
//  5. 줌/팬 후에도 하이라이트가 커서 아래 실제 노드와 일치 (스테일 없음)
//  6. 레이아웃 전환(밸류체인↔아이소메트릭) 후에도 호버 정상 동작
// =============================================================================
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGE = 'file://' + path.resolve(__dirname, '..', 'v7-ontology-explorer.html');

let browser, page;
const errors = [];

before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(PAGE);
  await page.waitForFunction(() => window._cy && window._hoverDebug);
  await page.waitForTimeout(400); // 초기 fit 안정화
  await page.evaluate(() => {
    window.__t = {
      // 노드 중심의 페이지(뷰포트) 좌표
      pageXY(id) {
        const cy = window._cy, r = cy.container().getBoundingClientRect();
        const p = cy.$('#' + id).renderedPosition();
        return { x: r.left + p.x, y: r.top + p.y };
      },
      // 모델 좌표 → 페이지 좌표
      modelToPage(x, y) {
        const cy = window._cy, r = cy.container().getBoundingClientRect();
        const z = cy.zoom(), pan = cy.pan();
        return { x: r.left + x * z + pan.x, y: r.top + y * z + pan.y };
      },
      // 타입 노드들의 모델 좌표·크기
      typeNodes() {
        return window._cy.nodes('[!isGroup][!isPlane]').map(n => ({
          id: n.id(), x: n.position('x'), y: n.position('y'), w: n.width(), h: n.height(),
        }));
      },
      // 페이지 좌표 아래에 있는 타입 노드 (테스트 독자 판정 — 페이지 로직과 독립)
      nodeAtPage(px, py) {
        const cy = window._cy, r = cy.container().getBoundingClientRect();
        const z = cy.zoom(), pan = cy.pan();
        const mx = (px - r.left - pan.x) / z, my = (py - r.top - pan.y) / z;
        const hit = this.typeNodes().find(n =>
          Math.abs(mx - n.x) <= n.w / 2 && Math.abs(my - n.y) <= n.h / 2);
        return hit ? hit.id : null;
      },
      state() {
        const cy = window._cy;
        return {
          hi: cy.$('.hi').map(e => e.id()).sort(),
          dim: cy.$('.dim').map(e => e.id()).sort(),
          both: cy.$('.hi.dim').map(e => e.id()),
          hoverId: window._hoverDebug.hoverId,
          pinnedId: window._hoverDebug.pinnedId,
          stats: { ...window._hoverDebug.stats },
        };
      },
      // 호버 시 기대되는 hi/dim 집합
      expected(id) {
        const cy = window._cy;
        const hood = cy.$('#' + id).closedNeighborhood();
        const dim = cy.elements().not(hood).filter(e => !e.data('isGroup') && !e.data('isPlane'));
        return { hi: hood.map(e => e.id()).sort(), dim: dim.map(e => e.id()).sort() };
      },
      dimOpacity() {
        const d = window._cy.$('.dim');
        return d.length ? d[0].numericStyle('opacity') : null;
      },
      // 어떤 요소(라벨 포함)와도 겹치지 않는 진짜 빈 배경 지점 (페이지 좌표)
      emptyPoint() {
        const cy = window._cy, r = cy.container().getBoundingClientRect();
        const boxes = cy.elements().filter(e => !e.data('isPlane') && e.visible())
          .map(e => e.renderedBoundingBox());
        for (let y = 20; y < r.height - 20; y += 25) {
          for (let x = 20; x < r.width - 20; x += 25) {
            if (x < 260 && y < 60) continue;   // 좌상단 레이아웃 툴바 회피
            if (boxes.every(b => x < b.x1 - 15 || x > b.x2 + 15 || y < b.y1 - 15 || y > b.y2 + 15))
              return { x: r.left + x, y: r.top + y };
          }
        }
        return null;
      },
      reset() { const s = window._hoverDebug.stats; s.applies = 0; s.clears = 0; },
    };
  });
});

after(async () => { await browser.close(); });

beforeEach(async () => {
  // 중립화: 포커스/고정이 완전히 풀릴 때까지 배경 탭 반복(포커스 중 배경 탭 = 한 단계 복귀라 여러 번 필요)
  // + 복귀 애니메이션 대기 + 뷰포트 리셋 + 컨테이너 밖(헤더)으로 이동 → 카운터 리셋
  const wasActive = await page.evaluate(() => {
    let n = 0;
    while ((window._focusDebug.focusOn || window._hoverDebug.pinnedId) && n < 6) { window._cy.emit('tap'); n++; }
    return n > 0;
  });
  if (wasActive) {
    await page.waitForTimeout(950);   // exitFocus 위치 복원(350ms) + fit(250ms) 완료 대기
    await page.evaluate(() => { window._cy.fit(window._cy.elements(':visible'), 40); });
  }
  await page.mouse.move(8, 8);
  await page.waitForTimeout(50);
  await page.evaluate(() => window.__t.reset());
});

// 노드 중심으로 호버시키고 상태가 기대 집합과 일치하는지 단언
async function hoverAndCheck(id) {
  const c = await page.evaluate(i => window.__t.pageXY(i), id);
  await page.mouse.move(c.x, c.y);
  await page.waitForTimeout(30);
  const [st, exp] = await page.evaluate(i =>
    [window.__t.state(), window.__t.expected(i)], id);
  assert.equal(st.hoverId, id, `hoverId는 ${id}여야 함`);
  assert.deepEqual(st.hi, exp.hi, `hi 집합이 closedNeighborhood와 일치해야 함 (${id})`);
  assert.deepEqual(st.dim, exp.dim, `dim 집합이 기대와 일치해야 함 (${id})`);
  assert.deepEqual(st.both, [], 'hi와 dim이 동시에 붙은 요소가 없어야 함');
  return st;
}

// 세로로 인접한 두 노드(같은 열)와 그 사이 틈의 페이지 좌표
async function verticalPairWithGap() {
  return page.evaluate(() => {
    const nodes = window.__t.typeNodes();
    const byX = {};
    nodes.forEach(n => (byX[n.x] = byX[n.x] || []).push(n));
    for (const col of Object.values(byX)) {
      if (col.length >= 2) {
        col.sort((a, b) => a.y - b.y);
        const [a, b] = col;
        const gapY = (a.y + a.h / 2 + b.y - b.h / 2) / 2;
        return {
          a: { id: a.id, ...window.__t.modelToPage(a.x, a.y) },
          b: { id: b.id, ...window.__t.modelToPage(b.x, b.y) },
          gap: window.__t.modelToPage(a.x, gapY),
        };
      }
    }
    throw new Error('세로 인접 노드 쌍을 찾지 못함');
  });
}

// 같은 행(y 동일)의 노드들 — 가로 스윕 경로
async function rowNodes() {
  return page.evaluate(() => {
    const nodes = window.__t.typeNodes();
    const minY = Math.min(...nodes.map(n => n.y));
    return nodes.filter(n => n.y === minY).sort((a, b) => a.x - b.x)
      .map(n => ({ id: n.id, ...window.__t.modelToPage(n.x, n.y) }));
  });
}

// ── T1. 로드 상태 ────────────────────────────────────────────────────────────
test('T1 페이지 로드 — JS 오류 없음, 그래프 구성 완료', async () => {
  assert.deepEqual(errors, [], 'JS 오류가 없어야 함');
  const n = await page.evaluate(() => ({
    types: window.ONTOLOGY.objectTypes.length,
    rendered: window._cy.nodes('[!isGroup][!isPlane]').length,
    edges: window._cy.edges().length,
    links: window.ONTOLOGY.linkTypes.length,
  }));
  assert.equal(n.rendered, n.types, '객체 타입 노드가 전부 렌더돼야 함');
  assert.equal(n.edges, n.links, '링크 타입 엣지가 전부 렌더돼야 함');
});

// ── T2. 기본 호버 = 이웃 hi + 나머지 dim ────────────────────────────────────
test('T2 노드 호버 — closedNeighborhood 하이라이트, 나머지 dim, 그룹/평면 제외', async () => {
  const ids = await page.evaluate(() => window.__t.typeNodes().slice(0, 3).map(n => n.id));
  for (const id of ids) {
    const st = await hoverAndCheck(id);
    assert.ok(st.hi.length >= 1, '자기 자신 포함 최소 1개 hi');
    assert.ok(st.dim.length > 0, '나머지는 dim');
  }
  await page.waitForTimeout(250); // opacity 페이드(0.12s) 완료 후 실측
  const dimOp = await page.evaluate(() => window.__t.dimOpacity());
  assert.ok(dimOp !== null && dimOp < 0.5, `dim 요소의 실제 opacity(${dimOp})가 낮아져야 함`);
});

// ── T3. 빠른 가로 스윕 — 전체 해제(깜빡임) 없이 직행 전환 ────────────────────
test('T3 빠른 스윕 — 노드→노드 이동 중 clear 0회, 마지막 노드 하이라이트 유지', async () => {
  const row = await rowNodes();
  assert.ok(row.length >= 3, '스윕할 행 노드 3개 이상');
  await page.mouse.move(row[0].x, row[0].y);
  await page.evaluate(() => window.__t.reset());
  const last = row[row.length - 1];
  await page.mouse.move(last.x, last.y, { steps: 80 });
  await page.waitForTimeout(30);
  const st = await page.evaluate(() => window.__t.state());
  assert.equal(st.stats.clears, 0, `스윕 중 전체 해제가 없어야 함 (clears=${st.stats.clears})`);
  assert.equal(st.hoverId, last.id, '스윕 종료 시 마지막 노드가 호버 상태');
  const exp = await page.evaluate(i => window.__t.expected(i), last.id);
  assert.deepEqual(st.hi, exp.hi, '스윕 종료 시 하이라이트 집합 정확');
});

// ── T4. 느린 스윕 — 틈에서 오래 머물러도 이동 중이면 깜빡임 없음 ─────────────
test('T4 느린 스윕 — 이동 중에는 틈 통과가 길어도 clear 0회', async () => {
  const row = await rowNodes();
  const [a, b] = row;
  await page.mouse.move(a.x, a.y);
  await page.evaluate(() => window.__t.reset());
  // a→b를 12단계로 나눠 단계당 70ms — 틈 통과에 300ms 이상 걸리는 느린 이동
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(a.x + (b.x - a.x) * i / 12, a.y);
    await page.waitForTimeout(70);
  }
  const st = await page.evaluate(() => window.__t.state());
  assert.equal(st.stats.clears, 0, `느린 스윕 중에도 전체 해제가 없어야 함 (clears=${st.stats.clears})`);
  assert.equal(st.hoverId, b.id, '느린 스윕 종료 시 목적 노드가 호버 상태');
});

// ── T5. 배경에 정지 — 유예 후 정확히 1회 해제 ───────────────────────────────
test('T5 노드 이탈 후 배경 정지 — 유예 후 1회 해제, 잔여 하이라이트 없음', async () => {
  const { a, gap } = await verticalPairWithGap();
  await page.mouse.move(a.x, a.y);
  await page.evaluate(() => window.__t.reset());
  await page.mouse.move(gap.x, gap.y);
  await page.waitForTimeout(700); // 유예(그레이스)보다 충분히 길게
  const st = await page.evaluate(() => window.__t.state());
  assert.equal(st.hoverId, null, '배경 정지 후 호버 해제');
  assert.deepEqual(st.hi, [], 'hi 잔여 없음');
  assert.deepEqual(st.dim, [], 'dim 잔여 없음');
  assert.equal(st.stats.clears, 1, `해제는 정확히 1회 (clears=${st.stats.clears})`);
});

// ── T6. 이탈 직후 같은 노드 복귀 — 해제/재적용 없음 ─────────────────────────
test('T6 틈으로 나갔다가 유예 내 복귀 — 해제 0회, 재적용 0회', async () => {
  const { a, gap } = await verticalPairWithGap();
  await page.mouse.move(a.x, a.y);
  await page.evaluate(() => window.__t.reset());
  await page.mouse.move(gap.x, gap.y);
  await page.waitForTimeout(60);
  await page.mouse.move(a.x + 2, a.y);
  await page.waitForTimeout(300);
  const st = await page.evaluate(() => window.__t.state());
  assert.equal(st.hoverId, a.id, '같은 노드 호버 유지');
  assert.equal(st.stats.clears, 0, '해제 없음');
  assert.equal(st.stats.applies, 0, '불필요한 재적용 없음');
});

// ── T7. 경계 지터 — 노드↔틈 빠른 반복에도 상태 안정 ─────────────────────────
test('T7 경계 지터 — 노드/틈 왕복 10회에 clear 0, apply 0', async () => {
  const { a, gap } = await verticalPairWithGap();
  await page.mouse.move(a.x, a.y);
  await page.evaluate(() => window.__t.reset());
  for (let i = 0; i < 10; i++) {
    await page.mouse.move(gap.x, gap.y + (i % 2));
    await page.mouse.move(a.x + (i % 3), a.y);
  }
  await page.waitForTimeout(50);
  const st = await page.evaluate(() => window.__t.state());
  assert.equal(st.hoverId, a.id);
  assert.equal(st.stats.clears, 0, '지터 중 해제 없음');
  assert.equal(st.stats.applies, 0, '지터 중 재적용 없음');
});

// ── T8. 컨테이너 이탈 — 즉시 해제 ───────────────────────────────────────────
test('T8 캔버스 밖(사이드패널)으로 이탈 — 즉시 해제', async () => {
  const { a } = await verticalPairWithGap();
  await page.mouse.move(a.x, a.y);
  const panel = await page.evaluate(() => {
    const r = document.getElementById('sidePanel').getBoundingClientRect();
    return { x: r.left + 40, y: r.top + 100 };
  });
  await page.mouse.move(panel.x, panel.y);
  await page.waitForTimeout(60);
  const st = await page.evaluate(() => window.__t.state());
  assert.equal(st.hoverId, null, '이탈 즉시 호버 해제');
  assert.deepEqual(st.hi, [], 'hi 잔여 없음');
  assert.deepEqual(st.dim, [], 'dim 잔여 없음');
});

// ── T9. 휠 줌 — 줌 후에도 커서 아래 노드와 하이라이트 일치 ───────────────────
test('T9 휠 줌 인/아웃 — 줌이 실제로 동작하고 하이라이트가 커서 아래 노드와 일치', async () => {
  const { a } = await verticalPairWithGap();
  await page.mouse.move(a.x, a.y);
  const z0 = await page.evaluate(() => window._cy.zoom());
  await page.mouse.wheel(0, -400);           // 줌 인
  await page.waitForTimeout(250);
  const z1 = await page.evaluate(() => window._cy.zoom());
  assert.ok(z1 > z0 * 1.05, `휠로 줌 인이 돼야 함 (${z0.toFixed(3)} → ${z1.toFixed(3)})`);
  let [under, st] = await page.evaluate(p =>
    [window.__t.nodeAtPage(p.x, p.y), window.__t.state()], a);
  assert.equal(st.hoverId, under, `줌 인 후 hoverId(${st.hoverId})가 커서 아래 노드(${under})와 일치`);
  await page.mouse.wheel(0, 900);            // 크게 줌 아웃
  await page.waitForTimeout(700);            // 유예 경과 포함
  const z2 = await page.evaluate(() => window._cy.zoom());
  assert.ok(z2 < z1 * 0.95, `휠로 줌 아웃이 돼야 함 (${z1.toFixed(3)} → ${z2.toFixed(3)})`);
  [under, st] = await page.evaluate(p =>
    [window.__t.nodeAtPage(p.x, p.y), window.__t.state()], a);
  assert.equal(st.hoverId, under, `줌 아웃 후 hoverId(${st.hoverId})가 커서 아래 노드(${under})와 일치`);
  if (under) {
    const exp = await page.evaluate(i => window.__t.expected(i), under);
    const cur = await page.evaluate(() => window.__t.state());
    assert.deepEqual(cur.hi, exp.hi, '줌 후 하이라이트 집합 정확');
  }
});

// ── T10. 배경 팬 드래그 — 드래그 중 동결, 종료 후 커서 아래와 일치 ───────────
test('T10 팬 드래그 — 종료 후 하이라이트가 커서 아래 노드와 일치', async () => {
  const { a, gap } = await verticalPairWithGap();
  await page.mouse.move(a.x, a.y);           // 노드 위에서 하이라이트
  await page.waitForTimeout(30);
  await page.mouse.move(gap.x, gap.y);       // 배경(틈)으로
  await page.mouse.down();                   // 배경에서 팬 시작
  await page.mouse.move(gap.x + 120, gap.y + 60, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(700);            // 유예 경과
  const [under, st] = await page.evaluate(p =>
    [window.__t.nodeAtPage(p.x, p.y), window.__t.state()],
    { x: gap.x + 120, y: gap.y + 60 });
  assert.equal(st.hoverId, under, `팬 종료 후 hoverId(${st.hoverId}) = 커서 아래(${under})`);
  if (!under) {
    assert.deepEqual(st.hi, [], '커서가 배경이면 hi 잔여 없음');
    assert.deepEqual(st.dim, [], '커서가 배경이면 dim 잔여 없음');
  }
  // 원위치 복원
  await page.evaluate(() => { window._cy.fit(window._cy.elements(':visible'), 40); });
});

// ── T11. 도구바 — 고정 시 [관계 뷰] 버튼, 해제 시 숨김 ──────────────────────
test('T11 도구바 — 객체 고정 시 [관계 뷰] 버튼 표시, 해제 시 숨김', async () => {
  let vis = await page.evaluate(() => document.getElementById('graphTools').style.display !== 'none');
  assert.equal(vis, false, '초기(비고정)에는 도구바 숨김');
  const { a } = await verticalPairWithGap();
  await page.mouse.click(a.x, a.y);
  await page.waitForTimeout(80);
  const btn = await page.evaluate(() => ({
    tools: document.getElementById('graphTools').style.display !== 'none',
    focus: document.getElementById('btnFocus').style.display !== 'none',
    text: document.getElementById('btnFocus').textContent,
    back: document.getElementById('btnBack').style.display !== 'none',
  }));
  assert.ok(btn.tools && btn.focus, '고정 시 관계 뷰 버튼 표시');
  assert.ok(btn.text.includes('관계 뷰'), '버튼에 대상 타입·관계 뷰 표기');
  assert.equal(btn.back, false, '그래프 뷰에서는 이전 버튼 없음');
  const empty = await page.evaluate(() => window.__t.emptyPoint());
  await page.mouse.click(empty.x, empty.y);
  await page.waitForTimeout(80);
  vis = await page.evaluate(() => document.getElementById('graphTools').style.display !== 'none');
  assert.equal(vis, false, '고정 해제 시 도구바 숨김');
});

// ── T12. 클릭 — 노드 클릭 시 사이드패널에 타입 상세 ─────────────────────────
test('T12 노드 클릭 — 사이드패널에 해당 타입 상세 렌더', async () => {
  const first = await page.evaluate(() => {
    const n = window.__t.typeNodes()[0];
    return { id: n.id, ...window.__t.modelToPage(n.x, n.y) };
  });
  await page.mouse.click(first.x, first.y);
  await page.waitForTimeout(100);
  const ok = await page.evaluate(id => {
    const name = window.ONTOLOGY.objectTypes.find(t => t.id === id).name;
    return document.getElementById('sidePanel').textContent.includes(name);
  }, first.id);
  assert.ok(ok, '사이드패널에 클릭한 타입 이름이 표시돼야 함');
});

// ── T13. 클릭 고정 — 호버·배경 정지에도 하이라이트 유지 ─────────────────────
test('T13 노드 클릭 고정 — 다른 노드 호버·배경 정지에도 하이라이트 유지', async () => {
  const { a, b, gap } = await verticalPairWithGap();
  await page.mouse.click(a.x, a.y);
  await page.waitForTimeout(50);
  const exp = await page.evaluate(i => window.__t.expected(i), a.id);
  let st = await page.evaluate(() => window.__t.state());
  assert.equal(st.pinnedId, a.id, '클릭한 노드가 고정돼야 함');
  assert.deepEqual(st.hi, exp.hi, '고정 노드의 이웃이 하이라이트');
  await page.evaluate(() => window.__t.reset());
  await page.mouse.move(b.x, b.y);           // 다른 노드 위로 호버
  await page.waitForTimeout(80);
  st = await page.evaluate(() => window.__t.state());
  assert.equal(st.pinnedId, a.id, '호버해도 고정 유지');
  assert.deepEqual(st.hi, exp.hi, '하이라이트가 고정 대상 그대로');
  assert.equal(st.stats.applies, 0, '호버로 인한 재적용 없음');
  await page.mouse.move(gap.x, gap.y);       // 배경으로 이동 후 정지
  await page.waitForTimeout(600);
  st = await page.evaluate(() => window.__t.state());
  assert.deepEqual(st.hi, exp.hi, '배경 정지에도 해제되지 않음');
  assert.equal(st.stats.clears, 0, '유예 해제가 동작하면 안 됨');
});

// ── T14. 고정 중 줌/팬 — 하이라이트 불변 ────────────────────────────────────
test('T14 고정 중 휠 줌·팬 드래그 — 하이라이트 집합 불변', async () => {
  const { a, gap } = await verticalPairWithGap();
  await page.mouse.click(a.x, a.y);
  await page.waitForTimeout(50);
  const exp = await page.evaluate(i => window.__t.expected(i), a.id);
  await page.mouse.move(gap.x, gap.y);
  await page.mouse.wheel(0, -400);           // 줌 인
  await page.waitForTimeout(250);
  await page.mouse.wheel(0, 600);            // 줌 아웃
  await page.waitForTimeout(250);
  await page.mouse.down();                   // 배경 팬 드래그
  await page.mouse.move(gap.x + 100, gap.y + 50, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const st = await page.evaluate(() => window.__t.state());
  assert.equal(st.pinnedId, a.id, '줌/팬 후에도 고정 유지');
  assert.deepEqual(st.hi, exp.hi, '하이라이트 집합 불변');
  await page.evaluate(() => { window._cy.fit(window._cy.elements(':visible'), 40); });
});

// ── T15. 다른 객체 클릭 — 고정 대상 변경 ────────────────────────────────────
test('T15 고정 중 다른 노드 클릭 — 고정 대상과 사이드패널이 그 노드로 변경', async () => {
  const { a, b } = await verticalPairWithGap();
  await page.mouse.click(a.x, a.y);
  await page.waitForTimeout(50);
  await page.mouse.click(b.x, b.y);
  await page.waitForTimeout(80);
  const exp = await page.evaluate(i => window.__t.expected(i), b.id);
  const st = await page.evaluate(() => window.__t.state());
  assert.equal(st.pinnedId, b.id, '고정 대상이 새 노드로 변경');
  assert.deepEqual(st.hi, exp.hi, '하이라이트가 새 노드의 이웃으로 변경');
  const ok = await page.evaluate(id => {
    const name = window.ONTOLOGY.objectTypes.find(t => t.id === id).name;
    return document.getElementById('sidePanel').textContent.includes(name);
  }, b.id);
  assert.ok(ok, '사이드패널도 새 노드 상세로 변경');
});

// ── T16. 배경 클릭 — 해제 후 호버 재개 ──────────────────────────────────────
test('T16 배경(비객체) 클릭 — 고정 해제, 이후 호버 정상 재개', async () => {
  const { a } = await verticalPairWithGap();
  await page.mouse.click(a.x, a.y);
  await page.waitForTimeout(50);
  const empty = await page.evaluate(() => window.__t.emptyPoint());
  assert.ok(empty, '빈 배경 지점을 찾아야 함');
  await page.mouse.click(empty.x, empty.y);  // 비객체(진짜 빈 배경) 클릭
  await page.waitForTimeout(80);
  let st = await page.evaluate(() => window.__t.state());
  assert.equal(st.pinnedId, null, '고정 해제');
  assert.deepEqual(st.hi, [], 'hi 잔여 없음');
  assert.deepEqual(st.dim, [], 'dim 잔여 없음');
  await hoverAndCheck(a.id);                 // 해제 후 호버가 다시 동작
});

// ── T17. 엣지 클릭 — 링크 고정 (엣지 + 양끝 노드) ───────────────────────────
test('T17 엣지 클릭 고정 — 엣지와 양끝 노드 하이라이트, 링크 패널 표시', async () => {
  const edge = await page.evaluate(() => {
    const e = window._cy.edges()[0];
    return { id: e.id(), lt: e.data('lt'), ends: [e.id(), e.source().id(), e.target().id()].sort() };
  });
  await page.evaluate(id => { window._cy.getElementById(id).emit('tap'); }, edge.id);
  await page.waitForTimeout(80);
  const st = await page.evaluate(() => window.__t.state());
  assert.equal(st.pinnedId, edge.id, '엣지가 고정 대상');
  assert.deepEqual(st.hi, edge.ends, '엣지 + 양끝 노드만 하이라이트');
  const ok = await page.evaluate(() =>
    document.getElementById('sidePanel').textContent.includes('링크'));
  assert.ok(ok, '사이드패널에 링크 상세 표시');
  // 다른 노드 호버해도 유지
  const { b } = await verticalPairWithGap();
  await page.mouse.move(b.x, b.y);
  await page.waitForTimeout(80);
  const st2 = await page.evaluate(() => window.__t.state());
  assert.deepEqual(st2.hi, edge.ends, '엣지 고정 중 호버에도 하이라이트 유지');
});

// ── T18. 노드 드래그 = 팬 — 객체 이동 불가 ──────────────────────────────────
test('T18 노드 드래그 — 노드는 고정(이동 불가), 드래그는 팬으로 동작', async () => {
  async function dragOnNode() {
    const before = await page.evaluate(() => {
      const n = window.__t.typeNodes()[3];
      const pan = window._cy.pan();
      return { id: n.id, px: n.x, py: n.y, pan, ...window.__t.modelToPage(n.x, n.y) };
    });
    await page.mouse.move(before.x, before.y);
    await page.mouse.down();
    await page.mouse.move(before.x + 80, before.y + 40, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    const after = await page.evaluate(id => {
      const n = window._cy.getElementById(id), pan = window._cy.pan();
      return { px: n.position('x'), py: n.position('y'), pan };
    }, before.id);
    assert.equal(after.px, before.px, '노드 x 좌표 불변');
    assert.equal(after.py, before.py, '노드 y 좌표 불변');
    const panMoved = Math.abs(after.pan.x - before.pan.x) + Math.abs(after.pan.y - before.pan.y);
    assert.ok(panMoved > 50, `노드 위 드래그가 팬으로 동작해야 함 (pan 이동 ${panMoved.toFixed(1)}px)`);
    await page.evaluate(() => { window._cy.fit(window._cy.elements(':visible'), 40); });
  }
  await dragOnNode();
  // 배경(빈 지점)·그룹 상자 등 어디서 시작해도 팬이 돼야 함
  async function dragPansFrom(pt, label) {
    const before = await page.evaluate(() => ({ ...window._cy.pan() }));
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.mouse.move(pt.x + 70, pt.y + 35, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => ({ ...window._cy.pan() }));
    const moved = Math.abs(after.x - before.x) + Math.abs(after.y - before.y);
    assert.ok(moved > 50, `${label}에서 시작한 드래그도 팬 동작 (이동 ${moved.toFixed(1)}px)`);
    await page.evaluate(() => { window._cy.fit(window._cy.elements(':visible'), 40); });
  }
  const empty = await page.evaluate(() => window.__t.emptyPoint());
  await dragPansFrom(empty, '빈 배경');
  const { gap } = await verticalPairWithGap();   // 노드 사이 틈 = 엣지·그룹 상자 위
  await dragPansFrom(gap, '그룹 상자/엣지 위');
  // 드래그 이후에도 클릭 고정이 정상 동작하는지 확인
  const { a } = await verticalPairWithGap();
  await page.mouse.click(a.x, a.y);
  await page.waitForTimeout(80);
  const st = await page.evaluate(() => window.__t.state());
  assert.equal(st.pinnedId, a.id, '드래그 기능 추가 후에도 클릭 고정 정상');
});

// ── 관계(포커스) 뷰 헬퍼 ─────────────────────────────────────────────────────
async function clickNode(id) {
  const c = await page.evaluate(i => {
    const cy = window._cy, r = cy.container().getBoundingClientRect();
    const p = cy.getElementById(i).renderedPosition();
    return { x: r.left + p.x, y: r.top + p.y };
  }, id);
  await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(900);   // 방사 배치(350ms) + fit(250ms) 완료 대기
}
async function enterFocusOn(id) {   // 그래프에서 고정 → [관계 뷰] 버튼으로 진입
  await clickNode(id);
  await page.click('#btnFocus');
  await page.waitForTimeout(900);
}
async function focusState() {
  return page.evaluate(() => {
    const cy = window._cy;
    const visN = cy.nodes('[!isGroup]').filter(n => !n.hasClass('hidden'));
    return {
      focusOn: window._focusDebug.focusOn,
      stack: window._focusDebug.stack,
      visibleNodes: visN.map(n => n.id()).sort(),
      visibleEdges: cy.edges().filter(e => !e.hasClass('hidden')).map(e => e.id()).sort(),
      centerCls: cy.$('node.focus-center').map(n => n.id()),
      labels: Object.fromEntries(visN.map(n => [n.id(), n.data('label')])),
    };
  });
}

// ── T19. 관계 뷰 진입 — 링크된 타입만 + 아이콘·표본·속성 카드 ────────────────
test('T19 관계 뷰 진입 — [관계 뷰] 버튼 → 링크만 방사형, 아이콘·표본·속성 카드', async () => {
  await enterFocusOn('vehicle');
  const st = await focusState();
  const exp = await page.evaluate(() => {
    const hood = window._cy.getElementById('vehicle').closedNeighborhood();
    return { nodes: hood.nodes().map(n => n.id()).sort(), edges: hood.edges().map(e => e.id()).sort() };
  });
  assert.equal(st.focusOn, 'vehicle', '포커스 대상 = 고정한 객체');
  assert.deepEqual(st.visibleNodes, exp.nodes, '선택 객체 + 링크된 타입만 표시');
  assert.deepEqual(st.visibleEdges, exp.edges, '연결 엣지만 표시');
  assert.deepEqual(st.centerCls, ['vehicle'], '중심 노드 강조');
  const sample = await page.evaluate(() =>   // DB는 페이지 스크립트의 전역 렉시컬 const
    ({ title: DB.objects[DB.byType.vehicle[0]].title }));
  for (const [id, label] of Object.entries(st.labels)) {
    assert.ok(label.includes('객체:'), `${id} 카드에 표본 인스턴스 표기`);
    assert.ok(label.includes('속성:'), `${id} 카드에 주요 속성 표기`);
  }
  assert.ok(st.labels.vehicle.includes(sample.title), '중심 카드에 실제 표본 데이터 포함');
  const icons = await page.evaluate(() =>
    window._cy.nodes('.focus').toArray().every(n => (n.data('icon') || '').startsWith('data:image/svg+xml')));
  assert.ok(icons, '모든 카드에 객체 아이콘(SVG) 데이터');
  const ui = await page.evaluate(() => ({
    back: document.getElementById('btnBack').style.display !== 'none',
    focusBtn: document.getElementById('btnFocus').style.display !== 'none',
    crumb: document.getElementById('focusCrumb').textContent,
  }));
  assert.ok(ui.back, '관계 뷰에서는 [← 이전] 버튼 표시');
  assert.equal(ui.focusBtn, false, '관계 뷰에서는 진입 버튼 숨김');
  assert.ok(ui.crumb.includes('차량'), '경로에 현재 객체 표시');
});

// ── T19b. 관계 뷰 팬 — 링크 많은 객체(차종)에서 확대·이동 탐색 ────────────────
test('T19b 관계 뷰 팬 — 줌 인 후 카드/스포크/빈 곳 어디서 드래그해도 이동', async () => {
  await enterFocusOn('model');               // 차종 — 연결 고리가 많은 케이스
  const zBefore = await page.evaluate(() => window._cy.zoom());
  await page.mouse.move(700, 450);           // 캔버스 안에서 휠
  await page.mouse.wheel(0, -500);           // 확대 (한 화면에 다 안 담기는 상태)
  await page.waitForTimeout(250);
  const zAfter = await page.evaluate(() => window._cy.zoom());
  assert.ok(zAfter > zBefore * 1.05, `관계 뷰에서 휠 줌 동작 (${zBefore.toFixed(3)} → ${zAfter.toFixed(3)})`);
  const pts = await page.evaluate(() => {
    const cy = window._cy, r = cy.container().getBoundingClientRect();
    const center = cy.getElementById('model').renderedPosition();
    return {
      card: { x: r.left + center.x, y: r.top + center.y },                       // 중심 카드 위
      spoke: { x: r.left + center.x + 150, y: r.top + center.y + 8 },            // 스포크(엣지) 부근
      corner: { x: r.left + 30, y: r.top + r.height - 30 },                      // 구석
    };
  });
  for (const [label, pt] of Object.entries(pts)) {
    const before = await page.evaluate(() => ({ ...window._cy.pan() }));
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.mouse.move(pt.x + 90, pt.y + 45, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => ({ ...window._cy.pan() }));
    const moved = Math.abs(after.x - before.x) + Math.abs(after.y - before.y);
    assert.ok(moved > 60, `관계 뷰 ${label} 지점 드래그로 팬 (이동 ${moved.toFixed(1)}px)`);
  }
  // 팬·줌 중에도 포커스 상태와 카드 배치는 그대로
  const st = await focusState();
  assert.equal(st.focusOn, 'model', '팬/줌 후에도 포커스 유지');
  const nodeMoved = await page.evaluate(() => {
    const n = window._cy.getElementById('model');
    return n.position();
  });
  assert.ok(Number.isFinite(nodeMoved.x), '노드 모델 좌표 정상');
});

// ── T20. 드릴다운 + [← 이전] — 이웃 클릭 = 이동, 이전 = 역순 복귀 ────────────
test('T20 드릴다운과 [← 이전] — 이웃 클릭 = 포커스 이동, 이전 버튼 = 역순 복귀', async () => {
  await enterFocusOn('vehicle');
  const neighbor = await page.evaluate(() =>
    window._cy.nodes('.focus').toArray().filter(n => n.id() !== 'vehicle')[0].id());
  await clickNode(neighbor);
  let st = await focusState();
  const exp = await page.evaluate(id =>
    window._cy.getElementById(id).closedNeighborhood().nodes().map(n => n.id()).sort(), neighbor);
  assert.equal(st.focusOn, neighbor, '이웃 클릭 = 포커스 이동(드릴다운)');
  assert.deepEqual(st.visibleNodes, exp, '표시 집합도 새 객체의 링크로 교체');
  assert.deepEqual(st.stack, ['vehicle'], '드릴다운 경로가 스택에 기록');
  const crumb = await page.evaluate(() => document.getElementById('focusCrumb').textContent);
  assert.ok(crumb.includes('›'), '경로 브레드크럼 표시');
  await page.click('#btnBack');
  await page.waitForTimeout(900);
  st = await focusState();
  assert.equal(st.focusOn, 'vehicle', '[← 이전] = 직전 포커스로 복귀');
  assert.deepEqual(st.stack, [], '스택 소진');
});

// ── T21. ESC — 그래프 복귀(고정 유지) → 다시 ESC = 고정 해제 ─────────────────
test('T21 ESC — 관계 뷰에서 그래프 복귀(라벨·그룹 원복, 고정 유지), 재차 ESC = 해제', async () => {
  await enterFocusOn('vehicle');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  const st = await page.evaluate(() => ({
    focusOn: window._focusDebug.focusOn,
    hidden: window._cy.$('.hidden').length,
    focusCls: window._cy.$('.focus, .focus-center').length,
    ghosts: window._cy.$('node[isGroup].ghost').length,
    labelsRestored: window._cy.nodes('[!isGroup]').toArray()
      .filter(n => n.data('label0')).every(n => n.data('label') === n.data('label0')),
    pinnedId: window._hoverDebug.pinnedId,
  }));
  assert.equal(st.focusOn, null, 'ESC = 관계 뷰 종료');
  assert.equal(st.hidden, 0, '전체 노드 복원');
  assert.equal(st.focusCls, 0, '포커스 클래스 잔여 없음');
  assert.equal(st.ghosts, 0, '그룹 상자 복원');
  assert.ok(st.labelsRestored, '카드 라벨 원복');
  assert.equal(st.pinnedId, 'vehicle', '그래프 복귀 후에도 마지막 객체 고정 유지');
  await page.keyboard.press('Escape');       // 그래프 뷰에서 ESC = 고정 해제
  await page.waitForTimeout(80);
  const st2 = await page.evaluate(() => ({
    pinnedId: window._hoverDebug.pinnedId,
    marks: window._cy.$('.hi, .dim').length,
    tools: document.getElementById('graphTools').style.display !== 'none',
  }));
  assert.equal(st2.pinnedId, null, '재차 ESC = 고정 해제');
  assert.equal(st2.marks, 0, '하이라이트 잔여 없음');
  assert.equal(st2.tools, false, '도구바 숨김');
});

// ── T22. 관계 뷰 중 배경 클릭 — ESC와 동일하게 한 단계 복귀 ──────────────────
test('T22 관계 뷰 중 배경 클릭 — 드릴다운 역순 복귀 → 그래프 복귀', async () => {
  await enterFocusOn('vehicle');
  const neighbor = await page.evaluate(() =>
    window._cy.nodes('.focus').toArray().filter(n => n.id() !== 'vehicle')[0].id());
  await clickNode(neighbor);
  let empty = await page.evaluate(() => window.__t.emptyPoint());
  assert.ok(empty, '빈 배경 지점(1)');
  await page.mouse.click(empty.x, empty.y);
  await page.waitForTimeout(900);
  assert.equal((await focusState()).focusOn, 'vehicle', '배경 클릭 = 직전 포커스 복귀');
  empty = await page.evaluate(() => window.__t.emptyPoint());
  assert.ok(empty, '빈 배경 지점(2)');
  await page.mouse.click(empty.x, empty.y);
  await page.waitForTimeout(900);
  const st = await page.evaluate(() => ({
    focusOn: window._focusDebug.focusOn, pinnedId: window._hoverDebug.pinnedId,
    hidden: window._cy.$('.hidden').length,
  }));
  assert.equal(st.focusOn, null, '스택 소진 후 배경 클릭 = 그래프 복귀');
  assert.equal(st.pinnedId, 'vehicle', '마지막 객체 고정 유지');
  assert.equal(st.hidden, 0, '전체 노드 복원');
});

// ── T23. 종료 무결성 — 시나리오 전체 수행 후 JS 오류 0건 ─────────────────────
test('T23 전체 시나리오 후 JS 오류 없음', () => {
  assert.deepEqual(errors, [], '테스트 전 과정에서 JS 오류가 없어야 함');
});
