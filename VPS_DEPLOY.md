# 🚀 Инструкция деплоя бэкенда на VPS

## 📋 Подготовка VPS

### 1. Подключитесь к VPS
```bash
ssh root@45.83.140.152
```

### 2. Установите Node.js 20
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 3. Установите PostgreSQL
```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
```

### 4. Установите Docker и Docker Compose
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

## 🗄️ Настройка PostgreSQL

### 1. Создайте базу данных
```bash
sudo -u postgres psql
CREATE DATABASE loopera;
CREATE USER loopera_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE loopera TO loopera_user;
\q
```

### 2. Настройте доступ
```bash
sudo nano /etc/postgresql/16/main/postgresql.conf
# Раскомментируйте: listen_addresses = 'localhost'

sudo nano /etc/postgresql/16/main/pg_hba.conf
# Добавьте: local   loopera   loopera_user   md5

sudo systemctl restart postgresql
```

## 📦 Деплой бэкенда

### 1. Склонируйте репозиторий
```bash
cd /opt
git clone https://github.com/TriphoyFLX/loopera-backend.git
cd loopera-backend
```

### 2. Создайте .env файл
```bash
nano .env
```

```env
# Server Configuration
PORT=5001

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=loopera
DB_USER=loopera_user
DB_PASSWORD=your_secure_password

# JWT Configuration
JWT_SECRET=super_secure_jwt_secret_key_minimum_32_characters_long

# Frontend URL (for CORS)
FRONTEND_URL=https://loopera-lpr.vercel.app

# Email Configuration
EMAIL_USER=roomop86@gmail.com
EMAIL_PASS=cnwm ldmu yqkt mvyb

# Environment
NODE_ENV=production
```

### 3. Установите зависимости
```bash
npm install
```

### 4. Соберите проект
```bash
npm run build
```

### 5. Создайте systemd сервис
```bash
sudo nano /etc/systemd/system/loopera-backend.service
```

```ini
[Unit]
Description=Loopera Backend
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/loopera-backend
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### 6. Запустите сервис
```bash
sudo systemctl daemon-reload
sudo systemctl enable loopera-backend
sudo systemctl start loopera-backend
```

## 🔥 Альтернативный деплой через Docker

### 1. Используйте готовый docker-compose.yml
```bash
cd /opt/loopera-backend
nano .env.production
```

```env
NODE_ENV=production
PORT=5001
DB_NAME=loopera
DB_USER=loopera_user
DB_PASSWORD=your_secure_password
JWT_SECRET=super_secure_jwt_secret_key_minimum_32_characters_long
FRONTEND_URL=https://loopera-lpr.vercel.app
EMAIL_USER=roomop86@gmail.com
EMAIL_PASS=cnwm ldmu yqkt mvyb
```

### 2. Запустите через Docker
```bash
docker-compose --env-file .env.production up -d
```

## ✅ Проверка работы

### 1. Проверьте статус сервиса
```bash
sudo systemctl status loopera-backend
# или для Docker
docker-compose ps
```

### 2. Проверьте логи
```bash
sudo journalctl -u loopera-backend -f
# или для Docker
docker-compose logs -f
```

### 3. Проверьте API
```bash
curl http://localhost:5001/api/health
```

### 4. Проверьте доступ извне
```bash
curl http://45.83.140.152:5001/api/health
```

## 🛡️ Настройка Firewall

```bash
sudo ufw allow ssh
sudo ufw allow 5001
sudo ufw enable
```

## 🔄 Обновление

### Для systemd:
```bash
cd /opt/loopera-backend
git pull
npm install
npm run build
sudo systemctl restart loopera-backend
```

### Для Docker:
```bash
cd /opt/loopera-backend
git pull
docker-compose --env-file .env.production up -d --build
```

## 📊 Мониторинг

### Проверка нагрузки:
```bash
htop
df -h
free -h
```

### Проверка логов:
```bash
tail -f /var/log/syslog
```

## 🚨 Траблшутинг

### Если не запускается:
1. Проверьте порт: `netstat -tlnp | grep 5001`
2. Проверьте логи: `sudo journalctl -u loopera-backend`
3. Проверьте БД: `sudo -u postgres psql -d loopera`

### Если нет доступа извне:
1. Проверьте firewall: `sudo ufw status`
2. Проверьте listened IP: `netstat -tlnp | grep 5001`

### Если проблемы с БД:
1. Проверьте подключение: `sudo -u postgres psql -d loopera`
2. Проверьте права: `\l` в psql

## 🎯 Готово!

После этих шагов бэкенд будет доступен по:
- API: `http://45.83.140.152:5001`
- Health: `http://45.83.140.152:5001/api/health`
