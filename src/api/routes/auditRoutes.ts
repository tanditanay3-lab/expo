import express from 'express';
import { query } from '../../db/connection';
import { auditLogger } from '../../core/auditLogger';
import {
  AuditLog,
  ActorType,
  ApiResponse
} from '../../types';

const router = express.Router();

// GET /api/v1/audit/logs - List audit logs for the current tenant
router.get('/logs', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const {
      shipmentId,
      actorType,
      action,
      startDate,
      endDate,
      search,
      page = 1,
      pageSize = 50
    } = req.query;

    const result = await auditLogger.getTenantAuditLog(tenantId, {
      shipmentId: shipmentId as string,
      actorType: actorType as ActorType,
      action: action as string,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      page: page as number,
      pageSize: pageSize as number
    });

    res.json({
      data: result.logs,
      total: result.total,
      page: page as number,
      pageSize: pageSize as number,
      totalPages: Math.ceil(result.total / (pageSize as number))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch audit logs',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/audit/logs/:id - Get a specific audit log entry
router.get('/logs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const result = await query<AuditLog>(
      'SELECT * FROM audit_log WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Audit log entry not found'
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch audit log entry',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/audit/shipment/:shipmentId - Get audit log for a specific shipment
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

    const auditLogs = await auditLogger.getShipmentAuditLog(shipmentId, tenantId);

    res.json({
      data: auditLogs,
      total: auditLogs.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch shipment audit log',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/audit/export/:shipmentId - Export audit trail for a shipment
router.get('/export/:shipmentId', async (req, res) => {
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

    const exportData = await auditLogger.exportShipmentAuditLog(shipmentId, tenantId);

    // Set headers for download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="audit-trail-${exportData.shipmentNumber}-${new Date().toISOString().split('T')[0]}.json"`);

    res.json(exportData);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to export audit trail',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/audit/search - Search audit logs
router.get('/search', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { query: searchQuery, startDate, endDate, page = 1, pageSize = 50 } = req.query;

    if (!searchQuery) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'query parameter is required'
      });
    }

    const result = await auditLogger.searchAuditLogs(
      tenantId,
      searchQuery as string,
      {
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        page: page as number,
        pageSize: pageSize as number
      }
    );

    res.json({
      data: result.logs,
      total: result.total,
      page: page as number,
      pageSize: pageSize as number,
      totalPages: Math.ceil(result.total / (pageSize as number))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to search audit logs',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/audit/actor-types - Get available actor types
router.get('/actor-types', (req, res) => {
  const actorTypes: ActorType[] = [
    'agent',
    'human',
    'system'
  ];

  res.json({
    actorTypes: actorTypes.map(type => ({
      value: type,
      label: type.charAt(0).toUpperCase() + type.slice(1),
      description: getActorTypeDescription(type)
    }))
  });
});

// GET /api/v1/audit/stats - Get audit log statistics for the current tenant
router.get('/stats', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { days = 30 } = req.query;

    // Get total audit logs
    const totalResult = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM audit_log WHERE tenant_id = $1',
      [tenantId]
    );

    // Get recent audit logs
    const recentResult = await query<AuditLog>(
      `SELECT * FROM audit_log 
       WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '$2 days'
       ORDER BY created_at DESC`,
      [tenantId, days]
    );

    // Get by actor type
    const byActorResult = await query<{ actor_type: ActorType; count: string }>(
      `SELECT actor_type, COUNT(*) as count 
       FROM audit_log 
       WHERE tenant_id = $1 
       GROUP BY actor_type`,
      [tenantId]
    );

    // Get by action
    const byActionResult = await query<{ action: string; count: string }>(
      `SELECT action, COUNT(*) as count 
       FROM audit_log 
       WHERE tenant_id = $1 
       GROUP BY action 
       ORDER BY count DESC 
       LIMIT 10`,
      [tenantId]
    );

    // Format results
    const byActor: Record<ActorType, number> = {
      agent: 0,
      human: 0,
      system: 0
    };

    for (const row of byActorResult.rows) {
      byActor[row.actor_type as ActorType] = parseInt(row.count);
    }

    const byAction: Record<string, number> = {};
    for (const row of byActionResult.rows) {
      byAction[row.action] = parseInt(row.count);
    }

    res.json({
      total: parseInt(totalResult.rows[0].count),
      recent: recentResult.rows.length,
      byActor,
      byAction,
      recentLogs: recentResult.rows
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get audit stats',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Helper function
function getActorTypeDescription(type: ActorType): string {
  const descriptions: Record<ActorType, string> = {
    agent: 'AI agent action',
    human: 'Human user action',
    system: 'System action'
  };
  return descriptions[type] || type;
}

export default router;
