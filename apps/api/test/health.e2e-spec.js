"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("@nestjs/testing");
const supertest_1 = __importDefault(require("supertest"));
const app_module_1 = require("../src/app.module");
describe('Health (e2e)', () => {
    let app;
    beforeAll(async () => {
        const moduleFixture = await testing_1.Test.createTestingModule({
            imports: [app_module_1.AppModule],
        }).compile();
        app = moduleFixture.createNestApplication();
        app.setGlobalPrefix('api');
        await app.init();
    });
    afterAll(async () => {
        await app.close();
    });
    describe('/api/health (GET)', () => {
        it('should return health status', () => {
            return (0, supertest_1.default)(app.getHttpServer())
                .get('/api/health')
                .expect(200)
                .expect((res) => {
                expect(res.body).toHaveProperty('status');
                expect(res.body).toHaveProperty('timestamp');
                expect(res.body).toHaveProperty('services');
                expect(res.body.services).toHaveProperty('api');
                expect(res.body.services).toHaveProperty('database');
                expect(res.body.services).toHaveProperty('redis');
                expect(res.body).toHaveProperty('version');
            });
        });
    });
});
//# sourceMappingURL=health.e2e-spec.js.map