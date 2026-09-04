#!/usr/bin/env bash
set -euo pipefail

INFO="\033[1;34m[INFO]\033[0m"
OK="\033[1;32m[ OK ]\033[0m"
FAIL="\033[1;31m[FAIL]\033[0m"
WARN="\033[1;33m[WARN]\033[0m"

die() {
  echo -e "$FAIL $*" >&2
  exit 1
}

info() {
  echo -e "\n$INFO $*"
}

ok() {
  echo -e "$OK $*"
}

warn() {
  echo -e "$WARN $*"
}

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[[ -n "$repo_root" ]] || die "Run this from inside the Vercentlabs ERP Git repository."
cd "$repo_root"

[[ -f package.json ]] || die "package.json not found at repository root."
[[ -f docs/scripts/validate_parallel_implementation.py ]] || die "Phase 2 parallel-governance validator is missing."
[[ -f docs/scripts/validate_worktree_hygiene.py ]] || die "Phase 2 worktree-hygiene validator is missing."
[[ -f scripts/validation/verify-toolchain.mjs ]] || die "Phase 2 toolchain validator is missing."

branch="$(git branch --show-current)"
[[ "$branch" == "main" ]] || die "Current branch is '$branch'. This checkpoint script is intentionally restricted to main."

# Refuse in-progress Git operations.
git_dir="$(git rev-parse --git-dir)"
for marker in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD; do
  [[ ! -e "$git_dir/$marker" ]] || die "Git operation in progress ($marker). Finish/abort it before checkpointing."
done
[[ ! -d "$git_dir/rebase-merge" && ! -d "$git_dir/rebase-apply" ]] || die "A rebase is in progress. Finish/abort it first."

# Do not mix unknown pre-staged content into this checkpoint.
if ! git diff --cached --quiet --exit-code; then
  echo
  git diff --cached --name-status
  die "The index already contains staged changes. Unstage/review them first so this script cannot accidentally commit unknown staged work."
fi

info "Fetching origin/main before touching the index."
git remote get-url origin >/dev/null 2>&1 || die "Remote 'origin' is not configured."
git fetch origin main

git rev-parse --verify origin/main >/dev/null 2>&1 || die "origin/main could not be resolved after fetch."

if ! git merge-base --is-ancestor origin/main HEAD; then
  echo
  echo "Local HEAD:   $(git rev-parse --short HEAD)"
  echo "origin/main:  $(git rev-parse --short origin/main)"
  die "Local main is behind or diverged from origin/main. No files were staged or committed. Reconcile remote changes first."
fi
ok "origin/main is an ancestor of local HEAD; a normal push will not overwrite remote history."

info "Current working-tree summary before staging."
git status --short

# Remember which files are currently untracked so that only generated delivery
# artifacts can be selectively removed from the index after git add -A.
mapfile -d '' untracked_before < <(git ls-files --others --exclude-standard -z)

info "Staging the complete repository checkpoint."
git add -A

# Unstage only root-level transport/delivery artifacts generated during this
# implementation conversation. Leave them on disk and leave all real source,
# docs, migrations and tests staged.
excluded=()
for path in "${untracked_before[@]}"; do
  [[ "$path" != */* ]] || continue
  case "$path" in
    *.patch|*.diff|apply-*.sh|resume-*.sh|repair-*.sh)
      if git diff --cached --name-only -- "$path" | grep -Fqx "$path"; then
        git restore --staged -- "$path"
        excluded+=("$path")
      fi
      ;;
  esac
done

if ((${#excluded[@]})); then
  info "Kept temporary delivery artifacts OUT of the commit:"
  printf '  - %s\n' "${excluded[@]}"
fi

if git diff --cached --quiet --exit-code; then
  die "Nothing remains staged after excluding transport artifacts."
fi

info "Exact paths that WILL be committed."
git diff --cached --name-status

info "Checkpoint diff summary."
git diff --cached --stat

info "Validating staged whitespace/conflict integrity."
git diff --cached --check
ok "Staged diff integrity passed."

# Activate Node 24 when fnm/nvm is available. This mirrors the validated project flow.
current_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
if [[ "$current_major" != "24" ]]; then
  info "Repository requires Node 24; current Node is $(node -v 2>/dev/null || echo unavailable). Attempting activation."
  if command -v fnm >/dev/null 2>&1; then
    eval "$(fnm env --shell bash)"
    fnm use 24 >/dev/null
  elif command -v nvm >/dev/null 2>&1; then
    nvm use 24 >/dev/null
  else
    die "Node 24 is not active and neither fnm nor nvm is available."
  fi
fi

[[ "$(node -p 'process.versions.node.split(".")[0]')" == "24" ]] || die "Node major is still not 24."
pnpm_version="$(pnpm --version 2>/dev/null | tr -d '\r\n' || true)"
if [[ "$pnpm_version" != "11.21.0" ]]; then
  pnpm_version="$(corepack pnpm --version 2>/dev/null | tr -d '\r\n' || true)"
fi
[[ "$pnpm_version" == "11.21.0" ]] || die "Expected pnpm 11.21.0, resolved '${pnpm_version:-none}'."
ok "Toolchain shell: Node $(node -v), pnpm $pnpm_version."

info "Running final checkpoint governance gates."
node scripts/validation/verify-toolchain.mjs
PYTHONDONTWRITEBYTECODE=1 python docs/scripts/validate_parallel_implementation.py
PYTHONDONTWRITEBYTECODE=1 python docs/scripts/validate_pm_planning.py
PYTHONDONTWRITEBYTECODE=1 python docs/scripts/check_planning_closure.py
PYTHONDONTWRITEBYTECODE=1 python docs/scripts/check_implementation_authorization.py
PYTHONDONTWRITEBYTECODE=1 python docs/scripts/validate_worktree_hygiene.py --scope .
corepack pnpm verify:architecture
corepack pnpm verify:db
git diff --cached --check
ok "Final checkpoint validation passed."

info "Creating checkpoint commit."
commit_message="chore: checkpoint F001 hardening and parallel AI governance"
git commit -m "$commit_message"

commit_sha="$(git rev-parse HEAD)"
ok "Created commit ${commit_sha}."

info "Re-fetching origin/main immediately before push."
git fetch origin main
if ! git merge-base --is-ancestor origin/main HEAD; then
  warn "origin/main advanced after the commit was created."
  echo "Local commit is preserved: $commit_sha"
  die "Push was NOT attempted. Reconcile origin/main, then push the preserved commit."
fi

info "Pushing main to origin."
git push origin HEAD:main
ok "Push completed."

echo
echo "Checkpoint commit: $commit_sha"
echo "Branch: main"
echo "Remote: origin/main"
echo
echo "Temporary root-level delivery artifacts were intentionally left untracked and were not pushed."
echo "Execution-state reconciliation remains the next implementation-governance step."
