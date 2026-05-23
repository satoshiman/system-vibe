# SystemVibe

A distributed systems platform built with NestJS, PostgreSQL, Redis, and Docker.

## Overview

SystemVibe is a scalable backend infrastructure designed for distributed applications, featuring:
- RESTful API with NestJS
- PostgreSQL database with Prisma ORM
- Redis for caching and queuing
- Docker Compose for container orchestration
- Nginx reverse proxy

## Tech Stack

- **Backend**: NestJS (Node.js/TypeScript)
- **Database**: PostgreSQL 16
- **Cache/Queue**: Redis 7
- **ORM**: Prisma
- **Containerization**: Docker & Docker Compose
- **Reverse Proxy**: Nginx

## Prerequisites

- Docker Desktop (for macOS/Windows) or Docker Engine (for Linux)
- Node.js 20+ (for local development)
- npm or yarn

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/satoshiman/system-vibe.git
cd system-vibe
```

### 2. Start all services

```bash
cd infra/docker
docker compose up -d
```

This will start:
- PostgreSQL on port 5433
- Redis on port 6379
- API Server on port 3000
- Nginx on port 80

### 3. Verify services are running

```bash
# Check health status
curl http://localhost/api/health

# Expected response:
# {
#   "status": "healthy",
#   "timestamp": "2026-05-23T03:39:39.687Z",
#   "services": {
#     "api": "healthy",
#     "database": "healthy",
#     "redis": "healthy"
#   },
#   "version": "0.1.0"
# }
```

### 4. Stop services

```bash
cd infra/docker
docker compose down
```

## Project Structure

```
system-vibe/
├── apps/
│   └── api/                 # NestJS API application
│       ├── src/
│       │   ├── modules/     # Feature modules
│       │   │   └── health/  # Health check module
│       │   ├── common/      # Common utilities
│       │   ├── config/      # Configuration
│       │   ├── guards/      # Auth guards
│       │   ├── interceptors/ # Interceptors
│       │   └── filters/     # Exception filters
│       ├── Dockerfile
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   ├── database/            # Prisma ORM configuration
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   └── migrations/
│   ├── redis/               # Redis utilities
│   └── shared/              # Shared utilities
├── infra/
│   └── docker/
│       ├── docker-compose.yml
│       └── nginx.conf
├── docs/                    # Documentation
├── .env.example             # Environment variables template
└── package.json             # Root package.json
```

## Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Available variables:
- `NODE_ENV`: development | production
- `DB_USER`: PostgreSQL username (default: systemvibe)
- `DB_PASSWORD`: PostgreSQL password (default: devpassword)
- `DB_NAME`: PostgreSQL database name (default: systemvibe)
- `REDIS_URL`: Redis connection string

## Development

### Local Development (without Docker)

```bash
# Install dependencies
npm install

# Start PostgreSQL and Redis with Docker
cd infra/docker
docker compose up -d postgres redis

# Run API locally
cd apps/api
npm run start:dev
```

### Building for Production

```bash
cd apps/api
npm run build
```

### Running Tests

```bash
cd apps/api
npm run test
```

## API Endpoints

### Health Check

```
GET /api/health
```

Returns the health status of all services.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-05-23T03:39:39.687Z",
  "services": {
    "api": "healthy",
    "database": "healthy",
    "redis": "healthy"
  },
  "version": "0.1.0"
}
```

## Database

### Access PostgreSQL

```bash
docker exec -it systemvibe-postgres psql -U systemvibe -d systemvibe
```

### Run Prisma Migrations

```bash
cd packages/database
npx prisma migrate dev
```

### Generate Prisma Client

```bash
cd packages/database
npx prisma generate
```

## Redis

### Access Redis CLI

```bash
docker exec -it systemvibe-redis redis-cli
```

### Ping Redis

```bash
docker exec systemvibe-redis redis-cli ping
# Response: PONG
```

## Docker Commands

### View logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f api
```

### Restart services

```bash
docker compose restart
```

### Rebuild services

```bash
docker compose up --build -d
```

### Remove all containers and volumes

```bash
docker compose down -v
```

## Current Status

### Phase 1: Foundation ✅

- [x] Project structure with monorepo layout
- [x] NestJS API application with health module
- [x] PostgreSQL database with Prisma ORM
- [x] Docker Compose configuration
- [x] Nginx reverse proxy configuration
- [x] Health check with actual connection verification

### Phase 2: Authentication (Planned)

- [ ] User registration/login
- [ ] JWT token authentication
- [ ] Auth guards
- [ ] Session storage in Redis

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT

## Contact

- GitHub: [@satoshiman](https://github.com/satoshiman)
