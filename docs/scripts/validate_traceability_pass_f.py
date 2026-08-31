#!/usr/bin/env python3
from pathlib import Path
import csv, hashlib, re, sys
ROOT=Path(__file__).resolve().parents[2];D=ROOT/'docs';R=D/'02-register';SP=D/'04-shared-platform'; errors=[]
def err(x): errors.append(x)
def rows(p):
    if not p.exists(): return []
    with p.open(encoding='utf-8',newline='') as f:return list(csv.DictReader(f))
def split_ids(s): return [x for x in re.split(r'[;,\s]+',s or '') if x]
fr=rows(R/'FEATURE_REGISTER.csv'); spr=rows(SP/'SHARED_PLATFORM_REGISTER.csv')
if len(fr)!=510 or [r.get('feature_id') for r in fr] != [f'F{i:03d}' for i in range(1,511)]: err('canonical F001-F510 authority invalid')
if fr:
    sha=hashlib.sha256(''.join(f"{r['feature_id']},{r['feature_name']}\n" for r in fr).encode()).hexdigest()
    if sha!='82cfcf68e74cef8c8c8872136d0bfcc0bb619b0517f3a33cfc92bc1e3dde232e': err('canonical fingerprint mismatch')
if len(spr)!=36 or [r.get('sp_id') for r in spr] != [f'SP{i:03d}' for i in range(1,37)]: err('SP001-SP036 authority invalid')
for name,n in [('SEMANTIC_REVIEW_REGISTER.csv',510),('FLOW_STATE_REVIEW_REGISTER.csv',510),('BENCHMARK_RELEVANCE_REVIEW.csv',510),('ARCHITECTURE_AI_FREEZE_REVIEW.csv',1)]:
    x=rows(R/name)
    if len(x)!=n or any((r.get('review_status') or '').upper()!='APPROVED' for r in x): err(f'{name} is not fully approved')
subs=rows(R/'SUBREQUIREMENT_REGISTER.csv'); ssubs=rows(SP/'SHARED_PLATFORM_SUBREQUIREMENT_REGISTER.csv')
if len(subs)!=18870: err(f'business requirement count={len(subs)}, expected 18870')
if len(ssubs)!=1332: err(f'shared requirement count={len(ssubs)}, expected 1332')
if any(not (r.get('test_ids') or '').strip() for r in subs): err('business requirements still have blank test_ids')
if any(not (r.get('test_ids') or '').strip() for r in ssubs): err('shared-platform requirements still have blank test_ids')
# Regression guard: validate_planning_closure.py resolves critical business
# requirement test_ids through TEST_TRACEABILITY_REGISTER. Ensure every PVT-*
# reference created by Pass F is present there before the full chain runs.
legacy_tests=rows(R/'TEST_TRACEABILITY_REGISTER.csv')
legacy_ids={r.get('test_id','') for r in legacy_tests}
for r in subs:
    for tid in split_ids(r.get('test_ids','')):
        if tid.startswith('PVT-') and tid not in legacy_ids:
            err(f"{r['requirement_id']}: PVT id missing from TEST_TRACEABILITY_REGISTER: {tid}")
vr=rows(R/'PLANNED_VERIFICATION_REGISTER.csv')
if len(vr)!=20202: err(f'planned verification rows={len(vr)}, expected 20202')
if len({r.get('requirement_id') for r in vr})!=20202: err('planned verification requirement coverage is not one-to-one')
tr=rows(R/'TRACEABILITY_GRAPH.csv')
if len(tr)!=20202: err(f'traceability rows={len(tr)}, expected 20202')
if len({r.get('requirement_id') for r in tr})!=20202: err('traceability graph does not cover every atomic requirement exactly once')
for r in tr:
    for k in ['authority_type','authority_id','requirement_id','requirement_type','planned_test_ids','primary_wave','planning_status']:
        if not (r.get(k) or '').strip(): err(f"{r.get('requirement_id')}: blank {k}")
for r in tr:
    if r.get('authority_type')=='BUSINESS_FEATURE':
        for k in ['semantic_ids','flow_ids','state_transition_ids','benchmark_ids','architecture_area','web_area','mobile_classification','dossier_path']:
            if not (r.get(k) or '').strip(): err(f"{r.get('requirement_id')}: business traceability blank {k}")
cover=rows(R/'MASTER_TRACEABILITY_COVERAGE.csv')
if len(cover)!=546: err(f'coverage rows={len(cover)}, expected 546')
if cover and any((r.get('overall') or '').upper()!='PASS' for r in cover): err('authority coverage has non-PASS rows')
manifest=rows(R/'FEATURE_BUILD_MANIFEST.csv')
if len(manifest)!=510: err('feature build manifest is not 510 rows')
for r in manifest:
    for k in ['dossier_path','capability_requirement_ids','flow_requirement_ids','business_rule_ids','data_requirement_ids','validation_ids','calculation_ids','ux_ids','security_ids','integration_ids','api_ids','e2e_ids','uat_ids','pass_c_flow_ids','pass_c_transition_ids','pass_d_benchmark_ids','server_domain_area','web_experience_area','mobile_classification','primary_wave','planned_test_ids']:
        if not (r.get(k) or '').strip(): err(f"{r.get('feature_id')}: build manifest blank {k}")
    if 'BLOCKED' in (r.get('implementation_authorization') or ''): err(f"{r.get('feature_id')}: still implementation-blocked")
if len(rows(R/'IMPLEMENTATION_WAVE_REGISTER.csv'))!=17: err('implementation wave register must contain T00/T01/W01-W15 = 17 rows')
if len(rows(R/'FEATURE_IMPLEMENTATION_WAVE_REGISTER.csv'))!=510: err('feature wave register must contain 510 rows')
if len(rows(SP/'SHARED_PLATFORM_IMPLEMENTATION_WAVE_REGISTER.csv'))!=36: err('shared-platform wave register must contain 36 rows')
if len(rows(R/'FEATURE_SURFACE_CLASSIFICATION.csv'))!=510: err('feature surface classification must contain 510 rows')
jr=rows(R/'JOURNEY_REGISTER.csv')
if len(jr)<121: err(f'journey register={len(jr)}, expected at least 121 after 10 program journeys')
for r in jr:
    if (r.get('working_status') or '').upper()!='SPECIFICATION_READY' or (r.get('readiness_gate') or '').upper()!='SPECIFICATION_READY': err(f"{r.get('journey_id')}: journey not specification-ready")
    if not (r.get('contract_path') or '').strip() or not (r.get('e2e_ids') or '').strip() or not (r.get('uat_ids') or '').strip(): err(f"{r.get('journey_id')}: missing contract/e2e/uat traceability")
jv=rows(R/'JOURNEY_VERIFICATION_REGISTER.csv')
if len(jv)<len(jr)*5: err('journey verification plan does not provide 5 planned checks per journey')
mandatory=['LEAD_TO_CASH.md','ORDER_TO_CASH.md','PROCURE_TO_PAY.md','PLAN_TO_PRODUCE.md','MANUFACTURING_QUALITY_STOCK.md','POS_TO_CASH.md','HIRE_TO_PAYROLL_TO_BOOKS.md','ASSET_TO_BOOKS.md','PROJECT_TO_CASH.md','SERVICE_TO_RESOLUTION.md']
for fn in mandatory:
    p=D/'05-cross-module'/fn
    if not p.exists(): err('missing program journey '+fn); continue
    txt=p.read_text(encoding='utf-8').lower()
    for tok in ['status: `specification_ready`','transaction','idempotency','retry','reversal','reconciliation','e2e','uat']:
        if tok not in txt: err(f'{fn}: missing semantic token {tok}')
rev=rows(R/'FINAL_IMPLEMENTATION_AUTHORIZATION_REVIEW.csv')
if len(rev)!=1 or (rev[0].get('review_status') or '').upper()!='APPROVED' or (rev[0].get('implementation_authorization') or '').upper()!='PASS': err('Pass F final authorization review is not APPROVED/PASS')
# If enterprise audit exists, all freeze-blocking P0/P1 must now be resolved or accepted risk.
aud=rows(R/'ENTERPRISE_AUDIT_FINDINGS.csv')
for r in aud:
    if (r.get('freeze_blocking') or '').upper()=='YES' and (r.get('priority') or '').upper() in {'P0','P1'} and (r.get('status') or '').upper() not in {'RESOLVED','ACCEPTED_RISK'}: err(f"open freeze blocker {r.get('finding_id')}")
# Product readiness must remain unpromoted.
for r in rows(R/'PRODUCT_READINESS_MATRIX.csv'):
    if (r.get('product_ready') or '').upper() in {'YES','TRUE','READY','COMPLETE'}: err(f"{r.get('feature_id')}: product readiness was promoted by planning")
# New Pass F docs cannot invent F511+.
for p in [D/'00-program/FINAL_PASS_F_MASTER_TRACEABILITY.md',D/'01-standards/IMPLEMENTATION_AUTHORIZATION_STANDARD.md',D/'00-program/IMPLEMENTATION_START_CHECKLIST.md']:
    if p.exists():
        for x in re.findall(r'\bF(\d{3,})\b',p.read_text(encoding='utf-8')):
            if int(x)>510: err(f'{p.name}: invented F{x}')
if errors:
    print('FINAL PASS F TRACEABILITY / AUTHORIZATION VALIDATION FAILED')
    for e in errors[:160]: print(' -',e)
    sys.exit(1)
print('FINAL PASS F TRACEABILITY / AUTHORIZATION VALIDATION PASSED')
print(' - canonical business authority: 510 / 510')
print(' - shared-platform authority: 36 / 36')
print(' - business requirements traced: 18870 / 18870')
print(' - shared-platform requirements traced: 1332 / 1332')
print(' - planned atomic verification obligations: 20202')
print(f' - registered journeys: {len(jr)}; all specification-ready with E2E/UAT plans')
print(' - master authority coverage: 546 / 546 PASS')
print(' - implementation waves/surfaces/architecture mappings: PASS')
print(' - unresolved freeze-blocking P0/P1 planning findings: NONE')
print(' - product readiness promotion: NONE')
