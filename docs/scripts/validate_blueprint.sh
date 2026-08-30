#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
python docs/scripts/validate_blueprint.py
python docs/scripts/validate_requirement_contract.py
python docs/scripts/validate_references.py
python docs/scripts/validate_benchmarks.py
python docs/scripts/validate_journeys.py
python docs/scripts/validate_readiness.py
git diff --check -- docs
