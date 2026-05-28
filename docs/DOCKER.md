# Docker in SystemVibe

## Docker Overview

**Docker** is a containerization platform that packages applications and all their dependencies into a single container. Containers are isolated, lightweight environments that run consistently across any machine.

### Core Concepts

- **Image**: A read-only template containing the OS, libraries, dependencies, and application
- **Container**: A running instance of an Image
- **Dockerfile**: A script file used to build Images
- **Volume**: Persistent storage for container data
- **Network**: How containers communicate with each other

---

## Docker in SystemVibe

SystemVibe uses Docker to containerize the entire application stack:

### Service Architecture

| Service           | Image                                     | Port | Purpose                 |
| ----------------- | ----------------------------------------- | ---- | ----------------------- |
| `postgres`        | postgres:16-alpine                        | 5433 | Primary database        |
| `redis`           | redis:7-alpine                            | 6379 | Cache & Job Queue       |
| `redis-commander` | rediscommander                            | 8001 | Redis GUI               |
| `api`             | Build from `apps/api/Dockerfile`          | 3000 | API Server (NestJS)     |
| `worker-image`    | Build from `apps/worker-image/Dockerfile` | -    | Image processing worker |
| `nginx`           | nginx:alpine                              | 80   | Reverse proxy           |
| `prometheus`      | prom/prometheus                           | 9090 | Metrics collection      |
| `grafana`         | grafana/grafana                           | 3001 | Metrics dashboard       |

### Monorepo & Docker

The project uses **npm workspaces** with the following structure:

```
├── apps/
│   ├── api/           → Service: api
│   └── worker-image/  → Service: worker-image
└── packages/
    ├── config/        → Shared config
    ├── database/      → Prisma schema & client
    └── redis/         → Redis utilities
```

**Multi-stage Build** is used to optimize image size:

1. **Stage 1 (builder)**: Install dependencies, build TypeScript, generate Prisma client
2. **Stage 2 (runtime)**: Only copy necessary artifacts, remove build tools

---

## Docker Compose

**Docker Compose** is a tool for defining and running multi-container applications.

### Configuration File

Main file: `@/infra/docker/docker-compose.yml`

### Key Structure

```yaml
services:
  service_name:
    image: image_name:tag # Or build from Dockerfile
    build:
      context: ../../ # Build context (monorepo root)
      dockerfile: apps/api/Dockerfile
    container_name: systemvibe-xxx # Specific container name
    env_file: ../../.env # Load env from file
    environment: # Or inline env vars
      KEY: value
    depends_on:
      postgres:
        condition: service_healthy # Wait for service to be healthy
    volumes:
      - postgres_data:/var/lib/postgresql/data # Named volume
      - ../../apps/api/src:/app/src:ro # Bind mount (dev)
    networks:
      - systemvibe # Custom network
    healthcheck: # Health check config
      test: ["CMD-SHELL", "pg_isready -U systemvibe"]
      interval: 10s
      timeout: 5s
      retries: 5
```

---

## Common Docker Commands in This System

### Starting the System

```bash
# Start all services (foreground)
cd infra/docker
docker compose up

# Start in background (detached mode)
docker compose up -d

# Start with image rebuild
docker compose up --build

# Start only one service
docker compose up api -d
```

### Stopping & Cleanup

```bash
# Stop all services
docker compose down

# Stop and remove volumes (⚠️ data loss)
docker compose down -v

# Stop and remove images
docker compose down --rmi all
```

### Rebuild & Deploy

```bash
# Rebuild image (don't run)
docker compose build api

# Build without cache
docker compose build --no-cache api

# Restart a service
docker compose restart api
```

### Logs & Debugging

```bash
# View all service logs
docker compose logs

# View logs and follow (real-time)
docker compose logs -f

# View logs for one service
docker compose logs -f api

# Enter shell in container
docker exec -it systemvibe-api sh
docker exec -it systemvibe-postgres psql -U systemvibe

# Check status
docker compose ps
```

### Volumes & Data

```bash
# List volumes
docker volume ls

# Inspect volume details
docker volume inspect systemvibe_postgres_data

# Remove unused volumes
docker volume prune
```

### Networks

```bash
# List networks
docker network ls

# Inspect network
docker network inspect systemvibe_systemvibe
```

### Images

```bash
# List images
docker images

# Remove unused images
docker image prune

# Remove a specific image
docker rmi <image_id>
```

---

## Common Errors & How to Fix Them

### 1. Port Already in Use

```
Error: Ports are not available: exposing port TCP 0.0.0.0:5433 → 0.0.0.0:0: listen tcp 0.0.0.0:5433: bind: address already in use
```

**Cause**: Port 5433 (PostgreSQL) or 3000 (API) is being used by another process.

**Fix**:

```bash
# Find process using the port
lsof -i :5433
# Or
netstat -anv | grep 5433

# Kill the process
kill -9 <PID>

# Or change port in docker-compose.yml
ports:
  - "5434:5432"  # Change 5433 → 5434
```

### 2. Permission Denied When Mounting Volumes

```
Error: EACCES: permission denied, mkdir '/app/node_modules'
```

**Cause**: Bind mount on macOS/Linux has permission mismatch.

**Fix**: Run container with appropriate user or remove `:ro` (read-only) if write access is needed.

### 3. Prisma Client Not Found

```
Error: @prisma/client did not initialize yet
```

**Cause**: Prisma client hasn't been generated in the container.

**Fix**:

```bash
# Enter container and generate
docker exec -it systemvibe-api npx prisma generate --schema=packages/database/prisma/schema.prisma

# Or rebuild
docker compose build --no-cache api
docker compose up -d api
```

### 4. Database Connection Failed

```
Error: Can't reach database server at `postgres`:`5432`
```

**Cause**: API started before PostgreSQL was ready.

**Fix**: `depends_on` with `condition: service_healthy` is already configured. If still failing:

```bash
# Check health status
docker compose ps

# Restart api after postgres is ready
docker compose restart api
```

### 5. Image Build Cache Causing Errors

**Cause**: Old layer cache contains outdated dependencies.

**Fix**:

```bash
# Build without cache
docker compose build --no-cache

# Or remove all and rebuild
docker compose down
docker image prune -a
docker compose up --build
```

### 6. `.env` Not Loaded

**Cause**: `.env` file is in wrong location or path in `docker-compose.yml` is incorrect.

**Fix**:

```bash
# Check file exists
cat ../../.env  # From infra/docker directory

# Copy from example
cp .env.example .env
```

### 7. Worker Cannot Connect to Redis

**Cause**: Wrong network or hostname.

**Fix**: Inside containers, use service name as hostname:

- `redis` (not `localhost`)
- `postgres` (not `localhost`)

---

## Best Practices

### 1. Always Use `docker compose down -v` When Changing Schema

```bash
# Full reset (removes data)
docker compose down -v
docker compose up -d
```

### 2. Rebuild After Changing Dependencies

```bash
# package.json or package-lock.json changed → rebuild
docker compose build --no-cache api
docker compose up -d api
```

### 3. Development vs Production

|         | Development                | Production       |
| ------- | -------------------------- | ---------------- |
| Command | `npm run dev` (hot reload) | `node dist/main` |
| Volumes | Bind mount source code     | No mount         |
| Logs    | Verbose                    | Structured JSON  |
| Debug   | Enabled                    | Disabled         |

### 4. Check Health Before Deploying

```bash
# Wait for all services to be healthy
docker compose up -d
sleep 10
docker compose ps
```

### 5. Resource Limits

Add to `docker-compose.yml` for production:

```yaml
services:
  api:
    deploy:
      resources:
        limits:
          cpus: "1"
          memory: 512M
```

---

## Docker Cheat Sheet

```bash
# === LIFECYCLE ===
docker compose up -d           # Start
docker compose down            # Stop
docker compose restart         # Restart
docker compose down -v         # Stop + remove volumes

# === BUILD ===
docker compose build           # Build
docker compose build --no-cache # Build without cache
docker compose up --build      # Build then start

# === DEBUG ===
docker compose logs -f         # Follow logs
docker compose ps              # Status
docker exec -it <container> sh # Shell into container
docker top <container>         # Processes

# === CLEANUP ===
docker system prune            # Remove unused data
docker volume prune            # Remove unused volumes
docker image prune             # Remove unused images
```

---

## References

- [Dockerfile API](/apps/api/Dockerfile)
- [Dockerfile Worker](/apps/worker-image/Dockerfile)
- [Docker Compose](/infra/docker/docker-compose.yml)
- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Reference](https://docs.docker.com/compose/compose-file/)
