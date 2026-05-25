# SystemVibe API

NestJS RESTful API server for SystemVibe platform.

## Overview

This is the main API server built with NestJS, providing RESTful endpoints for the SystemVibe distributed systems platform. It includes health checks, database integration with PostgreSQL, caching with Redis, and Swagger API documentation.

## Tech Stack

- **Framework**: NestJS 10.x
- **Language**: TypeScript 5.x
- **Database**: PostgreSQL 16 with Prisma ORM
- **Cache/Queue**: Redis 7 with BullMQ (via ioredis)
- **Logging**: Pino with pino-pretty
- **API Documentation**: Swagger/OpenAPI
- **Authentication**: JWT with Redis session management

## Prerequisites

- Node.js 20+
- npm or yarn
- Docker (for PostgreSQL and Redis)
- PostgreSQL 16 (via Docker on port 5433)
- Redis 7 (via Docker on port 6379)

## Installation

```bash
cd apps/api
npm install
```

## Environment Variables

Create a `.env` file in the project root (or use the root `.env`):

```env
NODE_ENV=development
API_PORT=3000
DB_HOST=localhost
DB_PORT=5433
DB_USER=systemvibe
DB_PASSWORD=devpassword
DB_NAME=systemvibe
REDIS_URL=redis://localhost:6379
```

## Development

### Start the API

```bash
# Development mode with hot reload
npm run dev

# Or build and start
npm run build
npm start
```

The API will be available at `http://localhost:3000/api`

### API Documentation

Swagger UI is automatically available at:

```
http://localhost:3000/api/docs
```

### BullMQ Board

Queue monitoring dashboard is available at:

```
http://localhost:3000/admin/queues
```

### Available Scripts

- `npm run dev` - Start in development mode with hot reload
- `npm run build` - Build the project
- `npm start` - Start the production build
- `npm test` - Run unit tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:cov` - Run tests with coverage
- `npm run test:e2e` - Run end-to-end tests
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier

## Project Structure

```
apps/api/
├── src/
│   ├── modules/          # Feature modules
│   │   ├── health/       # Health check module
│   │   ├── auth/         # Authentication module (JWT, Redis sessions)
│   │   ├── queue/        # BullMQ queue configuration
│   │   └── jobs/         # Job submission and management
│   ├── common/           # Common utilities and decorators
│   ├── config/           # Configuration files
│   ├── guards/           # Authentication guards
│   ├── interceptors/     # Request/response interceptors
│   ├── filters/          # Exception filters
│   ├── app.module.ts     # Root module
│   └── main.ts           # Application entry point
├── test/                 # E2E tests
│   ├── auth.e2e-spec.ts
│   ├── health.e2e-spec.ts
│   └── jobs.e2e-spec.ts
├── dist/                 # Compiled JavaScript
├── Dockerfile            # Docker image configuration
├── jest.config.js        # Jest configuration
├── package.json          # Dependencies and scripts
└── tsconfig.json         # TypeScript configuration
```

## API Endpoints

### Health Check

```
GET /api/health
```

Returns the health status of API, database, Redis, and auth services.

**Response:**

```json
{
  "status": "healthy",
  "timestamp": "2026-05-23T05:22:00.000Z",
  "services": {
    "api": "healthy",
    "database": "healthy",
    "redis": "healthy",
    "auth": "healthy"
  },
  "version": "0.2.0"
}
```

### Authentication Endpoints

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

#### Login

```
POST /api/auth/login
```

Authenticate with existing credentials.

#### Refresh Token

```
POST /api/auth/refresh
```

Refresh an expired access token.

#### Get Profile

```
GET /api/auth/me
```

Get the current user's profile (requires authentication).

#### Logout

```
POST /api/auth/logout
```

Logout the current user (requires authentication).

### Job Queue Endpoints (Public - No Authentication Required)

#### Submit Job

```
POST /api/jobs
```

Submit a new job to the queue.

**Request Body:**

```json
{
  "type": "image-resize",
  "payload": {
    "imageUrl": "https://example.com/image.jpg",
    "width": 800,
    "height": 600
  },
  "priority": "normal",
  "timeout": 3600
}
```

#### List Jobs

```
GET /api/jobs
```

List all jobs with optional filters.

**Query Parameters:**

- `status`: Filter by job status (PENDING, QUEUED, PROCESSING, COMPLETED, FAILED, CANCELLED)
- `type`: Filter by job type
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20)

#### Get Job

```
GET /api/jobs/:id
```

Get details of a specific job.

#### Cancel Job

```
DELETE /api/jobs/:id
```

Cancel a job (only allowed for PENDING or QUEUED jobs).

## Adding New Modules

To add a new feature module:

```bash
# Generate a new module
nest g module modules/module-name
nest g controller modules/module-name
nest g service modules/module-name
```

Then add Swagger decorators to document your endpoints:

```typescript
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('module-name')
@Controller('module-name')
export class ModuleNameController {
  @Get()
  @ApiOperation({ summary: 'Get all items' })
  @ApiResponse({ status: 200, description: 'Returns all items' })
  findAll() {
    // implementation
  }
}
```

## Docker

### Build the Docker image

```bash
docker build -t systemvibe-api .
```

### Run with Docker Compose

From the project root:

```bash
cd infra/docker
docker compose up -d api
```

## Testing

```bash
# Run all unit tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:cov

# Run E2E tests (requires PostgreSQL and Redis)
npm run test:e2e

# Run specific test file
npm test -- jobs.service.spec.ts
```

## Logging

The API uses Pino for structured logging. Logs are output to stdout in JSON format.

For development, you can use `pino-pretty` for readable logs:

```bash
npm run dev | pino-pretty
```

## Error Handling

Global exception filters are configured to handle errors consistently across the application. Custom filters can be added in the `src/filters/` directory.

## Database

The API uses Prisma ORM for database operations. The schema is defined in `packages/database/prisma/schema.prisma`.

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

### View Prisma Studio

```bash
cd packages/database
npx prisma studio
```

## Redis

Redis is used for caching, session storage, and job queuing with BullMQ.

### Access Redis CLI

```bash
docker exec -it systemvibe-redis redis-cli
```

### Check BullMQ Queue

```bash
# Check queue keys
KEYS "bull:jobs:*"

# Check queue length
LLEN bull:jobs:waiting

# Check job data
HGETALL bull:jobs:<job_id>
```

## Contributing

1. Follow the existing code style
2. Add Swagger decorators to all new endpoints (@ApiTags, @ApiOperation, @ApiResponse)
3. Write unit tests for service logic
4. Write E2E tests for API endpoints
5. Run linting before committing: `npm run lint`
6. Run tests before committing: `npm test` and `npm run test:e2e`
7. Update this README when adding new modules or endpoints

## License

MIT
