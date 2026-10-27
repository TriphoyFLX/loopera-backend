#!/usr/bin/env bash
# Local Postgres dump for Loopera (Docker).
# Env (optional): BACKUP_DIR, DB_NAME, DB_USER, RETENTION_DAYS, POSTGRES_CONTAINER
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
DB_NAME="${DB_NAME:-loopera}"
DB_USER="${DB_USER:-loopera}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-loopera-postgres}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/loopera_backup_${STAMP}.sql"

echo "[backup] dumping ${DB_NAME} from ${POSTGRES_CONTAINER}…"
docker exec "$POSTGRES_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-acl > "$BACKUP_FILE"
gzip -f "$BACKUP_FILE"
echo "[backup] wrote ${BACKUP_FILE}.gz"

find "$BACKUP_DIR" -name 'loopera_backup_*.sql.gz' -mtime +"$RETENTION_DAYS" -delete
echo "[backup] pruned backups older than ${RETENTION_DAYS}d"
