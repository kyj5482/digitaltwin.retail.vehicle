#!/usr/bin/env bash
# 온톨로지 그래프 호버 테스트 실행기
# 선행 조건: 프로젝트 루트에서 `npm i --no-save playwright` (브라우저는 ~/.cache/ms-playwright 재사용)
# chromium 헤드리스가 요구하는 시스템 라이브러리(libatk 등)를 사용자 추출본(/tmp/pwlibs)으로 주입한다.
# --test-concurrency=2: 4코어 호스트에서 5개 스위트 전체 병렬 시 chromium 크래시(OOM·이미지 디코드) 방지.
set -e
cd "$(dirname "$0")/../.."
export LD_LIBRARY_PATH="/tmp/pwlibs/usr/lib/aarch64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
node --test --test-concurrency=2 "prototypes/tests/*.test.mjs" "$@"
