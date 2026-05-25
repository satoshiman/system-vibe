import { z } from 'zod';
import dotenv from 'dotenv';

// Load .env file from root of project
dotenv.config({ path: process.cwd() + '/.env' });

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url().default('postgresql://systemvibe:devpassword@localhost:5432/systemvibe'),
  DB_USER: z.string().default('systemvibe'),
  DB_PASSWORD: z.string().default('devpassword'),
  DB_NAME: z.string().default('systemvibe'),

  // API
  API_PORT: z.string().transform(Number).default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().transform(Number).default('6379'),

  // JWT
  JWT_SECRET: z.string().min(32).default('your-secret-key-change-in-production'),
  JWT_REFRESH_SECRET: z.string().min(32).default('your-refresh-secret-key-change-in-production'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Worker
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.errors
        .filter((e) => e.code === 'invalid_type')
        .map((e) => e.path.join('.'));
      
      if (missingVars.length > 0) {
        console.error('❌ Missing or invalid environment variables:');
        missingVars.forEach((v) => console.error(`   - ${v}`));
        console.error('\nPlease check your .env file');
        process.exit(1);
      }
    }
    throw error;
  }
}

export const env = validateEnv();
