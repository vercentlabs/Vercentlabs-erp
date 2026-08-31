#!/usr/bin/env python3
from pathlib import Path
import csv,sys
ROOT=Path(__file__).resolve().parents[2];R=ROOT/'docs/02-register'; blockers=[]
p=R/'ENTERPRISE_AUDIT_FINDINGS.csv'
with p.open(encoding='utf-8',newline='') as f:rows=list(csv.DictReader(f))
for r in rows:
    if r.get('freeze_blocking')=='YES' and r.get('status') not in {'RESOLVED','ACCEPTED_RISK'}:
        blockers.append(f"{r['finding_id']} {r['priority']} {r['category']}: {r['status']}")
sp=ROOT/'docs/04-shared-platform/SHARED_PLATFORM_REGISTER.csv'
if not sp.exists():blockers.append('P0 shared-platform authority: exact founder-approved 36-row register is still missing')
sem=R/'SEMANTIC_REVIEW_REGISTER.csv'
if sem.exists():
    with sem.open(encoding='utf-8',newline='') as f:sr=list(csv.DictReader(f))
    pending=[r for r in sr if r.get('review_status')!='APPROVED']
    if pending:blockers.append(f'P1 semantic review: {len(pending)} / {len(sr)} features not independently APPROVED')
if blockers:
 print('PLANNING CLOSURE: BLOCKED')
 for b in blockers:print(' -',b)
 print('\nDo not architecture-freeze or start mass implementation yet.')
 sys.exit(2)
print('PLANNING CLOSURE: PASS')
print('Architecture-freeze preparation may proceed.')
