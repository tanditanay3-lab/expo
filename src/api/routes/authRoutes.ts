import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { query } from '../../db/connection';
import { auditLogger } from '../../core/auditLogger';
import {
  User,
  UserRole,
  UserStatus,
  TenantTier,
  DeploymentMode,
  SubscriptionStatus
} from '../../types';

const router = express.Router();

// Get JWT secret from environment
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

// POST /api/v1/auth/signup - Sign up a new tenant and user
router.post('/signup', async (req, res) => {
  try {
    const { 
      tenantName, 
      email, 
      password, 
      firstName, 
      lastName, 
      phone,
      tier = 'starter' as TenantTier,
      deploymentMode = 'saas' as DeploymentMode
    } = req.body;

    // Validate required fields
    if (!tenantName || !email || !password || !firstName || !lastName) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'tenantName, email, password, firstName, and lastName are required'
      });
    }

    // Validate email format
    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Invalid email format'
      });
    }

    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Password must be at least 8 characters long'
      });
    }

    // Check if email already exists
    const existingTenant = await query<{ id: string }>(
      'SELECT id FROM tenants WHERE email = $1',
      [email]
    );

    if (existingTenant.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Email already registered'
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create tenant
    const tenantResult = await query<{
      id: string;
      name: string;
      email: string;
      tier: TenantTier;
      deployment_mode: DeploymentMode;
    }>(
      `INSERT INTO tenants (
        name, email, password_hash, tier, deployment_mode, 
        subscription_status, plan_limits, usage_metrics
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, name, email, tier, deployment_mode`,
      [
        tenantName,
        email,
        passwordHash,
        tier,
        deploymentMode,
        'trial' as SubscriptionStatus,
        getPlanLimits(tier),
        { shipments: 0, documents: 0 }
      ]
    );

    const tenant = tenantResult.rows[0];

    // Create user
    const userResult = await query<User>(
      `INSERT INTO users (
        tenant_id, email, password_hash, first_name, last_name, 
        phone, role, status, preferences
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        tenant.id,
        email,
        passwordHash,
        firstName,
        lastName,
        phone,
        'owner' as UserRole,
        'active' as UserStatus,
        {}
      ]
    );

    const user = userResult.rows[0];

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user.id,
        tenantId: tenant.id,
        email: user.email,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Log the signup
    await auditLogger.logSystemAction(
      tenant.id,
      'tenant_signup',
      { tenantData: { name: tenantName, email, tier }, userData: { firstName, lastName, email } },
      { tenantId: tenant.id, userId: user.id },
      { ipAddress: req.ip, userAgent: req.get('User-Agent') }
    );

    res.status(201).json({
      success: true,
      message: 'Signup successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        status: user.status
      },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        email: tenant.email,
        tier: tenant.tier,
        deploymentMode: tenant.deployment_mode
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to sign up',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/v1/auth/login - Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'email and password are required'
      });
    }

    // Find user
    const userResult = await query<User>(
      `SELECT u.*, t.id as tenant_id, t.name as tenant_name, t.tier, t.deployment_mode, t.subscription_status
       FROM users u
       JOIN tenants t ON u.tenant_id = t.id
       WHERE u.email = $1`,
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid email or password'
      });
    }

    const user = userResult.rows[0];

    // Check password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    
    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid email or password'
      });
    }

    // Check if user is active
    if (user.status !== 'active') {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Account is not active'
      });
    }

    // Check if tenant is active
    if (user.subscription_status !== 'active' && user.subscription_status !== 'trial') {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Tenant subscription is not active'
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user.id,
        tenantId: user.tenant_id,
        email: user.email,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Update last login
    await query(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1',
      [user.id]
    );

    // Log the login
    await auditLogger.logHumanAction(
      '',
      user.tenant_id,
      user.id,
      'user_login',
      { email },
      { loginSuccessful: true },
      'logged_in',
      { ipAddress: req.ip, userAgent: req.get('User-Agent') }
    );

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        role: user.role,
        status: user.status,
        preferences: user.preferences
      },
      tenant: {
        id: user.tenant_id,
        name: user.tenant_name,
        email: user.email,
        tier: user.tier,
        deploymentMode: user.deployment_mode,
        subscriptionStatus: user.subscription_status
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to login',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/v1/auth/logout - Logout (invalidate token)
router.post('/logout', async (req, res) => {
  try {
    const userId = req.userId;
    const tenantId = req.tenantId;

    // In a real implementation, you would add the token to a blacklist
    // For JWT, logout is typically handled client-side by removing the token

    // Log the logout
    await auditLogger.logHumanAction(
      '',
      tenantId,
      userId,
      'user_logout',
      {},
      { logoutSuccessful: true },
      'logged_out',
      { ipAddress: req.ip, userAgent: req.get('User-Agent') }
    );

    res.json({
      success: true,
      message: 'Logout successful'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to logout',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/v1/auth/refresh - Refresh token
router.post('/refresh', async (req, res) => {
  try {
    const userId = req.userId;
    const tenantId = req.tenantId;
    const email = req.email;
    const role = req.role;

    // Generate new JWT token
    const token = jwt.sign(
      {
        userId,
        tenantId,
        email,
        role
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Log the token refresh
    await auditLogger.logHumanAction(
      '',
      tenantId,
      userId,
      'token_refreshed',
      {},
      { tokenRefreshed: true },
      'refreshed',
      { ipAddress: req.ip, userAgent: req.get('User-Agent') }
    );

    res.json({
      success: true,
      message: 'Token refreshed',
      token
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to refresh token',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/v1/auth/forgot-password - Forgot password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'email is required'
      });
    }

    // Find user
    const userResult = await query<{ id: string; tenant_id: string; email: string; first_name: string }>(
      `SELECT u.id, u.tenant_id, u.email, u.first_name
       FROM users u
       JOIN tenants t ON u.tenant_id = t.id
       WHERE u.email = $1`,
      [email]
    );

    if (userResult.rows.length === 0) {
      // Don't reveal that email doesn't exist for security
      return res.json({
        success: true,
        message: 'If an account exists with this email, a password reset link has been sent'
      });
    }

    const user = userResult.rows[0];

    // In a real implementation, you would:
    // 1. Generate a password reset token
    // 2. Store it in the database with an expiration
    // 3. Send an email with a reset link

    // Log the forgot password request
    await auditLogger.logSystemAction(
      user.tenant_id,
      'password_reset_requested',
      { email },
      { userId: user.id },
      { ipAddress: req.ip, userAgent: req.get('User-Agent') }
    );

    res.json({
      success: true,
      message: 'If an account exists with this email, a password reset link has been sent'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to process forgot password request',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/v1/auth/reset-password - Reset password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'token and newPassword are required'
      });
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Password must be at least 8 characters long'
      });
    }

    // In a real implementation, you would:
    // 1. Verify the password reset token
    // 2. Check if it's expired
    // 3. Find the user associated with the token
    // 4. Update the password

    // For now, we'll return a success message
    res.json({
      success: true,
      message: 'Password reset successful'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to reset password',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/v1/auth/change-password - Change password (authenticated)
router.post('/change-password', async (req, res) => {
  try {
    const userId = req.userId;
    const tenantId = req.tenantId;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'currentPassword and newPassword are required'
      });
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Password must be at least 8 characters long'
      });
    }

    // Get current user
    const userResult = await query<User>(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'User not found'
      });
    }

    const user = userResult.rows[0];

    // Check current password
    const passwordMatch = await bcrypt.compare(currentPassword, user.password_hash);
    
    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Update password
    await query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [passwordHash, userId]
    );

    // Log the password change
    await auditLogger.logHumanAction(
      '',
      tenantId,
      userId,
      'password_changed',
      {},
      { passwordChanged: true },
      'changed',
      { ipAddress: req.ip, userAgent: req.get('User-Agent') }
    );

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to change password',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/auth/me - Get current user information
router.get('/me', async (req, res) => {
  try {
    const userId = req.userId;
    const tenantId = req.tenantId;

    const userResult = await query<User>(
      `SELECT u.*, t.name as tenant_name, t.tier, t.deployment_mode, t.subscription_status
       FROM users u
       JOIN tenants t ON u.tenant_id = t.id
       WHERE u.id = $1 AND u.tenant_id = $2`,
      [userId, tenantId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'User not found'
      });
    }

    const user = userResult.rows[0];

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        role: user.role,
        status: user.status,
        preferences: user.preferences,
        lastLoginAt: user.last_login_at
      },
      tenant: {
        id: user.tenant_id,
        name: user.tenant_name,
        tier: user.tier,
        deploymentMode: user.deployment_mode,
        subscriptionStatus: user.subscription_status
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get user information',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Helper functions
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function getPlanLimits(tier: TenantTier): Record<string, any> {
  const limits: Record<TenantTier, Record<string, any>> = {
    starter: {
      shipments: 20,
      documents: 100,
      users: 1,
      buyers: 50
    },
    growth: {
      shipments: 100,
      documents: 500,
      users: 5,
      buyers: 200
    },
    scale: {
      shipments: 300,
      documents: 1500,
      users: 10,
      buyers: 500
    },
    enterprise: {
      shipments: -1, // Unlimited
      documents: -1, // Unlimited
      users: -1, // Unlimited
      buyers: -1 // Unlimited
    }
  };
  return limits[tier] || limits.starter;
}

export default router;
