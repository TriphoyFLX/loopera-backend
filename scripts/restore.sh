#!/usr/bin/env bash
# Restore Postgres from a gzip/sql dump created by backup.sh
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
DB_NAME="${DB_NAME:-loopera}"
DB_USER="${DB_USER:-loopera}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-loopera-postgres}"

if [ $# -eq 0 ]; then
  echo "Usage: $0 <backup_file.sql|.sql.gz>"
  echo "Available:"
  ls -1t "$BACKUP_DIR"/loopera_backup_*.sql.gz 2>/dev/null | head -10 || true
  exit 1
fi

BACKUP_FILE="$1"
if [ ! -f "$BACKUP_FILE" ]; then
  echo "Not found: $BACKUP_FILE"
  exit 1
fi

mkdir -p "$BACKUP_DIR"
echo "[restore] safety dump before restore…"
docker exec "$POSTGRES_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-acl \
  | gzip > "$BACKUP_DIR/loopera_pre_restore_$(date +%Y%m%d_%H%M%S).sql.gz"

RESTORE_FILE="/tmp/loopera_restore_$$.sql"
if [[ "$BACKUP_FILE" == *.gz ]]; then
  gunzip -c "$BACKUP_FILE" > "$RESTORE_FILE"
else
  cp "$BACKUP_FILE" "$RESTORE_FILE"
fi

echo "[restore] recreating database ${DB_NAME}…"
docker exec "$POSTGRES_CONTAINER" psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();" \
  -c "DROP DATABASE IF EXISTS ${DB_NAME};" \
  -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"

docker exec -i "$POSTGRES_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 < "$RESTORE_FILE"
rm -f "$RESTORE_FILE"
echo "[restore] done"
