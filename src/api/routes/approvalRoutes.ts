import express from 'express';
import { query } from '../../db/connection';
import { approvalSystem } from '../../core/approvalSystem';
import { auditLogger } from '../../core/auditLogger';
import { stateMachine } from '../../core/stateMachine';
import {
  Approval,
  ApprovalTargetType,
  ApprovalDecision,
  ApiResponse
} from '../../types';

const router = express.Router();

// GET /api/v1/approvals - List all approvals for the current tenant
router.get('/', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { shipmentId, targetType, targetId, decision, page = 1, pageSize = 20 } = req.query;

    let queryText = 'SELECT * FROM approvals WHERE tenant_id = $1';
    const params: any[] = [tenantId];
    let paramIndex = 2;

    if (shipmentId) {
      queryText += ` AND shipment_id = $${paramIndex++}`;
      params.push(shipmentId);
    }

    if (targetType) {
      queryText += ` AND target_type = $${paramIndex++}`;
      params.push(targetType);
    }

    if (targetId) {
      queryText += ` AND target_id = $${paramIndex++}`;
      params.push(targetId);
    }

    if (decision) {
      queryText += ` AND decision = $${paramIndex++}`;
      params.push(decision);
    }

    // Count total
    const countQuery = `SELECT COUNT(*) FROM (${queryText}) AS subquery`;
    const countResult = await query<{ count: string }>(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Add pagination
    queryText += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(pageSize, (page as number - 1) * (pageSize as number));

    const result = await query<Approval>(queryText, params);

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
      error: 'Failed to fetch approvals',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/approvals/:id - Get a specific approval
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const result = await query<Approval>(
      'SELECT * FROM approvals WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Approval not found'
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch approval',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/v1/approvals - Record an approval
router.post('/', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const userId = req.userId;
    const { shipmentId, targetType, targetId, decision, comments, changes } = req.body;

    // Validate required fields
    if (!shipmentId || !targetType || !targetId || !decision) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'shipmentId, targetType, targetId, and decision are required'
      });
    }

    // Check if shipment exists and belongs to tenant
    const shipmentResult = await query<{ id: string; tenant_id: string }>(
      'SELECT id, tenant_id FROM shipments WHERE id = $1',
      [shipmentId]
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

    // Record the approval
    const approval = await approvalSystem.recordApproval({
      shipmentId,
      tenantId,
      targetType: targetType as ApprovalTargetType,
      targetId,
      approverId: userId,
      decision: decision as ApprovalDecision,
      comments,
      changes,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    // Log the approval
    await auditLogger.logHumanAction(
      shipmentId,
      tenantId,
      userId,
      `${targetType}_${decision}`,
      { targetId, targetType, decision },
      { approvalId: approval.id },
      decision as string
    );

    res.status(201).json(approval);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to record approval',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/v1/approvals/:id/revoke - Revoke an approval
router.post('/:id/revoke', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const userId = req.userId;
    const { reason } = req.body;

    // Check if approval exists and belongs to tenant
    const approvalResult = await query<Approval>(
      'SELECT * FROM approvals WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (approvalResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Approval not found'
      });
    }

    const approval = approvalResult.rows[0];

    // Check if user can revoke (only the approver or admin can revoke)
    const userResult = await query<{ role: string }>(
      'SELECT role FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'User not found'
      });
    }

    const userRole = userResult.rows[0].role;
    const canRevoke = approval.approver_id === userId || ['owner', 'admin'].includes(userRole);

    if (!canRevoke) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Only the approver or admin can revoke an approval'
      });
    }

    // Revoke the approval
    const success = await approvalSystem.revokeApproval(id, userId, reason);

    if (!success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to revoke approval',
        message: 'Could not revoke the approval'
      });
    }

    // Log the revocation
    await auditLogger.logHumanAction(
      approval.shipment_id,
      tenantId,
      userId,
      'approval_revoked',
      { approvalId: id, originalDecision: approval.decision },
      { revoked: true, reason },
      'revoked'
    );

    res.json({
      success: true,
      message: 'Approval revoked successfully',
      approvalId: id
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to revoke approval',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/approvals/shipment/:shipmentId - Get approvals for a specific shipment
router.get('/shipment/:shipmentId', async (req, res) => {
  try {
    const { shipmentId } = req.params;
    const tenantId = req.tenantId;

    // Check if shipment exists and belongs to tenant
    const shipmentResult = await query<{ id: string; tenant_id: string }>(
      'SELECT id, tenant_id FROM shipments WHERE id = $1',
      [shipmentId]
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

    const result = await query<Approval>(
      'SELECT * FROM approvals WHERE shipment_id = $1 AND tenant_id = $2 ORDER BY created_at',
      [shipmentId, tenantId]
    );

    res.json({
      data: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch shipment approvals',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/approvals/stats - Get approval statistics for the current tenant
router.get('/stats', async (req, res) => {
  try {
    const tenantId = req.tenantId;

    const stats = await approvalSystem.getApprovalStats(tenantId);

    res.json(stats);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get approval stats',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/approvals/target-types - Get available target types
router.get('/target-types', (req, res) => {
  const targetTypes: ApprovalTargetType[] = [
    'document',
    'compliance_screen',
    'buyer_risk',
    'classification',
    'shipment'
  ];

  res.json({
    targetTypes: targetTypes.map(type => ({
      value: type,
      label: type.replace('_', ' ').toUpperCase(),
      description: getTargetTypeDescription(type)
    }))
  });
});

// GET /api/v1/approvals/decision-types - Get available decision types
router.get('/decision-types', (req, res) => {
  const decisionTypes: ApprovalDecision[] = [
    'approved',
    'rejected',
    'edited',
    'acknowledged'
  ];

  res.json({
    decisionTypes: decisionTypes.map(decision => ({
      value: decision,
      label: decision.charAt(0).toUpperCase() + decision.slice(1),
      description: getDecisionTypeDescription(decision)
    }))
  });
});

// Helper functions
function getTargetTypeDescription(type: ApprovalTargetType): string {
  const descriptions: Record<ApprovalTargetType, string> = {
    document: 'Document approval',
    compliance_screen: 'Compliance screening flag acknowledgment',
    buyer_risk: 'Buyer risk approval',
    classification: 'HS code classification approval',
    shipment: 'Shipment-level approval'
  };
  return descriptions[type] || type;
}

function getDecisionTypeDescription(decision: ApprovalDecision): string {
  const descriptions: Record<ApprovalDecision, string> = {
    approved: 'Approved - Accepted as is',
    rejected: 'Rejected - Not accepted',
    edited: 'Edited - Approved with changes',
    acknowledged: 'Acknowledged - Reviewed and noted'
  };
  return descriptions[decision] || decision;
}

export default router;
