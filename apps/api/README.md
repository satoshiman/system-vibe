# SystemVibe API

NestJS RESTful API server for SystemVibe platform.

## Overview

This is the main API server built with NestJS, providing RESTful endpoints for the SystemVibe distributed systems platform. It includes health checks, database integration with PostgreSQL, caching with Redis, and Swagger API documentation.

## Tech Stack

- **Framework**: NestJS 10.x
- **Language**: TypeScript 5.x
- **Database**: PostgreSQL 16 (via pg)
- **Cache/Queue**: Redis 7 (via ioredis)
- **Logging**: Pino
- **API Documentation**: Swagger/OpenAPI

## Prerequisites

- Node.js 20+
- npm or yarn
- PostgreSQL (running locally or via Docker)
- Redis (running locally or via Docker)

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

### Available Scripts

- `npm run dev` - Start in development mode with hot reload
- `npm run build` - Build the project
- `npm start` - Start the production build
- `npm test` - Run tests
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier

## Project Structure

```
apps/api/
├── src/
│   ├── modules/          # Feature modules
│   │   └── health/       # Health check module
│   ├── common/           # Common utilities and decorators
│   ├── config/           # Configuration files
│   ├── guards/           # Authentication guards
│   ├── interceptors/     # Request/response interceptors
│   ├── filters/          # Exception filters
│   ├── app.module.ts     # Root module
│   └── main.ts           # Application entry point
├── dist/                 # Compiled JavaScript
├── Dockerfile            # Docker image configuration
├── package.json          # Dependencies and scripts
└── tsconfig.json         # TypeScript configuration
```

## API Endpoints

### Health Check

```
GET /api/health
```

Returns the health status of API, database, and Redis services.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-05-23T05:22:00.000Z",
  "services": {
    "api": "healthy",
    "database": "healthy",
    "redis": "healthy"
  },
  "version": "0.1.0"
}
```

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
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run tests with coverage
npm test -- --coverage
```

## Logging

The API uses Pino for structured logging. Logs are output to stdout in JSON format.

For development, you can use `pino-pretty` for readable logs:

```bash
npm run dev | pino-pretty
```

## Error Handling

Global exception filters are configured to handle errors consistently across the application. Custom filters can be added in the `src/filters/` directory.

## Contributing

1. Follow the existing code style
2. Add Swagger decorators to all new endpoints
3. Write tests for new features
4. Run linting before committing: `npm run lint`

## License

MIT
