import express from 'express';
import { query } from '../../db/connection';
import { AgentFactory } from '../../agents/baseAgent';
import { auditLogger } from '../../core/auditLogger';
import {
  Buyer,
  BuyerRiskCategory,
  BuyerVerificationStatus,
  Payment,
  PaymentMethod,
  PaymentStatus,
  ApiResponse
} from '../../types';

const router = express.Router();

// GET /api/v1/buyers - List all buyers for the current tenant
router.get('/', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const {
      riskCategory,
      verificationStatus,
      search,
      page = 1,
      pageSize = 20,
      sortBy = 'name',
      sortOrder = 'asc'
    } = req.query;

    let queryText = 'SELECT * FROM buyers WHERE tenant_id = $1';
    const params: any[] = [tenantId];
    let paramIndex = 2;

    if (riskCategory) {
      queryText += ` AND risk_category = $${paramIndex++}`;
      params.push(riskCategory);
    }

    if (verificationStatus) {
      queryText += ` AND verification_status = $${paramIndex++}`;
      params.push(verificationStatus);
    }

    if (search) {
      queryText += ` AND (name ILIKE $${paramIndex} OR registration_no ILIKE $${paramIndex} OR email ILIKE $${paramIndex} OR country ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Count total
    const countQuery = `SELECT COUNT(*) FROM (${queryText}) AS subquery`;
    const countResult = await query<{ count: string }>(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Add sorting and pagination
    const validSortColumns = ['name', 'risk_score', 'country', 'created_at', 'updated_at', 'total_shipments', 'total_value'];
    const sortColumn = validSortColumns.includes(sortBy as string) ? sortBy : 'name';
    const order = sortOrder === 'asc' ? 'ASC' : 'DESC';

    queryText += ` ORDER BY ${sortColumn} ${order} LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(pageSize, (page as number - 1) * (pageSize as number));

    const result = await query<Buyer>(queryText, params);

    res.json({
      data: result.rows,
      total,
      page: page as number,
      pageSize: pageSize as number,
      totalPages: Math.ceil(total / (pageSize as number))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch buyers',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/buyers/:id - Get a specific buyer
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const result = await query<Buyer>(
      'SELECT * FROM buyers WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Buyer not found'
      });
    }

    const buyer = result.rows[0];

    // Get related data
    const [payments, shipments] = await Promise.all([
      query<Payment>('SELECT * FROM payments WHERE buyer_id = $1 AND tenant_id = $2 ORDER BY payment_date DESC', [id, tenantId]),
      query('SELECT id, shipment_number, invoice_value, stage, status FROM shipments WHERE buyer_id = $1 AND tenant_id = $2 ORDER BY created_at DESC', [id, tenantId])
    ]);

    res.json({
      ...buyer,
      payments: payments.rows,
      shipments: shipments.rows
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch buyer',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/v1/buyers - Create a new buyer
router.post('/', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const userId = req.userId;
    const buyerData: Partial<Buyer> = req.body;

    // Validate required fields
    if (!buyerData.name || !buyerData.country) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'name and country are required'
      });
    }

    // Create the buyer
    const result = await query<Buyer>(
      `INSERT INTO buyers (
        tenant_id, name, registration_no, gstin, pan, country, 
        city, state, address, pincode, email, phone, website, 
        business_type, risk_score, risk_category, payment_terms, 
        credit_limit, currency, verification_status, external_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
      RETURNING *`,
      [
        tenantId,
        buyerData.name,
        buyerData.registration_no,
        buyerData.gstin,
        buyerData.pan,
        buyerData.country,
        buyerData.city,
        buyerData.state,
        buyerData.address,
        buyerData.pincode,
        buyerData.email,
        buyerData.phone,
        buyerData.website,
        buyerData.business_type,
        buyerData.risk_score || 50.00,
        buyerData.risk_category || 'medium',
        buyerData.payment_terms,
        buyerData.credit_limit,
        buyerData.currency || 'INR',
        buyerData.verification_status || 'pending',
        buyerData.external_data || {}
      ]
    );

    const buyer = result.rows[0];

    // Log the buyer creation
    await auditLogger.logHumanAction(
      '',
      tenantId,
      userId,
      'buyer_created',
      { buyerData },
      { buyerId: buyer.id, name: buyer.name },
      'created'
    );

    res.status(201).json(buyer);
  } catch (error) {
    res.status(400).json({
      success: false,
      error: 'Failed to create buyer',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// PUT /api/v1/buyers/:id - Update a buyer
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const userId = req.userId;
    const buyerData: Partial<Buyer> = req.body;

    // Check if buyer exists
    const existingResult = await query<Buyer>(
      'SELECT * FROM buyers WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Buyer not found'
      });
    }

    // Build update query
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    const updatableFields = [
      'name', 'registration_no', 'gstin', 'pan', 'country',
      'city', 'state', 'address', 'pincode', 'email', 'phone',
      'website', 'business_type', 'payment_terms', 'credit_limit',
      'currency', 'verification_status', 'verification_notes', 'external_data'
    ];

    for (const field of updatableFields) {
      if (buyerData[field as keyof Buyer] !== undefined) {
        updates.push(`${field} = $${paramIndex++}`);
        params.push(buyerData[field as keyof Buyer]);
      }
    }

    if (updates.length === 0) {
      return res.json(existingResult.rows[0]);
    }

    updates.push(`updated_at = NOW()`);
    params.push(id, tenantId);

    const result = await query<Buyer>(
      `UPDATE buyers SET ${updates.join(', ')} WHERE id = $${paramIndex++} AND tenant_id = $${paramIndex++} RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Buyer not found'
      });
    }

    // Log the buyer update
    await auditLogger.logHumanAction(
      '',
      tenantId,
      userId,
      'buyer_updated',
      { originalData: existingResult.rows[0], updateData: buyerData },
      { updatedBuyer: result.rows[0] },
      'updated'
    );

    res.json(result.rows[0]);
  } catch (error) {
    res.status(400).json({
      success: false,
      error: 'Failed to update buyer',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// DELETE /api/v1/buyers/:id - Delete a buyer
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const userId = req.userId;

    // Check if buyer exists
    const existingResult = await query<Buyer>(
      'SELECT * FROM buyers WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Buyer not found'
      });
    }

    const buyer = existingResult.rows[0];

    // Check if buyer has active shipments
    const shipmentResult = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM shipments WHERE buyer_id = $1 AND tenant_id = $2 AND stage != $3',
      [id, tenantId, 'filed']
    );

    if (parseInt(shipmentResult.rows[0].count) > 0) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Cannot delete buyer with active shipments'
      });
    }

    // Delete the buyer
    await query(
      'DELETE FROM buyers WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    // Log the deletion
    await auditLogger.logHumanAction(
      '',
      tenantId,
      userId,
      'buyer_deleted',
      { buyerData: buyer },
      { deleted: true, buyerId: id },
      'deleted'
    );

    res.json({ success: true, message: 'Buyer deleted successfully' });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to delete buyer',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/v1/buyers/:id/verify - Verify a buyer
router.post('/:id/verify', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const userId = req.userId;

    // Check if buyer exists
    const existingResult = await query<Buyer>(
      'SELECT * FROM buyers WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Buyer not found'
      });
    }

    // Get the buyer verification agent
    const buyerAgent = AgentFactory.getAgent('buyer_verification');
    if (!buyerAgent) {
      return res.status(500).json({
        success: false,
        error: 'Service Unavailable',
        message: 'Buyer verification agent not available'
      });
    }

    // Execute verification
    const result = await buyerAgent.execute('', tenantId, {
      verificationRequests: [{ buyerId: id }]
    });

    // Log the verification
    await auditLogger.logHumanAction(
      '',
      tenantId,
      userId,
      'buyer_verification_requested',
      { buyerId: id },
      { result },
      'verified'
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to verify buyer',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/buyers/:id/risk-score - Get buyer risk score
router.get('/:id/risk-score', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    // Check if buyer exists
    const existingResult = await query<Buyer>(
      'SELECT * FROM buyers WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Buyer not found'
      });
    }

    // Get the buyer verification agent
    const buyerAgent = AgentFactory.getAgent('buyer_verification');
    if (!buyerAgent) {
      return res.status(500).json({
        success: false,
        error: 'Service Unavailable',
        message: 'Buyer verification agent not available'
      });
    }

    // Get risk score
    const result = await (buyerAgent as any).getBuyerRiskScore(id, tenantId);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Buyer risk score not found'
      });
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get buyer risk score',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/v1/buyers/:id/payments - Add payment history for a buyer
router.post('/:id/payments', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const userId = req.userId;
    const paymentData: {
      shipmentId: string;
      paymentDate: Date;
      amount: number;
      currency: string;
      paymentMethod: PaymentMethod;
      paymentStatus: PaymentStatus;
      daysOverdue?: number;
      notes?: string;
    } = req.body;

    // Check if buyer exists
    const existingResult = await query<Buyer>(
      'SELECT * FROM buyers WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Buyer not found'
      });
    }

    // Check if shipment exists and belongs to tenant
    const shipmentResult = await query<{ id: string; tenant_id: string }>(
      'SELECT id, tenant_id FROM shipments WHERE id = $1',
      [paymentData.shipmentId]
    );

    if (shipmentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Shipment not found'
      });
    }

    if (shipmentResult.rows[0].tenant_id !== tenantId) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Shipment does not belong to this tenant'
      });
    }

    // Get the buyer verification agent
    const buyerAgent = AgentFactory.getAgent('buyer_verification');
    if (!buyerAgent) {
      return res.status(500).json({
        success: false,
        error: 'Service Unavailable',
        message: 'Buyer verification agent not available'
      });
    }

    // Add payment history
    const payment = await (buyerAgent as any).addPaymentHistory(id, tenantId, paymentData);

    // Log the payment addition
    await auditLogger.logHumanAction(
      paymentData.shipmentId,
      tenantId,
      userId,
      'payment_added',
      { buyerId: id, paymentData },
      { paymentId: payment.id },
      'added'
    );

    res.status(201).json(payment);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to add payment history',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/buyers/:id/payments - Get payment history for a buyer
router.get('/:id/payments', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    // Check if buyer exists
    const existingResult = await query<Buyer>(
      'SELECT * FROM buyers WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Buyer not found'
      });
    }

    const result = await query<Payment>(
      'SELECT * FROM payments WHERE buyer_id = $1 AND tenant_id = $2 ORDER BY payment_date DESC',
      [id, tenantId]
    );

    res.json({
      data: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get payment history',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/buyers/stats - Get buyer statistics for the current tenant
router.get('/stats', async (req, res) => {
  try {
    const tenantId = req.tenantId;

    // Get the buyer verification agent
    const buyerAgent = AgentFactory.getAgent('buyer_verification');
    if (!buyerAgent) {
      return res.status(500).json({
        success: false,
        error: 'Service Unavailable',
        message: 'Buyer verification agent not available'
      });
    }

    // Get stats
    const stats = await (buyerAgent as any).getBuyerStats(tenantId);

    res.json(stats);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get buyer stats',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/buyers/risk-categories - Get risk categories
router.get('/risk-categories', (req, res) => {
  const riskCategories: BuyerRiskCategory[] = [
    'low',
    'medium',
    'high',
    'critical'
  ];

  res.json({
    riskCategories: riskCategories.map(category => ({
      value: category,
      label: category.charAt(0).toUpperCase() + category.slice(1),
      description: getRiskCategoryDescription(category)
    }))
  });
});

// GET /api/v1/buyers/verification-statuses - Get verification statuses
router.get('/verification-statuses', (req, res) => {
  const verificationStatuses: BuyerVerificationStatus[] = [
    'pending',
    'verified',
    'rejected',
    'flagged'
  ];

  res.json({
    verificationStatuses: verificationStatuses.map(status => ({
      value: status,
      label: status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')
    }))
  });
});

// Helper function
function getRiskCategoryDescription(category: BuyerRiskCategory): string {
  const descriptions: Record<BuyerRiskCategory, string> = {
    low: 'Low risk - Reliable buyer with good payment history',
    medium: 'Medium risk - Buyer with moderate risk factors',
    high: 'High risk - Buyer with significant risk factors',
    critical: 'Critical risk - High-risk buyer, requires special attention'
  };
  return descriptions[category] || category;
}

export default router;
