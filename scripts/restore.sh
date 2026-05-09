#!/bin/bash

# Database Restore Script for Loopera
# Restores database from backup file

BACKUP_DIR="/root/loopera-backend/backups"
DB_NAME="loopera"
DB_USER="matveevdima"

if [ $# -eq 0 ]; then
    echo "Usage: $0 <backup_file>"
    echo "Available backups:"
    ls -la $BACKUP_DIR/loopera_backup_*.sql.gz | tail -5
    exit 1
fi

BACKUP_FILE=$1

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo "Backup file not found: $BACKUP_FILE"
    exit 1
fi

echo "Restoring database from: $BACKUP_FILE"

# Extract backup if compressed
if [[ $BACKUP_FILE == *.gz ]]; then
    echo "Decompressing backup..."
    gunzip -c $BACKUP_FILE > /tmp/restore.sql
    RESTORE_FILE="/tmp/restore.sql"
else
    RESTORE_FILE=$BACKUP_FILE
fi

# Create backup before restore
echo "Creating pre-restore backup..."
docker exec loopera-postgres pg_dump -U $DB_USER -d $DB_NAME > $BACKUP_DIR/loopera_pre_restore_$(date +%Y%m%d_%H%M%S).sql

# Drop and recreate database
echo "Restoring database..."
docker exec loopera-postgres psql -U $DB_USER -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME;"
docker exec loopera-postgres psql -U $DB_USER -d postgres -c "CREATE DATABASE $DB_NAME;"

# Restore from backup
docker exec loopera-postgres psql -U $DB_USER -d $DB_NAME < $RESTORE_FILE

if [ $? -eq 0 ]; then
    echo "Database restored successfully!"
    
    # Clean up temp file
    [ -f "/tmp/restore.sql" ] && rm /tmp/restore.sql
    
else
    echo "Database restore failed!"
    exit 1
fi

echo "Restore process completed."
