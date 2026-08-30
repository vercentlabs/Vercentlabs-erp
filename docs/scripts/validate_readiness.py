#!/usr/bin/env python3
from pathlib import Path
import csv,re,sys
ROOT=Path(__file__).resolve().parents[2]; D=ROOT/'docs'; R=D/'02-register'; errors=[]
def err(x): errors.append(x)
with (R/'SUBREQUIREMENT_REGISTER.csv').open(encoding='utf-8',newline='') as f: subs=list(csv.DictReader(f))
with (R/'BENCHMARK_REGISTER.csv').open(encoding='utf-8',newline='') as f: bms=list(csv.DictReader(f))
with (R/'EVIDENCE_REGISTER.csv').open(encoding='utf-8',newline='') as f: evs=list(csv.DictReader(f))
with (R/'PRODUCT_READINESS_MATRIX.csv').open(encoding='utf-8',newline='') as f: prs=list(csv.DictReader(f))
sub_by={}
for r in subs: sub_by.setdefault(r.get('feature_id',''),[]).append(r)
def ids(cell): return {x for x in re.split(r'[;,\s]+',cell or '') if x}
def bm_for(fid): return [r for r in bms if fid in ids(r.get('feature_ids')) and r.get('status') in {'EVIDENCE_CAPTURED','REVIEWED','APPROVED'}]
def code_for(fid): return [r for r in evs if fid in ids(r.get('feature_ids')) and r.get('evidence_type')=='CODE_AUDIT' and r.get('status') in {'VERIFIED','APPROVED'}]
required_types={'FR','BR','UX','SEC','E2E','UAT'}
for p in prs:
    fid=p['feature_id']; ws=p['working_status']; gate=p['readiness_gate']
    if ws=='SPECIFICATION_READY' or gate=='SPECIFICATION_READY':
        if ws!='SPECIFICATION_READY' or gate!='SPECIFICATION_READY': err(f'{fid}: working/readiness final states must agree')
        have={r.get('requirement_type') for r in sub_by.get(fid,[]) if r.get('status') in {'APPROVED','READY'}}
        miss=required_types-have
        if miss: err(f'{fid}: SPECIFICATION_READY missing approved requirement types {sorted(miss)}')
        if not bm_for(fid): err(f'{fid}: SPECIFICATION_READY lacks captured benchmark evidence')
        if not code_for(fid): err(f'{fid}: SPECIFICATION_READY lacks verified CODE_AUDIT evidence')
        for dim in ('research','requirements','design','domain','security','e2e','responsive','accessibility','visual','uat'):
            if p.get(dim) not in {'READY','PASS','COMPLETE'}: err(f'{fid}: SPECIFICATION_READY but {dim}={p.get(dim)}')
    if p.get('product_ready')=='YES':
        if p.get('implementation')!='IMPLEMENTED': err(f'{fid}: PRODUCT_READY without IMPLEMENTED')
        if p.get('uat') not in {'READY','PASS','COMPLETE'}: err(f'{fid}: PRODUCT_READY without UAT')
if errors:
    print('READINESS VALIDATION FAILED'); [print(' -',e) for e in errors]; sys.exit(1)
print('READINESS VALIDATION PASSED')
print(' - no unsupported specification/product readiness promotions detected')
