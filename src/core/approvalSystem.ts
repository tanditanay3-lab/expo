import { query, beginTransaction, DatabaseTransaction } from '../db/connection';
import { auditLogger } from './auditLogger';
import { stateMachine } from './stateMachine';
import {
  Approval,
  ApprovalTargetType,
  ApprovalDecision,
  ShipmentStage
} from '../types';

interface ApprovalRequest {
  shipmentId: string;
  tenantId: string;
  targetType: ApprovalTargetType;
  targetId: string;
  approverId: string;
  decision: ApprovalDecision;
  comments?: string;
  changes?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

export class ApprovalSystem {
  private static instance: ApprovalSystem;

  private constructor() {}

  public static getInstance(): ApprovalSystem {
    if (!ApprovalSystem.instance) {
      ApprovalSystem.instance = new ApprovalSystem();
    }
    return ApprovalSystem.instance;
  }

  /**
   * Record an approval
   */
  async recordApproval(request: ApprovalRequest): Promise<Approval> {
    const tx = await beginTransaction();
    
    try {
      // Record the approval
      const result = await tx.client.query<Approval>(
        `INSERT INTO approvals (
          shipment_id, tenant_id, target_type, target_id, 
          approver_id, decision, comments, changes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *`,
        [
          request.shipmentId,
          request.tenantId,
          request.targetType,
          request.targetId,
          request.approverId,
          request.decision,
          request.comments,
          request.changes || {}
        ]
      );

      const approval = result.rows[0];

      // Log the approval in audit trail
      await auditLogger.logHumanAction(
        request.shipmentId,
        request.tenantId,
        request.approverId,
        `${request.targetType}_${request.decision}`,
        { targetId: request.targetId, targetType: request.targetType },
        { approvalId: approval.id, decision: request.decision },
        request.decision,
        { comments: request.comments, changes: request.changes },
        request.ipAddress,
        request.userAgent
      );

      // Update the target record status based on approval
      await this.updateTargetStatus(
        request.shipmentId,
        request.targetType,
        request.targetId,
        request.decision,
        tx
      );

      await tx.commit();
      
      return approval;
    } catch (error) {
      await tx.rollback();
      console.error('Error recording approval:', error);
      throw error;
    }
  }

  /**
   * Update target record status based on approval
   */
  private async updateTargetStatus(
    shipmentId: string,
    targetType: ApprovalTargetType,
    targetId: string,
    decision: ApprovalDecision,
    tx: DatabaseTransaction
  ): Promise<void> {
    switch (targetType) {
      case 'document':
        if (decision === 'approved') {
          await tx.client.query(
            'UPDATE documents SET status = $1, approved_at = NOW() WHERE id = $2',
            ['approved', targetId]
          );
        } else if (decision === 'rejected') {
          await tx.client.query(
            'UPDATE documents SET status = $1 WHERE id = $2',
            ['rejected', targetId]
          );
        }
        break;

      case 'compliance_screen':
        if (decision === 'acknowledged' || decision === 'approved') {
          await tx.client.query(
            'UPDATE compliance_screens SET status = $1, resolved_at = NOW() WHERE id = $2',
            ['resolved', targetId]
          );
        }
        break;

      case 'buyer_risk':
        // Buyer risk approval is recorded but doesn't change buyer status directly
        // The shipment can proceed based on this approval
        break;

      case 'classification':
        if (decision === 'approved') {
          await tx.client.query(
            'UPDATE classifications SET status = $1, approved_at = NOW() WHERE id = $2',
            ['approved', targetId]
          );
        }
        break;

      case 'shipment':
        // Handle shipment-level approvals
        if (decision === 'approved') {
          // Check if this allows stage advancement
          const currentStage = await stateMachine.getCurrentStage(shipmentId);
          if (currentStage === 'ready_to_file') {
            // Allow filing
            await tx.client.query(
              'UPDATE shipments SET status = $1 WHERE id = $2',
              ['ready_to_file', shipmentId]
            );
          }
        }
        break;
    }
  }

  /**
   * Get approvals for a shipment
   */
  async getShipmentApprovals(shipmentId: string, tenantId: string): Promise<Approval[]> {
    const result = await query<Approval>(
      'SELECT * FROM approvals WHERE shipment_id = $1 AND tenant_id = $2 ORDER BY created_at',
      [shipmentId, tenantId]
    );
    return result.rows;
  }

  /**
   * Get approvals for a specific target
   */
  async getTargetApprovals(
    shipmentId: string,
    targetType: ApprovalTargetType,
    targetId: string
  ): Promise<Approval[]> {
    const result = await query<Approval>(
      'SELECT * FROM approvals WHERE shipment_id = $1 AND target_type = $2 AND target_id = $3 ORDER BY created_at',
      [shipmentId, targetType, targetId]
    );
    return result.rows;
  }

  /**
   * Check if a target has been approved
   */
  async isApproved(
    shipmentId: string,
    targetType: ApprovalTargetType,
    targetId: string
  ): Promise<boolean> {
    const result = await query<Approval>(
      `SELECT 1 FROM approvals 
       WHERE shipment_id = $1 AND target_type = $2 AND target_id = $3 
       AND decision IN ('approved', 'acknowledged')
       LIMIT 1`,
      [shipmentId, targetType, targetId]
    );
    return result.rows.length > 0;
  }

  /**
   * Check if a target has been rejected
   */
  async isRejected(
    shipmentId: string,
    targetType: ApprovalTargetType,
    targetId: string
  ): Promise<boolean> {
    const result = await query<Approval>(
      `SELECT 1 FROM approvals 
       WHERE shipment_id = $1 AND target_type = $2 AND target_id = $3 
       AND decision = 'rejected'
       LIMIT 1`,
      [shipmentId, targetType, targetId]
    );
    return result.rows.length > 0;
  }

  /**
   * Get pending approvals for a shipment
   */
  async getPendingApprovals(shipmentId: string, tenantId: string): Promise<Array<{
    targetType: ApprovalTargetType;
    targetId: string;
    targetDetails: Record<string, any>;
    required: boolean;
  }>> {
    const pendingApprovals: Array<{
      targetType: ApprovalTargetType;
      targetId: string;
      targetDetails: Record<string, any>;
      required: boolean;
    }> = [];

    // Check for documents that need approval
    const documents = await query(
      `SELECT id, type, status FROM documents 
       WHERE shipment_id = $1 AND status != 'approved'`,
      [shipmentId]
    );

    for (const doc of documents.rows) {
      if (doc.status === 'pending' || doc.status === 'edited') {
        pendingApprovals.push({
          targetType: 'document',
          targetId: doc.id,
          targetDetails: { type: doc.type, currentStatus: doc.status },
          required: true
        });
      }
    }

    // Check for compliance screens that need acknowledgment
    const complianceScreens = await query(
      `SELECT id, severity, status FROM compliance_screens 
       WHERE shipment_id = $1 AND severity IN ('critical', 'high') AND status != 'resolved'`,
      [shipmentId]
    );

    for (const screen of complianceScreens.rows) {
      pendingApprovals.push({
        targetType: 'compliance_screen',
        targetId: screen.id,
        targetDetails: { severity: screen.severity, currentStatus: screen.status },
        required: true
      });
    }

    // Check for buyer risk that needs approval
    const shipment = await query(
      `SELECT s.buyer_id, b.risk_category 
       FROM shipments s
       LEFT JOIN buyers b ON s.buyer_id = b.id
       WHERE s.id = $1`,
      [shipmentId]
    );

    if (shipment.rows.length > 0 && shipment.rows[0].buyer_id) {
      const { buyer_id, risk_category } = shipment.rows[0];
      if (risk_category === 'high' || risk_category === 'critical') {
        const hasApproval = await this.isApproved(shipmentId, 'buyer_risk', buyer_id);
        if (!hasApproval) {
          pendingApprovals.push({
            targetType: 'buyer_risk',
            targetId: buyer_id,
            targetDetails: { riskCategory: risk_category },
            required: true
          });
        }
      }
    }

    // Check for classification that needs approval
    const classifications = await query(
      `SELECT id, confidence, status FROM classifications 
       WHERE shipment_id = $1 AND confidence < 0.8 AND status != 'approved'`,
      [shipmentId]
    );

    for (const classification of classifications.rows) {
      pendingApprovals.push({
        targetType: 'classification',
        targetId: classification.id,
        targetDetails: { confidence: classification.confidence, currentStatus: classification.status },
        required: true
      });
    }

    return pendingApprovals;
  }

  /**
   * Check if all required approvals are in place for a shipment to advance
   */
  async hasAllRequiredApprovals(shipmentId: string): Promise<boolean> {
    const pending = await this.getPendingApprovals(shipmentId, '');
    return pending.length === 0;
  }

  /**
   * Get approval statistics for a tenant
   */
  async getApprovalStats(tenantId: string): Promise<{
    totalApprovals: number;
    byType: Record<ApprovalTargetType, number>;
    byDecision: Record<ApprovalDecision, number>;
    pendingApprovals: number;
    recentApprovals: Approval[];
  }> {
    // Get total approvals
    const totalResult = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM approvals WHERE tenant_id = $1',
      [tenantId]
    );

    // Get by type
    const byTypeResult = await query<{ target_type: ApprovalTargetType; count: string }>(
      `SELECT target_type, COUNT(*) as count 
       FROM approvals 
       WHERE tenant_id = $1 
       GROUP BY target_type`,
      [tenantId]
    );

    // Get by decision
    const byDecisionResult = await query<{ decision: ApprovalDecision; count: string }>(
      `SELECT decision, COUNT(*) as count 
       FROM approvals 
       WHERE tenant_id = $1 
       GROUP BY decision`,
      [tenantId]
    );

    // Get pending approvals count
    const pendingResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count 
       FROM (
         SELECT DISTINCT shipment_id, target_type, target_id
         FROM approvals 
         WHERE tenant_id = $1 AND decision != 'approved'
       ) AS pending`,
      [tenantId]
    );

    // Get recent approvals
    const recentResult = await query<Approval>(
      'SELECT * FROM approvals WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 10',
      [tenantId]
    );

    // Format results
    const byType: Record<ApprovalTargetType, number> = {
      document: 0,
      compliance_screen: 0,
      buyer_risk: 0,
      classification: 0,
      shipment: 0
    };

    for (const row of byTypeResult.rows) {
      byType[row.target_type] = parseInt(row.count);
    }

    const byDecision: Record<ApprovalDecision, number> = {
      approved: 0,
      rejected: 0,
      edited: 0,
      acknowledged: 0
    };

    for (const row of byDecisionResult.rows) {
      byDecision[row.decision] = parseInt(row.count);
    }

    return {
      totalApprovals: parseInt(totalResult.rows[0].count),
      byType,
      byDecision,
      pendingApprovals: parseInt(pendingResult.rows[0].count),
      recentApprovals: recentResult.rows
    };
  }

  /**
   * Revoke an approval
   */
  async revokeApproval(approvalId: string, userId: string, reason?: string): Promise<boolean> {
    const tx = await beginTransaction();
    
    try {
      // Get the approval to be revoked
      const approvalResult = await tx.client.query<Approval>(
        'SELECT * FROM approvals WHERE id = $1',
        [approvalId]
      );

      if (approvalResult.rows.length === 0) {
        throw new Error('Approval not found');
      }

      const approval = approvalResult.rows[0];

      // Delete the approval
      await tx.client.query(
        'DELETE FROM approvals WHERE id = $1',
        [approvalId]
      );

      // Log the revocation
      await auditLogger.logHumanAction(
        approval.shipment_id,
        approval.tenant_id,
        userId,
        'approval_revoked',
        { approvalId, originalDecision: approval.decision },
        { revoked: true },
        'revoked',
        { reason }
      );

      // Update target status back to pending
      await tx.client.query(
        `UPDATE ${this.getTargetTable(approval.target_type)} 
         SET status = 'pending' 
         WHERE id = $1`,
        [approval.target_id]
      );

      await tx.commit();
      return true;
    } catch (error) {
      await tx.rollback();
      console.error('Error revoking approval:', error);
      throw error;
    }
  }

  /**
   * Get target table name based on target type
   */
  private getTargetTable(targetType: ApprovalTargetType): string {
    switch (targetType) {
      case 'document':
        return 'documents';
      case 'compliance_screen':
        return 'compliance_screens';
      case 'classification':
        return 'classifications';
      case 'buyer_risk':
        return 'buyers';
      case 'shipment':
        return 'shipments';
      default:
        return 'approvals';
    }
  }
}

// Export singleton instance
export const approvalSystem = ApprovalSystem.getInstance();

export default approvalSystem;
