import express from 'express';
import { query } from '../../db/connection';
import { AgentFactory } from '../../agents/baseAgent';
import { auditLogger } from '../../core/auditLogger';
import {
  Classification,
  ClassificationMethod,
  ClassificationStatus,
  ApiResponse
} from '../../types';

const router = express.Router();

// GET /api/v1/customs/classifications - List all classifications for the current tenant
router.get('/classifications', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { shipmentId, hsCode, status, page = 1, pageSize = 20 } = req.query;

    let queryText = 'SELECT * FROM classifications WHERE tenant_id = $1';
    const params: any[] = [tenantId];
    let paramIndex = 2;

    if (shipmentId) {
      queryText += ` AND shipment_id = $${paramIndex++}`;
      params.push(shipmentId);
    }

    if (hsCode) {
      queryText += ` AND hs_code = $${paramIndex++}`;
      params.push(hsCode);
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

    const result = await query<Classification>(queryText, params);

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
      error: 'Failed to fetch classifications',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/customs/classifications/:id - Get a specific classification
router.get('/classifications/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const result = await query<Classification>(
      'SELECT * FROM classifications WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Classification not found'
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch classification',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/v1/customs/classify - Classify a product
router.post('/classify', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const userId = req.userId;
    const { shipmentId, productDescription, productCategory, destinationPort, destinationCountry, forceReclassify } = req.body;

    if (!shipmentId || !productDescription) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'shipmentId and productDescription are required'
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

    // Get the customs intelligence agent
    const customsAgent = AgentFactory.getAgent('customs_intelligence');
    if (!customsAgent) {
      return res.status(500).json({
        success: false,
        error: 'Service Unavailable',
        message: 'Customs intelligence agent not available'
      });
    }

    // Execute classification
    const result = await customsAgent.execute(shipmentId, tenantId, {
      classificationRequests: [{
        productDescription,
        productCategory,
        destinationPort,
        destinationCountry,
        forceReclassify
      }],
      calculateDuty: true,
      predictClearanceTime: true
    });

    // Log the classification
    await auditLogger.logHumanAction(
      shipmentId,
      tenantId,
      userId,
      'product_classification_requested',
      { productDescription, productCategory },
      { result },
      'classified'
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to classify product',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/v1/customs/classifications/:id/approve - Approve a classification
router.post('/classifications/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const userId = req.userId;
    const { comments } = req.body;

    // Check if classification exists and belongs to tenant
    const classificationResult = await query<Classification>(
      'SELECT * FROM classifications WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (classificationResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Classification not found'
      });
    }

    const classification = classificationResult.rows[0];

    // Update classification status
    await query(
      `UPDATE classifications SET status = $1, approved_by = $2, approved_at = NOW()
       WHERE id = $3`,
      ['approved', userId, id]
    );

    // Record approval
    await query(
      `INSERT INTO approvals (
        shipment_id, tenant_id, target_type, target_id, 
        approver_id, decision, comments
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        classification.shipment_id,
        tenantId,
        'classification' as const,
        id,
        userId,
        'approved' as const,
        comments
      ]
    );

    // Log the approval
    await auditLogger.logHumanAction(
      classification.shipment_id,
      tenantId,
      userId,
      'classification_approved',
      { classificationId: id, hsCode: classification.hs_code },
      { approved: true, comments },
      'approved'
    );

    res.json({
      success: true,
      message: 'Classification approved',
      classificationId: id
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to approve classification',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/v1/customs/classifications/:id/reclassify - Reclassify a product
router.post('/classifications/:id/reclassify', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const userId = req.userId;
    const { manualOverride, productDescription, productCategory, destinationPort, destinationCountry } = req.body;

    // Check if classification exists and belongs to tenant
    const classificationResult = await query<Classification>(
      'SELECT * FROM classifications WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (classificationResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Classification not found'
      });
    }

    const classification = classificationResult.rows[0];

    // Get the customs intelligence agent
    const customsAgent = AgentFactory.getAgent('customs_intelligence');
    if (!customsAgent) {
      return res.status(500).json({
        success: false,
        error: 'Service Unavailable',
        message: 'Customs intelligence agent not available'
      });
    }

    // Reclassify
    const result = await (customsAgent as any).reclassifyProduct(
      classification.shipment_id,
      tenantId,
      {
        productDescription: productDescription || classification.classification_notes || '',
        productCategory,
        destinationPort,
        destinationCountry,
        forceReclassify: true,
        manualOverride
      }
    );

    // Log the reclassification
    await auditLogger.logHumanAction(
      classification.shipment_id,
      tenantId,
      userId,
      'product_reclassified',
      { classificationId: id, manualOverride },
      { result },
      'reclassified'
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to reclassify product',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/customs/hs-codes - Get HS code suggestions
router.get('/hs-codes', async (req, res) => {
  try {
    const { query: searchQuery, category, limit = 10 } = req.query;

    if (!searchQuery) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'query parameter is required'
      });
    }

    // Get the customs intelligence agent
    const customsAgent = AgentFactory.getAgent('customs_intelligence');
    if (!customsAgent) {
      return res.status(500).json({
        success: false,
        error: 'Service Unavailable',
        message: 'Customs intelligence agent not available'
      });
    }

    // Get suggestions
    const suggestions = await (customsAgent as any).getHSCodeSuggestions(
      searchQuery as string,
      category as string,
      parseInt(limit as string)
    );

    res.json({
      suggestions,
      count: suggestions.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get HS code suggestions',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/customs/hs-codes/:code - Get HS code details
router.get('/hs-codes/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const { destinationCountry } = req.query;

    // Get the customs intelligence agent
    const customsAgent = AgentFactory.getAgent('customs_intelligence');
    if (!customsAgent) {
      return res.status(500).json({
        success: false,
        error: 'Service Unavailable',
        message: 'Customs intelligence agent not available'
      });
    }

    // Get HS code details
    const details = await (customsAgent as any).getHSCodeDetails(code);

    if (!details) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'HS code not found'
      });
    }

    // Get duty rates if country specified
    let dutyRates = null;
    if (destinationCountry) {
      dutyRates = await (customsAgent as any).getDutyRates(code, destinationCountry as string);
    }

    res.json({
      ...details,
      dutyRates
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get HS code details',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/customs/duty-rates - Calculate duty rates
router.get('/duty-rates', async (req, res) => {
  try {
    const { hsCode, value, currency = 'INR', destinationCountry } = req.query;

    if (!hsCode || !value) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'hsCode and value are required'
      });
    }

    // Get the customs intelligence agent
    const customsAgent = AgentFactory.getAgent('customs_intelligence');
    if (!customsAgent) {
      return res.status(500).json({
        success: false,
        error: 'Service Unavailable',
        message: 'Customs intelligence agent not available'
      });
    }

    // Calculate duty
    const dutyCalculation = await (customsAgent as any).calculateDuty(
      '', // No shipment ID needed for standalone calculation
      '', // No tenant ID needed for standalone calculation
      hsCode as string,
      parseFloat(value as string),
      currency as string,
      destinationCountry as string
    );

    res.json(dutyCalculation);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to calculate duty rates',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/customs/clearance-time - Predict clearance time
router.get('/clearance-time', async (req, res) => {
  try {
    const { hsCode, destinationPort, originPort } = req.query;

    if (!hsCode || !destinationPort) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'hsCode and destinationPort are required'
      });
    }

    // Get the customs intelligence agent
    const customsAgent = AgentFactory.getAgent('customs_intelligence');
    if (!customsAgent) {
      return res.status(500).json({
        success: false,
        error: 'Service Unavailable',
        message: 'Customs intelligence agent not available'
      });
    }

    // Predict clearance time
    const prediction = await (customsAgent as any).predictClearanceTime(
      '', // No shipment ID needed for standalone prediction
      '', // No tenant ID needed for standalone prediction
      hsCode as string,
      destinationPort as string,
      originPort as string
    );

    res.json(prediction);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to predict clearance time',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/customs/ports - Get port information
router.get('/ports', async (req, res) => {
  try {
    const { portCode } = req.query;

    if (!portCode) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'portCode is required'
      });
    }

    // Get the customs intelligence agent
    const customsAgent = AgentFactory.getAgent('customs_intelligence');
    if (!customsAgent) {
      return res.status(500).json({
        success: false,
        error: 'Service Unavailable',
        message: 'Customs intelligence agent not available'
      });
    }

    // Get port information
    const portInfo = await (customsAgent as any).getPortInformation(portCode as string);

    if (!portInfo) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Port not found'
      });
    }

    res.json(portInfo);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get port information',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/customs/status - Get customs classification status for a shipment
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

    // Get the customs intelligence agent
    const customsAgent = AgentFactory.getAgent('customs_intelligence');
    if (!customsAgent) {
      return res.status(500).json({
        success: false,
        error: 'Service Unavailable',
        message: 'Customs intelligence agent not available'
      });
    }

    // Get status
    const status = await (customsAgent as any).getStatus(shipmentId as string);

    res.json(status);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get customs classification status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/customs/classification-methods - Get classification methods
router.get('/classification-methods', (req, res) => {
  const classificationMethods: ClassificationMethod[] = [
    'rules_based',
    'ml_model',
    'manual_override',
    'hybrid'
  ];

  res.json({
    classificationMethods: classificationMethods.map(method => ({
      value: method,
      label: method.replace('_', ' ').toUpperCase(),
      description: getClassificationMethodDescription(method)
    }))
  });
});

// GET /api/v1/customs/classification-statuses - Get classification statuses
router.get('/classification-statuses', (req, res) => {
  const classificationStatuses: ClassificationStatus[] = [
    'pending',
    'reviewed',
    'approved',
    'rejected',
    'overridden'
  ];

  res.json({
    classificationStatuses: classificationStatuses.map(status => ({
      value: status,
      label: status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')
    }))
  });
});

// Helper function
function getClassificationMethodDescription(method: ClassificationMethod): string {
  const descriptions: Record<ClassificationMethod, string> = {
    rules_based: 'Rules-based classification using HS code database',
    ml_model: 'Machine learning model for classification',
    manual_override: 'Manually overridden classification',
    hybrid: 'Combination of rules-based and ML classification'
  };
  return descriptions[method] || method;
}

export default router;
