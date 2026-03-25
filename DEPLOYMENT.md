# 🚀 Loopera Production Deployment Guide

## 📋 Prerequisites

- Docker & Docker Compose installed
- VPS with at least 2GB RAM
- Domain name configured (optional)
- SSL certificate (recommended for production)

## 🔧 Configuration

1. **Setup Environment Variables:**
   ```bash
   cp .env.production.example .env.production
   ```

2. **Update .env.production with your values:**
   - `DB_PASSWORD`: Secure database password
   - `JWT_SECRET`: Minimum 32 characters
   - `FRONTEND_URL`: Your Vercel domain
   - `EMAIL_USER`: Your Gmail
   - `EMAIL_PASS`: Gmail app password

## 🚀 Quick Deploy

```bash
# Make deploy script executable
chmod +x deploy.sh

# Run deployment
./deploy.sh
```

## 🐳 Manual Deploy

```bash
# Using docker-compose
docker-compose --env-file .env.production up --build -d

# Or step by step:
docker-compose down
docker-compose --env-file .env.production build
docker-compose --env-file .env.production up -d
```

## 🌐 Access Points

After deployment:

- **Frontend**: `http://your-server-ip` or `https://your-domain.com`
- **Backend API**: `http://your-server-ip/api` or `https://your-domain.com/api`
- **Health Check**: `http://your-server-ip/api/health`
- **PgAdmin**: `http://your-server-ip:5050` (if enabled)

## 📊 Monitoring

### Check Service Status:
```bash
docker-compose ps
```

### View Logs:
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f postgres
```

### Health Checks:
```bash
# Backend health
curl http://localhost:5001/api/health

# Database connection
docker-compose exec postgres pg_isready -U loopera_user -d loopera
```

## 🔧 Troubleshooting

### Common Issues:

1. **Database Connection Failed**:
   - Check `DB_PASSWORD` in .env.production
   - Verify postgres container is running
   - Check database logs: `docker-compose logs postgres`

2. **Frontend Not Loading**:
   - Check `VITE_API_URL` points to backend
   - Verify nginx configuration
   - Check frontend logs: `docker-compose logs frontend`

3. **CORS Errors**:
   - Verify `FRONTEND_URL` matches your domain
   - Check backend logs for CORS errors

4. **Email Not Working**:
   - Use Gmail App Password (not regular password)
   - Enable 2FA on Gmail account
   - Check `EMAIL_USER` and `EMAIL_PASS`

### Reset Everything:
```bash
# Stop and remove all containers
docker-compose down -v

# Remove all images
docker system prune -a

# Redeploy
./deploy.sh
```

## 🔒 Security Recommendations

1. **Change Default Passwords**:
   - Database password
   - JWT secret
   - PgAdmin password

2. **Use HTTPS**:
   - Configure SSL certificate
   - Update `FRONTEND_URL` to https://

3. **Firewall Rules**:
   ```bash
   # Allow HTTP/HTTPS
   sudo ufw allow 80
   sudo ufw allow 443
   
   # Allow database (local only)
   sudo ufw deny 5432
   ```

4. **Regular Updates**:
   ```bash
   # Update containers
   docker-compose pull
   docker-compose up -d
   ```

## 📱 Vercel Frontend Deployment

For frontend-only deployment on Vercel:

1. **Configure Environment** in Vercel dashboard:
   - `VITE_API_URL`: `https://your-backend-domain.com/api`

2. **Deploy**:
   ```bash
   cd frontend-repo
   npm run build
   vercel --prod
   ```

## 📈 Scaling

### For High Traffic:

1. **Add Redis** for caching
2. **Use Load Balancer** for multiple backend instances
3. **Enable CDN** for static files
4. **Monitor Resources** with Prometheus/Grafana

## 🔄 Backup Strategy

```bash
# Database backup
docker-compose exec postgres pg_dump -U loopera_user loopera > backup.sql

# Uploads backup
tar -czf uploads-backup.tar.gz uploads/

# Automated backup script (add to crontab)
0 2 * * * /path/to/backup-script.sh
```
