# SystemVibe

A distributed systems platform built with NestJS, PostgreSQL, Redis, and Docker.

## Overview

SystemVibe is a scalable backend infrastructure designed for distributed applications, featuring:

- RESTful API with NestJS
- PostgreSQL database with Prisma ORM
- Redis for caching and queuing
- Docker Compose for container orchestration
- Nginx reverse proxy

### Expected Outcomes

Upon completion, SystemVibe will deliver:

**A Production-Ready Distributed System**

- Horizontally scalable API that can handle thousands of concurrent requests
- Independent worker services for background job processing (image processing, email, etc.)
- Fault-tolerant architecture with automatic retry mechanisms and graceful degradation

**High-Performance Data Layer**

- PostgreSQL database optimized for read/write operations with connection pooling
- Redis caching layer for sub-millisecond response times on frequently accessed data
- Efficient job queue with BullMQ supporting millions of jobs with priority and scheduling

**Developer-Friendly Infrastructure**

- Type-safe codebase with end-to-end TypeScript support
- Comprehensive API documentation with Swagger UI
- Hot-reload development environment for rapid iteration
- Unit and E2E test coverage for reliability

**Operational Excellence**

- Containerized deployment with Docker for consistency across environments
- Health monitoring and metrics for all services
- Structured logging with Pino for debugging and observability
- Zero-downtime deployment capabilities

**Extensible Architecture**

- Monorepo structure allowing easy addition of new services and packages
- Shared libraries for database, configuration, and utilities to avoid code duplication
- Clear separation of concerns enabling independent scaling and deployment of components

## Tech Stack

- **Backend**: NestJS (Node.js/TypeScript)
- **Database**: PostgreSQL 16
- **Cache/Queue**: Redis 7 with BullMQ
- **ORM**: Prisma
- **Image Processing**: Sharp
- **Containerization**: Docker & Docker Compose
- **Reverse Proxy**: Nginx
- **Logging**: Pino with pino-pretty

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
- Image Worker (background job processing)
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
#     "redis": "healthy",
#     "queue": "healthy",
#     "worker": "healthy"
#   },
#   "version": "0.3.0"
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
│   ├── api/                 # NestJS API application
│   │   ├── src/
│   │   │   ├── modules/     # Feature modules
│   │   │   │   ├── health/  # Health check module
│   │   │   │   ├── auth/    # Authentication module
│   │   │   │   ├── jobs/    # Job queue module
│   │   │   │   ├── queue/   # BullMQ configuration
│   │   │   │   ├── websocket/ # WebSocket gateway
│   │   │   │   └── metrics/   # Prometheus metrics
│   │   │   ├── common/      # Common utilities
│   │   │   ├── config/      # Configuration
│   │   │   ├── guards/      # Auth guards
│   │   │   ├── interceptors/ # Interceptors
│   │   │   └── filters/     # Exception filters
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── worker-image/        # Image processing worker
│       ├── src/
│       │   ├── main.ts
│       │   ├── worker.module.ts
│       │   ├── image.processor.ts
│       │   └── redis-config.service.ts
│       ├── Dockerfile
│       └── package.json
├── packages/
│   ├── config/              # Centralized environment configuration
│   │   ├── src/
│   │   │   ├── env.ts       # Zod validation schema
│   │   │   └── index.ts     # Export typed config
│   │   └── package.json
│   ├── database/            # Prisma ORM configuration
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   ├── src/
│   │   │   ├── prisma.service.ts
│   │   │   └── prisma.module.ts
│   │   └── migrations/
│   ├── redis/               # Redis utilities
│   │   ├── src/
│   │   │   └── index.ts
│   │   └── package.json
│   └── shared/              # Shared utilities
├── infra/
│   ├── docker/              # Local Docker Compose
│   │   ├── docker-compose.yml
│   │   └── nginx.conf
│   └── k8s/                 # Kubernetes manifests (GCP)
│       ├── namespace.yaml
│       ├── api/
│       ├── worker/
│       ├── jobs/
│       ├── monitoring/
│       └── ingress/
├── docs/                    # Documentation
│   └── implementation/      # Phase implementation guides
│       ├── PHASE_1_GETTING_STARTED.md
│       ├── PHASE_2_AUTHENTICATION.md
│       ├── PHASE_3_JOB_QUEUE.md
│       ├── PHASE_4_WORKER.md
│       ├── PHASE_5_REALTIME_UPDATES.md
│       ├── PHASE_6_MONITORING.md
│       ├── PHASE_7_GCP_K8S_MIGRATION.md
│       ├── PHASE_8_WEBHOOK.md
│       └── PHASE_9_RATE_LIMITING.md
├── .env.example             # Environment variables template
└── package.json             # Root package.json
```

### Why This Structure?

This project uses a **monorepo architecture** with three main directories: `apps/`, `packages/`, and `infra/`. This separation is intentional and follows best practices for building scalable, maintainable distributed systems.

---

#### **1. apps/ - Deployable Applications**

**Purpose**: Contains independent, deployable applications that can run as separate services.

**Current**: `apps/api/` - The main NestJS API server

**Future additions**:

- `apps/worker/` - Background job processing workers
- `apps/webhook/` - Webhook delivery service
- `apps/scheduler/` - Cron job scheduler

**Why separate apps?**

- **Independent Deployment**: Each app can be deployed, scaled, and updated independently
- **Clear Boundaries**: Each app has a single responsibility (API handles HTTP, workers process jobs)
- **Horizontal Scaling**: Run multiple instances of API server or workers based on load
- **Technology Flexibility**: Different apps could use different frameworks if needed (though we standardize on NestJS)
- **Isolation**: If one app crashes, others continue running

**Example**:

```bash
# Scale API to handle more HTTP requests
docker compose up --scale api=3

# Scale workers to process more jobs
docker compose up --scale worker=5
```

---

#### **2. packages/ - Shared Code Libraries**

**Purpose**: Contains reusable code that multiple applications depend on. This is the key to avoiding code duplication.

**Current packages**:

- `packages/config/` - Centralized environment configuration with Zod validation
- `packages/database/` - Prisma ORM client and schema
- `packages/redis/` - Redis connection utilities
- `packages/shared/` - Common types, interfaces, utilities (to be implemented)

**Why separate packages?**

**A. Code Reuse Across Apps**

```
Without packages:
├── apps/api/src/database/client.ts      (Duplicate code)
├── apps/worker/src/database/client.ts  (Duplicate code)
└── apps/webhook/src/database/client.ts  (Duplicate code)

With packages:
├── packages/database/                   (Single source of truth)
    └── prisma client
├── apps/api/           → imports from @systemvibe/database
├── apps/worker/        → imports from @systemvibe/database
└── apps/webhook/       → imports from @systemvibe/database
```

**B. Single Source of Truth for Database Schema**

- Database schema defined once in `packages/database/prisma/schema.prisma`
- All apps use the same Prisma client
- Schema changes propagate automatically to all apps
- No risk of schema drift between services

**C. Type Safety Across Services**

```typescript
// packages/database/prisma/schema.prisma
model Job {
  id     String @id @default(uuid())
  status String
  payload Json
}

// Auto-generated TypeScript types
// All apps get the same Job type definition
```

**D. Independent Versioning**

- Can update database schema without redeploying all apps
- Can add new Redis utilities without affecting API
- Each package has its own version and dependencies

**E. Testing Isolation**

- Test database logic independently without running API server
- Test Redis utilities in isolation
- Unit tests are faster and more focused

**F. Circular Dependency Prevention**

- If database code lived in API, API might need to import from database later
- Separation prevents circular dependencies between packages

**G. Centralized Configuration**

- `packages/config/` provides single source of truth for environment variables
- Uses Zod for runtime validation - fail fast if env vars are missing or invalid
- Type-safe configuration with TypeScript
- All services import from `@systemvibe/config` instead of `process.env` directly
- Eliminates duplicate env config across services
- Easy to add new env vars with validation rules

---

#### **3. infra/ - Infrastructure Configuration**

**Purpose**: Contains infrastructure-as-code for deployment and orchestration.

**Current**: `infra/docker/` - Docker Compose configuration

**Why separate infra?**

- **Infrastructure vs Application Code**: Infrastructure configuration is different from application logic
- **Environment Parity**: Same Docker configs work in dev, staging, and production
- **Separation of Concerns**: Developers focus on app code, DevOps focus on infra
- **Multiple Environments**: Easy to add `infra/staging/`, `infra/production/` later
- **Reusability**: Docker configs can be reused across different projects

---

#### **4. docs/ - Documentation**

**Purpose**: Centralized documentation for the project.

**Why separate docs?**

- **Single Source of Truth**: All documentation in one place
- **Easy Navigation**: Developers know where to find docs
- **Version Control**: Documentation evolves with code
- **Onboarding**: New developers can quickly understand the system

---

### Architecture Benefits Summary

| Aspect               | Monolithic Approach                | Monorepo Approach (Our Design)      |
| -------------------- | ---------------------------------- | ----------------------------------- |
| **Code Duplication** | High (copy-paste between services) | Low (shared packages)               |
| **Database Schema**  | Scattered across services          | Single source of truth              |
| **Type Safety**      | Inconsistent across services       | Consistent via shared types         |
| **Deployment**       | All-or-nothing                     | Independent per app                 |
| **Testing**          | Complex (test entire monolith)     | Simple (test packages in isolation) |
| **Scalability**      | Limited (scale entire app)         | Flexible (scale specific services)  |
| **Maintenance**      | Risk of breaking changes           | Clear boundaries, safer updates     |
| **Onboarding**       | Confusing structure                | Clear separation of concerns        |

---

### Real-World Example: Adding a New Feature

**Scenario**: Add a new "email sending" job type

**Without monorepo structure**:

1. Add email logic to API (mixing concerns)
2. Copy email code to worker (duplication)
3. Update database schema in API (tightly coupled)
4. Risk of inconsistent implementations

**With our monorepo structure**:

1. Update `packages/database/prisma/schema.prisma` (single schema change)
2. Add email utilities to `packages/shared/` (reusable code)
3. Implement email job in `apps/worker/` (worker responsibility)
4. API enqueues jobs, worker processes them (clear separation)
5. Both apps automatically get updated types from database package

---

### When to Add New Packages vs Apps

**Add a new package when**:

- Code is needed by multiple apps
- It represents a domain concept (database, auth, metrics)
- It should be tested independently
- It has clear interfaces and contracts

**Add a new app when**:

- It's a deployable service with its own lifecycle
- It needs to scale independently
- It has distinct runtime requirements
- It serves a different purpose (API vs worker vs scheduler)

---

This structure is designed for **long-term maintainability** as the project grows from a single API to a full distributed system with multiple workers, services, and packages.

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

**Note**: When using Docker, PostgreSQL runs on port 5433 (mapped from container port 5432).

Available variables:

- `DATABASE_URL`: PostgreSQL connection string
- `DB_USER`: PostgreSQL username (default: systemvibe)
- `DB_PASSWORD`: PostgreSQL password (default: devpassword)
- `DB_NAME`: PostgreSQL database name (default: systemvibe)
- `API_PORT`: API server port (default: 3000)
- `NODE_ENV`: development | production
- `REDIS_URL`: Redis connection string
- `REDIS_HOST`: Redis host (default: localhost)
- `REDIS_PORT`: Redis port (default: 6379)
- `JWT_SECRET`: JWT secret key
- `JWT_REFRESH_SECRET`: JWT refresh token secret
- `JWT_EXPIRES_IN`: JWT token expiration (default: 15m)
- `JWT_REFRESH_EXPIRES_IN`: JWT refresh token expiration (default: 7d)
- `LOG_LEVEL`: Worker log level (error, warn, info, debug)

**Environment Configuration**:

The project uses a centralized configuration package (`packages/config/`) with Zod validation:

- All environment variables are validated at startup
- Type-safe configuration with TypeScript
- Single source of truth across all services
- Services import from `@systemvibe/config` instead of using `process.env` directly
- Docker Compose loads env vars from `.env` file using `env_file` directive

## Development

There are two development modes available:

### Mode 1: Local Development (Recommended)

Run the API locally with hot reload, while PostgreSQL and Redis run in Docker.

**Setup:**

```bash
# Terminal 1: Start database, Redis, and worker
cd infra/docker
docker compose up -d postgres redis worker-image

# Terminal 2: Run API locally
cd apps/api
npm install
npm run dev
```

**Advantages:**

- Hot reload enabled - changes reflect immediately
- Full IDE debugging support
- No Docker rebuilds needed
- Faster development cycle

**Access API:**

```bash
curl http://localhost:3000/api/health
```

### Mode 2: Docker Dev Mode

Run all services in Docker with volume mounts for hot reload.

**Setup:**

```bash
cd infra/docker
docker compose up -d --build
```

**How it works:**

- Source code is mounted into the container as read-only volumes
- `npm run dev` runs inside the container with hot reload
- Edit code locally, container auto-reloads

**Monitor logs:**

```bash
docker compose logs -f api
```

**Advantages:**

- Consistent environment with production
- All services in one command
- Still supports hot reload

**Limitations:**

- Adding new dependencies requires container rebuild
- Slightly slower than local development

### Switching Between Modes

**From Docker Dev to Local:**

```bash
# Stop Docker services
cd infra/docker
docker compose down

# Start only DB/Redis/Worker
docker compose up -d postgres redis worker-image

# Run API locally
cd apps/api
npm run dev
```

**From Local to Docker Dev:**

```bash
# Stop local API (Ctrl+C)
# Start all services in Docker
cd infra/docker
docker compose up -d --build
```

**From Docker Dev to Production Mode:**

Edit `infra/docker/docker-compose.yml`:

**Remove these lines (volumes section):**

```yaml
volumes:
  - ../../apps/api/src:/app/src:ro
  - ../../apps/api/package.json:/app/package.json:ro
  - ../../apps/api/tsconfig.json:/app/tsconfig.json:ro
```

**Change command:**

```yaml
command: npm start # Was: npm run dev
```

Then rebuild:

```bash
cd infra/docker
docker compose up -d --build
```

**From Production to Docker Dev Mode:**

Edit `infra/docker/docker-compose.yml`:

**Add these lines before `command`:**

```yaml
volumes:
  - ../../apps/api/src:/app/src:ro
  - ../../apps/api/package.json:/app/package.json:ro
  - ../../apps/api/tsconfig.json:/app/tsconfig.json:ro
```

**Change command:**

```yaml
command: npm run dev # Was: npm start
```

Then rebuild:

```bash
cd infra/docker
docker compose up -d --build
```

### Building for Production

```bash
cd apps/api
npm run build
```

### Running Tests

The project includes both unit tests and end-to-end (E2E) tests.

**Run all unit tests:**

```bash
cd apps/api
npm run test
```

**Run tests in watch mode:**

```bash
cd apps/api
npm run test:watch
```

**Run tests with coverage report:**

```bash
cd apps/api
npm run test:cov
```

**Run E2E tests:**

```bash
cd apps/api
npm run test:e2e
```

**Note:** E2E tests require PostgreSQL, Redis, and worker to be running. Start them with:

```bash
cd infra/docker
docker compose up -d postgres redis worker-image
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
    "redis": "healthy",
    "queue": "healthy",
    "worker": "healthy"
  },
  "version": "0.3.0"
}
```

### Authentication

#### Register

```
POST /api/auth/register
```

Register a new user account.

**Request Body:**

```json
{
  "email": "user@example.com",
  "password": "password123",
  "name": "John Doe"
}
```

**Response:**

```json
{
  "user": {
    "id": "cuid123",
    "email": "user@example.com",
    "name": "John Doe"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### Login

```
POST /api/auth/login
```

Authenticate with existing credentials.

**Request Body:**

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**

```json
{
  "user": {
    "id": "cuid123",
    "email": "user@example.com",
    "name": "John Doe"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### Refresh Token

```
POST /api/auth/refresh
```

Refresh an expired access token using a refresh token.

**Request Body:**

```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response:**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### Get Profile

```
GET /api/auth/me
```

Get the current user's profile (requires authentication).

**Headers:**

```
Authorization: Bearer <access_token>
```

**Response:**

```json
{
  "id": "cuid123",
  "email": "user@example.com",
  "name": "John Doe"
}
```

#### Logout

```
POST /api/auth/logout
```

Logout the current user (requires authentication).

**Headers:**

```
Authorization: Bearer <access_token>
```

**Response:**

```json
{
  "message": "Logged out successfully"
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

### Phase 2: Authentication ✅

- [x] User registration/login
- [x] JWT token authentication
- [x] Auth guards
- [x] Session storage in Redis

### Phase 3: Job Queue Basics ✅

- [x] Job entity in PostgreSQL with Prisma
- [x] BullMQ queue setup with Redis
- [x] Job submission API endpoint
- [x] Job retrieval and filtering
- [x] Job cancellation endpoint
- [x] Automatic retry with exponential backoff
- [x] Swagger documentation for all endpoints
- [x] Unit tests for JobsService
- [x] E2E tests for JobsController
- [x] BullMQ Board UI for queue monitoring

### Phase 4: Worker Implementation ✅

- [x] Worker package structure with NestJS
- [x] BullMQ worker configuration with Redis
- [x] Image processing processor (resize, thumbnail, compress)
- [x] Worker heartbeat mechanism for health monitoring
- [x] Docker containerization for workers
- [x] Worker service in Docker Compose
- [x] Graceful shutdown handling
- [x] Job event logging (active, completed, failed)

### Phase 5: Real-time Updates via WebSocket ✅

- [x] Socket.IO setup with NestJS WebSocket gateway
- [x] Job status broadcasts via WebSocket
- [x] Redis Pub/Sub for worker-to-API communication
- [x] Worker publishes job status events (PROCESSING, COMPLETED, FAILED)
- [x] Client subscription to job-specific channels
- [x] Real-time progress updates support

### Phase 6: Monitoring & Observability ✅

- [x] Prometheus metrics collection
- [x] Grafana dashboards
- [x] Metrics interceptor for HTTP requests
- [x] Worker job metrics via Redis Pub/Sub
- [x] Queue depth monitoring
- [x] Health check with queue and worker status

### Phase 7: GCP + Kubernetes Migration ✅

- [x] Docker Compose → GKE (Google Kubernetes Engine)
- [x] PostgreSQL container → Cloud SQL (managed PostgreSQL)
- [x] Redis container → Memorystore (managed Redis)
- [x] Local Docker → Artifact Registry (image registry)
- [x] Kubernetes manifests (Deployment, Service, HPA)
- [x] Cloud SQL Auth Proxy (sidecar pattern)
- [x] Google Managed Prometheus (GMP) + Cloud Monitoring
- [x] Prisma migrations as K8s Jobs
- [x] Workload Identity for GCP authentication

### Phase 8: Webhook Notifications 🔄

- [ ] Webhook delivery service
- [ ] Retry with exponential backoff
- [ ] Webhook signature verification
- [ ] Delivery status tracking

### Phase 9: Rate Limiting ⏳

- [ ] Redis-based rate limiting
- [ ] Token bucket algorithm
- [ ] Per-user and global limits
- [ ] Sliding window implementation

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
