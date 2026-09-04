#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import csv
import re
import subprocess
from typing import Iterable

CANONICAL_WAVES = ["T00", "T01"] + [f"W{i:02d}" for i in range(1, 16)]
WAVE_RE = re.compile(r"^(?:T0[01]|W(?:0[1-9]|1[0-5]))$")
WORK_PACKAGE_STATUSES = {
    "DRAFT", "READY", "ACTIVE", "READY_FOR_INTEGRATION", "INTEGRATED", "VERIFIED", "CLOSED", "BLOCKED", "CANCELLED"
}
EXECUTION_STATUSES = {
    "RECONCILIATION_REQUIRED", "NOT_STARTED", "READY", "IN_PROGRESS", "BLOCKED", "CANDIDATE_COMPLETE", "COMPLETE"
}
EXIT_GATE_STATUSES = {"NOT_EVALUATED", "PENDING", "PASS", "FAIL"}
PREDECESSOR_STATUSES = {"RECONCILIATION_REQUIRED", "NOT_EVALUATED", "PENDING", "PASS", "FAIL"}
MIGRATION_STATUSES = {"RESERVED", "CONSUMED", "RELEASED", "CANCELLED"}
WORK_TYPES = {"FOUNDATION", "FEATURE", "CAPABILITY", "INTEGRATION", "SHARED_PLATFORM", "GOVERNANCE", "HARDENING"}
YES_NO = {"YES", "NO"}
ACTIVE_PACKAGE_STATUSES = {"ACTIVE", "READY_FOR_INTEGRATION"}
DEPENDENCY_SATISFIED_PACKAGE_STATUSES = {"VERIFIED", "CLOSED"}

PLANNING_COMPLETE_RE = re.compile(r"(?mi)^\s*Planning\s+(?:is|remains)\s+\*\*COMPLETE\*\*")
STALE_BEGIN_T00_RE = re.compile(r"(?mi)^\s*Begin\s+`?T00`?\s+only\b")

def planning_closure_is_complete(text: str) -> bool:
    return bool(PLANNING_COMPLETE_RE.search(text))

def checkpoint_has_stale_begin_t00_authorization(text: str) -> bool:
    return bool(STALE_BEGIN_T00_RE.search(text) or "T00_WHEN_PROJECT_MANAGER_CHOOSES_TO_BEGIN" in text)

CENTRAL_GOVERNANCE_PATHS = (
    "docs/02-register/IMPLEMENTATION_WAVE_REGISTER.csv",
    "docs/02-register/IMPLEMENTATION_SEQUENCE_BASELINE.csv",
    "docs/02-register/IMPLEMENTATION_EXECUTION_REGISTER.csv",
    "docs/02-register/AGENT_WORK_PACKAGE_REGISTER.csv",
    "docs/02-register/MIGRATION_RESERVATION_REGISTER.csv",
    "docs/00-program/PM_PLANNING_BASELINE.md",
    "docs/00-program/CURRENT_REBUILD_CHECKPOINT.md",
)

# Shared/global hotspots that ordinary FEATURE packages may read but must not
# own or modify directly. Changes here require a dedicated INTEGRATION,
# SHARED_PLATFORM, GOVERNANCE or HARDENING work package.
SHARED_HOT_PATHS = (
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "turbo.json",
    "packages/ui",
    "packages/types",
    "packages/sdk",
    "packages/permissions",
    "services/api/src/core",
    "apps/web/src/core",
    *CENTRAL_GOVERNANCE_PATHS,
)

def rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def split_semicolon(value: str | None) -> list[str]:
    return [x.strip() for x in (value or "").split(";") if x.strip() and x.strip().lower() != "none"]


def normalize_repo_path(value: str) -> str:
    p = value.replace("\\", "/").strip()
    p = re.sub(r"^\./", "", p)
    p = re.sub(r"/+", "/", p)
    return p.rstrip("/")


def repo_path_key(value: str) -> str:
    # Treat ownership paths case-insensitively across all hosts. Git worktrees
    # may be integrated on Windows even when another agent developed on Linux.
    # Rejecting case-only overlaps is safer than allowing two packages to own
    # paths that alias on a case-insensitive filesystem.
    return normalize_repo_path(value).casefold()


def is_safe_repo_prefix(value: str) -> bool:
    p = normalize_repo_path(value)
    if not p or p.startswith("/") or re.match(r"^[A-Za-z]:", p):
        return False
    parts = p.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        return False
    # owned_paths/forbidden_paths are exact path prefixes, not glob patterns.
    return not any(ch in p for ch in "*?[]\x00")


def path_contains(prefix: str, path: str) -> bool:
    prefix_key = repo_path_key(prefix)
    path_key = repo_path_key(path)
    return path_key == prefix_key or path_key.startswith(prefix_key + "/")


def paths_overlap(a: str, b: str) -> bool:
    return path_contains(a, b) or path_contains(b, a)


def canonical_migration_prefix(value: str) -> str | None:
    raw = (value or "").strip()
    if not re.fullmatch(r"\d+", raw):
        return None
    # Existing repository migrations use three digits. Preserve at least that
    # width while remaining forward-safe at 1000+. This makes 74 and 074 the
    # same reservation identity and prevents numeric-prefix aliases.
    return str(int(raw)).zfill(3)


def parse_depends(value: str | None) -> list[str]:
    out: list[str] = []
    for token in split_semicolon(value):
        m = re.fullmatch(r"W(\d{2})-W(\d{2})", token)
        if m:
            start, end = int(m.group(1)), int(m.group(2))
            if start <= end:
                out.extend(f"W{i:02d}" for i in range(start, end + 1))
                continue
        out.append(token)
    return out


def run_git(root: Path, *args: str) -> tuple[int, str]:
    p = subprocess.run(["git", *args], cwd=root, text=True, capture_output=True)
    return p.returncode, (p.stdout + p.stderr).strip()


def migration_files(root: Path, scope: str) -> dict[str, list[str]]:
    base = root / "database" / ("platform" if scope == "PLATFORM" else "tenant") / "migrations"
    out: dict[str, list[str]] = {}
    if not base.exists():
        return out
    for p in base.glob("*.sql"):
        m = re.match(r"^(\d+)_", p.name)
        if not m:
            continue
        key = canonical_migration_prefix(m.group(1))
        if key is not None:
            out.setdefault(key, []).append(p.name)
    return out


def detect_cycle(graph: dict[str, list[str]]) -> list[str] | None:
    visiting: set[str] = set()
    visited: set[str] = set()
    stack: list[str] = []

    def visit(node: str) -> list[str] | None:
        if node in visiting:
            i = stack.index(node)
            return stack[i:] + [node]
        if node in visited:
            return None
        visiting.add(node)
        stack.append(node)
        for dep in graph.get(node, []):
            cyc = visit(dep)
            if cyc:
                return cyc
        stack.pop()
        visiting.remove(node)
        visited.add(node)
        return None

    for node in graph:
        cyc = visit(node)
        if cyc:
            return cyc
    return None


def duplicate_values(items: Iterable[str]) -> set[str]:
    seen: set[str] = set()
    dup: set[str] = set()
    for item in items:
        if item in seen:
            dup.add(item)
        seen.add(item)
    return dup
