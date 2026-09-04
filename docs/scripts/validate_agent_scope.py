#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import argparse
import re
import subprocess
import sys

from parallel_governance_lib import CENTRAL_GOVERNANCE_PATHS, SHARED_HOT_PATHS, is_safe_repo_prefix, normalize_repo_path, path_contains, rows, split_semicolon


def git(root: Path, *args: str) -> tuple[int, str]:
    p = subprocess.run(["git", *args], cwd=root, text=True, capture_output=True)
    return p.returncode, (p.stdout + p.stderr).strip()


def main() -> int:
    ap = argparse.ArgumentParser(description="Validate that the current branch only changes its registered AWP scope.")
    ap.add_argument("work_package_id")
    ap.add_argument("--root", type=Path, default=None)
    args = ap.parse_args()
    root = args.root.resolve() if args.root else Path(__file__).resolve().parents[2]
    reg = root / "docs" / "02-register"
    errors: list[str] = []
    def err(msg: str): errors.append(msg)

    awps = [r for r in rows(reg / "AGENT_WORK_PACKAGE_REGISTER.csv") if r.get("work_package_id") == args.work_package_id]
    if len(awps) != 1:
        err(f"work package {args.work_package_id} must exist exactly once")
        row = {}
    else: row = awps[0]
    if row and row.get("status") not in {"ACTIVE", "READY_FOR_INTEGRATION"}:
        err(f"work package status {row.get('status')} does not permit scope validation/work")

    rc, branch = git(root, "branch", "--show-current")
    if rc != 0: err("unable to determine current git branch: " + branch)
    elif row and branch.strip() != (row.get("branch") or "").strip(): err(f"current branch {branch.strip()!r} != registered branch {(row.get('branch') or '').strip()!r}")

    base = (row.get("base_commit") or "").strip() if row else ""
    if base:
        rc, out = git(root, "cat-file", "-e", base + "^{commit}")
        if rc != 0: err(f"base_commit {base} is invalid/unrecognized")
        else:
            rc, out = git(root, "merge-base", "--is-ancestor", base, "HEAD")
            if rc != 0: err(f"base_commit {base} is not an ancestor of HEAD")
    else: err("base_commit is required")

    changed: set[str] = set()
    if base:
        rc, out = git(root, "diff", "--name-only", base, "--")
        if rc == 0: changed.update(normalize_repo_path(x) for x in out.splitlines() if x.strip())
        else: err("unable to compute changed files from base_commit: " + out)
    rc, out = git(root, "ls-files", "--others", "--exclude-standard")
    if rc == 0: changed.update(normalize_repo_path(x) for x in out.splitlines() if x.strip())
    else: err("unable to list untracked files: " + out)

    owned = [normalize_repo_path(x) for x in split_semicolon(row.get("owned_paths"))] if row else []
    forbidden = [normalize_repo_path(x) for x in split_semicolon(row.get("forbidden_paths"))] if row else []
    for prefix in owned + forbidden:
        if not is_safe_repo_prefix(prefix): err(f"unsafe/non-prefix repository path: {prefix!r}")
    if row.get("work_type") == "FEATURE" and (row.get("shared_change_required") or "").upper() == "YES":
        err("FEATURE package with shared_change_required=YES must stop and use a dedicated INTEGRATION/SHARED_PLATFORM package")
    for path in sorted(changed):
        if not any(path_contains(prefix, path) for prefix in owned): err(f"changed path outside owned_paths: {path}")
        if any(path_contains(prefix, path) for prefix in forbidden): err(f"changed path is forbidden: {path}")
        if row.get("work_type") == "FEATURE" and any(path_contains(prefix, path) for prefix in CENTRAL_GOVERNANCE_PATHS):
            err(f"FEATURE package may not modify central governance path: {path}")
        if row.get("work_type") == "FEATURE" and any(path_contains(prefix, path) for prefix in SHARED_HOT_PATHS):
            err(f"FEATURE package may not modify shared hot path directly: {path}")

    reservations = {r.get("reservation_id", ""): r for r in rows(reg / "MIGRATION_RESERVATION_REGISTER.csv")}
    claimed = set(split_semicolon(row.get("migration_reservations"))) if row else set()
    for path in sorted(changed):
        m = re.match(r"^database/(platform|tenant)/migrations/(\d+)_.*\.sql$", path)
        if not m: continue
        scope = m.group(1).upper(); prefix = m.group(2); filename = Path(path).name
        match = [r for rid, r in reservations.items() if rid in claimed and r.get("database_scope") == scope and (r.get("prefix") or "").strip() == prefix]
        if not match:
            err(f"migration {path} has no claimed {scope}:{prefix} reservation")
        elif match[0].get("status") not in {"RESERVED", "CONSUMED"}:
            err(f"migration {path} uses unavailable reservation {match[0].get('reservation_id')} status={match[0].get('status')}")
        elif match[0].get("migration_filename") and match[0].get("migration_filename") != filename:
            err(f"migration {path} does not match reserved filename {match[0].get('migration_filename')}")

    if errors:
        print("AGENT SCOPE VALIDATION FAILED")
        for e in errors[:100]: print(" -", e)
        return 1
    print("AGENT SCOPE VALIDATION PASSED")
    print(f" - work package: {args.work_package_id}")
    print(f" - branch: {branch.strip()}")
    print(f" - changed files checked: {len(changed)}")
    print(" - all changes remain inside registered owned paths and migration reservations")
    return 0

if __name__ == "__main__":
    sys.exit(main())
