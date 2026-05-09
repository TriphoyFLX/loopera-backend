#!/bin/bash

# Automated Daily Backup Script for Loopera
# This script should be run via cron daily

BACKUP_DIR="/root/loopera-backend/backups"
DB_NAME="loopera"
DB_USER="matveevdima"
RETENTION_DAYS=7
LOG_FILE="/root/loopera-backend/logs/backup.log"

# Create backup directory if not exists
mkdir -p $BACKUP_DIR
mkdir -p $(dirname $LOG_FILE)

# Function to log with timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> $LOG_FILE
}

log "Starting automated database backup..."

# Create backup filename with timestamp
BACKUP_FILE="$BACKUP_DIR/loopera_backup_$(date +%Y%m%d_%H%M%S).sql"

# Create backup
docker exec loopera-postgres pg_dump -U $DB_USER -d $DB_NAME > $BACKUP_FILE 2>> $LOG_FILE

if [ $? -eq 0 ]; then
    log "Backup created successfully: $BACKUP_FILE"
    
    # Compress backup
    gzip $BACKUP_FILE 2>> $LOG_FILE
    log "Backup compressed: ${BACKUP_FILE}.gz"
    
    # Remove old backups (keep last 7 days)
    DELETED_COUNT=$(find $BACKUP_DIR -name "loopera_backup_*.sql.gz" -mtime +$RETENTION_DAYS -delete | wc -l)
    log "Old backups removed (older than $RETENTION_DAYS days): $DELETED_COUNT files"
    
    # Get current database stats
    LOOP_COUNT=$(docker exec loopera-postgres psql -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(*) FROM loops;" 2>> $LOG_FILE)
    USER_COUNT=$(docker exec loopera-postgres psql -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(*) FROM users;" 2>> $LOG_FILE)
    PACK_COUNT=$(docker exec loopera-postgres psql -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(*) FROM sound_packs;" 2>> $LOG_FILE)
    
    log "Database stats: Loops: $LOOP_COUNT, Users: $USER_COUNT, Packs: $PACK_COUNT"
    log "Backup process completed successfully."
    
else
    log "Backup failed!"
    exit 1
fi
