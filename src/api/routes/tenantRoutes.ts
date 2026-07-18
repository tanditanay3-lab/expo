import express from 'express';
import { query } from '../../db/connection';
import { auditLogger } from '../../core/auditLogger';
import {
  Tenant,
  TenantTier,
  DeploymentMode,
  SubscriptionStatus,
  ApiResponse
} from '../../types';

const router = express.Router();

// GET /api/v1/tenants/me - Get current tenant information
router.get('/me', async (req, res) => {
  try {
    const tenantId = req.tenantId;

    const result = await query<Tenant>(
      'SELECT * FROM tenants WHERE id = $1',
      [tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Tenant not found'
      });
    }

    const tenant = result.rows[0];

    // Get user count
    const userCountResult = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM users WHERE tenant_id = $1',
      [tenantId]
    );

    // Get shipment count
    const shipmentCountResult = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM shipments WHERE tenant_id = $1',
      [tenantId]
    );

    // Get buyer count
    const buyerCountResult = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM buyers WHERE tenant_id = $1',
      [tenantId]
    );

    res.json({
      ...tenant,
      userCount: parseInt(userCountResult.rows[0].count),
      shipmentCount: parseInt(shipmentCountResult.rows[0].count),
      buyerCount: parseInt(buyerCountResult.rows[0].count)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch tenant information',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// PUT /api/v1/tenants/me - Update current tenant information
router.put('/me', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const userId = req.userId;
    const tenantData: Partial<Tenant> = req.body;

    // Check if tenant exists
    const existingResult = await query<Tenant>(
      'SELECT * FROM tenants WHERE id = $1',
      [tenantId]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Tenant not found'
      });
    }

    // Build update query
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    const updatableFields = [
      'name', 'email', 'billing_email', 'phone', 'address',
      'city', 'state', 'country', 'pincode', 'gstin', 'pan'
    ];

    for (const field of updatableFields) {
      if (tenantData[field as keyof Tenant] !== undefined) {
        updates.push(`${field} = $${paramIndex++}`);
        params.push(tenantData[field as keyof Tenant]);
      }
    }

    if (updates.length === 0) {
      return res.json(existingResult.rows[0]);
    }

    updates.push(`updated_at = NOW()`);
    params.push(tenantId);

    const result = await query<Tenant>(
      `UPDATE tenants SET ${updates.join(', ')} WHERE id = $${paramIndex++} RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Tenant not found'
      });
    }

    // Log the tenant update
    await auditLogger.logHumanAction(
      '',
      tenantId,
      userId,
      'tenant_updated',
      { originalData: existingResult.rows[0], updateData: tenantData },
      { updatedTenant: result.rows[0] },
      'updated'
    );

    res.json(result.rows[0]);
  } catch (error) {
    res.status(400).json({
      success: false,
      error: 'Failed to update tenant',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/tenants - List all tenants (admin only)
router.get('/', async (req, res) => {
  try {
    const userId = req.userId;

    // Check if user is admin
    const userResult = await query<{ role: string; tenant_id: string }>(
      'SELECT role, tenant_id FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'User not found'
      });
    }

    const user = userResult.rows[0];
    
    // Only allow if user is owner of their tenant (for multi-tenant admin)
    // In a real implementation, you'd have a super-admin role
    if (user.role !== 'owner') {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Only admin users can list all tenants'
      });
    }

    // For now, only return the user's own tenant
    const result = await query<Tenant>(
      'SELECT * FROM tenants WHERE id = $1',
      [user.tenant_id]
    );

    res.json({
      data: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch tenants',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/tenants/:id - Get a specific tenant (admin only)
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    // Check if user is admin
    const userResult = await query<{ role: string; tenant_id: string }>(
      'SELECT role, tenant_id FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'User not found'
      });
    }

    const user = userResult.rows[0];
    
    // Only allow if user is owner of their tenant or the requested tenant
    if (user.role !== 'owner' && user.tenant_id !== id) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Only admin users can view other tenants'
      });
    }

    const result = await query<Tenant>(
      'SELECT * FROM tenants WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Tenant not found'
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch tenant',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/tenants/stats - Get tenant statistics
router.get('/stats', async (req, res) => {
  try {
    const tenantId = req.tenantId;

    // Get tenant info
    const tenantResult = await query<Tenant>(
      'SELECT * FROM tenants WHERE id = $1',
      [tenantId]
    );

    if (tenantResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Tenant not found'
      });
    }

    const tenant = tenantResult.rows[0];

    // Get usage statistics
    const [userCount, shipmentCount, buyerCount, documentCount] = await Promise.all([
      query<{ count: string }>('SELECT COUNT(*) as count FROM users WHERE tenant_id = $1', [tenantId]),
      query<{ count: string }>('SELECT COUNT(*) as count FROM shipments WHERE tenant_id = $1', [tenantId]),
      query<{ count: string }>('SELECT COUNT(*) as count FROM buyers WHERE tenant_id = $1', [tenantId]),
      query<{ count: string }>('SELECT COUNT(*) as count FROM documents d JOIN shipments s ON d.shipment_id = s.id WHERE s.tenant_id = $1', [tenantId])
    ]);

    // Get plan limits
    const planLimits = tenant.plan_limits || {};
    const usageMetrics = tenant.usage_metrics || {};

    res.json({
      tenantId: tenant.id,
      tenantName: tenant.name,
      tier: tenant.tier,
      subscriptionStatus: tenant.subscription_status,
      usage: {
        users: {
          used: parseInt(userCount.rows[0].count),
          limit: planLimits.users || Infinity
        },
        shipments: {
          used: parseInt(shipmentCount.rows[0].count),
          limit: planLimits.shipments || Infinity
        },
        buyers: {
          used: parseInt(buyerCount.rows[0].count),
          limit: planLimits.buyers || Infinity
        },
        documents: {
          used: parseInt(documentCount.rows[0].count),
          limit: planLimits.documents || Infinity
        }
      },
      planLimits,
      usageMetrics
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get tenant stats',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/tenants/tiers - Get available tenant tiers
router.get('/tiers', (req, res) => {
  const tiers: TenantTier[] = [
    'starter',
    'growth',
    'scale',
    'enterprise'
  ];

  res.json({
    tiers: tiers.map(tier => ({
      value: tier,
      label: tier.charAt(0).toUpperCase() + tier.slice(1),
      description: getTierDescription(tier),
      features: getTierFeatures(tier),
      priceRange: getTierPriceRange(tier)
    }))
  });
});

// GET /api/v1/tenants/deployment-modes - Get available deployment modes
router.get('/deployment-modes', (req, res) => {
  const deploymentModes: DeploymentMode[] = [
    'saas',
    'vpc',
    'on_prem'
  ];

  res.json({
    deploymentModes: deploymentModes.map(mode => ({
      value: mode,
      label: mode.toUpperCase().replace('_', ' '),
      description: getDeploymentModeDescription(mode)
    }))
  });
});

// GET /api/v1/tenants/subscription-statuses - Get available subscription statuses
router.get('/subscription-statuses', (req, res) => {
  const subscriptionStatuses: SubscriptionStatus[] = [
    'active',
    'trial',
    'suspended',
    'cancelled'
  ];

  res.json({
    subscriptionStatuses: subscriptionStatuses.map(status => ({
      value: status,
      label: status.charAt(0).toUpperCase() + status.slice(1)
    }))
  });
});

// Helper functions
function getTierDescription(tier: TenantTier): string {
  const descriptions: Record<TenantTier, string> = {
    starter: 'For small exporters with basic needs',
    growth: 'For growing businesses with more shipments',
    scale: 'For established businesses with high volume',
    enterprise: 'For large enterprises with custom requirements'
  };
  return descriptions[tier] || tier;
}

function getTierFeatures(tier: TenantTier): string[] {
  const features: Record<TenantTier, string[]> = {
    starter: [
      'Documentation Agent',
      'Up to 20 shipments/month',
      'Basic support'
    ],
    growth: [
      'All 4 AI Agents',
      'Up to 100 shipments/month',
      'Priority support',
      'Multi-user access'
    ],
    scale: [
      'All 4 AI Agents',
      'Up to 300 shipments/month',
      'Priority support',
      'ERP integration',
      'Multi-user access',
      'Advanced analytics'
    ],
    enterprise: [
      'All 4 AI Agents',
      'Unlimited shipments',
      'Dedicated support',
      'Custom integrations',
      'SLA guarantees',
      'On-prem/VPC deployment option'
    ]
  };
  return features[tier] || [];
}

function getTierPriceRange(tier: TenantTier): string {
  const priceRanges: Record<TenantTier, string> = {
    starter: '₹15,000 - ₹25,000/month',
    growth: '₹45,000 - ₹75,000/month',
    scale: '₹90,000 - ₹1,50,000/month',
    enterprise: 'Custom pricing (typically ₹2,00,000+)'
  };
  return priceRanges[tier] || 'Contact sales';
}

function getDeploymentModeDescription(mode: DeploymentMode): string {
  const descriptions: Record<DeploymentMode, string> = {
    saas: 'Shared multi-tenant cloud deployment',
    vpc: 'Dedicated virtual private cloud deployment',
    on_prem: 'On-premises deployment'
  };
  return descriptions[mode] || mode;
}

export default router;
