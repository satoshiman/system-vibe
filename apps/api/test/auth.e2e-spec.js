"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("@nestjs/testing");
const common_1 = require("@nestjs/common");
const supertest_1 = __importDefault(require("supertest"));
const app_module_1 = require("../src/app.module");
describe('Auth (e2e)', () => {
    let app;
    beforeAll(async () => {
        const moduleFixture = await testing_1.Test.createTestingModule({
            imports: [app_module_1.AppModule],
        }).compile();
        app = moduleFixture.createNestApplication();
        app.setGlobalPrefix('api');
        app.useGlobalPipes(new common_1.ValidationPipe());
        await app.init();
    });
    afterAll(async () => {
        await app.close();
    });
    describe('/auth/register (POST)', () => {
        it('should register a new user', () => {
            const randomEmail = `test-${Date.now()}@example.com`;
            return (0, supertest_1.default)(app.getHttpServer())
                .post('/api/auth/register')
                .send({
                email: randomEmail,
                password: 'password123',
                name: 'Test User',
            })
                .expect(201)
                .expect((res) => {
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
            return (0, supertest_1.default)(app.getHttpServer())
                .post('/api/auth/register')
                .send({
                email,
                password: 'password123',
                name: 'Test User',
            })
                .expect(201)
                .then(() => {
                return (0, supertest_1.default)(app.getHttpServer())
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
            return (0, supertest_1.default)(app.getHttpServer())
                .post('/api/auth/register')
                .send({
                email: 'invalid-email',
                password: 'password123',
                name: 'Test User',
            })
                .expect(400);
        });
        it('should fail with short password', () => {
            return (0, supertest_1.default)(app.getHttpServer())
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
        let registeredEmail;
        let registeredPassword;
        beforeAll(async () => {
            registeredEmail = `login-${Date.now()}@example.com`;
            registeredPassword = 'password123';
            await (0, supertest_1.default)(app.getHttpServer()).post('/api/auth/register').send({
                email: registeredEmail,
                password: registeredPassword,
                name: 'Test User',
            });
        });
        it('should login with valid credentials', () => {
            return (0, supertest_1.default)(app.getHttpServer())
                .post('/api/auth/login')
                .send({
                email: registeredEmail,
                password: registeredPassword,
            })
                .expect(200)
                .expect((res) => {
                expect(res.body).toHaveProperty('user');
                expect(res.body).toHaveProperty('accessToken');
                expect(res.body).toHaveProperty('refreshToken');
            });
        });
        it('should fail with invalid email', () => {
            return (0, supertest_1.default)(app.getHttpServer())
                .post('/api/auth/login')
                .send({
                email: 'nonexistent@example.com',
                password: 'password123',
            })
                .expect(401);
        });
        it('should fail with invalid password', () => {
            return (0, supertest_1.default)(app.getHttpServer())
                .post('/api/auth/login')
                .send({
                email: registeredEmail,
                password: 'wrongpassword',
            })
                .expect(401);
        });
    });
    describe('/auth/refresh (POST)', () => {
        let refreshToken;
        beforeAll(async () => {
            const email = `refresh-${Date.now()}@example.com`;
            const res = await (0, supertest_1.default)(app.getHttpServer()).post('/api/auth/register').send({
                email,
                password: 'password123',
                name: 'Test User',
            });
            refreshToken = res.body.refreshToken;
        });
        it('should refresh tokens with valid refresh token', () => {
            return (0, supertest_1.default)(app.getHttpServer())
                .post('/api/auth/refresh')
                .send({ refreshToken })
                .expect(200)
                .expect((res) => {
                expect(res.body).toHaveProperty('accessToken');
                expect(res.body).toHaveProperty('refreshToken');
            });
        });
        it('should fail with invalid refresh token', () => {
            return (0, supertest_1.default)(app.getHttpServer())
                .post('/api/auth/refresh')
                .send({ refreshToken: 'invalid-token' })
                .expect(401);
        });
    });
    describe('/auth/me (GET)', () => {
        let accessToken;
        beforeAll(async () => {
            const email = `profile-${Date.now()}@example.com`;
            const res = await (0, supertest_1.default)(app.getHttpServer()).post('/api/auth/register').send({
                email,
                password: 'password123',
                name: 'Test User',
            });
            accessToken = res.body.accessToken;
        });
        it('should get user profile with valid token', () => {
            return (0, supertest_1.default)(app.getHttpServer())
                .get('/api/auth/me')
                .set('Authorization', `Bearer ${accessToken}`)
                .expect(200)
                .expect((res) => {
                expect(res.body).toHaveProperty('id');
                expect(res.body).toHaveProperty('email');
                expect(res.body).toHaveProperty('name');
            });
        });
        it('should fail without token', () => {
            return (0, supertest_1.default)(app.getHttpServer()).get('/api/auth/me').expect(401);
        });
        it('should fail with invalid token', () => {
            return (0, supertest_1.default)(app.getHttpServer())
                .get('/api/auth/me')
                .set('Authorization', 'Bearer invalid-token')
                .expect(401);
        });
    });
    describe('/auth/logout (POST)', () => {
        let accessToken;
        beforeAll(async () => {
            const email = `logout-${Date.now()}@example.com`;
            const res = await (0, supertest_1.default)(app.getHttpServer()).post('/api/auth/register').send({
                email,
                password: 'password123',
                name: 'Test User',
            });
            accessToken = res.body.accessToken;
        });
        it('should logout successfully with valid token', () => {
            return (0, supertest_1.default)(app.getHttpServer())
                .post('/api/auth/logout')
                .set('Authorization', `Bearer ${accessToken}`)
                .expect(200)
                .expect((res) => {
                expect(res.body).toHaveProperty('message');
                expect(res.body.message).toBe('Logged out successfully');
            });
        });
        it('should fail without token', () => {
            return (0, supertest_1.default)(app.getHttpServer()).post('/api/auth/logout').expect(401);
        });
    });
});
//# sourceMappingURL=auth.e2e-spec.js.map