#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
output_arg="${1:-project-code.txt}"

if [[ "$output_arg" = /* ]]; then
  output_file="$output_arg"
else
  output_file="$project_root/$output_arg"
fi

mkdir -p "$(dirname "$output_file")"
output_file="$(cd "$(dirname "$output_file")" && pwd)/$(basename "$output_file")"
temp_file="${output_file}.tmp"
trap 'rm -f "$temp_file"' EXIT

is_source_file() {
  local name="$1"

  case "$name" in
    Dockerfile|Dockerfile.*|Containerfile|Makefile|CMakeLists.txt|Jenkinsfile|Procfile)
      return 0
      ;;
    *.js|*.jsx|*.mjs|*.cjs|*.ts|*.tsx|*.mts|*.cts|*.vue|*.svelte|*.astro|\
    *.py|*.pyi|*.rb|*.php|*.java|*.kt|*.kts|*.go|*.rs|*.c|*.h|*.cc|*.cpp|\
    *.cs|*.fs|*.fsx|*.swift|*.scala|*.sh|*.bash|*.zsh|*.ps1|*.sql|*.graphql|\
    *.gql|*.proto|*.html|*.htm|*.css|*.scss|*.sass|*.less|*.xml|*.xsl|*.json|\
    *.jsonc|*.yaml|*.yml|*.toml|*.ini|*.conf|*.config|*.properties|*.gradle|\
    *.md|*.mdx|*.txt|*.prisma|*.tf|*.tfvars)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

{
  printf '# Project source export\n'
  printf '# Root: %s\n' "$(basename "$project_root")"
  printf '# Generated: %s\n\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
} > "$temp_file"

file_count=0
while IFS= read -r -d '' file; do
  absolute_file="$(cd "$(dirname "$file")" && pwd)/$(basename "$file")"
  [[ "$absolute_file" == "$output_file" || "$absolute_file" == "$temp_file" ]] && continue

  relative_file="${file#./}"
  file_name="$(basename "$file")"

  # Keep credentials and dependency lockfiles out of the shareable code bundle.
  case "$file_name" in
    .env|.env.*|*.pem|*.key|*.p12|*.pfx|*.lock|package-lock.json|pnpm-lock.yaml|yarn.lock)
      continue
      ;;
  esac

  is_source_file "$file_name" || continue
  grep -Iq . "$file" || continue

  printf '\n================================================================================\n' >> "$temp_file"
  printf 'FILE: %s\n' "$relative_file" >> "$temp_file"
  printf '================================================================================\n\n' >> "$temp_file"
  cat "$file" >> "$temp_file"
  printf '\n' >> "$temp_file"
  ((file_count += 1))
done < <(
  cd "$project_root"
  find . \
    \( -type d \( \
      -name .git -o -name node_modules -o -name .pnpm -o -name .turbo -o \
      -name dist -o -name build -o -name coverage -o -name .next -o \
      -name .expo -o -name .cache -o -name .gradle -o -name Pods -o \
      -name target -o -name vendor -o -name __pycache__ \
    \) -prune \) -o -type f -print0 | sort -z
)

mv -f "$temp_file" "$output_file"
trap - EXIT

printf 'Exported %d source files to %s\n' "$file_count" "$output_file"
