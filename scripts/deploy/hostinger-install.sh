#!/usr/bin/env sh
set -eu

# Hostinger's Node image may expose a Corepack pnpm shim whose cache points at
# a missing pnpm.cjs. Install the repository-pinned pnpm explicitly, then use
# that binary for the workspace install.
npm install --global pnpm@11.21.0
pnpm install --frozen-lockfile
