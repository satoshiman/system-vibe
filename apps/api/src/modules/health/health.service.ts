import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Client } from 'pg';
import Redis from 'ioredis';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { env } from '@systemvibe/config';

@Injectable()
export class HealthService implements OnModuleInit, OnModuleDestroy {
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
    const authStatus = 'healthy';

    try {
      if (this.dbConnected) {
        await this.dbClient.query('SELECT 1');
        dbStatus = 'healthy';
      } else {
        dbStatus = 'unhealthy';
      }
    } catch (error) {
      console.error('Database health check error:', error);
      dbStatus = 'unhealthy';
    }

    try {
      const result = await this.redisClient.ping();
      redisStatus = result === 'PONG' ? 'healthy' : 'unhealthy';
    } catch (error) {
      console.error('Redis health check error:', error);
      redisStatus = 'unhealthy';
    }

    try {
      await this.imageQueue.getJobCounts();
      queueStatus = 'healthy';
    } catch (error) {
      console.error('Queue health check error:', error);
      queueStatus = 'unhealthy';
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
        auth: authStatus,
      },
      version: '0.3.0',
    };
  }
}
