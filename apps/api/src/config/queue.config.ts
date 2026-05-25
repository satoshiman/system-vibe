import { registerAs } from '@nestjs/config';
import { env } from '@systemvibe/config';

export default registerAs('queue', () => ({
  redis: {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      count: 1000,
      age: 86400, // 24 hours
    },
    removeOnFail: {
      count: 5000,
      age: 604800, // 7 days
    },
  },
}));
