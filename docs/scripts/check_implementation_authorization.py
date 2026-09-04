#!/usr/bin/env python3
from pathlib import Path
import csv, subprocess, sys
ROOT=Path(__file__).resolve().parents[2]; D=ROOT/'docs'; R=D/'02-register'; SP=D/'04-shared-platform'; blockers=[]
def rows(p):
    if not p.exists(): return []
    with p.open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
sp=rows(SP/'SHARED_PLATFORM_REGISTER.csv')
if len(sp)!=36 or any((r.get('specification_status') or r.get('status') or '').upper() not in {'SPECIFICATION_READY','APPROVED'} for r in sp): blockers.append('P0 SP001-SP036 not fully specification-ready')
for name,n in [('SEMANTIC_REVIEW_REGISTER.csv',510),('FLOW_STATE_REVIEW_REGISTER.csv',510),('BENCHMARK_RELEVANCE_REVIEW.csv',510),('ARCHITECTURE_AI_FREEZE_REVIEW.csv',1),('FINAL_IMPLEMENTATION_AUTHORIZATION_REVIEW.csv',1)]:
    x=rows(R/name)
    if len(x)!=n or any((r.get('review_status') or '').upper()!='APPROVED' for r in x): blockers.append('P1 '+name+' incomplete')
if len(rows(R/'TRACEABILITY_GRAPH.csv'))!=20202: blockers.append('P1 master traceability graph incomplete')
if len(rows(R/'PLANNED_VERIFICATION_REGISTER.csv'))!=20202: blockers.append('P1 atomic verification planning incomplete')
for r in rows(R/'JOURNEY_REGISTER.csv'):
    if (r.get('working_status') or '').upper()!='SPECIFICATION_READY' or not (r.get('e2e_ids') or '').strip() or not (r.get('uat_ids') or '').strip(): blockers.append('P1 journey '+r.get('journey_id','')+' incomplete')
for r in rows(R/'ENTERPRISE_AUDIT_FINDINGS.csv'):
    if (r.get('freeze_blocking') or '').upper()=='YES' and (r.get('priority') or '').upper() in {'P0','P1'} and (r.get('status') or '').upper() not in {'RESOLVED','ACCEPTED_RISK'}: blockers.append(f"{r.get('priority')} audit {r.get('finding_id')} unresolved")
pm=subprocess.run([sys.executable,str(D/'scripts/validate_pm_planning.py')],cwd=ROOT,text=True,capture_output=True)
if pm.returncode!=0: blockers.append('P0 PM/parallel planning baseline invalid: '+(pm.stdout+pm.stderr).strip().replace('\n',' | '))
if blockers:
    print('IMPLEMENTATION AUTHORIZATION: BLOCKED')
    for x in blockers[:100]: print(' -',x)
    sys.exit(2)
print('IMPLEMENTATION AUTHORIZATION: PASS')
print('Planning and architecture authority remain frozen under the sole Project Manager.')
print('Dependency-aware implementation may proceed only through registered work packages whose canonical predecessor gates pass.')
print('Execution-state reconciliation is required before any new package becomes ACTIVE.')
print('No calendar timeline, deadline, duration or delivery forecast is authorized by this baseline.')
print('Product readiness and production authorization remain separate future gates.')
