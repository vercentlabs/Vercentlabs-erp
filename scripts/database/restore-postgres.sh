#!/usr/bin/env bash
set -Eeuo pipefail

DATABASE_URL="${RESTORE_DATABASE_URL:-}"
BACKUP_FILE="${1:-}"
[[ -n "$DATABASE_URL" ]] || { echo "RESTORE_DATABASE_URL is required." >&2; exit 1; }
[[ -f "$BACKUP_FILE" ]] || { echo "Provide an existing custom-format backup file." >&2; exit 1; }
[[ "${CONFIRM_RESTORE:-}" == "RESTORE_VERCENTLABS_DATABASE" ]] || {
  echo "Set CONFIRM_RESTORE=RESTORE_VERCENTLABS_DATABASE after reviewing the target URL." >&2
  exit 1
}
command -v pg_restore >/dev/null || { echo "pg_restore is required." >&2; exit 1; }
command -v sha256sum >/dev/null || { echo "sha256sum is required." >&2; exit 1; }

if [[ -f "$BACKUP_FILE.sha256" ]]; then
  (
    cd "$(dirname "$BACKUP_FILE")"
    sha256sum -c "$(basename "$BACKUP_FILE").sha256"
  )
else
  echo "A matching .sha256 file is required before restore." >&2
  exit 1
fi

pg_restore --list "$BACKUP_FILE" >/dev/null
pg_restore \
  --dbname="$DATABASE_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  --single-transaction \
  "$BACKUP_FILE"

if command -v psql >/dev/null; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "ANALYZE;" >/dev/null
fi

echo "Restore completed and checksum verified. Run every database and live verifier before allowing traffic."
