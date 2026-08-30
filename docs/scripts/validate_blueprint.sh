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
python docs/scripts/validate_crm_pass1.py
python docs/scripts/validate_sales_pass2.py
python docs/scripts/validate_procurement_pass3.py
python docs/scripts/validate_stock_pass4.py
python docs/scripts/validate_manufacturing_pass5.py
python docs/scripts/validate_projects_pass6.py
python docs/scripts/validate_assets_pass7.py
git diff --check -- docs
