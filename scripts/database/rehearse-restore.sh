#!/usr/bin/env bash
set -Eeuo pipefail

[[ -n "${BACKUP_DATABASE_URL:-${MIGRATION_DATABASE_URL:-}}" ]] || {
  echo "BACKUP_DATABASE_URL or MIGRATION_DATABASE_URL is required." >&2
  exit 1
}
[[ -n "${RESTORE_REHEARSAL_DATABASE_URL:-}" ]] || {
  echo "RESTORE_REHEARSAL_DATABASE_URL is required and must point to a disposable database." >&2
  exit 1
}
[[ "${CONFIRM_RESTORE_REHEARSAL:-}" == "REHEARSE_ON_DISPOSABLE_DATABASE" ]] || {
  echo "Set CONFIRM_RESTORE_REHEARSAL=REHEARSE_ON_DISPOSABLE_DATABASE after confirming the target is disposable." >&2
  exit 1
}

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
BACKUP_FILE="$TMP_DIR/vercentlabs-restore-rehearsal.dump"

bash scripts/database/backup-postgres.sh "$BACKUP_FILE"
RESTORE_DATABASE_URL="$RESTORE_REHEARSAL_DATABASE_URL" \
CONFIRM_RESTORE=RESTORE_VERCENTLABS_DATABASE \
bash scripts/database/restore-postgres.sh "$BACKUP_FILE"

DATABASE_URL="$RESTORE_REHEARSAL_DATABASE_URL" ENFORCE_RESTRICTED_DB_ROLE=false \
  corepack pnpm --filter @vercentlabs/web verify:database
DATABASE_URL="$RESTORE_REHEARSAL_DATABASE_URL" ENFORCE_RESTRICTED_DB_ROLE=false \
  corepack pnpm --filter @vercentlabs/web verify:tenant-database
DATABASE_URL="$RESTORE_REHEARSAL_DATABASE_URL" ENFORCE_RESTRICTED_DB_ROLE=false \
  corepack pnpm --filter @vercentlabs/web verify:crm-database
DATABASE_URL="$RESTORE_REHEARSAL_DATABASE_URL" ENFORCE_RESTRICTED_DB_ROLE=false \
  corepack pnpm --filter @vercentlabs/web verify:sales-database
DATABASE_URL="$RESTORE_REHEARSAL_DATABASE_URL" ENFORCE_RESTRICTED_DB_ROLE=false \
  corepack pnpm --filter @vercentlabs/web verify:accounting-database
DATABASE_URL="$RESTORE_REHEARSAL_DATABASE_URL" ENFORCE_RESTRICTED_DB_ROLE=false \
  corepack pnpm --filter @vercentlabs/web verify:procurement-database

echo "Backup/restore rehearsal passed on the disposable target. Preserve the generated logs as release evidence."
