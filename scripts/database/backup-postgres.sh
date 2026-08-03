#!/usr/bin/env bash
set -Eeuo pipefail

DATABASE_URL="${BACKUP_DATABASE_URL:-${MIGRATION_DATABASE_URL:-}}"
[[ -n "$DATABASE_URL" ]] || {
  echo "BACKUP_DATABASE_URL or MIGRATION_DATABASE_URL is required." >&2
  exit 1
}
command -v pg_dump >/dev/null || { echo "pg_dump is required." >&2; exit 1; }
command -v pg_restore >/dev/null || { echo "pg_restore is required." >&2; exit 1; }
command -v sha256sum >/dev/null || { echo "sha256sum is required." >&2; exit 1; }
command -v node >/dev/null || { echo "Node.js is required to write the backup manifest." >&2; exit 1; }

BACKUP_DIR="${BACKUP_DIR:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT="${1:-$BACKUP_DIR/vercentlabs-control-$STAMP.dump}"
mkdir -p "$(dirname "$OUTPUT")"
umask 077

pg_dump \
  --dbname="$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$OUTPUT"

pg_restore --list "$OUTPUT" >/dev/null
sha256sum "$OUTPUT" > "$OUTPUT.sha256"

BACKUP_FILE="$OUTPUT" BACKUP_CREATED_AT="$STAMP" node --input-type=module <<'NODE'
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = process.env.BACKUP_FILE;
const checksum = fs.readFileSync(`${file}.sha256`, "utf8").trim().split(/\s+/)[0];
const stats = fs.statSync(file);
const manifest = {
  format: "postgresql-custom",
  createdAtUtc: process.env.BACKUP_CREATED_AT,
  fileName: file.split(/[\\/]/).pop(),
  sizeBytes: stats.size,
  sha256: checksum,
  pgDumpVersion: execFileSync("pg_dump", ["--version"], { encoding: "utf8" }).trim(),
  verifiedByPgRestoreList: true,
};
fs.writeFileSync(`${file}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
NODE

printf 'Verified PostgreSQL backup created: %s\n' "$OUTPUT"
printf 'Checksum: %s.sha256\n' "$OUTPUT"
printf 'Manifest: %s.manifest.json\n' "$OUTPUT"
