# VPS deploy (legacy notes)

> **Актуальная инструкция:** [LAUNCH.md](./LAUNCH.md)  
> Этот файл оставлен как короткий указатель. Старые примеры с паролями удалены — **не копируй секреты из git-истории**, ротируй всё, что когда-либо светилось в доках.

## Быстрый путь

1. Ubuntu VPS + Docker Engine + Compose plugin  
2. DNS `loopera.ru` / `www` → IP  
3. `cp .env.production.example .env.production` и заполни секреты  
4. `./deploy.sh` из `backend-repo/`  
5. Открой только **22 / 80 / 443** (ufw)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## Важно

- Backend **не** публикуй на `:5001` наружу — Caddy → frontend → backend  
- Postgres / Redis / PgAdmin не открывай в интернет  
- Gmail app-password из старых гайдов считать скомпрометированным — используй Resend + домен  
- JWT: `openssl rand -hex 48`
