# Loopera Backend

Node.js + Express + PostgreSQL бэкенд приложения Loopera.

## Установка

```bash
npm install
```

## Разработка

```bash
npm run dev
```

## Сборка

```bash
npm run build
```

## Запуск в продакшене

```bash
npm start
```

## Docker

```bash
# Запуск с PostgreSQL
docker-compose up -d

# Только бэкенд
docker-compose -f docker-compose.backend.yml up -d
```

## Структура

- `controllers/` - Контроллеры API
- `routes/` - Роуты Express
- `models/` - Модели данных
- `services/` - Бизнес-логика
- `middleware/` - Middleware
- `config/` - Конфигурация
- `migrations/` - Миграции БД
- `uploads/` - Загруженные файлы
