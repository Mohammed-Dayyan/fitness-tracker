# Shared helpers for the db-*.sh scripts. Source this file; do not run it.
# Nothing here ever prints a password: URLs are only ever shown as host/database.

PG_IMAGE="postgres:17-alpine"

# libpq (pg_dump, psql, pg_restore) rejects query parameters that only Prisma
# understands, which commonly appear in copied connection strings.
libpq_url() {
  local u="$1" base query p
  local kept=()
  base="${u%%\?*}"
  query=""
  [[ "$u" == *\?* ]] && query="${u#*\?}"
  local IFS='&'
  read -ra parts <<<"$query"
  for p in "${parts[@]}"; do
    case "$p" in
      "" | schema=* | pgbouncer=* | connection_limit=* | pool_timeout=*) ;;
      *) kept+=("$p") ;;
    esac
  done
  if ((${#kept[@]})); then echo "$base?${kept[*]}"; else echo "$base"; fi
}

# host:port of a connection URL, without credentials.
url_host() {
  local rest="${1#*://}"
  rest="${rest#*@}"
  echo "${rest%%/*}"
}

# database name of a connection URL.
url_db() {
  local rest="${1#*://}"
  rest="${rest#*/}"
  echo "${rest%%\?*}"
}

# Inside a Docker container "localhost" is the container itself, not your machine.
refuse_localhost_url() {
  case "$(url_host "$1")" in
    localhost* | 127.* | "[::1]"*)
      echo "ERROR: the URL's host is $(url_host "$1"), which inside Docker means the container itself." >&2
      echo "       To reach a database on this machine use host.docker.internal instead of localhost." >&2
      return 1
      ;;
  esac
}
