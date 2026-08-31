#!/usr/bin/env python3
from pathlib import Path
import csv,sys
ROOT=Path(__file__).resolve().parents[2]; D=ROOT/'docs'; R=D/'02-register'; errors=[]
def err(x): errors.append(x)
required=[D/'00-program/ENTERPRISE_DOCUMENTATION_AUDIT.md',D/'00-program/ARCHITECTURE_FREEZE_GATE.md',D/'01-standards/ARCHITECTURE_FREEZE_STANDARD.md',D/'04-shared-platform/SHARED_PLATFORM_AUTHORITY_GAP.md',R/'ENTERPRISE_AUDIT_FINDINGS.csv']
for p in required:
    if not p.exists(): err(f'missing {p.relative_to(ROOT)}')
if (R/'ENTERPRISE_AUDIT_FINDINGS.csv').exists():
    with (R/'ENTERPRISE_AUDIT_FINDINGS.csv').open(encoding='utf-8',newline='') as f: rows=list(csv.DictReader(f))
    fields={'finding_id','priority','category','scope','affected_ids','evidence','risk','remediation','acceptance_test','owner_ai_role','freeze_blocking','status','last_reviewed_on'}
    if rows and not fields.issubset(rows[0].keys()): err('ENTERPRISE_AUDIT_FINDINGS.csv missing required columns')
    ids=[r.get('finding_id','') for r in rows]
    if len(ids)!=len(set(ids)): err('duplicate audit finding ids')
    for r in rows:
        if r.get('priority') not in {'P0','P1','P2','P3'}: err(f"{r.get('finding_id')}: invalid priority")
        if r.get('freeze_blocking') not in {'YES','NO'}: err(f"{r.get('finding_id')}: invalid freeze_blocking")
        if r.get('status') not in {'OPEN','IN_PROGRESS','RESOLVED','ACCEPTED_RISK'}: err(f"{r.get('finding_id')}: invalid status")
        for k in ('evidence','risk','remediation','acceptance_test','owner_ai_role'):
            if not (r.get(k) or '').strip(): err(f"{r.get('finding_id')}: missing {k}")
if errors:
    print('ENTERPRISE AUDIT VALIDATION FAILED'); [print(' -',e) for e in errors]; sys.exit(1)
print('ENTERPRISE AUDIT VALIDATION PASSED')
print(' - audit findings are explicit and machine-governed')
print(' - architecture freeze remains a separate gate')
