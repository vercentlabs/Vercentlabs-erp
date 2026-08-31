#!/usr/bin/env python3
from pathlib import Path
import csv,re,sys
ROOT=Path(__file__).resolve().parents[2]; D=ROOT/'docs'; R=D/'02-register'; blockers=[]
def block(x): blockers.append(x)
p=R/'ENTERPRISE_AUDIT_FINDINGS.csv'
if not p.exists(): block('enterprise audit findings register missing')
else:
    with p.open(encoding='utf-8',newline='') as f: rows=list(csv.DictReader(f))
    for r in rows:
        if r.get('freeze_blocking')=='YES' and r.get('status') not in {'RESOLVED','ACCEPTED_RISK'}:
            block(f"{r.get('finding_id')}: {r.get('priority')} {r.get('category')} is {r.get('status')}")
sp=D/'04-shared-platform/SHARED_PLATFORM_REGISTER.csv'
if not sp.exists(): block('authoritative 36-row shared-platform register missing')
else:
    with sp.open(encoding='utf-8',newline='') as f: sr=list(csv.DictReader(f))
    if len(sr)!=36: block(f'shared-platform register has {len(sr)} rows, expected 36')
mandatory=['LEAD_TO_CASH.md','ORDER_TO_CASH.md','PROCURE_TO_PAY.md','PLAN_TO_PRODUCE.md','POS_TO_CASH.md','HIRE_TO_PAYROLL_TO_BOOKS.md','ASSET_TO_BOOKS.md','PROJECT_TO_CASH.md','SERVICE_TO_RESOLUTION.md']
for fn in mandatory:
    q=D/'05-cross-module'/fn
    if not q.exists(): block(f'missing mandatory journey {fn}'); continue
    m=re.search(r'^Status:\s*`([^`]+)`',q.read_text(encoding='utf-8'),re.M)
    if not m or m.group(1)!='SPECIFICATION_READY': block(f'{fn} is not SPECIFICATION_READY')
if blockers:
    print('ARCHITECTURE FREEZE BLOCKED')
    for b in blockers: print(' -',b)
    sys.exit(3)
print('ARCHITECTURE FREEZE GATE PASSED')
