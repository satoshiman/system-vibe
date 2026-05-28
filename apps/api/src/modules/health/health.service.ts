import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Client } from 'pg';
import Redis from 'ioredis';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { env } from '@systemvibe/config';
import { getRedisClient } from '@systemvibe/redis';

interface QueueStatus {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

interface WorkerStatus {
  id: string;
  type: string;
  status: string;
  lastHeartbeat: string;
  jobsProcessed: number;
  uptime: number;
}

@Injectable()
export class HealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HealthService.name);
  private dbClient!: Client;
  private redisClient!: Redis;
  private dbConnected = false;

  constructor(@InjectQueue('image') private imageQueue: Queue) {}

  async onModuleInit() {
    this.dbClient = new Client({
      connectionString: env.DATABASE_URL,
    });
    this.redisClient = new Redis(env.REDIS_URL);

    try {
      await this.dbClient.connect();
      this.dbConnected = true;
    } catch (error) {
      console.error('Failed to connect to database on init:', error);
    }
  }

  async onModuleDestroy() {
    if (this.dbConnected) {
      await this.dbClient.end();
    }
    this.redisClient.quit();
  }

  async getHealth() {
    let dbStatus = 'unknown';
    let redisStatus = 'unknown';
    let queueStatus = 'unknown';
    let workerStatus = 'unknown';
    const authStatus = 'healthy';
    const queues: QueueStatus[] = [];
    const workers: WorkerStatus[] = [];

    try {
      if (this.dbConnected) {
        await this.dbClient.query('SELECT 1');
        dbStatus = 'healthy';
      } else {
        dbStatus = 'unhealthy';
      }
    } catch (error) {
      this.logger.error('Database health check error:', error);
      dbStatus = 'unhealthy';
    }

    try {
      const result = await this.redisClient.ping();
      redisStatus = result === 'PONG' ? 'healthy' : 'unhealthy';
    } catch (error) {
      this.logger.error('Redis health check error:', error);
      redisStatus = 'unhealthy';
    }

    try {
      const counts = await this.imageQueue.getJobCounts();
      queueStatus = 'healthy';
      queues.push({
        name: 'image',
        waiting: counts.waiting || 0,
        active: counts.active || 0,
        completed: counts.completed || 0,
        failed: counts.failed || 0,
        delayed: counts.delayed || 0,
      });
    } catch (error) {
      this.logger.error('Queue health check error:', error);
      queueStatus = 'unhealthy';
    }

    try {
      // Get worker status from Redis heartbeat keys
      const redis = getRedisClient();
      const workerKeys = await redis.keys('worker:heartbeat:*');

      for (const key of workerKeys) {
        const workerData = await redis.get(key);
        if (workerData) {
          const worker = JSON.parse(workerData);
          workers.push({
            id: worker.id || worker.workerId,
            type: worker.type || 'unknown',
            status: worker.status || 'unknown',
            lastHeartbeat: worker.timestamp,
            jobsProcessed: worker.jobsProcessed || 0,
            uptime: worker.uptime || 0,
          });
        }
      }

      workerStatus = workers.length > 0 ? 'healthy' : 'degraded';
    } catch (error) {
      this.logger.error('Worker health check error:', error);
      workerStatus = 'unhealthy';
    }

    const overallStatus =
      dbStatus === 'healthy' && redisStatus === 'healthy' && queueStatus === 'healthy'
        ? 'healthy'
        : 'degraded';

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      services: {
        api: 'healthy',
        database: dbStatus,
        redis: redisStatus,
        queue: queueStatus,
        worker: workerStatus,
        auth: authStatus,
      },
      details: {
        queues,
        workers,
        metrics: {
          endpoint: '/api/metrics',
          format: 'prometheus',
        },
        grafana: {
          url: 'http://localhost:3001',
          dashboard: 'SystemVibe Dashboard',
        },
        prometheus: {
          url: 'http://localhost:9090',
        },
      },
      version: '0.6.0',
    };
  }
}
