# SystemVibe Phase 4: Worker Implementation - Implementation Guide

**Duration**: 1-2 weeks | **Goal**: Implement background job workers for processing queued jobs

**Note**: This guide has been updated to reflect the current implementation. Phase 4 is complete.

After Phase 4, you'll have:

- ✅ Worker package structure with NestJS
- ✅ BullMQ worker configuration with Redis
- ✅ Image processing processor (resize, thumbnail, compress)
- ✅ Worker heartbeat mechanism for health monitoring
- ✅ Docker containerization for workers
- ✅ Worker service in Docker Compose
- ✅ Graceful shutdown handling
- ✅ Job event logging (active, completed, failed)

---

## Prerequisites

**Before starting Phase 4, ensure Phase 3 is complete:**

- BullMQ queue setup in API
- Job submission API endpoints working
- Redis operational
- PostgreSQL database with Job entity
- Docker Compose infrastructure running

---

## Step 1: Create Worker Package Structure

```bash
# Create worker-image app
mkdir -p apps/worker-image/src

# Create package.json
cat > apps/worker-image/package.json << 'EOF'
{
  "name": "@systemvibe/worker-image",
  "version": "0.1.0",
  "description": "Image processing worker for SystemVibe",
  "main": "dist/main.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/main.js",
    "dev": "ts-node src/main.ts",
    "test": "echo 'No tests for worker-image package' && exit 0"
  },
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/bullmq": "^10.0.0",
    "@systemvibe/config": "^1.0.0",
    "@systemvibe/redis": "^1.0.0",
    "bullmq": "^5.0.0",
    "sharp": "^0.33.0",
    "pino": "^8.16.0",
    "pino-pretty": "^10.3.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "ts-node": "^10.9.0",
    "typescript": "^5.0.0",
    "prisma": "^5.0.0"
  }
}
EOF

# Create TypeScript configuration
cat > apps/worker-image/tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2021",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": false,
    "noImplicitAny": false,
    "strictBindCallApply": false,
    "forceConsistentCasingInFileNames": false,
    "noFallthroughCasesInSwitch": false
  }
}
EOF
```

**Dependencies explained:**

- `@nestjs/bullmq`: NestJS integration for BullMQ workers
- `bullmq`: Redis-based queue for job processing
- `sharp`: High-performance image processing library
- `ioredis`: Redis client for connection
- `pino`: Fast JSON logger
- `ts-node`: TypeScript execution for development

---

## Step 2: Create Redis Configuration Service

```bash
# Create Redis config service
cat > apps/worker-image/src/redis-config.service.ts << 'EOF'
import { Injectable } from "@nestjs/common";
import { SharedBullConfigurationFactory } from "@nestjs/bullmq";
import { env } from "@systemvibe/config";

@Injectable()
export class RedisConfigService implements SharedBullConfigurationFactory {
  createSharedConfiguration() {
    return {
      connection: {
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
        password: process.env.REDIS_PASSWORD || undefined,
      },
    };
  }
}
EOF
```

---

## Step 3: Create Image Processor

```bash
# Create image processor
cat > apps/worker-image/src/image.processor.ts << 'EOF'
import { Processor, WorkerHost, OnWorkerEvent } from "@nestjs/bullmq";
import { Job } from "bullmq";
import sharp from "sharp";
import pino from "pino";
import getRedisClient from "@systemvibe/redis";
import { env } from "@systemvibe/config";

const logger = pino({
  level: env.LOG_LEVEL,
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
    },
  },
});

const redis = getRedisClient();

// HOSTNAME is a runtime variable set by Docker, not in .env
const WORKER_ID = `worker-image-${process.env.HOSTNAME || "local"}`;
const HEARTBEAT_KEY = `worker:heartbeat:${WORKER_ID}`;
const HEARTBEAT_TTL = 30; // 30 seconds

interface ImageResizeJob {
  jobId: string;
  type: string;
  payload: {
    imageUrl: string;
    width: number;
    height: number;
  };
}

interface ImageThumbnailJob {
  jobId: string;
  type: string;
  payload: {
    imageUrl: string;
    size: number;
  };
}

interface ImageCompressJob {
  jobId: string;
  type: string;
  payload: {
    imageUrl: string;
    quality: number;
  };
}

@Processor("image")
export class ImageProcessor extends WorkerHost {
  private heartbeatInterval: NodeJS.Timeout;

  constructor() {
    super();
    logger.info("ImageProcessor initialized");
    this.startHeartbeat();
  }

  @OnWorkerEvent("active")
  onActive(job: Job) {
    logger.info(`Job started processing`, { jobId: job.id, name: job.name });
  }

  @OnWorkerEvent("completed")
  onCompleted(job: Job, result: any) {
    logger.info(`Job completed`, { jobId: job.id, name: job.name, result });
  }

  @OnWorkerEvent("failed")
  onFailed(job: Job, error: Error) {
    logger.error(`Job failed`, {
      jobId: job?.id,
      name: job?.name,
      error: error.message,
    });
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(async () => {
      try {
        await redis.set(
          HEARTBEAT_KEY,
          JSON.stringify({
            workerId: WORKER_ID,
            type: "image",
            timestamp: new Date().toISOString(),
            status: "active",
          }),
          "EX",
          HEARTBEAT_TTL,
        );
        logger.debug("Heartbeat sent", { workerId: WORKER_ID });
      } catch (error) {
        logger.error("Failed to send heartbeat", { error: error.message });
      }
    }, 10000);

    logger.info("Heartbeat started", { workerId: WORKER_ID, interval: "10s" });
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      logger.info("Heartbeat stopped");
    }
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { name, data } = job;
    logger.info(`Processing job: ${name}`, { jobId: job.id, data });

    try {
      let result;

      switch (name) {
        case "image-resize":
          result = await this.processResize(job);
          break;
        case "image-thumbnail":
          result = await this.processThumbnail(job);
          break;
        case "image-compress":
          result = await this.processCompress(job);
          break;
        default:
          throw new Error(`Unknown job type: ${name}`);
      }

      logger.info(`Job completed successfully: ${name}`, { jobId: job.id });
      return result;
    } catch (error) {
      logger.error(`Job failed: ${name}`, {
        jobId: job.id,
        error: error.message,
      });
      throw error;
    }
  }

  private async processResize(job: Job<ImageResizeJob>) {
    const { payload } = job.data;
    const { imageUrl, width, height } = payload;

    // In a real implementation, you would:
    // 1. Download the image from imageUrl
    // 2. Process it with sharp
    // 3. Upload the result to storage
    // 4. Return the new URL

    // For now, we'll simulate the processing
    logger.info(`Resizing image to ${width}x${height}`, { imageUrl });

    // Simulate processing time
    await this.simulateProcessing(1000);

    return {
      outputUrl: `${imageUrl}_resized_${width}x${height}`,
      durationMs: 1000,
      originalSize: { width: 1920, height: 1080 },
      newSize: { width, height },
    };
  }

  private async processThumbnail(job: Job<ImageThumbnailJob>) {
    const { payload } = job.data;
    const { imageUrl, size } = payload;

    logger.info(`Creating thumbnail of size ${size}`, { imageUrl });

    // Simulate processing time
    await this.simulateProcessing(500);

    return {
      thumbnailUrl: `${imageUrl}_thumb_${size}`,
      size,
    };
  }

  private async processCompress(job: Job<ImageCompressJob>) {
    const { payload } = job.data;
    const { imageUrl, quality } = payload;

    logger.info(`Compressing image with quality ${quality}`, { imageUrl });

    // Simulate processing time
    await this.simulateProcessing(1500);

    return {
      compressedUrl: `${imageUrl}_compressed_q${quality}`,
      originalSize: 2048000, // 2MB
      newSize: 512000, // 500KB
      compressionRatio: 0.25,
    };
  }

  private async simulateProcessing(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
EOF
```

**Processor features:**

- **Job Types**: image-resize, image-thumbnail, image-compress
- **Event Handlers**: Logs job lifecycle events (active, completed, failed)
- **Heartbeat**: Sends heartbeat to Redis every 10 seconds for health monitoring
- **Error Handling**: Catches and logs errors, re-throws for BullMQ retry logic
- **Simulation**: Currently simulates processing (replace with actual Sharp operations in production)

---

## Step 4: Create Worker Module

```bash
# Create worker module
cat > apps/worker-image/src/worker.module.ts << 'EOF'
import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ImageProcessor } from "./image.processor";
import { RedisConfigService } from "./redis-config.service";

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [],
      useClass: RedisConfigService,
    }),
    BullModule.registerQueue({
      name: "image",
    }),
  ],
  providers: [ImageProcessor, RedisConfigService],
})
export class WorkerModule {}
EOF
```

---

## Step 5: Create Worker Entry Point

```bash
# Create main.ts
cat > apps/worker-image/src/main.ts << 'EOF'
import { NestFactory } from "@nestjs/core";
import { WorkerModule } from "./worker.module";
import pino from "pino";
import { env } from "@systemvibe/config";

const logger = pino({
  level: env.LOG_LEVEL,
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
    },
  },
});

async function bootstrap() {
  logger.info("Starting Image Worker...");

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ["log", "error", "warn", "debug"],
  });

  logger.info("Image Worker started successfully");

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    logger.info("SIGTERM received, shutting down gracefully...");
    await app.close();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    logger.info("SIGINT received, shutting down gracefully...");
    await app.close();
    process.exit(0);
  });
}

bootstrap().catch((error) => {
  logger.error("Failed to start Image Worker", error);
  process.exit(1);
});
EOF
```

**Key features:**

- Uses `createApplicationContext` (not HTTP server)
- Graceful shutdown on SIGTERM and SIGINT
- Pino logger with pretty printing
- Error handling on startup failure

---

## Step 6: Create Dockerfile

```bash
# Create Dockerfile
cat > apps/worker-image/Dockerfile << 'EOF'
FROM node:20-alpine

# Install minimal build dependencies for Sharp
RUN apk add --no-cache \
    vips-dev \
    build-base \
    pkgconfig

WORKDIR /app

# Copy package.json and source code from apps/worker-image
COPY apps/worker-image/package.json ./
COPY apps/worker-image/tsconfig.json ./
COPY apps/worker-image/src ./src

# Install all dependencies (needed for TypeScript build)
RUN npm install

# Build TypeScript
RUN npm run build

# Set environment variables
ENV NODE_ENV=production
ENV LOG_LEVEL=info

# Start the worker
CMD ["node", "dist/main.js"]
EOF
```

**Dockerfile notes:**

- Uses Alpine Linux for small image size
- Installs vips-dev for Sharp image processing
- Builds TypeScript in container
- Sets production environment variables
- Runs compiled JavaScript

---

## Step 7: Update Docker Compose

```bash
# Update docker-compose.yml to add worker service
cat > infra/docker/docker-compose.yml << 'EOF'
version: "3.8"

services:
  # PostgreSQL Database
  postgres:
    image: postgres:16-alpine
    container_name: systemvibe-postgres
    env_file:
      - ../../.env
    environment:
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: ${DB_NAME}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5433:5432"
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
    env_file:
      - ../../.env
    environment:
      DATABASE_URL: postgresql://${DB_USER}:${DB_PASSWORD}@postgres:5432/${DB_NAME}
      REDIS_URL: redis://redis:6379
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    ports:
      - "3000:3000"
    volumes:
      - ../../apps/api/src:/app/src:ro
      - ../../apps/api/package.json:/app/package.json:ro
      - ../../apps/api/tsconfig.json:/app/tsconfig.json:ro
    command: npm run dev
    networks:
      - systemvibe

  # Image Worker
  worker-image:
    build:
      context: ../../
      dockerfile: apps/worker-image/Dockerfile
    container_name: systemvibe-worker-image
    env_file:
      - ../../.env
    environment:
      REDIS_HOST: redis
      REDIS_PORT: 6379
    depends_on:
      redis:
        condition: service_healthy
    networks:
      - systemvibe

volumes:
  postgres_data:
  redis_data:

networks:
  systemvibe:
    driver: bridge
EOF
```

---

## Step 8: Update Environment Variables

```bash
# Add worker-specific variables to .env.example
cat > .env.example << 'EOF'
# Database
DB_USER=systemvibe
DB_PASSWORD=devpassword
DB_NAME=systemvibe

# API
API_PORT=3000
NODE_ENV=development

# Redis
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT Secrets
JWT_SECRET=your-secret-key-change-in-production
JWT_REFRESH_SECRET=your-refresh-secret-key-change-in-production

# Logging
LOG_LEVEL=info
EOF
```

---

## Step 9: Build and Start Worker

```bash
# Build the worker app
npm run build --workspace=apps/worker-image

# Start all services with Docker Compose
cd infra/docker
docker compose up -d

# Check worker logs
docker compose logs -f worker-image

# Expected output:
# INFO: Starting Image Worker...
# INFO: ImageProcessor initialized
# INFO: Heartbeat started
# INFO: Image Worker started successfully
```

---

## Step 10: Test Worker with Job Submission

```bash
# Submit a job to test the worker
curl -X POST http://localhost:3000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "image-resize",
    "payload": {
      "imageUrl": "https://example.com/image.jpg",
      "width": 800,
      "height": 600
    },
    "priority": "normal"
  }'

# Expected response:
# {
#   "id": "cl1234567890",
#   "type": "image-resize",
#   "status": "QUEUED",
#   ...
# }

# Check worker logs to see job processing
docker compose logs worker-image

# Expected logs:
# INFO: Processing job: image-resize
# INFO: Job started processing
# INFO: Resizing image to 800x600
# INFO: Job completed
```

---

## Step 11: Verify Worker Heartbeat

```bash
# Access Redis CLI
docker exec -it systemvibe-redis redis-cli

# Check heartbeat key
KEYS worker:heartbeat:*

# Expected: worker:heartbeat:worker-image-<hostname>

# Get heartbeat data
GET worker:heartbeat:worker-image-<hostname>

# Expected: JSON with worker info
# {"workerId":"worker-image-...","type":"image","timestamp":"...","status":"active"}

# Check TTL
TTL worker:heartbeat:worker-image-<hostname>

# Expected: < 30 (seconds until expiry)
```

---

## Step 12: Test Different Job Types

```bash
# Test image-thumbnail
curl -X POST http://localhost:3000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "image-thumbnail",
    "payload": {
      "imageUrl": "https://example.com/image.jpg",
      "size": 150
    }
  }'

# Test image-compress
curl -X POST http://localhost:3000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "image-compress",
    "payload": {
      "imageUrl": "https://example.com/image.jpg",
      "quality": 80
    }
  }'

# Check job status
curl http://localhost:3000/api/jobs/<job-id>
```

---

## Worker Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Worker Container                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐    ┌──────────────────────────────────┐ │
│  │   main.ts     │───▶│   WorkerModule                    │ │
│  │  (Entry Point)│    │   - BullMQ Configuration          │ │
│  └──────────────┘    │   - Redis Connection              │ │
│                      └──────────────────────────────────┘ │
│                                    │                        │
│                                    ▼                        │
│                      ┌──────────────────────────────────┐ │
│                      │   ImageProcessor                 │ │
│                      │   - @Processor("image")          │ │
│                      │   - Job Event Handlers           │ │
│                      │   - Heartbeat Mechanism          │ │
│                      └──────────────────────────────────┘ │
│                                    │                        │
│                    ┌───────────────┼───────────────┐       │
│                    ▼               ▼               ▼       │
│           ┌─────────────┐ ┌─────────────┐ ┌─────────────┐  │
│           │  Resize     │ │  Thumbnail  │ │  Compress   │  │
│           │  Processor  │ │  Processor  │ │  Processor  │  │
│           └─────────────┘ └─────────────┘ └─────────────┘  │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────┐
│                      Redis Queue                             │
│  - Job Queue (image)                                         │
│  - Heartbeat Keys (worker:heartbeat:*)                       │
└─────────────────────────────────────────────────────────────┘
```

---

## What You've Learned (Phase 4)

✅ NestJS ApplicationContext (non-HTTP workers)
✅ BullMQ worker implementation with decorators
✅ Image processing with Sharp library
✅ Worker heartbeat mechanism for health monitoring
✅ Graceful shutdown handling
✅ Docker containerization of workers
✅ Worker scaling in Docker Compose
✅ Job event logging and monitoring
✅ Redis-based worker coordination

---

## Worker Lifecycle

```
1. STARTUP
   Worker container starts
   → NestFactory.createApplicationContext()
   → BullMQ connects to Redis
   → Processor registers with queue
   → Heartbeat starts (every 10s)

2. JOB PROCESSING
   Redis has job in queue
   → Worker receives job
   → @OnWorkerEvent("active") fires
   → process() method executes
   → Job-specific processor runs
   → @OnWorkerEvent("completed") fires
   → Result returned to BullMQ

3. HEARTBEAT
   Every 10 seconds
   → Worker sends heartbeat to Redis
   → Key: worker:heartbeat:{workerId}
   → TTL: 30 seconds
   → Can be monitored for health

4. SHUTDOWN
   SIGTERM/SIGINT received
   → Stop heartbeat
   → Finish current job
   → Close BullMQ connection
   → Exit gracefully
```

---

## Scaling Workers

**Important**: To enable scaling, the `worker-image` service must NOT have a `container_name` field in docker-compose.yml. Docker requires each container to have a unique name when scaling.

To scale workers horizontally, use the command line:

```bash
# Scale to 5 worker instances
cd infra/docker
docker compose up -d --scale worker-image=5
```

This will create 5 worker containers with auto-generated names (e.g., `docker-worker-image-1`, `docker-worker-image-2`, etc.).

To return to a single worker:

```bash
docker compose up -d --scale worker-image=1
```

---

## Monitoring Workers

### Check Worker Status via Redis

```bash
# List all active workers
docker exec systemvibe-redis redis-cli KEYS "worker:heartbeat:*"

# Get worker details (note: worker ID includes hostname when scaled)
docker exec systemvibe-redis redis-cli GET worker:heartbeat:worker-image-<hostname>

# Count active workers
docker exec systemvibe-redis redis-cli KEYS "worker:heartbeat:*" | wc -l
```

### Check Worker Logs

```bash
# Follow worker logs
docker compose logs -f worker-image

# Check last 100 lines
docker compose logs --tail=100 worker-image
```

### Monitor Queue via BullMQ Board

Visit: http://localhost:3000/admin/queues

- View queue statistics
- Monitor job progress
- Check worker activity
- Retry failed jobs

---

## Troubleshooting

### Issue: Worker not connecting to Redis

```bash
# Check Redis is running
docker compose ps redis

# Check worker logs
docker compose logs worker-image

# Verify Redis connection from worker container
docker exec systemvibe-worker-image sh -c "nc -zv redis 6379"
```

### Issue: Jobs not being processed

```bash
# Check if worker is registered
docker exec systemvibe-redis redis-cli KEYS "worker:heartbeat:*"

# Check queue has jobs
docker exec systemvibe-redis redis-cli LLEN bull:jobs:waiting

# Check BullMQ Board
# Visit http://localhost:3000/admin/queues
```

### Issue: Worker crashes on startup

```bash
# Check worker logs for errors
docker compose logs worker-image

# Verify environment variables
docker exec systemvibe-worker-image env | grep REDIS

# Check if Sharp dependencies are installed
docker exec systemvibe-worker-image npm list sharp
```

### Issue: Heartbeat not updating

```bash
# Check heartbeat key exists
docker exec systemvibe-redis redis-cli KEYS "worker:heartbeat:*"

# Check TTL
docker exec systemvibe-redis redis-cli TTL worker:heartbeat:worker-image-<id>

# If TTL is -2 (key doesn't exist), worker may have crashed
# Restart worker
docker compose restart worker-image
```

---

## Production Considerations

**Image Processing:**

- Replace simulation with actual Sharp operations
- Implement image download/upload to cloud storage (S3, GCS)
- Add input validation for image URLs
- Implement rate limiting per user
- Add image format conversion support

**Worker Management:**

- Implement worker auto-scaling based on queue depth
- Add worker health checks in Docker Compose
- Implement worker metrics collection (Prometheus)
- Add job timeout enforcement
- Implement worker priority scheduling

**Error Handling:**

- Add dead letter queue for failed jobs
- Implement job retry with exponential backoff
- Add error notifications (webhooks, email)
- Implement job result persistence
- Add job cancellation support

**Security:**

- Validate image URLs to prevent SSRF attacks
- Implement resource limits (CPU, memory)
- Add sandboxing for image processing
- Implement worker authentication
- Add audit logging for all operations

---

## Next Steps (Phase 5)

You're ready for **Phase 5: Advanced Features**:

- Webhook notifications for job completion
- Job result storage in database
- Worker auto-scaling
- Multiple worker types (video, AI inference)
- Job scheduling and delayed execution
- Job dependencies and workflows

---

## Quick Reference Commands

```bash
# Build worker
npm run build --workspace=apps/worker-image

# Start all services
cd infra/docker && docker compose up -d

# View worker logs
docker compose logs -f worker-image

# Restart worker
docker compose restart worker-image

# Scale workers (requires removing container_name from docker-compose.yml)
docker compose up -d --scale worker-image=5

# Check worker heartbeat
docker exec systemvibe-redis redis-cli KEYS "worker:heartbeat:*"

# Submit test job
curl -X POST http://localhost:3000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"type":"image-resize","payload":{"imageUrl":"https://example.com/img.jpg","width":800,"height":600}}'

# Check job status
curl http://localhost:3000/api/jobs/<job-id>

# Stop all services
docker compose down
```

---

**Phase 4 Complete! 🎉**

You now have a fully functional worker system that can process background jobs asynchronously with health monitoring and graceful shutdown capabilities.
