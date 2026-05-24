import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Jobs (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('/jobs (POST)', () => {
    it('should create a new job with valid data', () => {
      return request(app.getHttpServer())
        .post('/api/jobs')
        .send({
          type: 'image-resize',
          payload: {
            imageUrl: 'https://example.com/image.jpg',
            width: 800,
            height: 600,
          },
        })
        .expect(201)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('id');
          expect(res.body).toHaveProperty('type', 'image-resize');
          expect(res.body).toHaveProperty('status', 'QUEUED');
          expect(res.body).toHaveProperty('userId');
          expect(res.body).toHaveProperty('payload');
          expect(res.body).toHaveProperty('createdAt');
          expect(res.body).toHaveProperty('priority', 'normal');
          expect(res.body).toHaveProperty('timeout', 3600);
        });
    });

    it('should create a job with high priority', () => {
      return request(app.getHttpServer())
        .post('/api/jobs')
        .send({
          type: 'image-thumbnail',
          payload: { imageUrl: 'https://example.com/image.jpg' },
          priority: 'high',
        })
        .expect(201)
        .expect((res: any) => {
          expect(res.body.priority).toBe('high');
        });
    });

    it('should create a job with custom timeout', () => {
      return request(app.getHttpServer())
        .post('/api/jobs')
        .send({
          type: 'image-compress',
          payload: { imageUrl: 'https://example.com/image.jpg' },
          timeout: 7200,
        })
        .expect(201)
        .expect((res: any) => {
          expect(res.body.timeout).toBe(7200);
        });
    });

    it('should create a job with webhook URL', () => {
      return request(app.getHttpServer())
        .post('/api/jobs')
        .send({
          type: 'email-send',
          payload: { to: 'recipient@example.com', subject: 'Test' },
          webhookUrl: 'https://example.com/webhook',
        })
        .expect(201)
        .expect((res: any) => {
          expect(res.body.webhookUrl).toBe('https://example.com/webhook');
        });
    });

    it('should fail with invalid job type', () => {
      return request(app.getHttpServer())
        .post('/api/jobs')
        .send({
          type: 'invalid-type',
          payload: {},
        })
        .expect(400);
    });

    it('should fail with missing payload', () => {
      return request(app.getHttpServer())
        .post('/api/jobs')
        .send({
          type: 'image-resize',
        })
        .expect(400);
    });

    it('should fail with invalid priority', () => {
      return request(app.getHttpServer())
        .post('/api/jobs')
        .send({
          type: 'image-resize',
          payload: {},
          priority: 'invalid',
        })
        .expect(400);
    });

    it('should fail with timeout too low', () => {
      return request(app.getHttpServer())
        .post('/api/jobs')
        .send({
          type: 'image-resize',
          payload: {},
          timeout: 0,
        })
        .expect(400);
    });

    it('should fail with timeout too high', () => {
      return request(app.getHttpServer())
        .post('/api/jobs')
        .send({
          type: 'image-resize',
          payload: {},
          timeout: 100000,
        })
        .expect(400);
    });
  });

  describe('/jobs (GET)', () => {
    beforeAll(async () => {
      await request(app.getHttpServer())
        .post('/api/jobs')
        .send({
          type: 'image-resize',
          payload: { imageUrl: 'https://example.com/image.jpg' },
        });
    });

    it('should list all jobs', () => {
      return request(app.getHttpServer())
        .get('/api/jobs')
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('jobs');
          expect(Array.isArray(res.body.jobs)).toBe(true);
          expect(res.body).toHaveProperty('total');
          expect(typeof res.body.total).toBe('number');
        });
    });

    it('should filter jobs by status', () => {
      return request(app.getHttpServer())
        .get('/api/jobs?status=QUEUED')
        .expect(200)
        .expect((res: any) => {
          expect(res.body.jobs).toBeDefined();
        });
    });

    it('should filter jobs by type', () => {
      return request(app.getHttpServer())
        .get('/api/jobs?type=image-resize')
        .expect(200)
        .expect((res: any) => {
          expect(res.body.jobs).toBeDefined();
        });
    });

    it('should handle pagination', () => {
      return request(app.getHttpServer())
        .get('/api/jobs?page=1&limit=5')
        .expect(200)
        .expect((res: any) => {
          expect(res.body.jobs).toBeDefined();
        });
    });
  });

  describe('/jobs/:id (GET)', () => {
    let jobId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/jobs')
        .send({
          type: 'image-resize',
          payload: { imageUrl: 'https://example.com/image.jpg' },
        });

      jobId = res.body.id;
    });

    it('should get a specific job by id', () => {
      return request(app.getHttpServer())
        .get(`/api/jobs/${jobId}`)
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('id', jobId);
          expect(res.body).toHaveProperty('type');
          expect(res.body).toHaveProperty('status');
          expect(res.body).toHaveProperty('payload');
          expect(res.body).toHaveProperty('createdAt');
        });
    });

    it('should fail with invalid job id', () => {
      return request(app.getHttpServer()).get('/api/jobs/nonexistent-id').expect(404);
    });
  });

  describe('/jobs/:id (DELETE)', () => {
    let jobId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/jobs')
        .send({
          type: 'image-resize',
          payload: { imageUrl: 'https://example.com/image.jpg' },
        });

      jobId = res.body.id;
    });

    it('should cancel a job successfully', () => {
      return request(app.getHttpServer())
        .delete(`/api/jobs/${jobId}`)
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('status', 'CANCELLED');
        });
    });

    it('should fail to cancel already cancelled job', () => {
      return request(app.getHttpServer()).delete(`/api/jobs/${jobId}`).expect(400);
    });

    it('should fail with invalid job id', () => {
      return request(app.getHttpServer()).delete('/api/jobs/nonexistent-id').expect(404);
    });
  });
});
