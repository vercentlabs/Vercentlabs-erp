#!/usr/bin/env sh
set -eu

# Hostinger may provide a broken Corepack pnpm shim. npx downloads and runs the
# repository-pinned pnpm without reading Hostinger's Corepack cache.
npx --yes pnpm@11.21.0 install --frozen-lockfile
npx --yes pnpm@11.21.0 --filter @vercentlabs/landing build
