#!/usr/bin/env bash
# Restore a backup made by db-backup.sh.
#
#   npm run db:restore -- backups/FILE.dump
#       Safe default: restores into a scratch LOCAL database "fitness_restore"
#       (recreated each time) and prints row counts, so you can check the
#       backup without touching real data. Works for local AND production dumps.
#
#   npm run db:restore -- backups/FILE.dump --into fitness
#       Replaces the contents of the LOCAL database "fitness". Asks you to
#       type the database name. Stop the app first.
#
#   RESTORE_DATABASE_URL="postgresql://..." npm run db:restore -- backups/FILE.dump --remote
#       Replaces the app tables in a REMOTE database (e.g. Supabase, using the
#       direct or session-pooler URL). Shows which database it is about to
#       replace and asks you to type "restore". Passwords are never printed.
#
# Restores run in a single transaction: if anything fails, nothing changes.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

RESTORE_FLAGS=(--no-owner --no-privileges --clean --if-exists --single-transaction --exit-on-error)

file="${1:-}"
if [[ -z "$file" || ! -f "$file" ]]; then
  echo "Usage: npm run db:restore -- <backup.dump> [--into <local database> | --remote]" >&2
  exit 2
fi
shift
mode="scratch"
target="fitness_restore"
if [[ "${1:-}" == "--into" ]]; then
  mode="local"
  target="${2:?--into needs a database name}"
elif [[ "${1:-}" == "--remote" ]]; then
  mode="remote"
fi

docker run --rm -i "$PG_IMAGE" pg_restore --list >/dev/null <"$file" || {
  echo "ERROR: $file is not a readable backup." >&2
  exit 1
}

psql_local() { docker compose exec -T db psql -U fitness -v ON_ERROR_STOP=1 "$@"; }

case "$mode" in
  scratch)
    echo "Restoring $file into scratch LOCAL database \"$target\" (nothing else is touched) ..."
    psql_local -d postgres -q -c "SET client_min_messages = warning" \
      -c "DROP DATABASE IF EXISTS $target WITH (FORCE)" -c "CREATE DATABASE $target OWNER fitness"
    docker compose exec -T db pg_restore -U fitness -d "$target" "${RESTORE_FLAGS[@]}" <"$file"
    ;;
  local)
    read -r -p "This REPLACES all app data in LOCAL database \"$target\". Type the database name to continue: " answer
    [[ "$answer" == "$target" ]] || { echo "Cancelled."; exit 1; }
    echo "Restoring $file into LOCAL database \"$target\" ..."
    docker compose exec -T db pg_restore -U fitness -d "$target" "${RESTORE_FLAGS[@]}" <"$file"
    ;;
  remote)
    [[ -n "${RESTORE_DATABASE_URL:-}" ]] || { echo "Set RESTORE_DATABASE_URL for --remote." >&2; exit 2; }
    refuse_localhost_url "$RESTORE_DATABASE_URL"
    where="\"$(url_db "$RESTORE_DATABASE_URL")\" on $(url_host "$RESTORE_DATABASE_URL")"
    read -r -p "This REPLACES all app data in the REMOTE database $where. Type \"restore\" to continue: " answer
    [[ "$answer" == "restore" ]] || { echo "Cancelled."; exit 1; }
    echo "Restoring $file into the REMOTE database $where ..."
    PGURL="$(libpq_url "$RESTORE_DATABASE_URL")" docker run --rm -i -e PGURL --add-host=host.docker.internal:host-gateway "$PG_IMAGE" \
      sh -c 'pg_restore -d "$PGURL" "$@"' sh "${RESTORE_FLAGS[@]}" <"$file"
    echo "Restore complete. Row counts in the REMOTE database $where:"
    PGURL="$(libpq_url "$RESTORE_DATABASE_URL")" docker run --rm -i -e PGURL --add-host=host.docker.internal:host-gateway "$PG_IMAGE" \
      sh -c 'psql "$PGURL" -v ON_ERROR_STOP=1 -At -F " | "' <scripts/counts.sql
    exit 0
    ;;
esac

echo "Restore complete. Row counts in LOCAL database \"$target\":"
psql_local -d "$target" -At -F " | " <scripts/counts.sql
