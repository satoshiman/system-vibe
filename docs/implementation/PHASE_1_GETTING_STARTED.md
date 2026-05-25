# SystemVibe Phase 1: Foundation - Getting Started Guide

**Duration**: 1 week | **Goal**: Get the basic infrastructure working

After Phase 1, you'll have:

- ✅ Docker Compose running all services
- ✅ NestJS API server connected to PostgreSQL
- ✅ Redis operational
- ✅ Health check endpoint returning system status
- ✅ Structured logging setup
- ✅ Development environment ready

**Note**: This guide has been updated to reflect the current implementation. Phase 1 is complete and Phase 2 (Authentication) has been implemented.

---

## Prerequisites

**Install these first**:

```bash
# Node.js & npm
node --version    # Should be v18+
npm --version     # Should be v9+

# Docker & Docker Compose
docker --version        # Docker 20.10+
docker compose version # Docker Compose 2.0+

# Git
git --version    # Latest version
```

**Recommended Tools**:

- VS Code with TypeScript extension
- Postman or Insomnia (for testing API)
- DBeaver or pgAdmin (for database inspection)
- Redis Commander (for Redis inspection - included in docker-compose)

---

## Step 1: Create Project Structure

```bash
# Create project directory
mkdir systemvibe && cd systemvibe

# Initialize git
git init
git config user.name "Your Name"
git config user.email "your@email.com"

# Create .gitignore
cat > .gitignore << 'EOF'
node_modules/
dist/
build/
.env.local
.env.*.local
.DS_Store
*.log
.vscode/
.idea/
EOF

# Create monorepo structure
mkdir -p apps/api packages/shared packages/redis infra/docker docs

# Initialize npm workspaces
npm init -w -y
cat > package.json << 'EOF'
{
  "name": "systemvibe",
  "version": "0.1.0",
  "description": "Distributed task processing platform for learning system design",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev": "npm run dev --ws",
    "build": "npm run build --ws",
    "test": "npm run test --ws",
    "lint": "npm run lint --ws"
  },
  "keywords": ["nestjs", "redis", "bullmq", "docker", "distributed-systems"],
  "author": "Your Name",
  "license": "MIT"
}
EOF

git add .
git commit -m "Initial project structure"
```

---

## Step 2: Create NestJS API Application

```bash
# Create API workspace
mkdir -p apps/api

# Initialize package.json for API
cat > apps/api/package.json << 'EOF'
{
  "name": "systemvibe-api",
  "version": "0.1.0",
  "description": "SystemVibe API Server",
  "main": "dist/main.js",
  "scripts": {
    "start": "node dist/main",
    "dev": "nest start --watch",
    "build": "nest build",
    "test": "jest",
    "lint": "eslint src",
    "format": "prettier --write src"
  },
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "reflect-metadata": "^0.1.13",
    "rxjs": "^7.8.0",
    "pino": "^8.0.0",
    "pino-pretty": "^10.0.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.0.0",
    "@types/node": "^20.0.0",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "eslint": "^8.0.0",
    "prettier": "^3.0.0",
    "typescript": "^5.0.0"
  }
}
EOF

# Create TypeScript configuration
cat > apps/api/tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
EOF

# Create project structure
mkdir -p apps/api/src/{modules,common,config,guards,interceptors,filters}

# Create main application module
cat > apps/api/src/app.module.ts << 'EOF'
import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [HealthModule],
})
export class AppModule {}
EOF

# Create health module
mkdir -p apps/api/src/modules/health

cat > apps/api/src/modules/health/health.module.ts << 'EOF'
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
EOF

cat > apps/api/src/modules/health/health.service.ts << 'EOF'
import { Injectable } from '@nestjs/common';

@Injectable()
export class HealthService {
  getHealth() {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        api: 'healthy',
        database: 'unknown',
        redis: 'unknown',
      },
      version: '0.1.0',
    };
  }
}
EOF

cat > apps/api/src/modules/health/health.controller.ts << 'EOF'
import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  check() {
    return this.healthService.getHealth();
  }
}
EOF

# Create main.ts
cat > apps/api/src/main.ts << 'EOF'
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as pino from 'pino';
import { env } from '@systemvibe/config';

const logger = pino();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');

  const port = env.API_PORT;
  await app.listen(port, '0.0.0.0');

  logger.info(`API Server running on http://localhost:${port}`);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start API');
  process.exit(1);
});
EOF

# Create .eslintrc
cat > apps/api/.eslintrc.json << 'EOF'
{
  "parser": "@typescript-eslint/parser",
  "extends": ["plugin:@typescript-eslint/recommended"],
  "parserOptions": {
    "project": "tsconfig.json",
    "sourceType": "module"
  },
  "rules": {
    "@typescript-eslint/no-explicit-any": "warn"
  }
}
EOF

# Create .prettierrc
cat > apps/api/.prettierrc << 'EOF'
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2
}
EOF

# Create Dockerfile
cat > apps/api/Dockerfile << 'EOF'
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY dist ./dist
COPY package*.json ./

EXPOSE 3000
CMD ["node", "dist/main"]
EOF

git add apps/api
git commit -m "Add NestJS API application scaffold"
```

---

## Step 3: Setup PostgreSQL Database

```bash
# Create prisma package for database ORM
mkdir -p packages/database
cd packages/database

cat > package.json << 'EOF'
{
  "name": "@systemvibe/database",
  "version": "0.1.0",
  "main": "generated/index.js",
  "scripts": {
    "migrate:dev": "prisma migrate dev",
    "migrate:deploy": "prisma migrate deploy",
    "studio": "prisma studio"
  },
  "dependencies": {
    "@prisma/client": "^5.0.0"
  },
  "devDependencies": {
    "prisma": "^5.0.0"
  }
}
EOF

# Create Prisma schema
cat > prisma.schema << 'EOF'
// This is your Prisma schema file,
// learn more about it in the docs: https://pris.ly/d/prisma-schema

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("user")
}
EOF

mkdir -p migrations
cd ../..

git add packages/database
git commit -m "Add Prisma database ORM configuration"
```

---

## Step 4: Create Docker Compose

```bash
# Create Docker Compose configuration
cat > infra/docker/docker-compose.yml << 'EOF'
version: '3.8'

services:
  # PostgreSQL Database
  postgres:
    image: postgres:16-alpine
    container_name: systemvibe-postgres
    environment:
      POSTGRES_USER: ${DB_USER:-systemvibe}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-devpassword}
      POSTGRES_DB: ${DB_NAME:-systemvibe}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U systemvibe"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - systemvibe

  # Redis Cache & Queue
  redis:
    image: redis:7-alpine
    container_name: systemvibe-redis
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - systemvibe

  # Nginx Reverse Proxy (optional, for learning)
  nginx:
    image: nginx:alpine
    container_name: systemvibe-nginx
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - api
    networks:
      - systemvibe

  # API Server
  api:
    build:
      context: ../../
      dockerfile: apps/api/Dockerfile
    container_name: systemvibe-api
    environment:
      NODE_ENV: development
      API_PORT: 3000
      DATABASE_URL: postgresql://${DB_USER:-systemvibe}:${DB_PASSWORD:-devpassword}@postgres:5432/${DB_NAME:-systemvibe}
      REDIS_URL: redis://redis:6379
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    ports:
      - "3000:3000"
    volumes:
      - ../../apps/api/src:/app/src
      - ../../apps/api/dist:/app/dist
    command: npm run dev
    networks:
      - systemvibe

volumes:
  postgres_data:
  redis_data:

networks:
  systemvibe:
    driver: bridge
EOF

# Create environment file
cat > .env.local << 'EOF'
# Database
DB_USER=systemvibe
DB_PASSWORD=devpassword
DB_NAME=systemvibe

# API
API_PORT=3000
NODE_ENV=development

# Redis
REDIS_URL=redis://localhost:6379
EOF

git add infra/docker docker-compose.yml .env.local
git commit -m "Add Docker Compose infrastructure configuration"
```

---

## Step 5: Create Nginx Configuration

```bash
cat > infra/docker/nginx.conf << 'EOF'
events {
  worker_connections 1024;
}

http {
  upstream api {
    server host.docker.internal:3000;
  }

  server {
    listen 80;
    server_name localhost;

    location /api/ {
      proxy_pass http://api/api/;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection 'upgrade';
      proxy_set_header Host $host;
      proxy_cache_bypass $http_upgrade;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
      return 200 "SystemVibe API Gateway\n";
      add_header Content-Type text/plain;
    }
  }
}
EOF

git add infra/docker/nginx.conf
git commit -m "Add Nginx reverse proxy configuration"
```

---

## Step 6: Install Dependencies & Build

```bash
# Install all dependencies
npm install

# Build API
cd apps/api
npm run build
cd ../..

# Verify build
ls -la apps/api/dist
```

---

## Step 7: Start Everything

```bash
# Navigate to docker compose directory
cd infra/docker

# Start all services
docker compose up

# In another terminal, watch logs
docker compose logs -f

# Verify services are running
docker compose ps
```

**Expected Output**:

```
systemvibe-postgres     healthy ✓
systemvibe-redis        healthy ✓
systemvibe-api          running ✓
systemvibe-nginx        running ✓
```

---

## Step 8: Test the System

```bash
# Test API directly
curl http://localhost:3000/api/health

# Test via Nginx
curl http://localhost/api/health

# Expected Response:
# {
#   "status": "healthy",
#   "timestamp": "2025-01-01T10:00:00Z",
#   "services": {
#     "api": "healthy",
#     "database": "unknown",
#     "redis": "unknown"
#   },
#   "version": "0.1.0"
# }
```

---

## Step 9: Verify Connections

### Check PostgreSQL Connection

```bash
# In another terminal
docker exec systemvibe-postgres psql -U systemvibe -d systemvibe -c "\dt"

# Should show no tables yet (that's fine)
```

### Check Redis Connection

```bash
# In another terminal
docker exec systemvibe-redis redis-cli ping

# Expected: PONG
```

### Check API Logs

```bash
# Should see:
# INFO: API Server running on http://localhost:3000
```

---

## Step 10: First Commit

```bash
git add .
git commit -m "Phase 1 complete: Foundation with Docker, PostgreSQL, Redis, NestJS"
git log --oneline

# Should show commits for:
# Phase 1 complete: Foundation...
# Add Nginx reverse proxy...
# Add Docker Compose...
# Add Prisma database ORM...
# Add NestJS API...
# Initial project structure
```

---

## Troubleshooting

### Issue: Docker image won't build

```bash
# Try building again without cache
docker compose build --no-cache api

# Check Docker logs
docker logs systemvibe-api
```

### Issue: PostgreSQL won't start

```bash
# Check if port 5432 is already in use
lsof -i :5432

# Clean up old volumes
docker compose down -v
docker compose up postgres
```

### Issue: Redis connection refused

```bash
# Check if Redis is running
docker ps | grep redis

# Restart Redis
docker compose restart redis

# Test connection
docker exec systemvibe-redis redis-cli ping
```

### Issue: Health check failing

```bash
# Check NestJS compilation errors
docker logs systemvibe-api

# Ensure all dependencies installed
npm install

# Rebuild API
npm run build --workspace=apps/api
```

---

## What You've Learned (Phase 1)

✅ Docker multi-container orchestration
✅ Service networking in Docker Compose
✅ NestJS project structure and modules
✅ TypeScript configuration for backend
✅ Health check endpoints
✅ Basic logging setup
✅ Database initialization with Prisma
✅ Reverse proxy pattern with Nginx
✅ Centralized environment configuration with validation

**Environment Configuration**:

Phase 1 includes centralized environment configuration management:

- Created `packages/config/` for centralized env management
- Uses Zod for runtime validation of environment variables
- Single source of truth for all env vars across services
- Type-safe configuration with TypeScript
- Fail-fast validation on startup if env vars are missing or invalid
- Docker Compose uses `env_file` to load `.env` from root
- All services import from `@systemvibe/config` instead of `process.env` directly

**To use centralized config in your code**:

```typescript
import { env } from "@systemvibe/config";

// Access environment variables with type safety
const dbUrl = env.DATABASE_URL;
const port = env.API_PORT;
const logLevel = env.LOG_LEVEL;
```

---

## Next Steps (Phase 2)

You're ready for **Phase 2: Authentication**:

- User registration/login
- JWT token generation
- Auth guards on endpoints
- Session storage in Redis

For now, commit your work and create a GitHub repository!

```bash
# Create GitHub repo and push
git remote add origin https://github.com/your-username/systemvibe.git
git branch -M main
git push -u origin main
```

---

## Quick Reference Commands

```bash
# Start everything
cd infra/docker && docker compose up

# Stop everything
docker compose down

# View logs
docker compose logs -f api

# Rebuild API
docker compose build api

# Run API in development
docker compose up --build api

# Access Postgres CLI
docker exec -it systemvibe-postgres psql -U systemvibe

# Access Redis CLI
docker exec -it systemvibe-redis redis-cli

# Rebuild from scratch (clean slate)
docker compose down -v
docker compose up --build
```

---

**You're now ready to build! 🚀**
