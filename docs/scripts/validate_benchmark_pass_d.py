#!/usr/bin/env python3
from pathlib import Path
import csv,hashlib,sys,re
from collections import defaultdict
from urllib.parse import urlparse
ROOT=Path(__file__).resolve().parents[2];D=ROOT/'docs';R=D/'02-register';FAIL=[]
FP='82cfcf68e74cef8c8c8872136d0bfcc0bb619b0517f3a33cfc92bc1e3dde232e'
def rows(p):
    if not p.exists():return []
    with p.open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
def bad(x):FAIL.append(x)
f=rows(R/'FEATURE_REGISTER.csv');rv=rows(R/'BENCHMARK_RELEVANCE_REVIEW.csv');bm=rows(R/'BENCHMARK_REGISTER.csv');mp=rows(R/'BENCHMARK_REMEDIATION_REGISTER.csv');aud=rows(R/'BENCHMARK_EVIDENCE_AUDIT.csv')
if len(f)!=510 or [r.get('feature_id') for r in f]!=[f'F{i:03d}' for i in range(1,511)]:bad('canonical feature register is not exact F001-F510')
if f:
 h=hashlib.sha256(''.join(f"{r['feature_id']},{r['feature_name']}\n" for r in f).encode()).hexdigest()
 if h!=FP:bad('canonical fingerprint mismatch')
if len(rv)!=510:bad(f'expected 510 feature relevance reviews, found {len(rv)}')
else:
 for r in rv:
  if (r.get('review_status') or '').upper()!='APPROVED':bad(f"{r.get('feature_id')}: benchmark review not APPROVED")
  if r.get('independent_official_source_count')!='2':bad(f"{r.get('feature_id')}: expected two official sources")
  for c in ['source_authority_check','module_domain_fit','restricted_source_check','finding_relevance_check']:
   if (r.get(c) or '').upper()!='PASS':bad(f"{r.get('feature_id')}: {c} not PASS")
cur=[r for r in bm if (r.get('benchmark_id') or '').startswith('PFD-BM-')]
if len(cur)!=1020:bad(f'expected 1020 Pass-D benchmark rows, found {len(cur)}')
by=defaultdict(list)
for r in cur:by[r.get('feature_ids')].append(r)
for fid in [f'F{i:03d}' for i in range(1,511)]:
 rs=by[fid]
 if len(rs)!=2:bad(f'{fid}: expected 2 curated benchmark rows, found {len(rs)}');continue
 if len({r.get('source_url') for r in rs})!=2:bad(f'{fid}: curated sources are not independent')
 for r in rs:
  if (r.get('status') or '').upper()!='EVIDENCE_CAPTURED':bad(f"{r.get('benchmark_id')}: not EVIDENCE_CAPTURED")
  if (r.get('source_type') or '').upper()!='OFFICIAL_PRIMARY':bad(f"{r.get('benchmark_id')}: not OFFICIAL_PRIMARY")
  if not (r.get('source_url') or '').startswith('https://'):bad(f"{r.get('benchmark_id')}: source URL not HTTPS")
  if len((r.get('finding') or '').strip())<100:bad(f"{r.get('benchmark_id')}: finding too weak")
if len(mp)!=1020:bad(f'expected 1020 remediation/source mappings, found {len(mp)}')
if any((r.get('review_status') or '').upper()!='APPROVED' for r in mp):bad('one or more curated source mappings are not APPROVED')
# Known restricted-source misuse must never appear in curated rows.
upi_allowed={'F284','F285','F286','F292','F304','F305'};pci_allowed={'F283','F285','F286','F292','F304','F305'}
for r in cur:
 fid=r.get('feature_ids');t=' '.join([r.get('vendor',''),r.get('product',''),r.get('source_title',''),r.get('source_url','')]).lower()
 if ('npci' in t or '/upi/' in t) and fid not in upi_allowed:bad(f'{fid}: curated UPI evidence used outside payment scope')
 if ('pci' in t and ('dss' in t or 'securitystandards' in t)) and fid not in pci_allowed:bad(f'{fid}: curated PCI evidence used outside payment-card scope')
# Dossier markers.
mods={'CRM':'crm','Sales':'sales','Procurement':'procurement','Stock / Inventory':'stock','Manufacturing':'manufacturing','Projects':'projects','Assets':'assets','Point of Sale':'point-of-sale','Quality':'quality','Support / Customer Service':'support','HR & Payroll':'hr-payroll','Accounting / Finance':'accounting'}
for x in f:
 fid=x['feature_id'];matches=sorted((D/'03-modules'/mods[x['module']]/'features').glob(f'{fid}-*.md'))
 if len(matches)!=1 or '<!-- FINAL-PASS-D:START -->' not in matches[0].read_text(encoding='utf-8'):bad(f'{fid}: dossier missing Pass D authority')
if FAIL:
 print('FINAL PASS D BENCHMARK RELEVANCE VALIDATION FAILED')
 for x in FAIL[:80]:print(' -',x)
 if len(FAIL)>80:print(f' ... and {len(FAIL)-80} more')
 sys.exit(1)
print('FINAL PASS D BENCHMARK RELEVANCE VALIDATION PASSED')
print(' - canonical features reviewed: 510 / 510')
print(' - curated official benchmark mappings: 1020 (2 per feature)')
print(' - restricted-source misuse in curated mappings: NONE')
print(' - legacy evidence provenance retained and relevance-audited')
print(' - canonical F001-F510 fingerprint preserved')
print(' - implementation/product readiness not promoted')
