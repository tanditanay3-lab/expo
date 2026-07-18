import express from 'express';
import { query } from '../../db/connection';
import { AgentFactory } from '../../agents/baseAgent';
import { auditLogger } from '../../core/auditLogger';
import {
  Document,
  DocumentType,
  DocumentStatus,
  GenerateDocumentsRequest,
  ApiResponse
} from '../../types';

const router = express.Router();

// GET /api/v1/documents - List all documents for the current tenant
router.get('/', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { shipmentId, type, status, page = 1, pageSize = 20 } = req.query;

    let queryText = 'SELECT d.* FROM documents d JOIN shipments s ON d.shipment_id = s.id WHERE s.tenant_id = $1';
    const params: any[] = [tenantId];
    let paramIndex = 2;

    if (shipmentId) {
      queryText += ` AND d.shipment_id = $${paramIndex++}`;
      params.push(shipmentId);
    }

    if (type) {
      queryText += ` AND d.type = $${paramIndex++}`;
      params.push(type);
    }

    if (status) {
      queryText += ` AND d.status = $${paramIndex++}`;
      params.push(status);
    }

    // Count total
    const countQuery = `SELECT COUNT(*) FROM (${queryText}) AS subquery`;
    const countResult = await query<{ count: string }>(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Add pagination
    queryText += ` ORDER BY d.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(pageSize, (page as number - 1) * (pageSize as number));

    const result = await query<Document>(queryText, params);

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
      error: 'Failed to fetch documents',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/documents/:id - Get a specific document
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const result = await query<Document>(
      `SELECT d.* FROM documents d 
       JOIN shipments s ON d.shipment_id = s.id 
       WHERE d.id = $1 AND s.tenant_id = $2`,
      [id, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Document not found'
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch document',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/v1/documents/generate - Generate documents for a shipment
router.post('/generate', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const userId = req.userId;
    const { shipmentId, ...options }: GenerateDocumentsRequest & { shipmentId: string } = req.body;

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

    // Get the documentation agent
    const docAgent = AgentFactory.getAgent('documentation');
    if (!docAgent) {
      return res.status(500).json({
        success: false,
        error: 'Service Unavailable',
        message: 'Documentation agent not available'
      });
    }

    // Execute the agent
    const result = await docAgent.execute(shipmentId, tenantId, options);

    // Log the document generation
    await auditLogger.logHumanAction(
      shipmentId,
      tenantId,
      userId,
      'documents_generated',
      { shipmentId, options },
      { result },
      'generated'
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to generate documents',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/v1/documents/:id/approve - Approve a document
router.post('/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const userId = req.userId;
    const { comments, changes } = req.body;

    // Check if document exists and belongs to tenant
    const docResult = await query<Document>(
      `SELECT d.* FROM documents d 
       JOIN shipments s ON d.shipment_id = s.id 
       WHERE d.id = $1 AND s.tenant_id = $2`,
      [id, tenantId]
    );

    if (docResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Document not found'
      });
    }

    const document = docResult.rows[0];

    // Update document status
    await query(
      `UPDATE documents SET status = $1, approved_by = $2, approved_at = NOW(), 
       discrepancy_flags = COALESCE(discrepancy_flags, '[]'::jsonb) || $3
       WHERE id = $4`,
      ['approved', userId, JSON.stringify(changes || []), id]
    );

    // Record approval
    await query(
      `INSERT INTO approvals (
        shipment_id, tenant_id, target_type, target_id, 
        approver_id, decision, comments, changes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        document.shipment_id,
        tenantId,
        'document' as const,
        id,
        userId,
        'approved' as const,
        comments,
        changes || {}
      ]
    );

    // Log the approval
    await auditLogger.logHumanAction(
      document.shipment_id,
      tenantId,
      userId,
      'document_approved',
      { documentId: id, documentType: document.type },
      { approved: true, comments, changes },
      'approved'
    );

    res.json({
      success: true,
      message: 'Document approved',
      documentId: id
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to approve document',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/v1/documents/:id/reject - Reject a document
router.post('/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const userId = req.userId;
    const { comments, changes } = req.body;

    // Check if document exists and belongs to tenant
    const docResult = await query<Document>(
      `SELECT d.* FROM documents d 
       JOIN shipments s ON d.shipment_id = s.id 
       WHERE d.id = $1 AND s.tenant_id = $2`,
      [id, tenantId]
    );

    if (docResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Document not found'
      });
    }

    const document = docResult.rows[0];

    // Update document status
    await query(
      'UPDATE documents SET status = $1, reviewed_by = $2, reviewed_at = NOW() WHERE id = $3',
      ['rejected', userId, id]
    );

    // Record approval (rejection)
    await query(
      `INSERT INTO approvals (
        shipment_id, tenant_id, target_type, target_id, 
        approver_id, decision, comments, changes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        document.shipment_id,
        tenantId,
        'document' as const,
        id,
        userId,
        'rejected' as const,
        comments,
        changes || {}
      ]
    );

    // Log the rejection
    await auditLogger.logHumanAction(
      document.shipment_id,
      tenantId,
      userId,
      'document_rejected',
      { documentId: id, documentType: document.type },
      { rejected: true, comments, changes },
      'rejected'
    );

    res.json({
      success: true,
      message: 'Document rejected',
      documentId: id
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to reject document',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/v1/documents/:id/edit - Edit a document
router.post('/:id/edit', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const userId = req.userId;
    const { comments, changes } = req.body;

    // Check if document exists and belongs to tenant
    const docResult = await query<Document>(
      `SELECT d.* FROM documents d 
       JOIN shipments s ON d.shipment_id = s.id 
       WHERE d.id = $1 AND s.tenant_id = $2`,
      [id, tenantId]
    );

    if (docResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Document not found'
      });
    }

    const document = docResult.rows[0];

    // Update document status and content
    await query(
      `UPDATE documents SET status = $1, reviewed_by = $2, reviewed_at = NOW(), 
       content = COALESCE(content, '') || $3, 
       discrepancy_flags = COALESCE(discrepancy_flags, '[]'::jsonb) || $4
       WHERE id = $5`,
      ['edited', userId, JSON.stringify(changes || {}), JSON.stringify(changes || []), id]
    );

    // Record approval (edit)
    await query(
      `INSERT INTO approvals (
        shipment_id, tenant_id, target_type, target_id, 
        approver_id, decision, comments, changes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        document.shipment_id,
        tenantId,
        'document' as const,
        id,
        userId,
        'edited' as const,
        comments,
        changes || {}
      ]
    );

    // Log the edit
    await auditLogger.logHumanAction(
      document.shipment_id,
      tenantId,
      userId,
      'document_edited',
      { documentId: id, documentType: document.type },
      { edited: true, comments, changes },
      'edited'
    );

    res.json({
      success: true,
      message: 'Document edited',
      documentId: id
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to edit document',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/documents/:id/content - Get document content
router.get('/:id/content', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const result = await query<Document>(
      `SELECT d.content, d.file_name, d.mime_type, d.type 
       FROM documents d 
       JOIN shipments s ON d.shipment_id = s.id 
       WHERE d.id = $1 AND s.tenant_id = $2`,
      [id, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Document not found'
      });
    }

    const document = result.rows[0];

    // Set appropriate content type
    res.setHeader('Content-Type', document.mime_type || 'text/plain');
    res.setHeader('Content-Disposition', `inline; filename="${document.file_name}"`);

    res.send(document.content);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get document content',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/v1/documents/validate - Validate documents for a shipment
router.post('/validate', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const userId = req.userId;
    const { shipmentId } = req.body;

    if (!shipmentId) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'shipmentId is required'
      });
    }

    // Get the documentation agent
    const docAgent = AgentFactory.getAgent('documentation');
    if (!docAgent) {
      return res.status(500).json({
        success: false,
        error: 'Service Unavailable',
        message: 'Documentation agent not available'
      });
    }

    // Validate documents
    const result = await (docAgent as any).validateDocuments(shipmentId, tenantId);

    // Log the validation
    await auditLogger.logHumanAction(
      shipmentId,
      tenantId,
      userId,
      'documents_validated',
      { shipmentId },
      { result },
      'validated'
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to validate documents',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/v1/documents/types - Get available document types
router.get('/types', (req, res) => {
  const documentTypes: DocumentType[] = [
    'commercial_invoice',
    'packing_list',
    'coo_draft',
    'shipping_bill_draft',
    'lc_document_package'
  ];

  res.json({
    types: documentTypes.map(type => ({
      value: type,
      label: type.replace('_', ' ').toUpperCase()
    }))
  });
});

// GET /api/v1/documents/status - Get document generation status for a shipment
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

    // Get the documentation agent
    const docAgent = AgentFactory.getAgent('documentation');
    if (!docAgent) {
      return res.status(500).json({
        success: false,
        error: 'Service Unavailable',
        message: 'Documentation agent not available'
      });
    }

    // Get status
    const status = await (docAgent as any).getStatus(shipmentId as string);

    res.json(status);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get document status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
