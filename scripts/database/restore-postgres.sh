#!/usr/bin/env bash
set -Eeuo pipefail

DATABASE_URL="${RESTORE_DATABASE_URL:-}"
BACKUP_FILE="${1:-}"
[[ -n "$DATABASE_URL" ]] || { echo "RESTORE_DATABASE_URL is required." >&2; exit 1; }
[[ -f "$BACKUP_FILE" ]] || { echo "Provide an existing custom-format backup file." >&2; exit 1; }
[[ "${CONFIRM_RESTORE:-}" == "RESTORE_VERCENT_DATABASE" ]] || {
  echo "Set CONFIRM_RESTORE=RESTORE_VERCENT_DATABASE after reviewing the target URL." >&2
  exit 1
}
command -v pg_restore >/dev/null || { echo "pg_restore is required." >&2; exit 1; }
pg_restore --list "$BACKUP_FILE" >/dev/null
pg_restore --dbname="$DATABASE_URL" --clean --if-exists --no-owner --no-privileges "$BACKUP_FILE"
echo "Restore completed. Run all database verifiers before allowing traffic."
