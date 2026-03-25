#!/bin/bash

# Loopera Production Deployment Script
# ===========================================

set -e

echo "🚀 Starting Loopera Production Deployment..."

# Check if .env.production exists
if [ ! -f ".env.production" ]; then
    echo "❌ .env.production file not found!"
    echo "Please copy .env.production.example to .env.production and update values"
    exit 1
fi

# Load production environment
export $(cat .env.production | xargs)

echo "📦 Building and deploying services..."

# Stop existing services
echo "🛑 Stopping existing services..."
docker-compose down

# Build and start services
echo "🔨 Building and starting services..."
docker-compose --env-file .env.production up --build -d

# Wait for services to be healthy
echo "⏳ Waiting for services to be healthy..."
sleep 30

# Check service status
echo "🔍 Checking service status..."
docker-compose ps

# Show logs
echo "📋 Showing recent logs..."
docker-compose logs --tail=50

echo "✅ Deployment completed!"
echo ""
echo "🌐 Frontend: http://localhost"
echo "🔧 Backend API: http://localhost:5001"
echo "🗄️  PgAdmin: http://localhost:5050 (if enabled)"
echo ""
echo "📊 To check logs: docker-compose logs -f [service-name]"
echo "🛑 To stop: docker-compose down"
