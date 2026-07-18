import express from 'express';
import { query } from '../../db/connection';
import { AgentFactory } from '../../agents/baseAgent';
import { auditLogger } from '../../core/auditLogger';
import {
  ComplianceScreen,
  ComplianceListSource,
  ComplianceSeverity,
  CompliancePartyType,
  PolicyAlert,
  PolicySource,
  PolicySeverity,
  ApiResponse
} from '../../types';

const router = express.Router();

// GET /api/v1/compliance/screens - List all compliance screens for the current tenant
router.get('/screens', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { shipmentId, partyRef, listSource, severity, status, page = 1, pageSize = 20 } = req.query;

    let queryText = 'SELECT * FROM compliance_screens WHERE tenant_id = $1';
    const params: any[] = [tenantId];
    let paramIndex = 2;

    if (shipmentId) {
      queryText += ` AND shipment_id = $${paramIndex++}`;
      params.push(shipmentId);
    }

    if (partyRef) {
      queryText += ` AND party_ref = $${paramIndex++}`;
      params.push(partyRef);
    }

    if (listSource) {
      queryText += ` AND list_source = $${paramIndex++}`;
      params.push(listSource);
    }

    if (severity) {
      queryText += ` AND severity = $${paramIndex++}`;
      params.push(severity);
    }

    if (status) {
      queryText += ` AND status = $${paramIndex++}`;
      params.push(status);
    }

    // Count total
    const countQuery = `SELECT COUNT(*) FROM (${queryText}) AS subquery`;
    const countResult = await query<{ count: string }>(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Add pagination
    queryText += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(pageSize, (page as number - 1) * (pageSize as number));

    const result = await query<ComplianceScreen>(queryText, params);

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
      error: 'Failed to fetch compliance screens',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/compliance/screens/:id - Get a specific compliance screen
router.get('/screens/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const result = await query<ComplianceScreen>(
      'SELECT * FROM compliance_screens WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Compliance screen not found'
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch compliance screen',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/v1/compliance/screen - Screen a party for compliance
router.post('/screen', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const userId = req.userId;
    const { shipmentId, partyRef, partyType, partyName, partyCountry, partyAddress, forceRescreen } = req.body;

    if (!shipmentId || !partyRef || !partyType) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'shipmentId, partyRef, and partyType are required'
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

    // Get the compliance agent
    const complianceAgent = AgentFactory.getAgent('compliance');
    if (!complianceAgent) {
      return res.status(500).json({
        success: false,
        error: 'Service Unavailable',
        message: 'Compliance agent not available'
      });
    }

    // Execute screening
    const result = await complianceAgent.execute(shipmentId, tenantId, {
      screeningRequests: [{
        partyRef,
        partyType: partyType as CompliancePartyType,
        partyName,
        partyCountry,
        partyAddress,
        forceRescreen
      }]
    });

    // Log the screening
    await auditLogger.logHumanAction(
      shipmentId,
      tenantId,
      userId,
      'compliance_screening_requested',
      { partyRef, partyType, partyName },
      { result },
      'screened'
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to screen party',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/v1/compliance/screens/:id/acknowledge - Acknowledge a compliance screen
router.post('/screens/:id/acknowledge', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const userId = req.userId;
    const { resolutionNotes } = req.body;

    // Check if compliance screen exists and belongs to tenant
    const screenResult = await query<ComplianceScreen>(
      'SELECT * FROM compliance_screens WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (screenResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Compliance screen not found'
      });
    }

    const screen = screenResult.rows[0];

    // Update screen status
    await query(
      `UPDATE compliance_screens SET status = $1, resolved_by = $2, resolved_at = NOW(), resolution_notes = $3
       WHERE id = $4`,
      ['resolved', userId, resolutionNotes, id]
    );

    // Record approval
    await query(
      `INSERT INTO approvals (
        shipment_id, tenant_id, target_type, target_id, 
        approver_id, decision, comments
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        screen.shipment_id,
        tenantId,
        'compliance_screen' as const,
        id,
        userId,
        'acknowledged' as const,
        resolutionNotes
      ]
    );

    // Log the acknowledgment
    await auditLogger.logHumanAction(
      screen.shipment_id,
      tenantId,
      userId,
      'compliance_screen_acknowledged',
      { screenId: id, severity: screen.severity },
      { acknowledged: true, resolutionNotes },
      'acknowledged'
    );

    res.json({
      success: true,
      message: 'Compliance screen acknowledged',
      screenId: id
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to acknowledge compliance screen',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/compliance/alerts - List all policy alerts for the current tenant
router.get('/alerts', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { source, severity, status, page = 1, pageSize = 20 } = req.query;

    let queryText = 'SELECT * FROM policy_alerts WHERE tenant_id = $1';
    const params: any[] = [tenantId];
    let paramIndex = 2;

    if (source) {
      queryText += ` AND source = $${paramIndex++}`;
      params.push(source);
    }

    if (severity) {
      queryText += ` AND severity = $${paramIndex++}`;
      params.push(severity);
    }

    if (status) {
      queryText += ` AND status = $${paramIndex++}`;
      params.push(status);
    }

    // Count total
    const countQuery = `SELECT COUNT(*) FROM (${queryText}) AS subquery`;
    const countResult = await query<{ count: string }>(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Add pagination
    queryText += ` ORDER BY published_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(pageSize, (page as number - 1) * (pageSize as number));

    const result = await query<PolicyAlert>(queryText, params);

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
      error: 'Failed to fetch policy alerts',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/compliance/alerts/:id - Get a specific policy alert
router.get('/alerts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const result = await query<PolicyAlert>(
      'SELECT * FROM policy_alerts WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Policy alert not found'
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch policy alert',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/v1/compliance/monitor - Run policy monitoring
router.post('/monitor', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const userId = req.userId;
    const { sources, productCategories, destinationCountries } = req.body;

    // Get the compliance agent
    const complianceAgent = AgentFactory.getAgent('compliance');
    if (!complianceAgent) {
      return res.status(500).json({
        success: false,
        error: 'Service Unavailable',
        message: 'Compliance agent not available'
      });
    }

    // Execute policy monitoring
    const result = await (complianceAgent as any).monitorPolicies({
      sources: sources as PolicySource[],
      productCategories,
      destinationCountries
    });

    // Log the monitoring
    await auditLogger.logHumanAction(
      '',
      tenantId,
      userId,
      'policy_monitoring_requested',
      { sources, productCategories, destinationCountries },
      { result },
      'monitored'
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to run policy monitoring',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/compliance/status - Get compliance status for a shipment
router.get('/status', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { shipmentId } = req.query;

    if (!shipmentId) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'shipmentId is required'
      });
    }

    // Check if shipment exists and belongs to tenant
    const shipmentResult = await query<{ id: string; tenant_id: string }>(
      'SELECT id, tenant_id FROM shipments WHERE id = $1',
      [shipmentId as string]
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

    // Get the compliance agent
    const complianceAgent = AgentFactory.getAgent('compliance');
    if (!complianceAgent) {
      return res.status(500).json({
        success: false,
        error: 'Service Unavailable',
        message: 'Compliance agent not available'
      });
    }

    // Get status
    const status = await (complianceAgent as any).getStatus(shipmentId as string);

    res.json(status);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get compliance status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/compliance/sources - Get available compliance list sources
router.get('/sources', (req, res) => {
  const sources: ComplianceListSource[] = [
    'OFAC',
    'UN',
    'EU',
    'India_DGFT',
    'India_Customs',
    'India_RBI'
  ];

  res.json({
    sources: sources.map(source => ({
      value: source,
      label: source.replace('_', ' '),
      description: getSourceDescription(source)
    }))
  });
});

// GET /api/v1/compliance/policy-sources - Get available policy sources
router.get('/policy-sources', (req, res) => {
  const sources: PolicySource[] = [
    'DGFT',
    'RBI',
    'Customs',
    'FEMA'
  ];

  res.json({
    sources: sources.map(source => ({
      value: source,
      label: source,
      description: getPolicySourceDescription(source)
    }))
  });
});

// GET /api/v1/compliance/severity-levels - Get severity levels
router.get('/severity-levels', (req, res) => {
  const severityLevels: ComplianceSeverity[] = [
    'low',
    'medium',
    'high',
    'critical'
  ];

  res.json({
    severityLevels: severityLevels.map(level => ({
      value: level,
      label: level.charAt(0).toUpperCase() + level.slice(1),
      description: getSeverityDescription(level)
    }))
  });
});

// GET /api/v1/compliance/party-types - Get party types
router.get('/party-types', (req, res) => {
  const partyTypes: CompliancePartyType[] = [
    'buyer',
    'consignee',
    'shipper',
    'notify_party',
    'other'
  ];

  res.json({
    partyTypes: partyTypes.map(type => ({
      value: type,
      label: type.charAt(0).toUpperCase() + type.slice(1).replace('_', ' ')
    }))
  });
});

// Helper functions
function getSourceDescription(source: ComplianceListSource): string {
  const descriptions: Record<ComplianceListSource, string> = {
    OFAC: 'Office of Foreign Assets Control (US Treasury)',
    UN: 'United Nations Sanctions List',
    EU: 'European Union Consolidated Sanctions List',
    India_DGFT: 'Directorate General of Foreign Trade (India)',
    India_Customs: 'Indian Customs Restricted Lists',
    India_RBI: 'Reserve Bank of India Restricted Lists',
    other: 'Other sanctions lists'
  };
  return descriptions[source] || source;
}

function getPolicySourceDescription(source: PolicySource): string {
  const descriptions: Record<PolicySource, string> = {
    DGFT: 'Directorate General of Foreign Trade',
    RBI: 'Reserve Bank of India',
    Customs: 'Indian Customs Department',
    FEMA: 'Foreign Exchange Management Act',
    other: 'Other policy sources'
  };
  return descriptions[source] || source;
}

function getSeverityDescription(severity: ComplianceSeverity): string {
  const descriptions: Record<ComplianceSeverity, string> = {
    low: 'Low risk - No action required',
    medium: 'Medium risk - Review recommended',
    high: 'High risk - Approval required',
    critical: 'Critical risk - Immediate action required'
  };
  return descriptions[severity] || severity;
}

export default router;
