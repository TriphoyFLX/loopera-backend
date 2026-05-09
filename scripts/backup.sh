#!/bin/bash

# Database Backup Script for Loopera
# Creates daily backups with retention policy

BACKUP_DIR="/root/loopera-backend/backups"
DB_NAME="loopera"
DB_USER="matveevdima"
RETENTION_DAYS=7

# Create backup directory if not exists
mkdir -p $BACKUP_DIR

# Create backup filename with timestamp
BACKUP_FILE="$BACKUP_DIR/loopera_backup_$(date +%Y%m%d_%H%M%S).sql"

echo "Starting database backup..."

# Create backup
docker exec loopera-postgres pg_dump -U $DB_USER -d $DB_NAME > $BACKUP_FILE

if [ $? -eq 0 ]; then
    echo "Backup created successfully: $BACKUP_FILE"
    
    # Compress backup
    gzip $BACKUP_FILE
    echo "Backup compressed: ${BACKUP_FILE}.gz"
    
    # Remove old backups (keep last 7 days)
    find $BACKUP_DIR -name "loopera_backup_*.sql.gz" -mtime +$RETENTION_DAYS -delete
    echo "Old backups removed (older than $RETENTION_DAYS days)"
    
else
    echo "Backup failed!"
    exit 1
fi

echo "Backup process completed."
