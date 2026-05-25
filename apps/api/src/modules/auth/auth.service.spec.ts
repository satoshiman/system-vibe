import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

// Mock PrismaService before importing AuthService
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  $connect: jest.fn(),
  $disconnect: jest.fn(),
};

const mockRedis = {
  set: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
};

jest.mock('@systemvibe/redis', () => ({
  __esModule: true,
  default: jest.fn(() => mockRedis),
  getRedisClient: jest.fn(() => mockRedis),
}));

jest.mock('bcrypt');

// Import after mocking
import { AuthService } from './auth.service';
import { PrismaService } from '@systemvibe/database';

describe('AuthService', () => {
  let service: AuthService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockJwtSign: jest.Mock;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockJwtVerify: jest.Mock;

  beforeEach(async () => {
    mockJwtSign = jest.fn();
    mockJwtVerify = jest.fn();

    // Reset all mocks
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: JwtService,
          useValue: {
            sign: mockJwtSign,
            verify: mockJwtVerify,
          },
        },
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);

    // Set environment variables
    process.env.JWT_SECRET = 'test-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should register a new user successfully', async () => {
      const registerDto = {
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User',
      };

      const mockUser = {
        id: 'user-id',
        email: registerDto.email,
        name: registerDto.name,
        passwordHash: 'hashed-password',
      };

      mockPrisma.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
      mockPrisma.user.create.mockResolvedValue(mockUser);
      mockPrisma.user.update.mockResolvedValue(mockUser);
      mockJwtSign.mockReturnValue('token');

      const result = await service.register(registerDto);

      expect(result).toHaveProperty('user');
      expect(result.user.email).toBe(registerDto.email);
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(mockRedis.set).toHaveBeenCalled();
    });

    it('should throw UnauthorizedException if user already exists', async () => {
      const registerDto = {
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User',
      };

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

      await expect(service.register(registerDto)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('login', () => {
    it('should login user with valid credentials', async () => {
      const loginDto = {
        email: 'test@example.com',
        password: 'password123',
      };

      const mockUser = {
        id: 'user-id',
        email: loginDto.email,
        name: 'Test User',
        passwordHash: 'hashed-password',
        refreshToken: null,
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockPrisma.user.update.mockResolvedValue(mockUser);
      mockJwtSign.mockReturnValue('token');

      const result = await service.login(loginDto);

      expect(result).toHaveProperty('user');
      expect(result.user.email).toBe(loginDto.email);
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(mockRedis.set).toHaveBeenCalled();
    });

    it('should throw UnauthorizedException if user not found', async () => {
      const loginDto = {
        email: 'test@example.com',
        password: 'password123',
      };

      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if password is invalid', async () => {
      const loginDto = {
        email: 'test@example.com',
        password: 'wrongpassword',
      };

      const mockUser = {
        id: 'user-id',
        email: loginDto.email,
        passwordHash: 'hashed-password',
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refreshTokens', () => {
    it('should refresh tokens with valid refresh token', async () => {
      const refreshToken = 'valid-refresh-token';
      const payload = { sub: 'user-id', email: 'test@example.com' };

      const mockUser = {
        id: 'user-id',
        email: 'test@example.com',
        refreshToken: refreshToken,
      };

      mockJwtVerify.mockReturnValue(payload);
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.user.update.mockResolvedValue(mockUser);
      mockJwtSign.mockReturnValue('new-token');

      const result = await service.refreshTokens(refreshToken);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(mockRedis.set).toHaveBeenCalled();
    });

    it('should throw UnauthorizedException with invalid refresh token', async () => {
      const refreshToken = 'invalid-token';

      mockJwtVerify.mockImplementation(() => {
        throw new Error();
      });

      await expect(service.refreshTokens(refreshToken)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if refresh token does not match', async () => {
      const refreshToken = 'wrong-refresh-token';
      const payload = { sub: 'user-id', email: 'test@example.com' };

      const mockUser = {
        id: 'user-id',
        email: 'test@example.com',
        refreshToken: 'different-token',
      };

      mockJwtVerify.mockReturnValue(payload);
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(service.refreshTokens(refreshToken)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('should logout user successfully', async () => {
      const userId = 'user-id';

      mockPrisma.user.update.mockResolvedValue({});
      mockRedis.del.mockResolvedValue(1);

      const result = await service.logout(userId);

      expect(result).toEqual({ message: 'Logged out successfully' });
      expect(mockRedis.del).toHaveBeenCalledWith(`session:${userId}`);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: { refreshToken: null },
      });
    });
  });

  describe('validateUser', () => {
    it('should validate user with valid session', async () => {
      const userId = 'user-id';
      const mockUser = {
        id: userId,
        email: 'test@example.com',
        name: 'Test User',
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockRedis.get.mockResolvedValue(JSON.stringify({ userId, email: 'test@example.com' }));

      const result = await service.validateUser(userId);

      expect(result).toEqual(mockUser);
    });

    it('should throw UnauthorizedException if user not found', async () => {
      const userId = 'user-id';

      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.validateUser(userId)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if session expired', async () => {
      const userId = 'user-id';
      const mockUser = {
        id: userId,
        email: 'test@example.com',
        name: 'Test User',
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockRedis.get.mockResolvedValue(null);

      await expect(service.validateUser(userId)).rejects.toThrow(UnauthorizedException);
    });
  });
});
