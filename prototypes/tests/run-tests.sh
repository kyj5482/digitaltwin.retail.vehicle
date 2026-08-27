#!/usr/bin/env bash
# 온톨로지 그래프 호버 테스트 실행기
# 선행 조건: 프로젝트 루트에서 `npm i --no-save playwright` (브라우저는 ~/.cache/ms-playwright 재사용)
# chromium 헤드리스가 요구하는 시스템 라이브러리(libatk 등)를 사용자 추출본(/tmp/pwlibs)으로 주입한다.
set -e
cd "$(dirname "$0")/../.."
export LD_LIBRARY_PATH="/tmp/pwlibs/usr/lib/aarch64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
node --test "prototypes/tests/*.test.mjs" "$@"
