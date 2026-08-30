#!/usr/bin/env python3
from pathlib import Path
import csv,re,sys
ROOT=Path(__file__).resolve().parents[2]; D=ROOT/'docs'; R=D/'02-register'; errs=[]
def err(x): errs.append(x)
def rows(fn):
    with (R/fn).open(encoding='utf-8-sig',newline='') as f: return list(csv.DictReader(f))
FIDS={f'F{i:03d}' for i in range(1,31)}
fr={r['feature_id']:r for r in rows('FEATURE_REGISTER.csv') if r['feature_id'] in FIDS}
pr={r['feature_id']:r for r in rows('PRODUCT_READINESS_MATRIX.csv') if r['feature_id'] in FIDS}
subs=[r for r in rows('SUBREQUIREMENT_REGISTER.csv') if r.get('feature_id') in FIDS]
bms=[r for r in rows('BENCHMARK_REGISTER.csv') if r.get('status') in {'EVIDENCE_CAPTURED','REVIEWED','APPROVED'}]
evs=[r for r in rows('EVIDENCE_REGISTER.csv') if r.get('status') in {'VERIFIED','APPROVED'}]
if len(fr)!=30: err(f'feature rows {len(fr)} != 30')
for fid in sorted(FIDS):
    r=fr.get(fid); p=pr.get(fid)
    if not r or r.get('module')!='CRM' or r.get('specification_status')!='SPECIFICATION_READY': err(f'{fid}: feature register not specification-ready')
    if not p or p.get('working_status')!='SPECIFICATION_READY' or p.get('readiness_gate')!='SPECIFICATION_READY': err(f'{fid}: readiness matrix not specification-ready')
    if p and p.get('product_ready')=='YES': err(f'{fid}: product readiness must not be promoted by Pass 1')
    rr=[x for x in subs if x['feature_id']==fid and x.get('status') in {'APPROVED','READY'}]
    counts={t:sum(1 for x in rr if x['requirement_type']==t) for t in set(x['requirement_type'] for x in rr)}
    minima={'CAP':3,'FR':3,'US':2,'FLOW':2,'BR':2,'DATA':2,'VAL':2,'CALC':1,'UX':3,'SEC':2,'AUTO':1,'APP':1,'NOTIF':1,'REP':1,'AI':1,'INT':2,'API':2,'PERF':1,'OBS':1,'E2E':2,'UAT':2}
    for t,n in minima.items():
        if counts.get(t,0)<n: err(f'{fid}: {t} requirements {counts.get(t,0)} < {n}')
    if sum(1 for x in bms if fid in re.split(r'[;,\s]+',x.get('feature_ids','')))<2: err(f'{fid}: fewer than 2 captured official benchmark findings')
    ce=[x for x in evs if x.get('evidence_type')=='CODE_AUDIT' and fid in re.split(r'[;,\s]+',x.get('feature_ids',''))]
    if not ce: err(f'{fid}: missing verified CODE_AUDIT evidence')
    for e in ce:
        path=e.get('path_or_url','')
        if path and not (ROOT/path).exists(): err(f'{fid}: code evidence path no longer exists: {path}')
    matches=list((D/'03-modules/crm/features').glob(fid+'-*.md'))
    if len(matches)!=1: err(f'{fid}: expected exactly one dossier, got {len(matches)}'); continue
    txt=matches[0].read_text(encoding='utf-8')
    for forbidden in ('Working status: `UNSPECIFIED`','Readiness gate: `NONE`','Decision: `UNASSESSED`','PENDING_MODULE_PASS','F'+fid[1:]+'-UX-###'):
        if forbidden in txt: err(f'{fid}: unresolved placeholder/state {forbidden}')
    if re.search(r'\bTBD\b',txt): err(f'{fid}: material TBD remains')
for path in ['docs/11-visual-assets/wireframes/CRM_PASS1_WORKSPACES.md','docs/04-cross-module/CRM_TO_SALES_OPPORTUNITY_QUOTATION.md','docs/07-testing/CRM_PASS1_TEST_STRATEGY.md','docs/08-uat/CRM_PASS1_UAT_PLAN.md']:
    if not (ROOT/path).exists(): err(f'missing required Pass 1 artifact {path}')
if errs:
    print('CRM PASS 1 VALIDATION FAILED'); [print(' -',e) for e in errs]; sys.exit(1)
print('CRM PASS 1 VALIDATION PASSED')
print(' - canonical CRM features: 30 / 30')
print(' - specification-ready dossiers: 30 / 30')
print(' - materialized requirement contracts: PASS')
print(' - >=2 official benchmark findings per feature: PASS')
print(' - verified current-code evidence per feature: PASS')
print(' - visual/testing/UAT/cross-module artifacts: PASS')
print(' - product readiness promotion: NONE')
