#!/usr/bin/env python3
from pathlib import Path
import csv, sys
ROOT=Path(__file__).resolve().parents[2];D=ROOT/'docs';R=D/'02-register';blockers=[]
def rows(p):
    if not p.exists():return []
    with p.open(encoding='utf-8',newline='') as f:return list(csv.DictReader(f))

sp=D/'04-shared-platform/SHARED_PLATFORM_REGISTER.csv'
spr=rows(sp)
expected_sp=[f'SP{i:03d}' for i in range(1,37)]
if len(spr)!=36 or [r.get('sp_id') for r in spr]!=expected_sp:
    blockers.append(f'P0 shared-platform authority: expected exact SP001-SP036 register (36 rows), found {len(spr)}')
else:
    not_ready=[]
    for r in spr:
        status=(r.get('specification_status') or r.get('working_status') or r.get('status') or '').upper()
        if status not in {'SPECIFICATION_READY','APPROVED'}: not_ready.append(r)
    if not_ready: blockers.append(f'P0 shared-platform specifications: {len(not_ready)} / 36 not specification-ready')

sem=rows(R/'SEMANTIC_REVIEW_REGISTER.csv')
if len(sem)!=510: blockers.append(f'P1 semantic review register: expected 510 rows, found {len(sem)}')
else:
    pending=[r for r in sem if (r.get('review_status') or '').upper()!='APPROVED']
    if pending: blockers.append(f'P1 feature semantic/sub-capability review: {len(pending)} / 510 not APPROVED')


flow=rows(R/'FLOW_STATE_REVIEW_REGISTER.csv')
if len(flow)!=510: blockers.append(f'P1 flow/state review register: expected 510 rows, found {len(flow)}')
else:
    pending=[r for r in flow if (r.get('review_status') or '').upper()!='APPROVED']
    if pending: blockers.append(f'P1 user-flow/state-machine review: {len(pending)} / 510 not APPROVED')

bm=rows(R/'BENCHMARK_RELEVANCE_REVIEW.csv')
if len(bm)!=510: blockers.append(f'P1 benchmark relevance register: expected 510 rows, found {len(bm)}')
else:
    pending=[r for r in bm if (r.get('review_status') or '').upper()!='APPROVED']
    if pending: blockers.append(f'P1 benchmark relevance review: {len(pending)} / 510 not APPROVED')


arch=rows(R/'ARCHITECTURE_AI_FREEZE_REVIEW.csv')
if len(arch)!=1 or (arch[0].get('review_status') or '').upper()!='APPROVED': blockers.append('P1 Final Pass E architecture + AI execution freeze is not APPROVED')

final_auth=rows(R/'FINAL_IMPLEMENTATION_AUTHORIZATION_REVIEW.csv')
if len(final_auth)!=1 or (final_auth[0].get('review_status') or '').upper()!='APPROVED': blockers.append('P1 Final Pass F master traceability / implementation authorization audit is not APPROVED')

findings=rows(R/'ENTERPRISE_AUDIT_FINDINGS.csv')
for r in findings:
    if (r.get('freeze_blocking') or '').upper()=='YES' and (r.get('priority') or '').upper() in {'P0','P1'} and (r.get('status') or '').upper() not in {'RESOLVED','ACCEPTED_RISK'}:
        blockers.append(f"{r.get('priority')} audit {r.get('finding_id')}: {r.get('status') or 'OPEN'}")

if blockers:
    print('IMPLEMENTATION AUTHORIZATION: BLOCKED')
    for b in blockers: print(' -',b)
    print('\nTechnical blueprint is installed, but do not begin mass implementation until these evidence gates are resolved.')
    sys.exit(2)
print('IMPLEMENTATION AUTHORIZATION: PASS')
print('Planning may be frozen and dependency-aware implementation may begin.')
