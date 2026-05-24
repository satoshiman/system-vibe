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

- `packages/database/` - Prisma ORM client and schema
- `packages/redis/` - Redis connection utilities (to be implemented)
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

Available variables:

- `NODE_ENV`: development | production
- `DB_USER`: PostgreSQL username (default: systemvibe)
- `DB_PASSWORD`: PostgreSQL password (default: devpassword)
- `DB_NAME`: PostgreSQL database name (default: systemvibe)
- `REDIS_URL`: Redis connection string

## Development

There are two development modes available:

### Mode 1: Local Development (Recommended)

Run the API locally with hot reload, while PostgreSQL and Redis run in Docker.

**Setup:**

```bash
# Terminal 1: Start database and Redis
cd infra/docker
docker compose up -d postgres redis

# Terminal 2: Run API locally
cd apps/api
npm install
npm run start:dev
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
- `npm run start:dev` runs inside the container with hot reload
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

# Start only DB/Redis
docker compose up -d postgres redis

# Run API locally
cd apps/api
npm run start:dev
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
command: npm start # Was: npm run start:dev
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
command: npm run start:dev # Was: npm start
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

**Note:** E2E tests require PostgreSQL and Redis to be running. Start them with:

```bash
cd infra/docker
docker compose up -d postgres redis
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
    "auth": "healthy"
  },
  "version": "0.2.0"
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
