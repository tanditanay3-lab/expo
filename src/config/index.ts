import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configuration interface
export interface AppConfig {
  env: string;
  port: number;
  db: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
    ssl: boolean;
  };
  redis: {
    host: string;
    port: number;
    password: string;
  };
  anthropic: {
    apiKey: string;
    apiVersion: string;
    model: string;
  };
  jwt: {
    secret: string;
    expiresIn: string;
  };
  storage: {
    uploadDir: string;
    documentDir: string;
  };
  rateLimiting: {
    maxRequests: number;
    windowMs: number;
  };
  cors: {
    origin: string | string[];
    credentials: boolean;
  };
}

// Get configuration from environment variables
function getConfig(): AppConfig {
  return {
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000'),
    db: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      name: process.env.DB_NAME || 'consign_ai',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      ssl: process.env.DB_SSL === 'true'
    },
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD || ''
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      apiVersion: process.env.ANTHROPIC_API_VERSION || '2023-06-01',
      model: process.env.ANTHROPIC_MODEL || 'claude-3-sonnet-20240229'
    },
    jwt: {
      secret: process.env.JWT_SECRET || 'your_jwt_secret_key',
      expiresIn: process.env.JWT_EXPIRES_IN || '24h'
    },
    storage: {
      uploadDir: process.env.UPLOAD_DIR || './uploads',
      documentDir: process.env.DOCUMENT_STORAGE_DIR || './storage/documents'
    },
    rateLimiting: {
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000') // 15 minutes
    },
    cors: {
      origin: process.env.ALLOWED_ORIGINS || '*',
      credentials: process.env.CORS_CREDENTIALS === 'true'
    }
  };
}

// Configuration singleton
class Config {
  private static instance: AppConfig;

  static getInstance(): AppConfig {
    if (!Config.instance) {
      Config.instance = getConfig();
    }
    return Config.instance;
  }

  static reload(): void {
    Config.instance = getConfig();
  }
}

// Export configuration
export const config = Config.getInstance();
export default config;

// Validation function
export function validateConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const cfg = Config.getInstance();

  // Check required database configuration
  if (!cfg.db.host) {
    errors.push('DB_HOST is required');
  }
  if (!cfg.db.name) {
    errors.push('DB_NAME is required');
  }
  if (!cfg.db.user) {
    errors.push('DB_USER is required');
  }

  // Check required Redis configuration
  if (!cfg.redis.host) {
    errors.push('REDIS_HOST is required');
  }

  // Check required JWT configuration
  if (!cfg.jwt.secret) {
    errors.push('JWT_SECRET is required');
  }

  // Check required Anthropic configuration
  if (!cfg.anthropic.apiKey) {
    errors.push('ANTHROPIC_API_KEY is required');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
