import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Client } from 'pg';
import Redis from 'ioredis';

@Injectable()
export class HealthService implements OnModuleInit, OnModuleDestroy {
  private dbClient!: Client;
  private redisClient!: Redis;
  private dbConnected = false;

  async onModuleInit() {
    this.dbClient = new Client({
      connectionString: process.env.DATABASE_URL,
    });
    this.redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

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

    const overallStatus =
      dbStatus === 'healthy' && redisStatus === 'healthy' ? 'healthy' : 'degraded';

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      services: {
        api: 'healthy',
        database: dbStatus,
        redis: redisStatus,
        auth: authStatus,
      },
      version: '0.2.0',
    };
  }
}
