#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import argparse
import subprocess
import sys


def run(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], cwd=root, text=True, capture_output=True)


def nul_paths(data: bytes) -> list[str]:
    return [x.decode("utf-8", "surrogateescape") for x in data.split(b"\0") if x]


def git_paths_z(root: Path, args: list[str]) -> tuple[int, list[str], str]:
    p = subprocess.run(["git", *args], cwd=root, capture_output=True)
    return p.returncode, nul_paths(p.stdout), p.stderr.decode("utf-8", "replace")


UNTRACKED_TRANSPORT_SUFFIXES = {".patch", ".diff"}


def is_text_bytes(data: bytes) -> bool:
    return b"\0" not in data


def is_untracked_transport_artifact(rel: str) -> bool:
    """Return True for untracked unified-diff transport artifacts.

    Patch/diff files can legitimately encode trailing whitespace, blank EOF lines,
    and conflict-marker-looking source lines. They are delivery/evidence artifacts,
    not repository source text, so source-hygiene semantics must not reinterpret
    their payload. Tracked patch/diff files remain covered by Git's tracked diff
    checks; this exemption applies only to untracked transport artifacts.
    """
    return Path(rel).suffix.lower() in UNTRACKED_TRANSPORT_SUFFIXES


def check_untracked_text(path: Path, rel: str) -> list[str]:
    errors: list[str] = []
    try:
        data = path.read_bytes()
    except OSError as exc:
        return [f"{rel}: unable to read untracked file: {exc}"]
    if not is_text_bytes(data):
        return errors
    lines = data.splitlines()
    for index, raw in enumerate(lines, 1):
        if raw.endswith((b" ", b"\t")):
            errors.append(f"{rel}:{index}: trailing whitespace in untracked file")
        stripped = raw.lstrip()
        if stripped.startswith((b"<<<<<<<", b">>>>>>>")) or stripped == b"=======":
            errors.append(f"{rel}:{index}: leftover conflict marker in untracked file")
    normalized = data.replace(b"\r\n", b"\n")
    if normalized.endswith(b"\n\n"):
        errors.append(f"{rel}: new blank line at EOF in untracked file")
    return errors


def eol_attribute(root: Path, rel: str) -> str:
    p = run(root, "check-attr", "eol", "--", rel)
    if p.returncode != 0:
        return ""
    # format: path: eol: value
    line = p.stdout.strip().splitlines()[-1] if p.stdout.strip() else ""
    return line.rsplit(":", 1)[-1].strip() if ":" in line else ""


def main() -> int:
    ap = argparse.ArgumentParser(description="Validate staged, unstaged and untracked worktree text hygiene.")
    ap.add_argument("--scope", action="append", default=[], help="Repository path scope; repeatable. Defaults to whole repository.")
    ap.add_argument("--root", type=Path, default=None)
    args = ap.parse_args()
    root = args.root.resolve() if args.root else Path(__file__).resolve().parents[2]
    scopes = args.scope or ["."]

    errors: list[str] = []

    # HEAD -> working tree covers both staged and unstaged tracked changes.
    cmd = ["-c", "color.ui=false", "diff", "HEAD", "--check", "--", *scopes]
    diff = run(root, *cmd)
    diff_output = (diff.stdout + diff.stderr).strip()
    if diff.returncode != 0:
        errors.append(f"git diff HEAD --check failed (exit {diff.returncode})")
        if diff_output:
            errors.extend(f"tracked diff: {line}" for line in diff_output.splitlines())

    rc, tracked, stderr = git_paths_z(root, ["diff", "HEAD", "--name-only", "-z", "--", *scopes])
    if rc != 0:
        errors.append("unable to enumerate tracked changes: " + stderr.strip())
        tracked = []
    rc, untracked, stderr = git_paths_z(root, ["ls-files", "--others", "--exclude-standard", "-z", "--", *scopes])
    if rc != 0:
        errors.append("unable to enumerate untracked files: " + stderr.strip())
        untracked = []

    tracked_set = set(tracked)
    untracked_set = set(untracked)
    skipped_transport = sorted(rel for rel in untracked_set if is_untracked_transport_artifact(rel))
    checked_untracked = untracked_set.difference(skipped_transport)

    existing = sorted(tracked_set | checked_untracked)
    for rel in existing:
        path = root / rel
        if not path.is_file():
            continue
        if rel in checked_untracked:
            errors.extend(check_untracked_text(path, rel))
        try:
            data = path.read_bytes()
        except OSError:
            continue
        if not is_text_bytes(data):
            continue
        if eol_attribute(root, rel) == "lf" and b"\r\n" in data:
            errors.append(f"{rel}: CRLF violates repository eol=lf attribute")

    if errors:
        print("WORKTREE HYGIENE VALIDATION FAILED")
        for item in errors[:250]:
            print(" -", item)
        return 1

    print("WORKTREE HYGIENE VALIDATION PASSED")
    print(f" - scopes: {', '.join(scopes)}")
    print(f" - tracked changed paths checked: {len(tracked_set)}")
    print(f" - untracked source/text paths checked: {len(checked_untracked)}")
    print(f" - untracked patch/diff transport artifacts skipped: {len(skipped_transport)}")
    print(" - staged + unstaged tracked diff has no whitespace/conflict errors")
    print(" - untracked source/text files have no trailing whitespace/conflict markers")
    print(" - eol=lf files are LF-normalized")
    return 0


if __name__ == "__main__":
    sys.exit(main())
