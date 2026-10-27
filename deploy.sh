#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f .env.production ]; then
  echo "Missing .env.production — copy from .env.production.example and fill secrets."
  exit 1
fi

# shellcheck disable=SC1091
set -a
source .env.production
set +a

if [ -z "${JWT_SECRET:-}" ] || [ "${#JWT_SECRET}" -lt 48 ]; then
  echo "JWT_SECRET must be ≥48 chars (openssl rand -hex 48)"
  exit 1
fi

if [ -z "${DB_PASSWORD:-}" ]; then
  echo "DB_PASSWORD is required"
  exit 1
fi

echo "[deploy] building & starting…"
docker compose --env-file .env.production up -d --build

echo "[deploy] waiting for health…"
for i in $(seq 1 40); do
  if docker compose exec -T backend curl -fsS http://localhost:5001/api/readyz >/dev/null 2>&1; then
    echo "[deploy] backend ready"
    break
  fi
  if [ "$i" -eq 40 ]; then
    echo "[deploy] backend not ready — logs:"
    docker compose logs --tail=80 backend
    exit 1
  fi
  sleep 3
done

docker compose ps
echo ""
echo "Public site: https://${DOMAIN:-loopera.ru}"
echo "Health:      https://${DOMAIN:-loopera.ru}/api/health"
echo "Logs:        docker compose logs -f"
echo "Stop:        docker compose down"
