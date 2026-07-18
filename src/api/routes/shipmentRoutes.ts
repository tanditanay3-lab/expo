import express from 'express';
import { query, beginTransaction } from '../../db/connection';
import { stateMachine } from '../../core/stateMachine';
import { auditLogger } from '../../core/auditLogger';
import { approvalSystem } from '../../core/approvalSystem';
import { AgentFactory } from '../../agents/baseAgent';
import {
  Shipment,
  ShipmentStage,
  ShipmentStatus,
  CreateShipmentRequest,
  UpdateShipmentRequest,
  ApiResponse,
  PaginatedResponse
} from '../../types';

const router = express.Router();

// GET /api/v1/shipments - List all shipments for the current tenant
router.get('/', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const {
      stage,
      status,
      search,
      page = 1,
      pageSize = 20,
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = req.query;

    let queryText = 'SELECT * FROM shipments WHERE tenant_id = $1';
    const params: any[] = [tenantId];
    let paramIndex = 2;

    if (stage) {
      queryText += ` AND stage = $${paramIndex++}`;
      params.push(stage);
    }

    if (status) {
      queryText += ` AND status = $${paramIndex++}`;
      params.push(status);
    }

    if (search) {
      queryText += ` AND (shipment_number ILIKE $${paramIndex} OR invoice_number ILIKE $${paramIndex} OR product_description ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Count total
    const countQuery = `SELECT COUNT(*) FROM (${queryText}) AS subquery`;
    const countResult = await query<{ count: string }>(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Add sorting and pagination
    const validSortColumns = ['shipment_number', 'invoice_number', 'created_at', 'updated_at', 'stage', 'status', 'priority'];
    const sortColumn = validSortColumns.includes(sortBy as string) ? sortBy : 'created_at';
    const order = sortOrder === 'asc' ? 'ASC' : 'DESC';

    queryText += ` ORDER BY ${sortColumn} ${order} LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(pageSize, (page as number - 1) * (pageSize as number));

    const result = await query<Shipment>(queryText, params);

    const response: PaginatedResponse<Shipment> = {
      data: result.rows,
      total,
      page: page as number,
      pageSize: pageSize as number,
      totalPages: Math.ceil(total / (pageSize as number))
    };

    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch shipments',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/shipments/:id - Get a specific shipment
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const result = await query<Shipment>(
      'SELECT * FROM shipments WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Shipment not found'
      });
    }

    const shipment = result.rows[0];

    // Get related data
    const [buyer, consignee, documents, complianceScreens, classifications] = await Promise.all([
      shipment.buyer_id ? query('SELECT * FROM buyers WHERE id = $1', [shipment.buyer_id]) : Promise.resolve({ rows: [] }),
      shipment.consignee_id ? query('SELECT * FROM buyers WHERE id = $1', [shipment.consignee_id]) : Promise.resolve({ rows: [] }),
      query('SELECT * FROM documents WHERE shipment_id = $1 ORDER BY created_at', [id]),
      query('SELECT * FROM compliance_screens WHERE shipment_id = $1 ORDER BY created_at', [id]),
      query('SELECT * FROM classifications WHERE shipment_id = $1 ORDER BY created_at DESC', [id])
    ]);

    const response = {
      ...shipment,
      buyer: buyer.rows[0] || null,
      consignee: consignee.rows[0] || null,
      documents: documents.rows,
      complianceScreens: complianceScreens.rows,
      classifications: classifications.rows
    };

    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch shipment',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/v1/shipments - Create a new shipment
router.post('/', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const userId = req.userId;
    const data: CreateShipmentRequest = req.body;

    // Generate shipment number
    const shipmentNumberResult = await query<{ generate_shipment_number: string }>(
      'SELECT generate_shipment_number($1) as shipment_number',
      [tenantId]
    );

    const shipmentNumber = shipmentNumberResult.rows[0]?.shipment_number || `SHIP-${Date.now()}`;

    // Create the shipment
    const result = await query<Shipment>(
      `INSERT INTO shipments (
        tenant_id, shipment_number, stage, 
        buyer_id, consignee_id, invoice_number, invoice_date, 
        invoice_value, currency, incoterms, payment_terms,
        origin_port, destination_port, vessel_name, voyage_number,
        etd, eta, shipping_line, product_description, product_category,
        quantity, unit, unit_price, total_value, 
        status, priority, notes, created_by, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
      RETURNING *`,
      [
        tenantId,
        shipmentNumber,
        'draft' as ShipmentStage,
        data.buyer_id,
        data.consignee_id,
        data.invoice_number,
        data.invoice_date,
        data.invoice_value,
        data.currency || 'INR',
        data.incoterms,
        data.payment_terms,
        data.origin_port,
        data.destination_port,
        data.vessel_name,
        data.voyage_number,
        data.etd,
        data.eta,
        data.shipping_line,
        data.product_description,
        data.product_category,
        data.quantity,
        data.unit,
        data.unit_price,
        data.total_value || data.quantity * data.unit_price,
        'active' as ShipmentStatus,
        data.priority || 'normal',
        data.notes,
        userId,
        userId
      ]
    );

    const shipment = result.rows[0];

    // Log the shipment creation
    await auditLogger.logHumanAction(
      shipment.id,
      tenantId,
      userId,
      'shipment_created',
      { shipmentData: data },
      { shipmentId: shipment.id, shipmentNumber: shipment.shipment_number },
      'created'
    );

    res.status(201).json(shipment);
  } catch (error) {
    res.status(400).json({
      success: false,
      error: 'Failed to create shipment',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// PUT /api/v1/shipments/:id - Update a shipment
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const userId = req.userId;
    const data: UpdateShipmentRequest = req.body;

    // Check if shipment exists
    const existingResult = await query<Shipment>(
      'SELECT * FROM shipments WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Shipment not found'
      });
    }

    // Build update query
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (data.stage !== undefined) {
      updates.push(`stage = $${paramIndex++}`);
      params.push(data.stage);
    }

    if (data.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      params.push(data.status);
    }

    if (data.priority !== undefined) {
      updates.push(`priority = $${paramIndex++}`);
      params.push(data.priority);
    }

    if (data.notes !== undefined) {
      updates.push(`notes = $${paramIndex++}`);
      params.push(data.notes);
    }

    if (data.internal_notes !== undefined) {
      updates.push(`internal_notes = $${paramIndex++}`);
      params.push(data.internal_notes);
    }

    // Add other fields that can be updated
    const updatableFields = [
      'buyer_id', 'consignee_id', 'invoice_number', 'invoice_date',
      'invoice_value', 'currency', 'incoterms', 'payment_terms',
      'origin_port', 'destination_port', 'vessel_name', 'voyage_number',
      'etd', 'eta', 'shipping_line', 'product_description', 'product_category',
      'quantity', 'unit', 'unit_price', 'total_value'
    ];

    for (const field of updatableFields) {
      if (data[field as keyof UpdateShipmentRequest] !== undefined) {
        updates.push(`${field} = $${paramIndex++}`);
        params.push(data[field as keyof UpdateShipmentRequest]);
      }
    }

    if (updates.length === 0) {
      return res.json(existingResult.rows[0]);
    }

    updates.push(`updated_at = NOW()`);
    updates.push(`updated_by = $${paramIndex++}`);
    params.push(userId);
    params.push(id, tenantId);

    const result = await query<Shipment>(
      `UPDATE shipments SET ${updates.join(', ')} WHERE id = $${paramIndex++} AND tenant_id = $${paramIndex++} RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Shipment not found'
      });
    }

    // Log the shipment update
    await auditLogger.logHumanAction(
      id,
      tenantId,
      userId,
      'shipment_updated',
      { originalData: existingResult.rows[0], updateData: data },
      { updatedShipment: result.rows[0] },
      'updated'
    );

    res.json(result.rows[0]);
  } catch (error) {
    res.status(400).json({
      success: false,
      error: 'Failed to update shipment',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// DELETE /api/v1/shipments/:id - Delete a shipment
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const userId = req.userId;

    // Check if shipment exists
    const existingResult = await query<Shipment>(
      'SELECT * FROM shipments WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Shipment not found'
      });
    }

    const shipment = existingResult.rows[0];

    // Cannot delete filed shipments
    if (shipment.stage === 'filed') {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Cannot delete a filed shipment'
      });
    }

    // Delete the shipment (cascade will delete related records)
    await query(
      'DELETE FROM shipments WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    // Log the deletion
    await auditLogger.logHumanAction(
      id,
      tenantId,
      userId,
      'shipment_deleted',
      { shipmentData: shipment },
      { deleted: true },
      'deleted'
    );

    res.json({ success: true, message: 'Shipment deleted successfully' });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to delete shipment',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/v1/shipments/:id/advance - Advance shipment to next stage
router.post('/:id/advance', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const userId = req.userId;
    const { overrideReason } = req.body;

    // Check if shipment exists
    const existingResult = await query<Shipment>(
      'SELECT * FROM shipments WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Shipment not found'
      });
    }

    // Check if user can advance
    const canAdvance = await stateMachine.canAdvance(id);
    
    if (!canAdvance.canAdvance) {
      return res.status(400).json({
        success: false,
        error: 'Cannot Advance',
        message: 'Shipment cannot advance to next stage',
        missingChecks: canAdvance.missingChecks,
        nextStage: canAdvance.nextStage
      });
    }

    // Advance the stage
    const result = await stateMachine.advanceStage(id, userId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: 'Failed to advance',
        message: result.message,
        fromStage: result.fromStage,
        toStage: result.toStage
      });
    }

    res.json({
      success: true,
      message: 'Shipment advanced to next stage',
      fromStage: result.fromStage,
      toStage: result.toStage
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to advance shipment',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/v1/shipments/:id/force-advance - Force advance shipment (admin only)
router.post('/:id/force-advance', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const userId = req.userId;
    const { overrideReason } = req.body;

    // Check if shipment exists
    const existingResult = await query<Shipment>(
      'SELECT * FROM shipments WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Shipment not found'
      });
    }

    // Check if user is admin or owner
    const userResult = await query<{ role: string }>(
      'SELECT role FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0 || !['owner', 'admin'].includes(userResult.rows[0].role)) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Only admin or owner can force advance a shipment'
      });
    }

    // Force advance the stage
    const result = await stateMachine.forceAdvanceStage(id, userId, overrideReason);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: 'Failed to force advance',
        fromStage: result.fromStage,
        toStage: result.toStage
      });
    }

    // Log the force advance
    await auditLogger.logHumanAction(
      id,
      tenantId,
      userId,
      'shipment_force_advanced',
      { overrideReason },
      { fromStage: result.fromStage, toStage: result.toStage },
      'force_advanced'
    );

    res.json({
      success: true,
      message: 'Shipment force advanced to next stage',
      fromStage: result.fromStage,
      toStage: result.toStage
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to force advance shipment',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/v1/shipments/:id/file - Mark shipment as filed
router.post('/:id/file', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const userId = req.userId;

    // Check if shipment exists
    const existingResult = await query<Shipment>(
      'SELECT * FROM shipments WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Shipment not found'
      });
    }

    const shipment = existingResult.rows[0];

    // Check if shipment can be filed
    const canFile = await stateMachine.canFileShipment(id);
    
    if (!canFile) {
      return res.status(400).json({
        success: false,
        error: 'Cannot File',
        message: 'Shipment does not meet all requirements for filing'
      });
    }

    // Check if shipment is in ready_to_file stage
    if (shipment.stage !== 'ready_to_file') {
      return res.status(400).json({
        success: false,
        error: 'Invalid Stage',
        message: 'Shipment must be in ready_to_file stage to be filed',
        currentStage: shipment.stage
      });
    }

    // Mark as filed
    const result = await stateMachine.markAsFiled(id, userId);

    if (!result) {
      return res.status(400).json({
        success: false,
        error: 'Failed to file',
        message: 'Could not mark shipment as filed'
      });
    }

    // Log the filing
    await auditLogger.logHumanAction(
      id,
      tenantId,
      userId,
      'shipment_filed',
      { shipmentData: shipment },
      { filed: true, stage: 'filed' },
      'filed'
    );

    res.json({
      success: true,
      message: 'Shipment marked as filed',
      stage: 'filed',
      status: 'completed'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to file shipment',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/shipments/:id/status - Get shipment status and progress
router.get('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const status = await stateMachine.getShipmentStatus(id);

    res.json(status);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get shipment status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/shipments/:id/progress - Get shipment progress
router.get('/:id/progress', async (req, res) => {
  try {
    const { id } = req.params;

    const progress = await stateMachine.getShipmentProgress(id);

    res.json(progress);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get shipment progress',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/v1/shipments/:id/run-agents - Run all agents for a shipment
router.post('/:id/run-agents', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const userId = req.userId;

    // Check if shipment exists
    const existingResult = await query<Shipment>(
      'SELECT * FROM shipments WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Shipment not found'
      });
    }

    const results: Record<string, any> = {};

    // Run Documentation Agent
    try {
      const docAgent = AgentFactory.getAgent('documentation');
      if (docAgent) {
        results.documentation = await docAgent.execute(id, tenantId);
      }
    } catch (error) {
      results.documentation = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }

    // Run Compliance Agent
    try {
      const complianceAgent = AgentFactory.getAgent('compliance');
      if (complianceAgent) {
        results.compliance = await complianceAgent.execute(id, tenantId);
      }
    } catch (error) {
      results.compliance = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }

    // Run Buyer Verification Agent
    try {
      const buyerAgent = AgentFactory.getAgent('buyer_verification');
      if (buyerAgent) {
        results.buyer_verification = await buyerAgent.execute(id, tenantId);
      }
    } catch (error) {
      results.buyer_verification = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }

    // Run Customs Intelligence Agent
    try {
      const customsAgent = AgentFactory.getAgent('customs_intelligence');
      if (customsAgent) {
        results.customs_intelligence = await customsAgent.execute(id, tenantId);
      }
    } catch (error) {
      results.customs_intelligence = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }

    // Log the agent execution
    await auditLogger.logSystemAction(
      tenantId,
      'all_agents_executed',
      { shipmentId: id, userId },
      { results },
      { triggeredBy: userId }
    );

    res.json({
      success: true,
      message: 'All agents executed',
      results
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to run agents',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/shipments/:id/pending-approvals - Get pending approvals for a shipment
router.get('/:id/pending-approvals', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const pendingApprovals = await approvalSystem.getPendingApprovals(id, tenantId);

    res.json({
      success: true,
      pendingApprovals,
      count: pendingApprovals.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get pending approvals',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/shipments/dashboard - Get shipment dashboard data
router.get('/dashboard', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { stage, status, days } = req.query;

    let queryText = `SELECT * FROM shipment_dashboard WHERE tenant_id = $1`;
    const params: any[] = [tenantId];
    let paramIndex = 2;

    if (stage) {
      queryText += ` AND stage = $${paramIndex++}`;
      params.push(stage);
    }

    if (status) {
      queryText += ` AND status = $${paramIndex++}`;
      params.push(status);
    }

    if (days) {
      queryText += ` AND created_at >= NOW() - INTERVAL '$${paramIndex++} days'`;
      params.push(days);
    }

    queryText += ' ORDER BY created_at DESC';

    const result = await query(queryText, params);

    // Get summary statistics
    const statsResult = await query<{
      total: string;
      filed: string;
      ready_to_file: string;
      on_hold: string;
      total_value: string;
      avg_duty: string;
      unique_buyers: string;
    }>(
      `SELECT 
        COUNT(*)::text as total,
        COUNT(CASE WHEN stage = 'filed' THEN 1 END)::text as filed,
        COUNT(CASE WHEN stage = 'ready_to_file' THEN 1 END)::text as ready_to_file,
        COUNT(CASE WHEN status = 'on_hold' THEN 1 END)::text as on_hold,
        COALESCE(SUM(invoice_value), 0)::text as total_value,
        COALESCE(AVG(duty_estimate), 0)::text as avg_duty,
        COUNT(DISTINCT buyer_name)::text as unique_buyers
       FROM shipment_dashboard WHERE tenant_id = $1`,
      [tenantId]
    );

    const stats = statsResult.rows[0];

    res.json({
      shipments: result.rows,
      statistics: {
        total: parseInt(stats.total),
        filed: parseInt(stats.filed),
        readyToFile: parseInt(stats.ready_to_file),
        onHold: parseInt(stats.on_hold),
        totalValue: parseFloat(stats.total_value),
        averageDuty: parseFloat(stats.avg_duty),
        uniqueBuyers: parseInt(stats.unique_buyers)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get dashboard data',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
