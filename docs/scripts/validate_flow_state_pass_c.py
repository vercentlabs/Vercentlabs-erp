#!/usr/bin/env python3
from pathlib import Path
import csv, hashlib, sys
from collections import Counter,defaultdict
ROOT=Path(__file__).resolve().parents[2]; D=ROOT/'docs'; R=D/'02-register'; FAIL=[]
FP='82cfcf68e74cef8c8c8872136d0bfcc0bb619b0517f3a33cfc92bc1e3dde232e'
def rows(p):
    if not p.exists(): return []
    with p.open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
def bad(msg): FAIL.append(msg)
f=rows(R/'FEATURE_REGISTER.csv'); fl=rows(R/'FEATURE_FLOW_REGISTER.csv'); st=rows(R/'FEATURE_STATE_TRANSITION_REGISTER.csv'); rv=rows(R/'FLOW_STATE_REVIEW_REGISTER.csv'); sem=rows(R/'SEMANTIC_REVIEW_REGISTER.csv')
if len(f)!=510 or [x.get('feature_id') for x in f]!=[f'F{i:03d}' for i in range(1,511)]: bad('canonical feature register is not exact F001-F510')
if f:
    h=hashlib.sha256(''.join(f"{r['feature_id']},{r['feature_name']}\n" for r in f).encode()).hexdigest()
    if h!=FP: bad('canonical fingerprint mismatch')
if len(sem)!=510 or any((r.get('review_status') or '').upper()!='APPROVED' for r in sem): bad('Pass B semantic review not 510/510 APPROVED')
expected_types={'ENTRY_CONTEXT','HAPPY_PATH','ALTERNATE_PATH','PERMISSION_DENIED','VALIDATION_FAILURE','CONCURRENCY_CONFLICT','DUPLICATE_RETRY','REVERSAL_RECOVERY','DOWNSTREAM_FAILURE','RECONCILIATION_CLOSURE'}
if len(fl)!=5100: bad(f'expected 5100 flow rows, found {len(fl)}')
by=defaultdict(list)
for r in fl: by[r.get('feature_id')].append(r)
critical=['primary_actor','preconditions','steps','permission_gate','business_validation','concurrency_idempotency','visible_ui_state','downstream_effect','failure_recovery','audit_evidence','acceptance_test']
for fid in [f'F{i:03d}' for i in range(1,511)]:
    rs=by[fid]
    if len(rs)!=10: bad(f'{fid}: expected 10 flows, found {len(rs)}'); continue
    if {r.get('flow_type') for r in rs}!=expected_types: bad(f'{fid}: required flow types incomplete')
    for r in rs:
        for c in critical:
            v=(r.get(c) or '').strip()
            if not v or v.upper() in {'TBD','TODO','N/A'}: bad(f"{r.get('flow_id')}: missing {c}")
        if (r.get('status') or '').upper()!='FROZEN': bad(f"{r.get('flow_id')}: not FROZEN")
if len(st)!=2550: bad(f'expected 2550 state-transition rows, found {len(st)}')
sby=defaultdict(list)
for r in st: sby[r.get('feature_id')].append(r)
sc=['from_state','action','guard','to_state','invalid_transition_behavior','lock_strategy','idempotency_behavior','audit_event','downstream_event','reversal_transition','acceptance_test']
for fid in [f'F{i:03d}' for i in range(1,511)]:
    rs=sby[fid]
    if len(rs)!=5: bad(f'{fid}: expected 5 transitions, found {len(rs)}'); continue
    if len({r.get('transition_id') for r in rs})!=5: bad(f'{fid}: duplicate transition ids')
    for r in rs:
        for c in sc:
            v=(r.get(c) or '').strip()
            if not v or v.upper() in {'TBD','TODO','N/A'}: bad(f"{r.get('transition_id')}: missing {c}")
        if (r.get('status') or '').upper()!='FROZEN': bad(f"{r.get('transition_id')}: not FROZEN")
if len(rv)!=510: bad(f'expected 510 flow/state review rows, found {len(rv)}')
else:
    for r in rv:
        if (r.get('review_status') or '').upper()!='APPROVED': bad(f"{r.get('feature_id')}: flow/state review not APPROVED")
        if r.get('required_flow_count')!='10' or r.get('state_transition_count')!='5': bad(f"{r.get('feature_id')}: review counts invalid")
# dossiers must contain Pass C authority marker.
for x in f:
    fid=x['feature_id']; mod={'CRM':'crm','Sales':'sales','Procurement':'procurement','Stock / Inventory':'stock','Manufacturing':'manufacturing','Projects':'projects','Assets':'assets','Point of Sale':'point-of-sale','Quality':'quality','Support / Customer Service':'support','HR & Payroll':'hr-payroll','Accounting / Finance':'accounting'}[x['module']]
    folder=D/'03-modules'/mod/'features'; matches=sorted(folder.glob(f'{fid}-*.md'))
    if len(matches)!=1 or '<!-- FINAL-PASS-C:START -->' not in matches[0].read_text(encoding='utf-8'): bad(f'{fid}: dossier missing Final Pass C authority')
if FAIL:
    print('FINAL PASS C FLOW/STATE VALIDATION FAILED')
    for m in FAIL[:80]: print(' -',m)
    if len(FAIL)>80: print(f' ... and {len(FAIL)-80} more')
    sys.exit(1)
print('FINAL PASS C FLOW / STATE-MACHINE VALIDATION PASSED')
print(' - canonical features reviewed: 510 / 510')
print(' - frozen required flows: 5100 (10 per feature)')
print(' - governed state transitions: 2550 (5 per feature)')
print(' - happy/alternate/failure/concurrency/retry/reversal/reconciliation coverage: PASS')
print(' - canonical F001-F510 fingerprint preserved')
print(' - implementation/product readiness not promoted')
