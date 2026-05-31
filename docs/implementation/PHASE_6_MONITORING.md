# Phase 6: Monitoring & Logging

## Overview

Phase 6 implements comprehensive observability for SystemVibe using Prometheus for metrics collection, Grafana for visualization, and Pino for structured logging with correlation IDs.

## Goals

- Collect and expose Prometheus metrics from the API
- Visualize metrics with Grafana dashboards
- Implement structured logging with Pino
- Add correlation IDs for distributed tracing
- Monitor queue depth, job processing times, and worker health

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    SystemVibe Architecture                       │
│                                                                  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │   API       │    │   Worker    │    │   Worker    │         │
│  │   Server    │    │   Image     │    │   Image 2   │         │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘         │
│         │                  │                  │                 │
│         └──────────────────┼──────────────────┘                 │
│                            │                                    │
│         ┌──────────────────▼──────────────────┐                 │
│         │           Redis Queue              │                 │
│         │         (BullMQ Metrics)           │                 │
│         └──────────────────┬──────────────────┘                 │
│                            │                                    │
│  ┌─────────────────────────▼─────────────────────────┐       │
│  │              Prometheus Metrics                    │       │
│  │  - Queue depth                                     │       │
│  │  - Job processing time                             │       │
│  │  - Success/failure rates                         │       │
│  │  - Worker uptime                                 │       │
│  └─────────────────────────┬─────────────────────────┘       │
│                            │                                    │
│  ┌─────────────────────────▼─────────────────────────┐       │
│  │              Grafana Dashboards                    │       │
│  │  - Real-time metrics visualization               │       │
│  │  - Queue monitoring panels                       │       │
│  │  - Alert configurations                          │       │
│  └───────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

## Prerequisites

- Phase 1-5 completed
- Redis and PostgreSQL running
- API server and worker running
- Docker Compose environment ready

## Implementation Steps

### Step 1: Install Prometheus Dependencies

```bash
npm install --workspace=apps/api prom-client @nestjs/prometheus
```

### Step 2: Create Metrics Service

Create `apps/api/src/modules/metrics/metrics.service.ts`:

```typescript
import { Injectable } from "@nestjs/common";
import { Registry, Counter, Histogram, Gauge } from "prom-client";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";

@Injectable()
export class MetricsService {
  private readonly registry: Registry;

  // Job metrics
  public readonly jobCompletedCounter: Counter;
  public readonly jobFailedCounter: Counter;
  public readonly jobDurationHistogram: Histogram;

  // Queue metrics
  public readonly queueDepthGauge: Gauge;

  // Worker metrics
  public readonly workerOnlineGauge: Gauge;

  constructor(@InjectQueue("image") private imageQueue: Queue) {
    this.registry = new Registry();

    // Initialize counters
    this.jobCompletedCounter = new Counter({
      name: "systemvibe_job_completed_total",
      help: "Total number of completed jobs",
      labelNames: ["type", "status"],
      registers: [this.registry],
    });

    this.jobFailedCounter = new Counter({
      name: "systemvibe_job_failed_total",
      help: "Total number of failed jobs",
      labelNames: ["type"],
      registers: [this.registry],
    });

    // Initialize histograms
    this.jobDurationHistogram = new Histogram({
      name: "systemvibe_job_duration_seconds",
      help: "Job processing duration in seconds",
      labelNames: ["type"],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
      registers: [this.registry],
    });

    // Initialize gauges
    this.queueDepthGauge = new Gauge({
      name: "systemvibe_queue_depth",
      help: "Current number of jobs in queue",
      labelNames: ["queue"],
      registers: [this.registry],
    });

    this.workerOnlineGauge = new Gauge({
      name: "systemvibe_worker_online",
      help: "Number of online workers",
      labelNames: ["type"],
      registers: [this.registry],
    });
  }

  getMetrics(): string {
    return this.registry.metrics();
  }

  async updateQueueMetrics(): Promise<void> {
    const counts = await this.imageQueue.getJobCounts();
    this.queueDepthGauge.set({ queue: "image" }, counts.waiting);
  }
}
```

### Step 3: Create Metrics Controller

Create `apps/api/src/modules/metrics/metrics.controller.ts`:

```typescript
import { Controller, Get, Res } from "@nestjs/common";
import { Response } from "express";
import { MetricsService } from "./metrics.service";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";

@ApiTags("metrics")
@Controller("metrics")
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @ApiOperation({ summary: "Get Prometheus metrics" })
  @ApiResponse({
    status: 200,
    description: "Prometheus metrics in text format",
  })
  async getMetrics(@Res() res: Response): Promise<void> {
    const metrics = await this.metricsService.getMetrics();
    res.set("Content-Type", "text/plain");
    res.send(metrics);
  }
}
```

### Step 4: Create Metrics Module

Create `apps/api/src/modules/metrics/metrics.module.ts`:

```typescript
import { Module } from "@nestjs/common";
import { MetricsController } from "./metrics.controller";
import { MetricsService } from "./metrics.service";
import { QueueModule } from "../queue/queue.module";

@Module({
  imports: [QueueModule],
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
```

### Step 5: Update App Module

Update `apps/api/src/app.module.ts`:

```typescript
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { HealthModule } from "./modules/health/health.module";
import { AuthModule } from "./modules/auth/auth.module";
import { JobsModule } from "./modules/jobs/jobs.module";
import { WebsocketModule } from "./modules/websocket/websocket.module";
import { MetricsModule } from "./modules/metrics/metrics.module";
import { MetricsInterceptor } from "./modules/metrics/metrics.interceptor";
import queueConfig from "./config/queue.config";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [queueConfig],
    }),
    HealthModule,
    AuthModule,
    JobsModule,
    WebsocketModule,
    MetricsModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: MetricsInterceptor,
    },
  ],
})
export class AppModule {}
```

### Step 6: Add Prometheus and Grafana to Docker Compose

Update `infra/docker/docker-compose.yml`:

```yaml
  prometheus:
    image: prom/prometheus:latest
    container_name: systemvibe-prometheus
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    ports:
      - "9090:9090"
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
    networks:
      - systemvibe

  grafana:
    image: grafana/grafana:latest
    container_name: systemvibe-grafana
    volumes:
      - grafana_data:/var/lib/grafana
      - ./grafana/provisioning:/etc/grafana/provisioning:ro
      - ./grafana/dashboards:/var/lib/grafana/dashboards:ro
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_USER=admin
      - GF_SECURITY_ADMIN_PASSWORD=admin
      - GF_USERS_ALLOW_SIGN_UP=false
      - GF_SERVER_ROOT_URL=http://localhost:3001
    networks:
      - systemvibe
    depends_on:
      - prometheus

volumes:
  prometheus_data:
  grafana_data:
```

### Step 7: Create Prometheus Configuration

Create `infra/docker/prometheus.yml`:

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: "systemvibe-api"
    static_configs:
      - targets: ["host.docker.internal:3000"]
    metrics_path: /api/metrics
    scrape_interval: 5s
```

### Step 8: Setup Correlation IDs with pino-http

Install dependency:

```bash
npm install --workspace=apps/api pino-http uuid
npm install --save-dev --workspace=apps/api @types/uuid
```

Update `apps/api/src/main.ts` to configure correlation IDs:

```typescript
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import pino from "pino";
import pinoHttp from "pino-http";
import { v4 as uuidv4 } from "uuid";
import { env } from "@systemvibe/config";

// Create root logger with base properties
const logger = pino({
  level: env.LOG_LEVEL || "info",
  base: {
    service: "systemvibe-api",
    version: "0.1.0",
  },
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: false, // Disable default NestJS logger, use Pino instead
  });

  // Configure pino-http with correlation IDs
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        // Check for incoming correlation ID from headers
        const existingId = req.headers["x-correlation-id"] as string;
        if (existingId) {
          return existingId;
        }
        // Generate new correlation ID
        const id = uuidv4();
        res.setHeader("X-Correlation-Id", id);
        return id;
      },
      customProps: (req, res) => ({
        correlationId: req.id,
        userId: (req as any).user?.id,
      }),
      // Redact sensitive fields
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie"],
        remove: true,
      },
    }),
  );

  // Enable CORS
  app.enableCors({
    origin: "*",
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    credentials: true,
  });

  app.setGlobalPrefix("api");

  // ... rest of bootstrap (Swagger, BullMQ Board, etc.) ...

  const port = env.API_PORT;
  await app.listen(port, "0.0.0.0");
  logger.info(`API Server running on http://localhost:${port}`);
}

bootstrap().catch((err) => {
  logger.error(err, "Failed to start API");
  process.exit(1);
});
```

### Step 9: Update Worker to Use Correlation IDs

Update `apps/worker-image/src/image.processor.ts` to receive and log correlation IDs:

```typescript
import { Processor, WorkerHost, OnWorkerEvent } from "@nestjs/bullmq";
import { Job } from "bullmq";
import pino from "pino";
import { env } from "@systemvibe/config";

// Logger factory that includes correlation ID
const createLogger = (correlationId?: string) => {
  return pino({
    level: env.LOG_LEVEL,
    base: {
      service: "worker-image",
      correlationId: correlationId || "unknown",
    },
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
      },
    },
  });
};

@Processor("image")
export class ImageProcessor extends WorkerHost {
  private jobLoggers = new Map<string, any>();

  async process(job: Job): Promise<any> {
    // Get correlation ID from job data (passed by API)
    const correlationId = job.data.correlationId as string;

    // Create job-specific logger with correlation ID
    const logger = createLogger(correlationId);
    this.jobLoggers.set(job.id!, logger);

    logger.info("Job started processing", {
      jobId: job.id,
      type: job.name,
      correlationId,
    });

    // ... processing logic ...
  }

  @OnWorkerEvent("completed")
  async onCompleted(job: Job, result: any) {
    const logger = this.jobLoggers.get(job.id!) || createLogger();

    logger.info("Job completed", {
      jobId: job.id,
      result,
      correlationId: job.data.correlationId,
    });

    // Publish to Redis with correlation ID
    await redis.publish(
      "job:metrics",
      JSON.stringify({
        jobId: job.id,
        type: job.name,
        status: "completed",
        correlationId: job.data.correlationId,
        duration: job.data.duration,
      }),
    );

    this.jobLoggers.delete(job.id!);
  }

  @OnWorkerEvent("failed")
  async onFailed(job: Job, error: Error) {
    const logger = this.jobLoggers.get(job.id!) || createLogger();

    logger.error("Job failed", {
      jobId: job.id,
      error: error.message,
      correlationId: job.data.correlationId,
    });

    this.jobLoggers.delete(job.id!);
  }
}
```

### Step 10: Pass Correlation ID from API to Worker

Update `apps/api/src/modules/jobs/jobs.service.ts` to include correlation ID in job data:

```typescript
import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { PrismaService } from "@systemvibe/database";
import { CreateJobDto } from "./dto/create-job.dto";

@Injectable()
export class JobsService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue("image") private imageQueue: Queue,
  ) {}

  async create(
    createJobDto: CreateJobDto,
    correlationId?: string,
    userId?: string,
  ): Promise<JobResponseDto> {
    // Create job in database
    const job = await this.prisma.job.create({
      data: {
        type: createJobDto.type,
        payload: createJobDto.payload as any,
        priority: createJobDto.priority || "normal",
        status: "PENDING",
        userId: userId || null,
      },
    });

    // Add to queue with correlation ID for tracing
    await this.imageQueue.add(
      createJobDto.type,
      {
        jobId: job.id,
        type: createJobDto.type,
        payload: createJobDto.payload,
        correlationId, // Pass correlation ID to worker
        userId,
      },
      {
        jobId: job.id,
        priority: this.getPriorityValue(createJobDto.priority || "normal"),
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
      },
    );

    // Update status
    const updatedJob = await this.prisma.job.update({
      where: { id: job.id },
      data: { status: "QUEUED" },
    });

    return this.toJobResponseDto(updatedJob);
  }
}
```

### Step 11: Configure Log Persistence in Docker Compose

Update `infra/docker/docker-compose.yml` to persist logs:

```yaml
services:
  api:
    build:
      context: ../../apps/api
      dockerfile: Dockerfile
    container_name: systemvibe-api
    environment:
      - LOG_LEVEL=info
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
        labels: "service,environment"
        env: "OS_VERSION"
    volumes:
      - api_logs:/app/logs
    networks:
      - systemvibe

  worker-image:
    build:
      context: ../../apps/worker-image
      dockerfile: Dockerfile
    container_name: systemvibe-worker-image
    environment:
      - LOG_LEVEL=info
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
    volumes:
      - worker_logs:/app/logs
    networks:
      - systemvibe

  # Optional: Loki for centralized log aggregation
  loki:
    image: grafana/loki:latest
    container_name: systemvibe-loki
    ports:
      - "3100:3100"
    volumes:
      - ./loki-config.yml:/etc/loki/local-config.yaml
      - loki_data:/loki
    command: -config.file=/etc/loki/local-config.yaml
    networks:
      - systemvibe

volumes:
  api_logs:
  worker_logs:
  loki_data:
```

### Step 12: View Logs with Correlation IDs

**View API logs:**

```bash
# Real-time logs with correlation IDs
docker compose logs -f api

# Logs with specific correlation ID
docker compose logs api | grep "550e8400-e29b-41d4-a716-446655440000"

# JSON logs (structured)
docker inspect --format='{{.LogPath}}' systemvibe-api
sudo cat $(docker inspect --format='{{.LogPath}}' systemvibe-api) | jq
```

**View Worker logs:**

```bash
docker compose logs -f worker-image
```

**Query logs with Loki (if enabled):**

```bash
# Query by correlation ID
curl "http://localhost:3100/loki/api/v1/query?query={service=\"systemvibe-api\"} |= \"550e8400-e29b-41d4-a716-446655440000\""
```

### Step 13: Update Worker to Report Metrics

Update `apps/worker-image/src/image.processor.ts` to track job metrics:

```typescript
import { Job } from "bullmq";
import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";

@Processor("image")
export class ImageProcessor extends WorkerHost {
  private jobStartTimes = new Map<string, number>();

  async process(job: Job): Promise<any> {
    // Record start time
    this.jobStartTimes.set(job.id!, Date.now());

    // ... existing processing logic ...
  }

  @OnWorkerEvent("completed")
  async onCompleted(job: Job, result: any) {
    const startTime = this.jobStartTimes.get(job.id!);
    const duration = startTime ? (Date.now() - startTime) / 1000 : 0;

    // Publish metrics to Redis for API to collect
    await redis.publish(
      "job:metrics",
      JSON.stringify({
        jobId: job.id,
        type: job.name,
        status: "completed",
        duration,
      }),
    );

    this.jobStartTimes.delete(job.id!);
  }

  @OnWorkerEvent("failed")
  async onFailed(job: Job, error: Error) {
    await redis.publish(
      "job:metrics",
      JSON.stringify({
        jobId: job.id,
        type: job.name,
        status: "failed",
        error: error.message,
      }),
    );

    this.jobStartTimes.delete(job.id!);
  }
}
```

## Metrics Available

After implementation, the following metrics will be available at `/api/metrics`:

| Metric                            | Type      | Description           |
| --------------------------------- | --------- | --------------------- |
| `systemvibe_job_completed_total`  | Counter   | Total completed jobs  |
| `systemvibe_job_failed_total`     | Counter   | Total failed jobs     |
| `systemvibe_job_duration_seconds` | Histogram | Job processing time   |
| `systemvibe_queue_depth`          | Gauge     | Jobs waiting in queue |
| `systemvibe_worker_online`        | Gauge     | Active workers        |

## Grafana Dashboard

Create a dashboard with panels for:

1. **Queue Depth** - Real-time queue size
2. **Job Processing Rate** - Jobs/minute
3. **Success/Failure Ratio** - Pie chart
4. **Average Processing Time** - Trend over time
5. **Worker Status** - Online/offline workers

## Testing

### 1. Start Services

```bash
cd infra/docker
docker compose up -d prometheus grafana
```

### 2. Verify Metrics Endpoint

```bash
curl http://localhost:3000/api/metrics
```

### 3. Access Grafana

- Open http://localhost:3001
- Login: admin/admin
- Import the SystemVibe dashboard

### 4. Verify Prometheus

- Open http://localhost:9090
- Query: `systemvibe_queue_depth`

## Troubleshooting

### Metrics Not Available

- Check if API is running: `curl http://localhost:3000/api/health`
- Verify Prometheus config targets
- Check Prometheus logs: `docker compose logs prometheus`

### Grafana No Data

- Verify Prometheus is data source in Grafana
- Check time range in dashboard
- Ensure metrics are being scraped

## Next Steps

After completing Phase 6:

1. **Phase 7**: Implement webhook notifications
2. **Add alerts**: Configure alert rules in Prometheus
3. **Log aggregation**: Add Loki for centralized logging
4. **Distributed tracing**: Implement OpenTelemetry/Jaeger

## Log Output Examples

### Structured Log with Correlation ID

**API Log:**

```json
{
  "level": 30,
  "time": 1717152345678,
  "pid": 12345,
  "hostname": "api-pod-1",
  "service": "systemvibe-api",
  "version": "0.1.0",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "user-123",
  "msg": "Job created",
  "jobId": "job-456",
  "type": "image-resize"
}
```

**Worker Log (same correlation ID):**

```json
{
  "level": 30,
  "time": 1717152346000,
  "pid": 67890,
  "hostname": "worker-image-abc",
  "service": "worker-image",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "msg": "Job completed",
  "jobId": "job-456",
  "durationMs": 1234,
  "result": { "outputUrl": "https://storage.example.com/result.jpg" }
}
```

### Pretty Print Output (Development)

```
[08:30:45.123] INFO (12345): Job created
    service: "systemvibe-api"
    correlationId: "550e8400-e29b-41d4-a716-446655440000"
    userId: "user-123"
    jobId: "job-456"
    type: "image-resize"

[08:30:46.456] INFO (67890): Job completed
    service: "worker-image"
    correlationId: "550e8400-e29b-41d4-a716-446655440000"
    jobId: "job-456"
    durationMs: 1234
```

## Summary

Phase 6 adds production-grade observability with:

- **Prometheus** for metrics collection
- **Grafana** for visualization
- **Structured logging** with Pino
- **Correlation IDs** for distributed tracing across API → Queue → Worker
- **Log persistence** with Docker JSON file driver and log rotation
- **Cross-service tracing** with same correlation ID in all logs
- **Real-time monitoring** of queues and workers

This provides complete visibility into system health, performance, and request tracing for production deployments.
