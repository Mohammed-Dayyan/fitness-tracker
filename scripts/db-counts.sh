#!/usr/bin/env bash
# Print the row count of every app table, to compare a database with its backup.
#
#   npm run db:counts                       LOCAL Docker database "fitness"
#   npm run db:counts -- fitness_restore    another LOCAL database by name
#   COUNT_DATABASE_URL="postgresql://..." npm run db:counts     a REMOTE database
#
# Read-only. Passwords are never printed.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

if [[ -n "${COUNT_DATABASE_URL:-}" ]]; then
  refuse_localhost_url "$COUNT_DATABASE_URL"
  echo "Row counts, REMOTE database \"$(url_db "$COUNT_DATABASE_URL")\" on $(url_host "$COUNT_DATABASE_URL"):"
  PGURL="$(libpq_url "$COUNT_DATABASE_URL")" docker run --rm -i -e PGURL --add-host=host.docker.internal:host-gateway "$PG_IMAGE" \
    sh -c 'psql "$PGURL" -v ON_ERROR_STOP=1 -At -F " | "' <scripts/counts.sql
else
  db="${1:-fitness}"
  echo "Row counts, LOCAL Docker database \"$db\":"
  docker compose exec -T db psql -U fitness -d "$db" -v ON_ERROR_STOP=1 -At -F " | " <scripts/counts.sql
fi
