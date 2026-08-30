#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
python docs/scripts/validate_blueprint.py
git diff --check -- docs
