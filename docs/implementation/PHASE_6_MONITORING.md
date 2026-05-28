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
import { HealthModule } from "./modules/health/health.module";
import { AuthModule } from "./modules/auth/auth.module";
import { JobsModule } from "./modules/jobs/jobs.module";
import { WebsocketModule } from "./modules/websocket/websocket.module";
import { MetricsModule } from "./modules/metrics/metrics.module";
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
      - systemvibe-network

  grafana:
    image: grafana/grafana:latest
    container_name: systemvibe-grafana
    volumes:
      - grafana_data:/var/lib/grafana
      - ./grafana/dashboards:/etc/grafana/provisioning/dashboards
      - ./grafana/datasources:/etc/grafana/provisioning/datasources
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    networks:
      - systemvibe-network
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

### Step 8: Update Worker to Report Metrics

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

## Summary

Phase 6 adds production-grade observability with:

- **Prometheus** for metrics collection
- **Grafana** for visualization
- **Structured logging** with correlation IDs
- **Real-time monitoring** of queues and workers

This provides visibility into system health and performance for production deployments.
