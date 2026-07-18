import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../db/connection';
import { auditLogger } from '../core/auditLogger';

// Get JWT secret from environment
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      tenantId?: string;
      email?: string;
      role?: string;
    }
  }
}

// Authentication middleware
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Authentication token required'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: string;
      tenantId: string;
      email: string;
      role: string;
      exp: number;
    };

    // Check if token is expired
    if (decoded.exp && decoded.exp < Date.now() / 1000) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Token expired'
      });
    }

    // Attach user info to request
    req.userId = decoded.userId;
    req.tenantId = decoded.tenantId;
    req.email = decoded.email;
    req.role = decoded.role;

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid token'
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Authentication failed'
    });
  }
}

// Tenant context middleware
export function tenantMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    // If tenantId is already set by auth middleware, use it
    if (req.tenantId) {
      // Set tenant context for database queries
      // In a real implementation with row-level security, you would set:
      // SET app.current_tenant_id = req.tenantId
      return next();
    }

    // If no tenantId, check if there's a tenant header (for service-to-service calls)
    const tenantHeader = req.headers['x-tenant-id'];
    if (tenantHeader && typeof tenantHeader === 'string') {
      req.tenantId = tenantHeader;
      return next();
    }

    // If no tenant context, return error
    return res.status(400).json({
      success: false,
      error: 'Bad Request',
      message: 'Tenant context required'
    });
  } catch (error) {
    console.error('Tenant middleware error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Tenant context setup failed'
    });
  }
}

// Role-based authorization middleware
export function roleMiddleware(requiredRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.role) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      if (!requiredRoles.includes(req.role)) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: `Requires one of the following roles: ${requiredRoles.join(', ')}`
        });
      }

      next();
    } catch (error) {
      console.error('Role middleware error:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'Role check failed'
      });
    }
  };
}

// Error handling middleware
export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  console.error('Error:', err);

  // Log the error to audit trail if we have tenant context
  if (req.tenantId && req.userId) {
    auditLogger.logSystemAction(
      req.tenantId,
      'error_occurred',
      { 
        path: req.path,
        method: req.method,
        error: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
      },
      { errorHandled: true },
      { ipAddress: req.ip, userAgent: req.get('User-Agent') }
    ).catch(() => {}); // Don't fail if audit logging fails
  }

  // Send error response
  res.status(500).json({
    success: false,
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
}

// Request logging middleware
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    
    // Log request details
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    
    // Log to audit trail if authenticated
    if (req.tenantId && req.userId) {
      auditLogger.logSystemAction(
        req.tenantId,
        'api_request',
        { 
          path: req.path,
          method: req.method,
          statusCode: res.statusCode,
          duration
        },
        { requestCompleted: true },
        { ipAddress: req.ip, userAgent: req.get('User-Agent') }
      ).catch(() => {}); // Don't fail if audit logging fails
    }
  });

  next();
}

// Rate limiting middleware (simple implementation)
export function rateLimiter(maxRequests: number, windowMs: number) {
  const requestCounts = new Map<string, { count: number; resetTime: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const ip = req.ip || req.connection.remoteAddress;
      const now = Date.now();

      const key = `${ip}:${req.path}`;
      const record = requestCounts.get(key);

      if (!record || now > record.resetTime) {
        // Reset the counter
        requestCounts.set(key, { count: 1, resetTime: now + windowMs });
        return next();
      }

      // Increment the counter
      record.count++;

      if (record.count > maxRequests) {
        return res.status(429).json({
          success: false,
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Please try again later.`
        });
      }

      next();
    } catch (error) {
      console.error('Rate limiter error:', error);
      next();
    }
  };
}

// Validation middleware for request bodies
export function validateRequest(schema: any) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // In a real implementation, you would validate req.body against the schema
      // For now, we'll just pass through
      next();
    } catch (error) {
      res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: error instanceof Error ? error.message : 'Invalid request data'
      });
    }
  };
}

// Tenant isolation middleware (for multi-tenant queries)
export function tenantIsolation(req: Request, res: Response, next: NextFunction) {
  try {
    // In a real implementation with row-level security, this would be handled by PostgreSQL
    // For now, we'll just ensure tenantId is set
    if (!req.tenantId) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Tenant context required'
      });
    }

    next();
  } catch (error) {
    console.error('Tenant isolation error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Tenant isolation check failed'
    });
  }
}

export default {
  authMiddleware,
  tenantMiddleware,
  roleMiddleware,
  errorHandler,
  requestLogger,
  rateLimiter,
  validateRequest,
  tenantIsolation
};
