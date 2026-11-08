#!/bin/sh
# Run tests on Linux, here, in Docker (node:24-bookworm): this checkout mounted at /work, its Linux
# node_modules kept in a named volume (installed again only when package-lock.json changes).
#
#   scripts/linux-test.sh                                   your computers' tests, a real headless Beluga's among them (BLG-783)
#   scripts/linux-test.sh tests/some.test.ts tests/other    any vitest files or folders
#
# BELUGA_LINUX_VOLUME picks another volume (default beluga-linux-test-nm).
set -eu

cd "$(dirname "$0")/.."
volume="${BELUGA_LINUX_VOLUME:-beluga-linux-test-nm}"
[ "$#" -gt 0 ] || set -- tests/machines/ tests/machines- tests/machine-

exec docker run --rm \
  -v "$PWD":/work \
  -v "$volume":/work/node_modules \
  -w /work \
  -e CI=1 \
  -e KLAUD_TEST_SLOTS=1 \
  node:24-bookworm \
  sh -c '
    set -e
    want=$(sha256sum package-lock.json | cut -c1-64)
    if [ "$(cat node_modules/.lock-sha 2>/dev/null)" != "$want" ]; then
      echo "Installing Linux node_modules (once per package-lock.json)…"
      find node_modules -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
      npm ci --no-audit --no-fund --loglevel=error
      echo "$want" > node_modules/.lock-sha
    fi
    echo "Linux $(uname -r), node $(node -v)"
    npx vitest run "$@"
  ' sh "$@"
