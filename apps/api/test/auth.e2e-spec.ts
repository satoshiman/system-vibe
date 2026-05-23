import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('/auth/register (POST)', () => {
    it('should register a new user', () => {
      const randomEmail = `test-${Date.now()}@example.com`;
      return request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: randomEmail,
          password: 'password123',
          name: 'Test User',
        })
        .expect(201)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('user');
          expect(res.body.user).toHaveProperty('id');
          expect(res.body.user).toHaveProperty('email');
          expect(res.body.user.email).toBe(randomEmail);
          expect(res.body).toHaveProperty('accessToken');
          expect(res.body).toHaveProperty('refreshToken');
        });
    });

    it('should fail with duplicate email', () => {
      const email = `duplicate-${Date.now()}@example.com`;

      return request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email,
          password: 'password123',
          name: 'Test User',
        })
        .expect(201)
        .then(() => {
          return request(app.getHttpServer())
            .post('/api/auth/register')
            .send({
              email,
              password: 'password123',
              name: 'Test User',
            })
            .expect(401);
        });
    });

    it('should fail with invalid email', () => {
      return request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'invalid-email',
          password: 'password123',
          name: 'Test User',
        })
        .expect(400);
    });

    it('should fail with short password', () => {
      return request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: '123',
          name: 'Test User',
        })
        .expect(400);
    });
  });

  describe('/auth/login (POST)', () => {
    let registeredEmail: string;
    let registeredPassword: string;

    beforeAll(async () => {
      registeredEmail = `login-${Date.now()}@example.com`;
      registeredPassword = 'password123';

      await request(app.getHttpServer()).post('/api/auth/register').send({
        email: registeredEmail,
        password: registeredPassword,
        name: 'Test User',
      });
    });

    it('should login with valid credentials', () => {
      return request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: registeredEmail,
          password: registeredPassword,
        })
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('user');
          expect(res.body).toHaveProperty('accessToken');
          expect(res.body).toHaveProperty('refreshToken');
        });
    });

    it('should fail with invalid email', () => {
      return request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'password123',
        })
        .expect(401);
    });

    it('should fail with invalid password', () => {
      return request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: registeredEmail,
          password: 'wrongpassword',
        })
        .expect(401);
    });
  });

  describe('/auth/refresh (POST)', () => {
    let refreshToken: string;

    beforeAll(async () => {
      const email = `refresh-${Date.now()}@example.com`;
      const res = await request(app.getHttpServer()).post('/api/auth/register').send({
        email,
        password: 'password123',
        name: 'Test User',
      });

      refreshToken = res.body.refreshToken;
    });

    it('should refresh tokens with valid refresh token', () => {
      return request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('accessToken');
          expect(res.body).toHaveProperty('refreshToken');
        });
    });

    it('should fail with invalid refresh token', () => {
      return request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: 'invalid-token' })
        .expect(401);
    });
  });

  describe('/auth/me (GET)', () => {
    let accessToken: string;

    beforeAll(async () => {
      const email = `profile-${Date.now()}@example.com`;
      const res = await request(app.getHttpServer()).post('/api/auth/register').send({
        email,
        password: 'password123',
        name: 'Test User',
      });

      accessToken = res.body.accessToken;
    });

    it('should get user profile with valid token', () => {
      return request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('id');
          expect(res.body).toHaveProperty('email');
          expect(res.body).toHaveProperty('name');
        });
    });

    it('should fail without token', () => {
      return request(app.getHttpServer()).get('/api/auth/me').expect(401);
    });

    it('should fail with invalid token', () => {
      return request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });

  describe('/auth/logout (POST)', () => {
    let accessToken: string;

    beforeAll(async () => {
      const email = `logout-${Date.now()}@example.com`;
      const res = await request(app.getHttpServer()).post('/api/auth/register').send({
        email,
        password: 'password123',
        name: 'Test User',
      });

      accessToken = res.body.accessToken;
    });

    it('should logout successfully with valid token', () => {
      return request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('message');
          expect(res.body.message).toBe('Logged out successfully');
        });
    });

    it('should fail without token', () => {
      return request(app.getHttpServer()).post('/api/auth/logout').expect(401);
    });
  });
});
