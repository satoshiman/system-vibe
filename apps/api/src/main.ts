import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { v4 as uuidv4 } from 'uuid';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { getQueueToken } from '@nestjs/bullmq';
import { env } from '@systemvibe/config';

// Create root logger with base properties
const logger = pino({
  level: env.LOG_LEVEL || 'info',
  base: {
    service: 'systemvibe-api',
    version: '0.1.0',
  },
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: false, // Disable default NestJS logger, use Pino instead
  });

  // Enable validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    })
  );

  // Configure pino-http with correlation IDs
  app.use(
    pinoHttp({
      logger: logger as unknown as Parameters<typeof pinoHttp>[0] extends { logger: infer L }
        ? L
        : never,
      genReqId: (req, res) => {
        // Check for incoming correlation ID from headers
        const existingId = req.headers['x-correlation-id'] as string;
        if (existingId) {
          return existingId;
        }
        // Generate new correlation ID
        const id = uuidv4();
        res.setHeader('X-Correlation-Id', id);
        return id;
      },
      // Redact sensitive fields
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie'],
        remove: true,
      },
    })
  );

  // Enable CORS
  app.enableCors({
    origin: '*', // Allow all origins for development
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    exposedHeaders: ['X-Correlation-Id'],
  });

  app.setGlobalPrefix('api');

  // Swagger configuration
  const config = new DocumentBuilder()
    .setTitle('SystemVibe API')
    .setDescription('SystemVibe API documentation')
    .setVersion('0.1.0')
    .addTag('health')
    .addTag('auth')
    .addTag('jobs')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth' // This name is used for referencing in @ApiBearerAuth()
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // BullMQ Board setup
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  const imageQueue = app.get(getQueueToken('image'));

  createBullBoard({
    queues: [new BullMQAdapter(imageQueue, { readOnlyMode: false })],
    serverAdapter,
  });

  app.use('/admin/queues', serverAdapter.getRouter());

  const port = env.API_PORT;
  await app.listen(port, '0.0.0.0');

  logger.info(`API Server running on http://localhost:${port}`);
  logger.info(`Swagger documentation available at http://localhost:${port}/api/docs`);
  logger.info(`BullMQ Board available at http://localhost:${port}/admin/queues`);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start API');
  process.exit(1);
});
