import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import pino from 'pino';

const logger = pino();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  app.setGlobalPrefix('api');
  
  const port = process.env.API_PORT || 3000;
  await app.listen(port, '0.0.0.0');
  
  logger.info(`API Server running on http://localhost:${port}`);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start API');
  process.exit(1);
});
