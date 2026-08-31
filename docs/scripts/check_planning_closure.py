#!/usr/bin/env python3
from pathlib import Path
import csv,sys
ROOT=Path(__file__).resolve().parents[2];R=ROOT/'docs/02-register';SP=ROOT/'docs/04-shared-platform'; blockers=[]
def rows(p):
    if not p.exists(): return []
    with p.open(encoding='utf-8',newline='') as f:return list(csv.DictReader(f))
for name,n in [('SEMANTIC_REVIEW_REGISTER.csv',510),('FLOW_STATE_REVIEW_REGISTER.csv',510),('BENCHMARK_RELEVANCE_REVIEW.csv',510),('ARCHITECTURE_AI_FREEZE_REVIEW.csv',1),('FINAL_IMPLEMENTATION_AUTHORIZATION_REVIEW.csv',1)]:
    x=rows(R/name)
    if len(x)!=n or any((r.get('review_status') or '').upper()!='APPROVED' for r in x): blockers.append(name)
sp=rows(SP/'SHARED_PLATFORM_REGISTER.csv')
if len(sp)!=36 or any((r.get('specification_status') or r.get('status') or '').upper() not in {'SPECIFICATION_READY','APPROVED'} for r in sp): blockers.append('SP001-SP036')
if blockers:
    print('PLANNING CLOSURE: BLOCKED'); [print(' -',x) for x in blockers]; sys.exit(2)
print('PLANNING CLOSURE: PASS')
