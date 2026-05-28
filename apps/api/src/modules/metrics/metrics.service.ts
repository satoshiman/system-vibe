import { Injectable, Logger } from '@nestjs/common';
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { getRedisClient } from '@systemvibe/redis';

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  private readonly registry: Registry;

  // Job metrics
  public readonly jobCompletedCounter: Counter;
  public readonly jobFailedCounter: Counter;
  public readonly jobDurationHistogram: Histogram;

  // Queue metrics
  public readonly queueDepthGauge: Gauge;
  public readonly queueActiveGauge: Gauge;
  public readonly queueDelayedGauge: Gauge;
  public readonly queueFailedGauge: Gauge;

  // Worker metrics
  public readonly workerOnlineGauge: Gauge;
  public readonly workerJobsProcessedGauge: Gauge;

  // API metrics
  public readonly httpRequestCounter: Counter;
  public readonly httpRequestDuration: Histogram;

  constructor(@InjectQueue('image') private imageQueue: Queue) {
    this.registry = new Registry();

    // Initialize job counters
    this.jobCompletedCounter = new Counter({
      name: 'systemvibe_job_completed_total',
      help: 'Total number of completed jobs',
      labelNames: ['type', 'priority'],
      registers: [this.registry],
    });

    this.jobFailedCounter = new Counter({
      name: 'systemvibe_job_failed_total',
      help: 'Total number of failed jobs',
      labelNames: ['type'],
      registers: [this.registry],
    });

    // Initialize job duration histogram
    this.jobDurationHistogram = new Histogram({
      name: 'systemvibe_job_duration_seconds',
      help: 'Job processing duration in seconds',
      labelNames: ['type', 'status'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
      registers: [this.registry],
    });

    // Initialize queue gauges
    this.queueDepthGauge = new Gauge({
      name: 'systemvibe_queue_depth',
      help: 'Current number of jobs waiting in queue',
      labelNames: ['queue'],
      registers: [this.registry],
    });

    this.queueActiveGauge = new Gauge({
      name: 'systemvibe_queue_active',
      help: 'Current number of active jobs being processed',
      labelNames: ['queue'],
      registers: [this.registry],
    });

    this.queueDelayedGauge = new Gauge({
      name: 'systemvibe_queue_delayed',
      help: 'Current number of delayed jobs',
      labelNames: ['queue'],
      registers: [this.registry],
    });

    this.queueFailedGauge = new Gauge({
      name: 'systemvibe_queue_failed',
      help: 'Current number of failed jobs',
      labelNames: ['queue'],
      registers: [this.registry],
    });

    // Initialize worker gauges
    this.workerOnlineGauge = new Gauge({
      name: 'systemvibe_worker_online',
      help: 'Number of online workers',
      labelNames: ['type'],
      registers: [this.registry],
    });

    this.workerJobsProcessedGauge = new Gauge({
      name: 'systemvibe_worker_jobs_processed_total',
      help: 'Total number of jobs processed by workers',
      labelNames: ['worker_id', 'type'],
      registers: [this.registry],
    });

    // Initialize API metrics
    this.httpRequestCounter = new Counter({
      name: 'systemvibe_http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.httpRequestDuration = new Histogram({
      name: 'systemvibe_http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    // Collect default metrics (Node.js runtime metrics)
    collectDefaultMetrics({
      register: this.registry,
      prefix: 'systemvibe_',
    });

    // Start queue metrics updater
    this.startQueueMetricsUpdater();
  }

  async getMetrics(): Promise<string> {
    await this.updateQueueMetrics();
    await this.updateWorkerMetrics();
    return this.registry.metrics();
  }

  async updateQueueMetrics(): Promise<void> {
    try {
      const counts = await this.imageQueue.getJobCounts();
      this.queueDepthGauge.set({ queue: 'image' }, counts.waiting || 0);
      this.queueActiveGauge.set({ queue: 'image' }, counts.active || 0);
      this.queueDelayedGauge.set({ queue: 'image' }, counts.delayed || 0);
      this.queueFailedGauge.set({ queue: 'image' }, counts.failed || 0);
    } catch (error) {
      this.logger.error('Failed to update queue metrics', error);
    }
  }

  async updateWorkerMetrics(): Promise<void> {
    try {
      const redis = getRedisClient();
      const workerKeys = await redis.keys('worker:heartbeat:*');

      // Count online workers by type
      const workersByType = new Map<string, number>();

      for (const key of workerKeys) {
        const workerData = await redis.get(key);
        if (workerData) {
          const worker = JSON.parse(workerData);
          const type = worker.type || 'unknown';
          workersByType.set(type, (workersByType.get(type) || 0) + 1);

          // Update jobs processed gauge
          if (worker.jobsProcessed !== undefined) {
            this.workerJobsProcessedGauge.set({ worker_id: worker.id, type }, worker.jobsProcessed);
          }
        }
      }

      // Update online worker gauges
      for (const [type, count] of workersByType.entries()) {
        this.workerOnlineGauge.set({ type }, count);
      }
    } catch (error) {
      this.logger.error('Failed to update worker metrics', error);
    }
  }

  recordJobCompleted(type: string, priority: string, durationSeconds: number): void {
    this.jobCompletedCounter.inc({ type, priority });
    this.jobDurationHistogram.observe({ type, status: 'completed' }, durationSeconds);
  }

  recordJobFailed(type: string, durationSeconds: number): void {
    this.jobFailedCounter.inc({ type });
    this.jobDurationHistogram.observe({ type, status: 'failed' }, durationSeconds);
  }

  recordHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number
  ): void {
    this.httpRequestCounter.inc({ method, route, status_code: statusCode.toString() });
    this.httpRequestDuration.observe({ method, route }, durationSeconds);
  }

  private startQueueMetricsUpdater(): void {
    // Update metrics every 15 seconds
    setInterval(() => {
      this.updateQueueMetrics().catch((error) => {
        this.logger.error('Failed to update queue metrics in interval', error);
      });
      this.updateWorkerMetrics().catch((error) => {
        this.logger.error('Failed to update worker metrics in interval', error);
      });
    }, 15000);
  }

  getRegistry(): Registry {
    return this.registry;
  }
}
