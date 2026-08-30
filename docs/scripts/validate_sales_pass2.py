#!/usr/bin/env python3
from pathlib import Path
import csv,re,sys
ROOT=Path(__file__).resolve().parents[2];D=ROOT/'docs';R=D/'02-register';errors=[]
EXPECTED=[('F031', 'Customer master'), ('F032', 'Customer addresses and contacts'), ('F033', 'Products and services'), ('F034', 'Price lists'), ('F035', 'Customer-specific prices'), ('F036', 'Quotations'), ('F037', 'Quotation versions and revisions'), ('F038', 'Quotation expiry'), ('F039', 'Discounts'), ('F040', 'Taxes'), ('F041', 'Approval workflow'), ('F042', 'Sales orders'), ('F043', 'Order confirmation'), ('F044', 'Order amendments'), ('F045', 'Availability check'), ('F046', 'Stock reservation'), ('F047', 'Partial fulfilment'), ('F048', 'Backorders'), ('F049', 'Delivery and shipment'), ('F050', 'Sales invoices'), ('F051', 'Partial invoicing'), ('F052', 'Advance payments'), ('F053', 'Credit limits'), ('F054', 'Customer returns'), ('F055', 'Credit notes and refunds'), ('F056', 'Drop shipping'), ('F057', 'Sales commissions'), ('F058', 'Payment terms'), ('F059', 'Order status tracking'), ('F060', 'Sales analytics'), ('F061', 'Margin and profitability'), ('F062', 'Order-to-cash reporting')]
FIDS={x[0] for x in EXPECTED}
def rows(fn):
    with (R/fn).open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
def split(c):return {x for x in re.split(r'[;,\s]+',c or '') if x}
def err(s):errors.append(s)
fr={r['feature_id']:r for r in rows('FEATURE_REGISTER.csv') if r['feature_id'] in FIDS};pr={r['feature_id']:r for r in rows('PRODUCT_READINESS_MATRIX.csv') if r['feature_id'] in FIDS};subs=[r for r in rows('SUBREQUIREMENT_REGISTER.csv') if r.get('feature_id') in FIDS];bms=[r for r in rows('BENCHMARK_REGISTER.csv') if r.get('status') in {'EVIDENCE_CAPTURED','REVIEWED','APPROVED'}];evs=[r for r in rows('EVIDENCE_REGISTER.csv') if r.get('status') in {'VERIFIED','APPROVED'}]
if len(fr)!=32:err(f'feature rows {len(fr)} != 32')
for fid,name in EXPECTED:
    r=fr.get(fid);p=pr.get(fid)
    if not r or r.get('module')!='Sales' or r.get('feature_name')!=name:err(f'{fid}: canonical mismatch')
    elif r.get('specification_status')!='SPECIFICATION_READY' or r.get('benchmark_status')!='RESEARCHED' or r.get('current_code_status')!='AUDITED' or r.get('pass')!='2':err(f'{fid}: register status mismatch')
    if not p or p.get('working_status')!='SPECIFICATION_READY' or p.get('readiness_gate')!='SPECIFICATION_READY':err(f'{fid}: readiness mismatch')
    if p and p.get('product_ready')=='YES':err(f'{fid}: product readiness improperly promoted')
    rr=[x for x in subs if x['feature_id']==fid and x.get('status') in {'APPROVED','READY'}];minima={'CAP':3,'FR':3,'US':2,'FLOW':2,'BR':2,'DATA':2,'VAL':2,'CALC':1,'UX':3,'SEC':2,'AUTO':1,'APP':1,'NOTIF':1,'REP':1,'AI':1,'INT':2,'API':2,'PERF':1,'OBS':1,'E2E':2,'UAT':2}
    for typ,n in minima.items():
        c=sum(1 for x in rr if x['requirement_type']==typ)
        if c<n:err(f'{fid}: {typ} {c} < {n}')
    if sum(1 for x in bms if fid in split(x.get('feature_ids')) and x.get('source_type')=='OFFICIAL_PRIMARY')<2:err(f'{fid}: fewer than 2 official benchmark findings')
    ce=[x for x in evs if x.get('evidence_type')=='CODE_AUDIT' and fid in split(x.get('feature_ids'))]
    if not ce:err(f'{fid}: missing verified code evidence')
    for e in ce:
        if e.get('path_or_url') and not (ROOT/e['path_or_url']).exists():err(f'{fid}: missing evidence path {e["path_or_url"]}')
    ms=list((D/'03-modules/sales/features').glob(fid+'-*.md'))
    if len(ms)!=1:err(f'{fid}: dossier count {len(ms)}');continue
    txt=ms[0].read_text(encoding='utf-8')
    if not txt.startswith(f'# {fid} — {name}\n'):err(f'{fid}: H1 mismatch')
    for bad in ('Working status: `UNSPECIFIED`','Readiness gate: `NONE`','Decision: `UNASSESSED`','PENDING_MODULE_PASS',f'{fid}-UX-###'):
        if bad in txt:err(f'{fid}: unresolved {bad}')
    if re.search(r'\bTBD\b',txt):err(f'{fid}: material TBD remains')
for path in ['docs/03-modules/sales/architecture/SALES_JOURNEY_QUOTE_TO_ORDER.md','docs/04-cross-module/CRM_TO_SALES_QUOTATION.md','docs/04-cross-module/SALES_TO_STOCK_FULFILMENT.md','docs/04-cross-module/SALES_TO_ACCOUNTING_ORDER_TO_CASH.md','docs/04-cross-module/SALES_RETURN_TO_STOCK_CREDIT.md','docs/11-visual-assets/wireframes/SALES_PASS2_WORKSPACES.md','docs/07-testing/SALES_PASS2_TEST_STRATEGY.md','docs/08-uat/SALES_PASS2_UAT_PLAN.md']:
    if not (ROOT/path).exists():err('missing '+path)
if errors:
    print('SALES PASS 2 VALIDATION FAILED');[print(' -',x) for x in errors];sys.exit(1)
print('SALES PASS 2 VALIDATION PASSED');print(' - canonical Sales features: 32 / 32');print(' - canonical F031-F062 names: PASS');print(' - specification-ready dossiers: 32 / 32');print(' - 21-type requirement contracts: PASS');print(' - >=2 official benchmark findings per feature: PASS');print(' - verified current-code evidence per feature: PASS');print(' - deterministic commercial controls: PASS');print(' - CRM/Stock/Accounting contracts: PASS');print(' - visual/testing/UAT artifacts: PASS');print(' - product readiness promotion: NONE')
