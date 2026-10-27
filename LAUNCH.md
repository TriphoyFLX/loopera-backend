# Loopera — запуск на VPS (Phase C)

Чеклист, чтобы оплатить сервер и открыть **https://loopera.ru**.

## 0. Что уже в коде

- Docker Compose: Postgres + Redis + Backend + Melody + Frontend + **Caddy (HTTPS)**
- Backend не торчит наружу (`:5001` только внутри сети)
- Graceful shutdown, `/api/health` + `/api/readyz`
- Rate-limit через Redis, object storage (R2/S3) опционально
- Планы Free / Basic / Pro / Business, YooKassa, Resend/SMTP
- Бэкапы: `scripts/backup.sh`, offsite `scripts/backup_offsite.sh`

## 1. VPS (минимум)

| | Soft launch | Комфорт |
|---|---|---|
| CPU / RAM | 2 vCPU / 4 GB | 4 vCPU / 8 GB |
| Диск | 40 GB SSD | 80 GB+ |
| ОС | Ubuntu 22.04/24.04 | |
| Порты | **22, 80, 443** | 5001/5432/5050 **закрыть** |

```bash
curl -fsSL https://get.docker.com | sh
sudo apt install -y docker-compose-plugin git
```

DNS: `A` записи `loopera.ru` и `www` → IP сервера.

## 2. Код и секреты

Положи рядом `backend-repo/`, `frontend-repo/`, `melody-service/` (как в монорепо).

```bash
cd backend-repo
cp .env.production.example .env.production
nano .env.production
```

Обязательно:

```bash
openssl rand -hex 48   # → JWT_SECRET
openssl rand -hex 24   # → DB_PASSWORD
```

Заполни:

- `FRONTEND_URL=https://loopera.ru`
- `DOMAIN=loopera.ru`
- `ACME_EMAIL=ты@loopera.ru`
- `YOOKASSA_SHOP_ID` + `YOOKASSA_SECRET_KEY`
- `RESEND_API_KEY` + `EMAIL_FROM=noreply@loopera.ru` (домен верифицирован в Resend)
- `GOOGLE_CLIENT_ID` / `SECRET` / redirect `https://loopera.ru/api/auth/google/callback`
- Опционально R2: `S3_*` + `MEDIA_CDN_URL` / `VITE_MEDIA_CDN_URL`
- Опционально `SENTRY_DSN` + `VITE_SENTRY_DSN`

> Старый `VPS_DEPLOY.md` содержал утёкший Gmail app-password — **смени пароль**, больше не используй SMTP через личный Gmail в проде.

## 3. Деплой

```bash
cd backend-repo
chmod +x deploy.sh scripts/*.sh
./deploy.sh
# или:
docker compose --env-file .env.production up -d --build
```

Проверки:

```bash
curl -fsS https://loopera.ru/api/health
curl -fsS https://loopera.ru/api/readyz
curl -fsS https://loopera.ru/healthz
```

## 4. Платежи и почта

1. YooKassa → webhook: `https://loopera.ru/api/shop/yookassa/webhook` (и billing webhook, если используешь)
2. Тестовый платёж: top-up / pack / подписка Basic
3. Регистрация → письмо с кодом (не в логах контейнера)

## 5. Медиа (рекомендуется до трафика)

```bash
# после заполнения S3_*
docker compose exec backend node scripts/sync-uploads-to-s3.mjs
# или с хоста, если volume смонтирован
```

Включи `MEDIA_CDN_URL`, пересобери frontend с `VITE_MEDIA_CDN_URL`.

## 6. Бэкапы (cron)

```cron
15 3 * * * cd /opt/loopera/backend-repo && ./scripts/backup_offsite.sh >> /var/log/loopera-backup.log 2>&1
```

Раз в месяц: dry-run `./scripts/restore.sh backups/….sql.gz` на staging.

## 7. Uptime

Мониторь `https://loopera.ru/api/readyz` (UptimeRobot / Better Stack).  
Алерт в Telegram/почту при 503.

## 8. Go-live smoke

- [ ] HTTPS зелёный, www → apex или оба работают
- [ ] Регистрация + verify email
- [ ] Google login
- [ ] Загрузка лупа / скачивание
- [ ] Покупка пака / подписка
- [ ] Админка только под твоим аккаунтом
- [ ] `/robots.txt` закрывает `/admin`, `/chats`, `/auth`
- [ ] Бэкап за ночь лежит локально (+ в R2)

## Не нужно для первого запуска

WebSocket-чаты, SSR OG, antifraud virus-scan, HttpOnly cookies — это следующий рост, не блокер оплаты сервера.
