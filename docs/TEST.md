# Testing Guide

## Table of Contents

- [Introduction](#introduction)
- [Types of Tests](#types-of-tests)
- [Testing Best Practices](#testing-best-practices)
- [Testing in SystemVibe](#testing-in-systemvibe)
- [Writing Tests](#writing-tests)
- [Running Tests](#running-tests)
- [Test Examples](#test-examples)

---

## Introduction

Testing is the process of verifying that your software works as expected. It helps catch bugs early, ensures code quality, and provides confidence when making changes.

### Why Test?

- **Catch bugs early** - Find issues before they reach production
- **Refactor safely** - Make changes with confidence that existing functionality still works
- **Documentation** - Tests serve as living documentation of how code should behave
- **Prevent regressions** - Ensure new changes don't break existing features

---

## Types of Tests

### 1. Unit Tests

**Definition:** Tests individual functions, classes, or modules in isolation.

**Characteristics:**

- Fast to run (milliseconds)
- Test a single piece of logic
- Use mocks/stubs for external dependencies
- No database, network, or file system access

**When to use:**

- Testing business logic
- Validating input/output of functions
- Testing edge cases and error handling

**Example:**

```typescript
// Testing a password hashing function
describe("hashPassword", () => {
  it("should hash password correctly", () => {
    const password = "mypassword";
    const hashed = hashPassword(password);
    expect(hashed).not.toBe(password);
    expect(verifyPassword(password, hashed)).toBe(true);
  });
});
```

### 2. Integration Tests

**Definition:** Tests how multiple units work together.

**Characteristics:**

- Slower than unit tests (seconds)
- Test interactions between modules
- May use real databases or external services
- Test data flow across boundaries

**When to use:**

- Testing database operations
- Testing API endpoints with real dependencies
- Testing service layer interactions

**Example:**

```typescript
// Testing AuthService with real database
describe("AuthService Integration", () => {
  it("should register user in database", async () => {
    const user = await authService.register({
      email: "test@example.com",
      password: "password123",
      name: "Test User",
    });
    expect(user).toHaveProperty("id");
    expect(user.email).toBe("test@example.com");
  });
});
```

### 3. End-to-End (E2E) Tests

**Definition:** Tests the entire application flow from user perspective.

**Characteristics:**

- Slowest to run (seconds to minutes)
- Test complete user workflows
- Use real HTTP requests, database, external services
- Most realistic testing environment

**When to use:**

- Testing critical user journeys
- Verifying API contracts
- Testing authentication flows
- Validating system integration

**Example:**

```typescript
// Testing complete registration flow
describe("Auth E2E", () => {
  it("should register, login, and access protected route", async () => {
    // Register
    const registerRes = await request(app)
      .post("/api/auth/register")
      .send({ email, password, name })
      .expect(201);

    // Login
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email, password })
      .expect(200);

    // Access protected route
    await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${loginRes.body.accessToken}`)
      .expect(200);
  });
});
```

### Test Pyramid

```
        /\
       /E2E\        Few, slow, expensive
      /------\
     /Integration\  Moderate
    /------------\
   /   Unit Tests \  Many, fast, cheap
  /----------------\
```

**Rule of thumb:**

- 70% Unit tests
- 20% Integration tests
- 10% E2E tests

---

## Testing Best Practices

### 1. Test Structure (AAA Pattern)

```typescript
describe("Feature", () => {
  it("should do something", () => {
    // Arrange - Setup test data and conditions
    const input = { email: "test@example.com", password: "123" };

    // Act - Execute the code being tested
    const result = await authService.register(input);

    // Assert - Verify the result
    expect(result).toHaveProperty("id");
    expect(result.email).toBe(input.email);
  });
});
```

### 2. Naming Conventions

- **Test file:** `*.spec.ts` (unit), `*.e2e-spec.ts` (E2E)
- **Test description:** "should [expected behavior] when [condition]"
- **Example:**
  - ✅ "should return 401 when token is invalid"
  - ❌ "test login"

### 3. One Assertion Per Test

```typescript
// ❌ Bad - multiple assertions
it("should validate user", () => {
  expect(user.email).toBeValidEmail();
  expect(user.password).toBeStrong();
  expect(user.name).not.toBeEmpty();
});

// ✅ Good - separate tests
it("should have valid email", () => {
  expect(user.email).toBeValidEmail();
});

it("should have strong password", () => {
  expect(user.password).toBeStrong();
});
```

### 4. Test Independence

Each test should be independent and not rely on other tests:

```typescript
// ❌ Bad - depends on previous test
let userId: string;
it("should create user", async () => {
  const user = await createTestUser();
  userId = user.id;
});
it("should delete user", async () => {
  await deleteUser(userId); // Depends on previous test
});

// ✅ Good - independent
it("should create and delete user", async () => {
  const user = await createTestUser();
  await deleteUser(user.id);
});
```

### 5. Use Random Data for Isolation

```typescript
// ❌ Bad - conflicts with existing data
it("should fail with duplicate email", async () => {
  await registerUser("duplicate@example.com");
  await registerUser("duplicate@example.com"); // May already exist
});

// ✅ Good - unique each time
it("should fail with duplicate email", async () => {
  const email = `test-${Date.now()}@example.com`;
  await registerUser(email);
  await registerUser(email); // Always unique
});
```

### 6. Mock External Dependencies

```typescript
// Mock database in unit tests
jest.mock("@systemvibe/database", () => ({
  prisma: {
    user: {
      create: jest.fn().mockResolvedValue({ id: 1, email: "test@example.com" }),
    },
  },
}));
```

**Explanation:**

- **`jest.mock('@systemvibe/database', ...)`** - Mocks the entire package. When code imports from this package, Jest returns the mock object instead of the real implementation.

- **`() => ({ prisma: { user: { create: ... } } })`** - Factory function that returns a mock object with the same structure as the real Prisma client (`prisma.user.create()`).

- **`jest.fn().mockResolvedValue({ id: 1, email: 'test@example.com' })`** - Creates a mock function that resolves a Promise with the specified object. When `prisma.user.create()` is called, it returns this mock data instead of inserting into a real database.

**Why mock in unit tests?**

- Unit tests should only test the service logic, not the database
- Avoids connecting to real databases (slow, requires setup)
- Ensures tests are independent and don't depend on external data
- Allows controlling return values to test different scenarios

---

## Testing in SystemVibe

### Tech Stack

- **Test Runner:** Jest
- **TypeScript:** ts-jest
- **HTTP Testing:** Supertest
- **NestJS Testing:** @nestjs/testing

### Project Structure

```
apps/api/
├── src/
│   └── modules/
│       └── auth/
│           ├── auth.service.ts
│           └── auth.service.spec.ts      # Unit tests
├── test/
│   ├── auth.e2e-spec.ts                  # E2E tests
│   └── health.e2e-spec.ts                # E2E tests
├── jest.config.js                        # Jest configuration
└── jest.setup.js                         # Test setup (load env vars)
```

### Test Types Used

#### 1. Unit Tests (`src/**/*.spec.ts`)

**Location:** Inside `src/` directory, next to the code being tested

**Purpose:** Test business logic in isolation

**Example:** `auth.service.spec.ts`

- Tests password hashing
- Tests JWT token generation
- Tests validation logic
- Uses mocks for database and Redis

#### 2. E2E Tests (`test/*.e2e-spec.ts`)

**Location:** In `test/` directory

**Purpose:** Test complete API flows with real infrastructure

**Examples:**

- `auth.e2e-spec.ts` - Complete authentication flows
- `health.e2e-spec.ts` - Health check endpoint
- `jobs.e2e-spec.ts` - Job submission, retrieval, and cancellation flows

**Infrastructure Required:**

- PostgreSQL database (running on port 5433)
- Redis cache (running on port 6379)
- Environment variables loaded from `.env`

### Jest Configuration

```javascript
// jest.config.js
module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  roots: ["<rootDir>/src", "<rootDir>/test"], // Scan both directories
  testMatch: ["**/*.spec.ts", "**/*.e2e-spec.ts"], // Match both test types
  transform: {
    "^.+\\.(t|j)s$": "ts-jest",
  },
  testEnvironment: "node",
  moduleNameMapper: {
    "^@systemvibe/(.*)$": "<rootDir>/../../packages/$1/src",
  },
  setupFiles: ["<rootDir>/jest.setup.js"], // Load environment variables
};
```

### Test Setup

**jest.setup.js** - Loads environment variables before tests run:

```javascript
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.resolve(__dirname, "../../.env") });
```

This ensures tests have access to:

- `DATABASE_URL` - PostgreSQL connection
- `REDIS_URL` - Redis connection
- `JWT_SECRET` - JWT signing key

---

## Writing Tests

### Unit Test Template

```typescript
import { Test, TestingModule } from "@nestjs/testing";
import { AuthService } from "./auth.service";

describe("AuthService", () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuthService],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    // Cleanup after each test
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("hashPassword", () => {
    it("should hash password correctly", () => {
      const password = "mypassword";
      const hashed = service.hashPassword(password);

      expect(hashed).not.toBe(password);
      expect(service.verifyPassword(password, hashed)).toBe(true);
    });
  });
});
```

### E2E Test Template

```typescript
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("Feature (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api");
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("/api/endpoint (POST)", () => {
    it("should create resource", () => {
      return request(app.getHttpServer())
        .post("/api/endpoint")
        .send({ data: "test" })
        .expect(201)
        .expect((res: any) => {
          expect(res.body).toHaveProperty("id");
          expect(res.body.data).toBe("test");
        });
    });
  });
});
```

---

## Running Tests

### Run All Tests

```bash
cd apps/api
npm test
```

### Run Unit Tests Only

```bash
npm test -- src
```

### Run E2E Tests Only

```bash
npm run test:e2e
```

### Run Tests in Watch Mode

```bash
npm run test:watch
```

### Run Tests with Coverage

```bash
npm run test:cov
```

### Run Specific Test File

```bash
npm test -- auth.service.spec.ts
```

### Run Tests Matching Pattern

```bash
npm test -- --testNamePattern="should register"
```

---

## Test Examples

### Example 1: Unit Test - Password Hashing

**File:** `src/modules/auth/auth.service.spec.ts`

```typescript
describe("AuthService", () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuthService],
    }).compile();
    service = module.get<AuthService>(AuthService);
  });

  describe("hashPassword", () => {
    it("should hash password with bcrypt", () => {
      const password = "password123";
      const hashed = service.hashPassword(password);

      expect(hashed).not.toBe(password);
      expect(hashed.length).toBeGreaterThan(50);
    });

    it("should verify correct password", () => {
      const password = "password123";
      const hashed = service.hashPassword(password);

      const isValid = service.verifyPassword(password, hashed);
      expect(isValid).toBe(true);
    });

    it("should reject incorrect password", () => {
      const password = "password123";
      const wrongPassword = "wrongpassword";
      const hashed = service.hashPassword(password);

      const isValid = service.verifyPassword(wrongPassword, hashed);
      expect(isValid).toBe(false);
    });
  });
});
```

### Example 2: E2E Test - Registration Flow

**File:** `test/auth.e2e-spec.ts`

```typescript
describe("Auth (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api");
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("/api/auth/register (POST)", () => {
    it("should register a new user", () => {
      const randomEmail = `test-${Date.now()}@example.com`;
      return request(app.getHttpServer())
        .post("/api/auth/register")
        .send({
          email: randomEmail,
          password: "password123",
          name: "Test User",
        })
        .expect(201)
        .expect((res: any) => {
          expect(res.body).toHaveProperty("user");
          expect(res.body.user).toHaveProperty("id");
          expect(res.body.user.email).toBe(randomEmail);
          expect(res.body).toHaveProperty("accessToken");
          expect(res.body).toHaveProperty("refreshToken");
        });
    });

    it("should fail with invalid email", () => {
      return request(app.getHttpServer())
        .post("/api/auth/register")
        .send({
          email: "invalid-email",
          password: "password123",
          name: "Test User",
        })
        .expect(400);
    });

    it("should fail with short password", () => {
      return request(app.getHttpServer())
        .post("/api/auth/register")
        .send({
          email: "test@example.com",
          password: "123",
          name: "Test User",
        })
        .expect(400);
    });
  });
});
```

### Example 3: E2E Test - Complete Auth Flow

```typescript
describe("Auth Flow (e2e)", () => {
  let app: INestApplication;
  let accessToken: string;
  let refreshToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();
  });

  it("should complete full auth flow", async () => {
    const email = `flow-${Date.now()}@example.com`;
    const password = "password123";

    // 1. Register
    const registerRes = await request(app.getHttpServer())
      .post("/api/auth/register")
      .send({ email, password, name: "Test User" })
      .expect(201);

    expect(registerRes.body).toHaveProperty("accessToken");
    expect(registerRes.body).toHaveProperty("refreshToken");

    // 2. Login
    const loginRes = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email, password })
      .expect(200);

    accessToken = loginRes.body.accessToken;
    refreshToken = loginRes.body.refreshToken;

    // 3. Access protected route
    await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    // 4. Refresh token
    const refreshRes = await request(app.getHttpServer())
      .post("/api/auth/refresh")
      .send({ refreshToken })
      .expect(200);

    accessToken = refreshRes.body.accessToken;

    // 5. Logout
    await request(app.getHttpServer())
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
  });
});
```

---

## Common Testing Scenarios

### Testing Error Handling

```typescript
it("should return 401 for invalid credentials", () => {
  return request(app.getHttpServer())
    .post("/api/auth/login")
    .send({ email: "wrong@example.com", password: "wrong" })
    .expect(401);
});
```

### Testing Validation

```typescript
it("should validate email format", () => {
  return request(app.getHttpServer())
    .post("/api/auth/register")
    .send({ email: "invalid", password: "123456", name: "Test" })
    .expect(400);
});
```

### Testing Async Operations

```typescript
it("should handle async database operations", async () => {
  const user = await service.createUser({ email: "test@example.com" });
  expect(user).toHaveProperty("id");

  const found = await service.findUser(user.id);
  expect(found.email).toBe("test@example.com");
});
```

---

## Troubleshooting

### Tests Not Found

**Problem:** Jest doesn't find test files

**Solution:** Check `jest.config.js`:

```javascript
roots: ['<rootDir>/src', '<rootDir>/test'],
testMatch: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
```

### Database Connection Errors

**Problem:** Tests fail with database connection errors

**Solution:**

1. Ensure PostgreSQL is running: `docker compose -f infra/docker/docker-compose.yml up -d postgres`
2. Check `.env` has correct `DATABASE_URL`
3. Verify `jest.setup.js` loads environment variables

### TypeScript Errors in Tests

**Problem:** TypeScript compilation errors in test files

**Solution:** Ensure `tsconfig.json` includes test directory:

```json
{
  "include": ["src", "test"],
  "rootDir": "."
}
```

### Tests Timing Out

**Problem:** Tests hang or timeout

**Solution:**

1. Check for unclosed connections in `afterAll`
2. Use `--detectOpenHandles` to find leaks
3. Increase timeout: `jest.setTimeout(10000)`

---

## Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [NestJS Testing](https://docs.nestjs.com/fundamentals/testing)
- [Supertest Documentation](https://github.com/visionmedia/supertest)
- [Testing Best Practices](https://testingjavascript.com/)
