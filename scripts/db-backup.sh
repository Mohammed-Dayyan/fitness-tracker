#!/usr/bin/env bash
# Back up the app's tables (schema "public") to a .dump file in backups/.
#
# There are TWO different backups. The script always says which one it made.
#
#   npm run db:backup
#       Backs up the LOCAL Docker database (docker compose service "db").
#       File: backups/fitness-local-<UTC time>.dump
#       This does NOT protect production.
#
#   BACKUP_DATABASE_URL="postgresql://..." npm run db:backup
#       Backs up the REMOTE database in that URL, e.g. production on Supabase.
#       Use the direct or session-pooler URL (port 5432), not the transaction
#       pooler (6543). File: backups/fitness-remote-<UTC time>.dump
#       Keep the URL out of your shell history: see docs/backup-restore.md.
#
# Uses the Postgres 17 client tools inside Docker, so nothing needs installing.
# Passwords are never printed. The output is pg_dump "custom" format, restorable
# with db-restore.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

DUMP_FLAGS=(--format=custom --schema=public --no-owner --no-privileges)

umask 077 # backups contain personal data: owner-only permissions
mkdir -p backups
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out=""
# A failed dump must not leave a partial file that looks like a backup.
trap '[[ -n "$out" ]] && rm -f "$out"' ERR

if [[ -n "${BACKUP_DATABASE_URL:-}" ]]; then
  refuse_localhost_url "$BACKUP_DATABASE_URL"
  kind="remote"
  out="backups/fitness-remote-$stamp.dump"
  echo "Backing up REMOTE database \"$(url_db "$BACKUP_DATABASE_URL")\" on $(url_host "$BACKUP_DATABASE_URL") ..."
  # -e NAME without a value passes the variable through without putting the
  # connection string on the docker command line.
  PGURL="$(libpq_url "$BACKUP_DATABASE_URL")" docker run --rm -e PGURL --add-host=host.docker.internal:host-gateway "$PG_IMAGE" \
    sh -c 'pg_dump "$PGURL" "$@"' sh "${DUMP_FLAGS[@]}" >"$out"
else
  kind="local"
  db="${BACKUP_DB_NAME:-fitness}"
  out="backups/fitness-local-$stamp.dump"
  echo "Backing up LOCAL Docker database \"$db\" (this is not a backup of production) ..."
  docker compose exec -T db pg_dump -U fitness -d "$db" "${DUMP_FLAGS[@]}" >"$out"
fi

# Prove the file is a complete, readable archive before reporting success.
if ! docker run --rm -i "$PG_IMAGE" pg_restore --list >/dev/null <"$out"; then
  echo "ERROR: $out is not a readable backup." >&2
  rm -f "$out"
  exit 1
fi
tables=$(docker run --rm -i "$PG_IMAGE" pg_restore --list <"$out" | grep -c " TABLE DATA " || true)
echo "Backup written ($kind): $out ($(du -h "$out" | cut -f1), $tables tables with data)"
