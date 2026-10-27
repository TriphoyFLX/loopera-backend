#!/usr/bin/env bash
# 1) Local pg_dump  2) optional upload to S3/R2 via AWS CLI
# Requires: aws CLI configured OR env AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_ENDPOINT_URL
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
[ -f "$ROOT/.env.production" ] && set -a && source "$ROOT/.env.production" && set +a

export BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
export DB_NAME="${DB_NAME:-loopera}"
export DB_USER="${DB_USER:-loopera}"
export RETENTION_DAYS="${RETENTION_DAYS:-14}"

"$ROOT/scripts/backup.sh"

LATEST="$(ls -1t "$BACKUP_DIR"/loopera_backup_*.sql.gz | head -1)"
BUCKET="${BACKUP_S3_BUCKET:-${S3_BUCKET:-}}"
PREFIX="${BACKUP_S3_PREFIX:-db-backups}"

if [ -z "$BUCKET" ]; then
  echo "[offsite] BACKUP_S3_BUCKET/S3_BUCKET not set — local only: $LATEST"
  exit 0
fi

ENDPOINT_ARGS=()
if [ -n "${S3_ENDPOINT:-}" ]; then
  ENDPOINT_ARGS+=(--endpoint-url "$S3_ENDPOINT")
fi

KEY="${PREFIX}/$(basename "$LATEST")"
echo "[offsite] uploading s3://${BUCKET}/${KEY}"
AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-${S3_ACCESS_KEY_ID:-}}" \
AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-${S3_SECRET_ACCESS_KEY:-}}" \
AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-${S3_REGION:-auto}}" \
  aws s3 cp "$LATEST" "s3://${BUCKET}/${KEY}" "${ENDPOINT_ARGS[@]}"

echo "[offsite] ok"
