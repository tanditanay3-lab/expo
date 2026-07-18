import { query } from '../db/connection';
import { ActorType, AuditLog } from '../types';

interface AuditLogInput {
  shipmentId?: string;
  tenantId: string;
  actorType: ActorType;
  actorRef: string;
  action: string;
  inputRef?: Record<string, any>;
  outputRef?: Record<string, any>;
  decision?: string;
  confidence?: number;
  agentVersion?: string;
  modelVersion?: string;
  promptVersion?: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

export class AuditLogger {
  private static instance: AuditLogger;

  private constructor() {}

  public static getInstance(): AuditLogger {
    if (!AuditLogger.instance) {
      AuditLogger.instance = new AuditLogger();
    }
    return AuditLogger.instance;
  }

  /**
   * Log an audit entry
   */
  async log(entry: AuditLogInput): Promise<AuditLog> {
    const result = await query<AuditLog>(
      `INSERT INTO audit_log (
        shipment_id, tenant_id, actor_type, actor_ref, action, 
        input_ref, output_ref, decision, confidence, 
        agent_version, model_version, prompt_version, metadata, 
        ip_address, user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *`,
      [
        entry.shipmentId,
        entry.tenantId,
        entry.actorType,
        entry.actorRef,
        entry.action,
        entry.inputRef || {},
        entry.outputRef || {},
        entry.decision,
        entry.confidence,
        entry.agentVersion,
        entry.modelVersion,
        entry.promptVersion,
        entry.metadata || {},
        entry.ipAddress,
        entry.userAgent
      ]
    );

    return result.rows[0];
  }

  /**
   * Log an agent action
   */
  async logAgentAction(
    shipmentId: string,
    tenantId: string,
    agentType: string,
    agentVersion: string,
    action: string,
    input: Record<string, any>,
    output: Record<string, any>,
    confidence: number,
    modelVersion?: string,
    promptVersion?: string,
    metadata?: Record<string, any>
  ): Promise<AuditLog> {
    return this.log({
      shipmentId,
      tenantId,
      actorType: 'agent',
      actorRef: `${agentType}:${agentVersion}`,
      action,
      inputRef: input,
      outputRef: output,
      confidence,
      agentVersion,
      modelVersion,
      promptVersion,
      metadata
    });
  }

  /**
   * Log a human action
   */
  async logHumanAction(
    shipmentId: string,
    tenantId: string,
    userId: string,
    action: string,
    input?: Record<string, any>,
    output?: Record<string, any>,
    decision?: string,
    metadata?: Record<string, any>,
    ipAddress?: string,
    userAgent?: string
  ): Promise<AuditLog> {
    return this.log({
      shipmentId,
      tenantId,
      actorType: 'human',
      actorRef: userId,
      action,
      inputRef: input,
      outputRef: output,
      decision,
      metadata,
      ipAddress,
      userAgent
    });
  }

  /**
   * Log a system action
   */
  async logSystemAction(
    tenantId: string,
    action: string,
    input?: Record<string, any>,
    output?: Record<string, any>,
    metadata?: Record<string, any>
  ): Promise<AuditLog> {
    return this.log({
      tenantId,
      actorType: 'system',
      actorRef: 'system',
      action,
      inputRef: input,
      outputRef: output,
      metadata
    });
  }

  /**
   * Get audit log for a shipment
   */
  async getShipmentAuditLog(shipmentId: string, tenantId: string): Promise<AuditLog[]> {
    const result = await query<AuditLog>(
      'SELECT * FROM audit_log WHERE shipment_id = $1 AND tenant_id = $2 ORDER BY created_at',
      [shipmentId, tenantId]
    );
    return result.rows;
  }

  /**
   * Get audit log entries for a tenant
   */
  async getTenantAuditLog(
    tenantId: string,
    options: {
      shipmentId?: string;
      actorType?: ActorType;
      action?: string;
      startDate?: Date;
      endDate?: Date;
      page?: number;
      pageSize?: number;
    } = {}
  ): Promise<{ logs: AuditLog[]; total: number }> {
    const { shipmentId, actorType, action, startDate, endDate, page = 1, pageSize = 50 } = options;
    
    let queryText = 'SELECT * FROM audit_log WHERE tenant_id = $1';
    const params: any[] = [tenantId];
    let paramIndex = 2;

    if (shipmentId) {
      queryText += ` AND shipment_id = $${paramIndex++}`;
      params.push(shipmentId);
    }

    if (actorType) {
      queryText += ` AND actor_type = $${paramIndex++}`;
      params.push(actorType);
    }

    if (action) {
      queryText += ` AND action ILIKE $${paramIndex++}`;
      params.push(`%${action}%`);
    }

    if (startDate) {
      queryText += ` AND created_at >= $${paramIndex++}`;
      params.push(startDate);
    }

    if (endDate) {
      queryText += ` AND created_at <= $${paramIndex++}`;
      params.push(endDate);
    }

    // Count total
    const countQuery = `SELECT COUNT(*) FROM (${queryText}) AS subquery`;
    const countResult = await query<{ count: string }>(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Add pagination
    queryText += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(pageSize, (page - 1) * pageSize);

    const result = await query<AuditLog>(queryText, params);
    
    return {
      logs: result.rows,
      total
    };
  }

  /**
   * Export audit log for a shipment (for compliance reporting)
   */
  async exportShipmentAuditLog(shipmentId: string, tenantId: string): Promise<{
    shipmentNumber: string;
    auditTrail: Array<{
      timestamp: string;
      actor: string;
      actorType: string;
      action: string;
      details: Record<string, any>;
    }>;
  }> {
    // Get shipment number
    const shipmentResult = await query<{ shipment_number: string }>(
      'SELECT shipment_number FROM shipments WHERE id = $1 AND tenant_id = $2',
      [shipmentId, tenantId]
    );

    if (shipmentResult.rows.length === 0) {
      throw new Error('Shipment not found');
    }

    const shipmentNumber = shipmentResult.rows[0].shipment_number;

    // Get audit log entries
    const auditLogs = await this.getShipmentAuditLog(shipmentId, tenantId);

    // Format for export
    const auditTrail = auditLogs.map(log => ({
      timestamp: log.created_at.toISOString(),
      actor: log.actor_ref,
      actorType: log.actor_type,
      action: log.action,
      details: {
        input: log.input_ref,
        output: log.output_ref,
        decision: log.decision,
        confidence: log.confidence,
        metadata: log.metadata
      }
    }));

    return {
      shipmentNumber,
      auditTrail
    };
  }

  /**
   * Get recent audit log entries across all tenants (admin only)
   */
  async getRecentAuditLogs(limit: number = 100): Promise<AuditLog[]> {
    const result = await query<AuditLog>(
      'SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    return result.rows;
  }

  /**
   * Search audit logs
   */
  async searchAuditLogs(
    tenantId: string,
    searchQuery: string,
    options: {
      startDate?: Date;
      endDate?: Date;
      page?: number;
      pageSize?: number;
    } = {}
  ): Promise<{ logs: AuditLog[]; total: number }> {
    const { startDate, endDate, page = 1, pageSize = 50 } = options;
    
    let queryText = `SELECT * FROM audit_log 
                     WHERE tenant_id = $1 
                     AND (action ILIKE $2 OR actor_ref ILIKE $2 OR shipment_id::text ILIKE $2)`;
    const params: any[] = [tenantId, `%${searchQuery}%`];
    let paramIndex = 3;

    if (startDate) {
      queryText += ` AND created_at >= $${paramIndex++}`;
      params.push(startDate);
    }

    if (endDate) {
      queryText += ` AND created_at <= $${paramIndex++}`;
      params.push(endDate);
    }

    // Count total
    const countQuery = `SELECT COUNT(*) FROM (${queryText}) AS subquery`;
    const countResult = await query<{ count: string }>(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Add pagination
    queryText += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(pageSize, (page - 1) * pageSize);

    const result = await query<AuditLog>(queryText, params);
    
    return {
      logs: result.rows,
      total
    };
  }
}

// Export singleton instance
export const auditLogger = AuditLogger.getInstance();

export default auditLogger;
