import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { JobsGateway } from './websocket.gateway';
import { MetricsService } from '../metrics/metrics.service';
import getRedisClient, { getSubscriberClient } from '@systemvibe/redis';
import { Redis } from 'ioredis';

interface JobStatusEvent {
  jobId: string;
  status: string;
  result?: unknown;
  error?: string;
}

interface JobProgressEvent {
  jobId: string;
  progress: number;
  message?: string;
}

@Injectable()
export class PubSubService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PubSubService.name);
  private redis: Redis;
  private subscriber: Redis;
  private channels = ['job:status', 'job:progress', 'job:metrics'];

  constructor(
    private jobsGateway: JobsGateway,
    private metricsService: MetricsService
  ) {
    this.redis = getRedisClient();
    this.subscriber = getSubscriberClient();
  }

  async onModuleInit() {
    // Subscribe to Redis Pub/Sub channels
    await this.subscriber.subscribe(...this.channels);
    this.logger.log(`Subscribed to channels: ${this.channels.join(', ')}`);

    // Listen for messages
    this.subscriber.on('message', (channel, message) => {
      this.handleMessage(channel, message);
    });
  }

  async onModuleDestroy() {
    await this.subscriber.unsubscribe(...this.channels);
    await this.subscriber.quit();
    this.logger.log('Unsubscribed from channels');
  }

  private handleMessage(channel: string, message: string) {
    try {
      const data = JSON.parse(message);

      if (channel === 'job:status') {
        this.handleJobStatus(data as JobStatusEvent);
      } else if (channel === 'job:progress') {
        this.handleJobProgress(data as JobProgressEvent);
      } else if (channel === 'job:metrics') {
        this.handleJobMetrics(data);
      }
    } catch (error) {
      this.logger.error(`Failed to parse message from ${channel}`, {
        error: (error as Error).message,
      });
    }
  }

  private handleJobStatus(event: JobStatusEvent) {
    this.logger.log(`Received job status event: ${event.jobId} - ${event.status}`);
    this.jobsGateway.broadcastJobStatus(event.jobId, {
      status: event.status,
      result: event.result,
      error: event.error,
    });
  }

  private handleJobProgress(event: JobProgressEvent) {
    this.logger.log(`Received job progress event: ${event.jobId} - ${event.progress}%`);
    this.jobsGateway.broadcastJobProgress(event.jobId, {
      progress: event.progress,
      message: event.message,
    });
  }

  private handleJobMetrics(data: any) {
    this.logger.log(`Received job metrics event: ${data.jobId} - ${data.event}`);

    if (data.event === 'job_completed') {
      this.metricsService.recordJobCompleted(
        data.type || 'unknown',
        data.priority || 'normal',
        data.durationSeconds || 0
      );
    } else if (data.event === 'job_failed') {
      this.metricsService.recordJobFailed(data.type || 'unknown', data.durationSeconds || 0);
    }
  }
}
