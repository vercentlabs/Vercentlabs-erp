#!/usr/bin/env bash
set -Eeuo pipefail

DATABASE_URL="${BACKUP_DATABASE_URL:-${MIGRATION_DATABASE_URL:-}}"
[[ -n "$DATABASE_URL" ]] || {
  echo "BACKUP_DATABASE_URL or MIGRATION_DATABASE_URL is required." >&2
  exit 1
}
command -v pg_dump >/dev/null || { echo "pg_dump is required." >&2; exit 1; }
command -v pg_restore >/dev/null || { echo "pg_restore is required." >&2; exit 1; }

BACKUP_DIR="${BACKUP_DIR:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT="${1:-$BACKUP_DIR/vercent-control-$STAMP.dump}"
mkdir -p "$(dirname "$OUTPUT")"
umask 077
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-privileges --file="$OUTPUT"
pg_restore --list "$OUTPUT" >/dev/null
if command -v sha256sum >/dev/null; then sha256sum "$OUTPUT" > "$OUTPUT.sha256"; fi
echo "Verified PostgreSQL backup created: $OUTPUT"
