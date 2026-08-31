#!/usr/bin/env python3
from pathlib import Path
import csv,re,sys
ROOT=Path(__file__).resolve().parents[2];D=ROOT/'docs';R=D/'02-register'; blockers=[]
def rows(p):
    if not p.exists(): return []
    with p.open(encoding='utf-8',newline='') as f:return list(csv.DictReader(f))
arch=rows(R/'ARCHITECTURE_AI_FREEZE_REVIEW.csv')
if len(arch)!=1 or (arch[0].get('review_status') or '').upper()!='APPROVED': blockers.append('Pass E architecture freeze review not approved')
for r in rows(R/'ENTERPRISE_AUDIT_FINDINGS.csv'):
    if (r.get('freeze_blocking') or '').upper()=='YES' and (r.get('priority') or '').upper() in {'P0','P1'} and (r.get('status') or '').upper() not in {'RESOLVED','ACCEPTED_RISK'}: blockers.append(f"{r.get('finding_id')}: {r.get('status')}")
mandatory=['LEAD_TO_CASH.md','ORDER_TO_CASH.md','PROCURE_TO_PAY.md','PLAN_TO_PRODUCE.md','MANUFACTURING_QUALITY_STOCK.md','POS_TO_CASH.md','HIRE_TO_PAYROLL_TO_BOOKS.md','ASSET_TO_BOOKS.md','PROJECT_TO_CASH.md','SERVICE_TO_RESOLUTION.md']
for fn in mandatory:
    p=D/'05-cross-module'/fn
    if not p.exists() or 'Status: `SPECIFICATION_READY`' not in p.read_text(encoding='utf-8'): blockers.append(fn+' not specification-ready')
if blockers:
    print('ARCHITECTURE FREEZE: BLOCKED'); [print(' -',x) for x in blockers]; sys.exit(3)
print('ARCHITECTURE FREEZE: PASS')
