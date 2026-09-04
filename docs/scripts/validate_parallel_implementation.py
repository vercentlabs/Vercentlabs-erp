#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import argparse
import re
import sys

from parallel_governance_lib import (
    ACTIVE_PACKAGE_STATUSES,
    CANONICAL_WAVES,
    DEPENDENCY_SATISFIED_PACKAGE_STATUSES,
    EXECUTION_STATUSES,
    EXIT_GATE_STATUSES,
    MIGRATION_STATUSES,
    WORK_TYPES,
    YES_NO,
    PREDECESSOR_STATUSES,
    WORK_PACKAGE_STATUSES,
    WAVE_RE,
    SHARED_HOT_PATHS,
    detect_cycle,
    duplicate_values,
    canonical_migration_prefix,
    is_safe_repo_prefix,
    migration_files,
    parse_depends,
    paths_overlap,
    rows,
    run_git,
    split_semicolon,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate dependency-safe parallel AI implementation governance.")
    parser.add_argument("--root", type=Path, default=None, help="Repository root (tests only; defaults to git/docs root).")
    args = parser.parse_args()
    root = (args.root.resolve() if args.root else Path(__file__).resolve().parents[2])
    docs = root / "docs"; reg = docs / "02-register"; plans = docs / "08-implementation-plans"
    errors: list[str] = []
    def err(msg: str): errors.append(msg)

    authority_path = reg / "IMPLEMENTATION_WAVE_REGISTER.csv"
    mirror_path = plans / "IMPLEMENTATION_WAVES.csv"
    feature_path = reg / "FEATURE_IMPLEMENTATION_WAVE_REGISTER.csv"
    manifest_path = reg / "FEATURE_BUILD_MANIFEST.csv"
    execution_path = reg / "IMPLEMENTATION_EXECUTION_REGISTER.csv"
    awp_path = reg / "AGENT_WORK_PACKAGE_REGISTER.csv"
    migration_path = reg / "MIGRATION_RESERVATION_REGISTER.csv"
    for p in [authority_path, mirror_path, feature_path, manifest_path, execution_path, awp_path, migration_path]:
        if not p.exists(): err(f"missing {p.relative_to(root)}")

    authority = rows(authority_path)
    ids = [r.get("wave_id", "") for r in authority]
    if ids != CANONICAL_WAVES:
        err("canonical implementation-wave authority must be exactly T00,T01,W01-W15 in order")
    if duplicate_values(ids):
        err("canonical wave register contains duplicate wave IDs")
    wave_by_id = {r.get("wave_id", ""): r for r in authority}
    for wid, row in wave_by_id.items():
        if not WAVE_RE.match(wid): err(f"invalid/non-zero-padded canonical wave ID: {wid}")
        if row.get("planning_status") != "PLANNED_FROZEN": err(f"{wid}: planning_status must remain PLANNED_FROZEN")
        for dep in parse_depends(row.get("depends_on")):
            if dep not in CANONICAL_WAVES: err(f"{wid}: invalid dependency {dep}")
    graph = {wid: parse_depends(row.get("depends_on")) for wid, row in wave_by_id.items()}
    cyc = detect_cycle(graph)
    if cyc: err("canonical dependency cycle: " + " -> ".join(cyc))

    mirror = rows(mirror_path)
    if [r.get("wave_id", "") for r in mirror] != CANONICAL_WAVES:
        err("implementation-plan wave mirror does not exactly match canonical wave IDs")
    else:
        for m in mirror:
            a = wave_by_id.get(m.get("wave_id", ""), {})
            for key in ("name", "scope", "depends_on", "planning_status"):
                if (m.get(key) or "") != (a.get(key) or ""):
                    err(f"{m.get('wave_id')}: wave mirror mismatch for {key}")

    features = rows(feature_path)
    manifests = rows(manifest_path)
    if len(features) != 510: err(f"feature implementation wave register rows={len(features)}, expected 510")
    if len(manifests) != 510: err(f"feature build manifest rows={len(manifests)}, expected 510")
    feature_ids = [r.get("feature_id", "") for r in features]
    manifest_ids = [r.get("feature_id", "") for r in manifests]
    expected_feature_ids = [f"F{i:03d}" for i in range(1, 511)]
    if sorted(feature_ids) != expected_feature_ids:
        err("feature implementation wave register must contain the exact canonical F001-F510 ID set")
    if sorted(manifest_ids) != expected_feature_ids:
        err("feature build manifest must contain the exact canonical F001-F510 ID set")
    for dup in sorted(duplicate_values(feature_ids)): err(f"duplicate feature ID {dup} in feature wave register")
    for dup in sorted(duplicate_values(manifest_ids)): err(f"duplicate feature ID {dup} in build manifest")
    feature_by_id = {r.get("feature_id", ""): r for r in features}
    manifest_by_id = {r.get("feature_id", ""): r for r in manifests}
    for fid, row in feature_by_id.items():
        wave = row.get("primary_wave", "")
        if wave not in wave_by_id: err(f"{fid}: invalid primary_wave {wave}")
        expected_deps = ";".join(parse_depends(wave_by_id.get(wave, {}).get("depends_on")))
        actual_deps = ";".join(parse_depends(row.get("canonical_wave_dependencies")))
        if actual_deps != expected_deps: err(f"{fid}: canonical_wave_dependencies={actual_deps!r}, expected {expected_deps!r} from {wave}")
        if manifest_by_id.get(fid, {}).get("primary_wave") != wave:
            err(f"{fid}: primary wave mismatch between feature register and build manifest")

    awps = rows(awp_path)
    awp_ids = [r.get("work_package_id", "") for r in awps]
    for dup in sorted(duplicate_values(awp_ids)): err(f"duplicate work-package ID {dup}")
    awp_by_id = {r.get("work_package_id", ""): r for r in awps}

    executions = rows(execution_path)
    ex_ids = [r.get("wave_id", "") for r in executions]
    if ex_ids != CANONICAL_WAVES: err("execution register must contain exactly one row for every T00,T01,W01-W15 wave in order")
    if duplicate_values(ex_ids): err("execution register contains duplicate wave IDs")
    ex_by_wave = {r.get("wave_id", ""): r for r in executions}
    for row in executions:
        wid = row.get("wave_id", "")
        if row.get("execution_status") not in EXECUTION_STATUSES: err(f"{wid}: invalid execution_status {row.get('execution_status')}")
        if row.get("predecessor_evidence_status") not in PREDECESSOR_STATUSES: err(f"{wid}: invalid predecessor_evidence_status {row.get('predecessor_evidence_status')}")
        if row.get("exit_gate_status") not in EXIT_GATE_STATUSES: err(f"{wid}: invalid exit_gate_status {row.get('exit_gate_status')}")
        active_list = split_semicolon(row.get("active_work_packages"))
        if len(active_list) != len(set(active_list)): err(f"{wid}: active_work_packages contains duplicate package IDs")
        if row.get("execution_status") == "COMPLETE" and row.get("exit_gate_status") != "PASS": err(f"{wid}: COMPLETE requires exit_gate_status PASS")
        if row.get("execution_status") == "RECONCILIATION_REQUIRED" and active_list: err(f"{wid}: RECONCILIATION_REQUIRED cannot have active work packages")
        if row.get("execution_status") in {"READY", "IN_PROGRESS", "CANDIDATE_COMPLETE", "COMPLETE"}:
            if row.get("predecessor_evidence_status") != "PASS": err(f"{wid}: {row.get('execution_status')} requires predecessor_evidence_status PASS")
            for dep in graph.get(wid, []):
                if ex_by_wave.get(dep, {}).get("exit_gate_status") != "PASS": err(f"{wid}: execution state requires canonical predecessor {dep} PASS")
        if row.get("execution_status") == "COMPLETE":
            if active_list: err(f"{wid}: COMPLETE cannot have active work packages")
            if not (row.get("last_verified_commit") or "").strip(): err(f"{wid}: COMPLETE requires last_verified_commit")
            if not (row.get("evidence_path") or "").strip(): err(f"{wid}: COMPLETE requires evidence_path")
        if row.get("accountable_owner") != "Project Manager": err(f"{wid}: accountable_owner must remain Project Manager")
        for awp in active_list:
            if awp not in awp_by_id:
                err(f"{wid}: active work package {awp} does not exist")
            elif awp_by_id[awp].get("canonical_wave") != wid:
                err(f"{wid}: active work package {awp} belongs to another wave")
            elif awp_by_id[awp].get("status") not in ACTIVE_PACKAGE_STATUSES:
                err(f"{wid}: active_work_packages contains stale/non-active package {awp} ({awp_by_id[awp].get('status')})")

    active_branches: list[str] = []
    for row in awps:
        wid = row.get("canonical_wave", ""); pid = row.get("work_package_id", ""); status = row.get("status", "")
        if status not in WORK_PACKAGE_STATUSES: err(f"{pid}: invalid status {status}")
        if wid not in wave_by_id: err(f"{pid}: invalid canonical_wave {wid}")
        awp_match = re.fullmatch(r"AWP-(T00|T01|W(?:0[1-9]|1[0-5]))-[A-Za-z0-9][A-Za-z0-9-]*", pid or "")
        if not awp_match: err(f"{pid}: work_package_id must use AWP-<canonical-wave>-<package> format")
        elif awp_match.group(1) != wid: err(f"{pid}: AWP ID embeds {awp_match.group(1)} but canonical_wave is {wid}")
        if row.get("accountable_owner") != "Project Manager": err(f"{pid}: accountable_owner must remain Project Manager")
        if row.get("executor_class") and row.get("executor_class") != "AI_AGENT": err(f"{pid}: executor_class must be AI_AGENT when populated")
        if row.get("work_type") not in WORK_TYPES: err(f"{pid}: invalid work_type {row.get('work_type')}")
        if (row.get("requires_migration") or "").upper() not in YES_NO: err(f"{pid}: requires_migration must be YES or NO")
        if (row.get("shared_change_required") or "").upper() not in YES_NO: err(f"{pid}: shared_change_required must be YES or NO")
        if (row.get("touches_ui") or "").upper() not in YES_NO: err(f"{pid}: touches_ui must be YES or NO")
        owned_paths = split_semicolon(row.get("owned_paths"))
        forbidden_paths = split_semicolon(row.get("forbidden_paths"))
        for prefix in owned_paths + forbidden_paths:
            if not is_safe_repo_prefix(prefix): err(f"{pid}: unsafe/non-prefix repository path {prefix!r}")
        if row.get("work_type") == "FEATURE":
            if not split_semicolon(row.get("feature_ids")): err(f"{pid}: FEATURE package requires feature_ids")
            if (row.get("shared_change_required") or "").upper() == "YES" and status in {"READY", "ACTIVE", "READY_FOR_INTEGRATION"}:
                err(f"{pid}: FEATURE package requiring shared changes must depend on a dedicated INTEGRATION/SHARED_PLATFORM package before becoming {status}")
            for prefix in owned_paths:
                for hot in SHARED_HOT_PATHS:
                    if paths_overlap(prefix, hot): err(f"{pid}: FEATURE package may not own shared hot path {prefix!r} overlapping {hot!r}")
        if status in {"READY", "ACTIVE", "READY_FOR_INTEGRATION"} and not (row.get("base_commit") or "").strip(): err(f"{pid}: {status} requires base_commit")
        if status in {"READY", "ACTIVE", "READY_FOR_INTEGRATION"} and not (row.get("branch") or "").strip(): err(f"{pid}: {status} requires branch")
        if status == "ACTIVE" and not owned_paths: err(f"{pid}: ACTIVE package requires owned_paths")
        if status in {"READY", "ACTIVE", "READY_FOR_INTEGRATION", "INTEGRATED", "VERIFIED", "CLOSED"} and not (row.get("required_verification") or "").strip(): err(f"{pid}: {status} requires required_verification")
        if status in {"READY_FOR_INTEGRATION", "INTEGRATED", "VERIFIED", "CLOSED"}:
            evidence = (row.get("evidence_path") or "").strip()
            if not evidence: err(f"{pid}: {status} requires evidence_path")
            elif not (root / evidence).is_file(): err(f"{pid}: evidence_path does not exist: {evidence}")
        if status in {"READY", "ACTIVE", "READY_FOR_INTEGRATION"} and (row.get("base_commit") or "").strip():
            rc, _ = run_git(root, "cat-file", "-e", (row.get("base_commit") or "").strip() + "^{commit}")
            if rc != 0: err(f"{pid}: base_commit is invalid/unrecognized")
        if status in ACTIVE_PACKAGE_STATUSES:
            ex = ex_by_wave.get(wid, {})
            if ex.get("execution_status") != "IN_PROGRESS": err(f"{pid}: active package requires {wid} execution_status IN_PROGRESS")
            if ex.get("predecessor_evidence_status") != "PASS": err(f"{pid}: active package requires predecessor_evidence_status PASS")
            branch_name = (row.get("branch") or "").strip()
            active_branches.append(branch_name.casefold())
            if branch_name:
                rc, _ = run_git(root, "show-ref", "--verify", "--quiet", f"refs/heads/{branch_name}")
                if rc != 0: err(f"{pid}: registered active branch does not exist: {branch_name}")
                elif (row.get("base_commit") or "").strip():
                    rc, _ = run_git(root, "merge-base", "--is-ancestor", (row.get("base_commit") or "").strip(), f"refs/heads/{branch_name}")
                    if rc != 0: err(f"{pid}: base_commit is not an ancestor of registered active branch {branch_name}")
            for dep in graph.get(wid, []):
                if ex_by_wave.get(dep, {}).get("exit_gate_status") != "PASS": err(f"{pid}: canonical predecessor {dep} is not PASS")
        for dep_pid in split_semicolon(row.get("depends_on_work_packages")):
            dep = awp_by_id.get(dep_pid)
            if not dep: err(f"{pid}: unresolved package dependency {dep_pid}")
            elif status in {"READY", "ACTIVE", "READY_FOR_INTEGRATION"} and dep.get("status") not in DEPENDENCY_SATISFIED_PACKAGE_STATUSES:
                err(f"{pid}: package dependency {dep_pid} is not VERIFIED/CLOSED")
        for fid in split_semicolon(row.get("feature_ids")):
            f = feature_by_id.get(fid)
            if not f: err(f"{pid}: unknown feature ID {fid}")
            elif f.get("primary_wave") != wid: err(f"{pid}: feature {fid} belongs to {f.get('primary_wave')}, not {wid}")
    for row in awps:
        if row.get("status") in ACTIVE_PACKAGE_STATUSES:
            pid=row.get("work_package_id", ""); wid=row.get("canonical_wave", "")
            listed=set(split_semicolon(ex_by_wave.get(wid, {}).get("active_work_packages")))
            if pid not in listed: err(f"{pid}: active package is not listed in {wid} execution register active_work_packages")
    for dup in sorted(d for d in duplicate_values(active_branches) if d): err(f"duplicate active branch {dup}")

    active = [r for r in awps if r.get("status") in ACTIVE_PACKAGE_STATUSES]
    for i, a in enumerate(active):
        for b in active[i+1:]:
            for pa in split_semicolon(a.get("owned_paths")):
                for pb in split_semicolon(b.get("owned_paths")):
                    if paths_overlap(pa, pb): err(f"owned-path collision: {a.get('work_package_id')}:{pa} overlaps {b.get('work_package_id')}:{pb}")

    reservations = rows(migration_path)
    active_res_keys: list[str] = []
    disk = {"PLATFORM": migration_files(root, "PLATFORM"), "TENANT": migration_files(root, "TENANT")}
    for scope, prefixes in disk.items():
        for prefix, filenames in prefixes.items():
            if len(filenames) > 1:
                err(f"duplicate migration prefix already on disk {scope}:{prefix}: {', '.join(sorted(filenames))}")
    reservation_ids = [r.get("reservation_id", "") for r in reservations]
    for dup in sorted(duplicate_values(reservation_ids)): err(f"duplicate migration reservation ID {dup}")
    reservation_by_id = {r.get("reservation_id", ""): r for r in reservations}
    for row in reservations:
        rid = row.get("reservation_id", ""); scope = row.get("database_scope", ""); status = row.get("status", ""); raw_prefix = (row.get("prefix") or "").strip(); pid = row.get("work_package_id", "")
        if scope not in {"PLATFORM", "TENANT"}: err(f"{rid}: invalid database_scope {scope}")
        if status not in MIGRATION_STATUSES: err(f"{rid}: invalid reservation status {status}")
        if pid not in awp_by_id: err(f"{rid}: reservation references nonexistent work package {pid}")
        if row.get("accountable_owner") != "Project Manager": err(f"{rid}: accountable_owner must remain Project Manager")
        prefix = canonical_migration_prefix(raw_prefix)
        if prefix is None:
            err(f"{rid}: migration prefix must be numeric")
            continue
        if int(prefix) == 0:
            err(f"{rid}: migration prefix 000 is not valid")
        if raw_prefix != prefix:
            err(f"{rid}: migration prefix must use canonical zero-padded form {prefix}, not {raw_prefix}")
        if status in {"RESERVED", "CONSUMED"}: active_res_keys.append(f"{scope}:{prefix}")
        if scope in disk:
            existing = disk[scope].get(prefix, [])
            if status == "RESERVED" and existing:
                err(f"{rid}: RESERVED prefix {scope}:{prefix} already exists on disk as {', '.join(existing)}")
            if status == "CONSUMED":
                expected_name = (row.get("migration_filename") or "").strip()
                if not expected_name:
                    err(f"{rid}: CONSUMED reservation requires migration_filename")
                if not existing:
                    err(f"{rid}: CONSUMED prefix {scope}:{prefix} has no migration on disk")
                elif expected_name and expected_name not in existing:
                    err(f"{rid}: CONSUMED migration filename mismatch: disk={','.join(existing)}, register={expected_name}")
    for dup in sorted(duplicate_values(active_res_keys)): err(f"duplicate active migration prefix {dup}")
    for row in awps:
        pid = row.get("work_package_id", "")
        claimed = split_semicolon(row.get("migration_reservations"))
        requires = (row.get("requires_migration") or "").upper()
        if requires == "YES" and not claimed: err(f"{pid}: requires_migration=YES without reservation")
        if requires == "NO" and claimed: err(f"{pid}: requires_migration=NO but migration reservations are claimed")
        for rid in claimed:
            r = reservation_by_id.get(rid)
            if not r:
                err(f"{pid}: claims nonexistent migration reservation {rid}")
            elif r.get("work_package_id") != pid:
                err(f"{pid}: migration reservation {rid} belongs to {r.get('work_package_id')}")
            elif row.get("status") in {"READY", "ACTIVE", "READY_FOR_INTEGRATION"} and r.get("status") not in {"RESERVED", "CONSUMED"}:
                err(f"{pid}: migration reservation {rid} is not usable in status {r.get('status')}")

    if plans.exists():
        ambiguous_file = re.compile(r"^WAVE_\d+", re.I)
        ambiguous_heading = re.compile(r"^#\s+Wave\s+\d+\b", re.I | re.M)
        for p in plans.rglob("*.md"):
            if ambiguous_file.search(p.name): err(f"ambiguous implementation-plan filename: {p.relative_to(root)}")
            try: txt = p.read_text(encoding="utf-8", errors="replace")
            except OSError: continue
            if ambiguous_heading.search(txt): err(f"ambiguous plain numeric Wave heading: {p.relative_to(root)}")

    if errors:
        print("PARALLEL IMPLEMENTATION GOVERNANCE VALIDATION FAILED")
        for e in errors[:200]: print(" -", e)
        return 1
    print("PARALLEL IMPLEMENTATION GOVERNANCE VALIDATION PASSED")
    print(" - canonical authority: T00,T01,W01-W15; dependency DAG acyclic")
    print(" - feature-to-wave dependency projection matches canonical authority")
    print(" - execution/AWP/migration registers structurally valid")
    print(" - active-package predecessor, dependency, branch and owned-path checks passed")
    print(" - migration reservation collisions absent")
    print(" - ambiguous plain numeric implementation-wave naming absent")
    return 0

if __name__ == "__main__":
    sys.exit(main())
