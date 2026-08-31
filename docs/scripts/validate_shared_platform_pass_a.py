#!/usr/bin/env python3
from pathlib import Path
import csv, hashlib, re, sys
ROOT=Path(__file__).resolve().parents[2]; D=ROOT/'docs'; SP=D/'04-shared-platform'; R=D/'02-register'; failures=[]
def fail(x): failures.append(x)
def rows(p):
    if not p.exists(): fail(f'missing {p.relative_to(ROOT)}'); return []
    with p.open(encoding='utf-8',newline='') as f:return list(csv.DictReader(f))
features=rows(R/'FEATURE_REGISTER.csv')
if len(features)!=510: fail(f'canonical feature count {len(features)} != 510')
else:
    if [x.get('feature_id') for x in features] != [f'F{i:03d}' for i in range(1,511)]: fail('canonical F IDs are not F001-F510')
    norm=''.join(f"{x['feature_id']},{x['feature_name']}\n" for x in features)
    if hashlib.sha256(norm.encode()).hexdigest()!='82cfcf68e74cef8c8c8872136d0bfcc0bb619b0517f3a33cfc92bc1e3dde232e': fail('canonical fingerprint mismatch')
reg=rows(SP/'SHARED_PLATFORM_REGISTER.csv')
if len(reg)!=36: fail(f'shared platform count {len(reg)} != 36')
else:
    if [x.get('sp_id') for x in reg] != [f'SP{i:03d}' for i in range(1,37)]: fail('shared IDs are not exactly SP001-SP036')
    if any((x.get('specification_status') or '').upper()!='SPECIFICATION_READY' for x in reg): fail('not all SP rows SPECIFICATION_READY')
    if any((x.get('canonical_business_count_impact') or '')!='NONE' for x in reg): fail('SP register alters canonical count')
    if len({x.get('requirement_name') for x in reg})!=36: fail('SP names missing/duplicated')
    for x in reg:
        p=D/x['spec_path']
        if not p.exists(): fail(f"missing dossier {x['spec_path']}")
        else:
            t=p.read_text(encoding='utf-8')
            if f"# {x['sp_id']} — {x['requirement_name']}" not in t: fail(f"{x['sp_id']} identity mismatch")
            for sec in ['SPEC-IDENTITY','SPEC-FUNCTIONAL','SPEC-FLOWS','SPEC-DATA','SPEC-SECURITY','SPEC-CONCURRENCY','SPEC-IDEMPOTENCY','SPEC-API','SPEC-MOBILE','SPEC-ACCESSIBILITY','SPEC-PERFORMANCE','SPEC-OBSERVABILITY','SPEC-TESTS','SPEC-E2E','SPEC-UAT','SPEC-DOD']:
                if f'[{sec}]' not in t: fail(f"{x['sp_id']} missing {sec}")
subs=rows(SP/'SHARED_PLATFORM_SUBREQUIREMENT_REGISTER.csv')
allowed={'CAP','FR','US','FLOW','BR','DATA','VAL','CALC','UX','SEC','AUTO','APP','NOTIF','REP','AI','INT','API','PERF','OBS','E2E','UAT'}
if len(subs)!=1332: fail(f'nested requirements {len(subs)} != 1332')
else:
    for spid in [f'SP{i:03d}' for i in range(1,37)]:
        rs=[x for x in subs if x.get('sp_id')==spid]
        if {x.get('type') for x in rs}!=allowed: fail(f'{spid} requirement type mismatch')
        if any((x.get('status') or '')!='APPROVED' for x in rs): fail(f'{spid} unapproved requirement')
        for x in rs:
            if not re.fullmatch(rf'{spid}-[A-Z0-9]+-\d{{3}}',x.get('requirement_id','')): fail(f"bad requirement id {x.get('requirement_id')}")
            if x.get('type') in {'SEC','BR','VAL','API','INT','PERF','OBS','E2E','UAT'} and not (x.get('test_ids') or '').strip(): fail(f"{x['requirement_id']} missing test/UAT id")
bm=rows(SP/'SHARED_PLATFORM_BENCHMARK_REGISTER.csv')
if len(bm)<72: fail(f'benchmark mappings {len(bm)} < 72')
for spid in [f'SP{i:03d}' for i in range(1,37)]:
    if len([x for x in bm if x.get('sp_id')==spid])<2: fail(f'{spid} has <2 benchmark mappings')
src=rows(SP/'SHARED_PLATFORM_SOURCE_REGISTER.csv')
if len(src)<10 or any((x.get('authority') or '')!='OFFICIAL/PRIMARY' for x in src): fail('source register authority/size invalid')
deps=rows(SP/'SHARED_PLATFORM_DEPENDENCY_REGISTER.csv'); valid={f'SP{i:03d}' for i in range(1,37)}
for x in deps:
    if x.get('from_sp_id') not in valid or x.get('to_sp_id') not in valid: fail(f'invalid dependency {x}')
tests=rows(SP/'SHARED_PLATFORM_TEST_PLAN.csv'); uat=rows(SP/'SHARED_PLATFORM_UAT_PLAN.csv')
if len(tests)!=72: fail(f'E2E plan {len(tests)} != 72')
if len(uat)!=72: fail(f'UAT plan {len(uat)} != 72')
for p in [SP/'SHARED_PLATFORM_REFERENCE_ARCHITECTURE.md',SP/'SHARED_PLATFORM_PERMISSION_MATRIX.md',SP/'SHARED_PLATFORM_CRITICAL_JOURNEYS.md',SP/'SHARED_PLATFORM_PASS_A_RESEARCH.md',D/'00-program/FINAL_PASS_A_REPORT.md']:
    if not p.exists(): fail(f'missing {p.relative_to(ROOT)}')
if failures:
    print('SHARED PLATFORM PASS A: FAIL')
    for x in failures: print(' -',x)
    sys.exit(1)
print('SHARED PLATFORM PASS A: PASS')
print(' - exact authority: SP001-SP036 (36/36)')
print(' - canonical F001-F510 fingerprint preserved')
print(f' - nested requirements: {len(subs)}')
print(f' - benchmark mappings: {len(bm)}')
print(f' - dependency edges: {len(deps)}')
print(f' - E2E/UAT planned: {len(tests)}/{len(uat)}')
print(' - implementation/product readiness not promoted')
