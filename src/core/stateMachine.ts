import { query, beginTransaction, DatabaseTransaction } from '../db/connection';
import {
  ShipmentStage,
  Shipment,
  Document,
  ComplianceScreen,
  Classification,
  Buyer,
  Approval,
  AuditLog
} from '../types';

// Define stage transition rules
const STAGE_TRANSITIONS: Record<ShipmentStage, { next: ShipmentStage; requiredChecks: string[] }> = {
  draft: {
    next: 'documents_generated',
    requiredChecks: ['has_documents']
  },
  documents_generated: {
    next: 'compliance_screened',
    requiredChecks: ['documents_approved']
  },
  compliance_screened: {
    next: 'buyer_verified',
    requiredChecks: ['compliance_passed']
  },
  buyer_verified: {
    next: 'customs_classified',
    requiredChecks: ['buyer_verified']
  },
  customs_classified: {
    next: 'ready_to_file',
    requiredChecks: ['customs_classified']
  },
  ready_to_file: {
    next: 'filed',
    requiredChecks: ['ready_to_file']
  },
  filed: {
    next: 'filed',
    requiredChecks: []
  },
  cancelled: {
    next: 'cancelled',
    requiredChecks: []
  }
};

// Define checks for each stage transition
interface StageCheck {
  (shipmentId: string, tx: DatabaseTransaction): Promise<boolean>;
}

const stageChecks: Record<string, StageCheck> = {
  // Check if documents have been generated
  has_documents: async (shipmentId: string, tx: DatabaseTransaction) => {
    const result = await tx.client.query(
      'SELECT COUNT(*) as count FROM documents WHERE shipment_id = $1',
      [shipmentId]
    );
    return parseInt(result.rows[0].count) > 0;
  },

  // Check if all required documents are approved
  documents_approved: async (shipmentId: string, tx: DatabaseTransaction) => {
    const result = await tx.client.query(
      `SELECT COUNT(*) as total, 
              COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved
       FROM documents 
       WHERE shipment_id = $1 AND type IN ('commercial_invoice', 'packing_list')`,
      [shipmentId]
    );
    const { total, approved } = result.rows[0];
    return parseInt(total) > 0 && parseInt(approved) === parseInt(total);
  },

  // Check if compliance screening has passed (no unresolved critical/high flags)
  compliance_passed: async (shipmentId: string, tx: DatabaseTransaction) => {
    const result = await tx.client.query(
      `SELECT COUNT(*) as critical_count 
       FROM compliance_screens 
       WHERE shipment_id = $1 
         AND severity IN ('critical', 'high') 
         AND status != 'resolved'`,
      [shipmentId]
    );
    return parseInt(result.rows[0].critical_count) === 0;
  },

  // Check if buyer verification is complete
  buyer_verified: async (shipmentId: string, tx: DatabaseTransaction) => {
    const result = await tx.client.query(
      `SELECT b.risk_category, 
              EXISTS(SELECT 1 FROM approvals a 
                     WHERE a.shipment_id = $1 
                       AND a.target_type = 'buyer_risk') as has_approval
       FROM shipments s
       LEFT JOIN buyers b ON s.buyer_id = b.id
       WHERE s.id = $1`,
      [shipmentId]
    );
    
    if (result.rows.length === 0) return false;
    
    const { risk_category, has_approval } = result.rows[0];
    
    // If buyer is high/critical risk, need explicit approval
    if (risk_category === 'high' || risk_category === 'critical') {
      return has_approval === true;
    }
    
    // Otherwise, buyer verification is complete
    return true;
  },

  // Check if customs classification is complete
  customs_classified: async (shipmentId: string, tx: DatabaseTransaction) => {
    const result = await tx.client.query(
      `SELECT c.confidence, 
              EXISTS(SELECT 1 FROM approvals a 
                     WHERE a.shipment_id = $1 
                       AND a.target_type = 'classification') as has_approval
       FROM classifications c
       WHERE c.shipment_id = $1
       ORDER BY c.created_at DESC
       LIMIT 1`,
      [shipmentId]
    );
    
    if (result.rows.length === 0) return false;
    
    const { confidence, has_approval } = result.rows[0];
    
    // If confidence is low, need explicit approval
    if (confidence < 0.8) {
      return has_approval === true;
    }
    
    // Otherwise, classification is complete
    return true;
  },

  // Check if shipment is ready to file
  ready_to_file: async (shipmentId: string, tx: DatabaseTransaction) => {
    // Check all previous stages are complete
    const checks = [
      stageChecks.documents_approved(shipmentId, tx),
      stageChecks.compliance_passed(shipmentId, tx),
      stageChecks.buyer_verified(shipmentId, tx),
      stageChecks.customs_classified(shipmentId, tx)
    ];
    
    const results = await Promise.all(checks);
    return results.every(r => r);
  }
};

// State Machine Class
export class ShipmentStateMachine {
  private static instance: ShipmentStateMachine;

  private constructor() {}

  public static getInstance(): ShipmentStateMachine {
    if (!ShipmentStateMachine.instance) {
      ShipmentStateMachine.instance = new ShipmentStateMachine();
    }
    return ShipmentStateMachine.instance;
  }

  /**
   * Get the current stage of a shipment
   */
  async getCurrentStage(shipmentId: string): Promise<ShipmentStage> {
    const result = await query<{ stage: ShipmentStage }>(
      'SELECT stage FROM shipments WHERE id = $1',
      [shipmentId]
    );
    
    if (result.rows.length === 0) {
      throw new Error(`Shipment not found: ${shipmentId}`);
    }
    
    return result.rows[0].stage;
  }

  /**
   * Check if a shipment can advance to the next stage
   */
  async canAdvance(shipmentId: string): Promise<{ canAdvance: boolean; nextStage?: ShipmentStage; missingChecks: string[] }> {
    const currentStage = await this.getCurrentStage(shipmentId);
    const transition = STAGE_TRANSITIONS[currentStage];
    
    if (!transition || transition.next === currentStage) {
      return { canAdvance: false, missingChecks: ['already_at_final_stage'] };
    }

    const tx = await beginTransaction();
    
    try {
      const checkResults = await Promise.all(
        transition.requiredChecks.map(checkName => 
          stageChecks[checkName](shipmentId, tx).catch(() => false)
        )
      );

      const missingChecks = transition.requiredChecks.filter(
        (_, index) => !checkResults[index]
      );

      await tx.rollback();

      return {
        canAdvance: missingChecks.length === 0,
        nextStage: transition.next,
        missingChecks
      };
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  /**
   * Advance a shipment to the next stage
   */
  async advanceStage(shipmentId: string, userId: string): Promise<{ success: boolean; fromStage: ShipmentStage; toStage: ShipmentStage; message?: string }> {
    const currentStage = await this.getCurrentStage(shipmentId);
    const transition = STAGE_TRANSITIONS[currentStage];
    
    if (!transition || transition.next === currentStage) {
      return { success: false, fromStage: currentStage, toStage: currentStage, message: 'Already at final stage' };
    }

    const tx = await beginTransaction();
    
    try {
      // Check if we can advance
      const checkResults = await Promise.all(
        transition.requiredChecks.map(checkName => 
          stageChecks[checkName](shipmentId, tx)
        )
      );

      const allChecksPassed = checkResults.every(r => r);
      
      if (!allChecksPassed) {
        await tx.rollback();
        return { 
          success: false, 
          fromStage: currentStage, 
          toStage: currentStage,
          message: 'Required checks not passed'
        };
      }

      // Update shipment stage
      await tx.client.query(
        'UPDATE shipments SET stage = $1, updated_at = NOW(), updated_by = $2 WHERE id = $3',
        [transition.next, userId, shipmentId]
      );

      // Log the stage transition
      await tx.client.query(
        `INSERT INTO audit_log 
         (shipment_id, tenant_id, actor_type, actor_ref, action, input_ref, output_ref, metadata)
         SELECT $1, tenant_id, 'human', $2, 'stage_transition', 
                jsonb_build_object('from_stage', $3, 'to_stage', $4),
                jsonb_build_object('shipment_id', $1, 'new_stage', $4),
                jsonb_build_object('triggered_by', $2)
         FROM shipments WHERE id = $1`,
        [shipmentId, userId, currentStage, transition.next]
      );

      await tx.commit();

      return { 
        success: true, 
        fromStage: currentStage, 
        toStage: transition.next,
        message: 'Stage advanced successfully'
      };
    } catch (error) {
      await tx.rollback();
      console.error('Error advancing shipment stage:', error);
      throw error;
    }
  }

  /**
   * Force advance a shipment stage (for admin override)
   */
  async forceAdvanceStage(shipmentId: string, userId: string, overrideReason?: string): Promise<{ success: boolean; fromStage: ShipmentStage; toStage: ShipmentStage }> {
    const currentStage = await this.getCurrentStage(shipmentId);
    const transition = STAGE_TRANSITIONS[currentStage];
    
    if (!transition || transition.next === currentStage) {
      return { success: false, fromStage: currentStage, toStage: currentStage };
    }

    const tx = await beginTransaction();
    
    try {
      // Update shipment stage
      await tx.client.query(
        'UPDATE shipments SET stage = $1, updated_at = NOW(), updated_by = $2 WHERE id = $3',
        [transition.next, userId, shipmentId]
      );

      // Log the forced stage transition
      await tx.client.query(
        `INSERT INTO audit_log 
         (shipment_id, tenant_id, actor_type, actor_ref, action, input_ref, output_ref, metadata)
         SELECT $1, tenant_id, 'human', $2, 'forced_stage_transition', 
                jsonb_build_object('from_stage', $3, 'to_stage', $4, 'reason', $5),
                jsonb_build_object('shipment_id', $1, 'new_stage', $4),
                jsonb_build_object('triggered_by', $2, 'override', true)
         FROM shipments WHERE id = $1`,
        [shipmentId, userId, currentStage, transition.next, overrideReason || 'Admin override']
      );

      await tx.commit();

      return { 
        success: true, 
        fromStage: currentStage, 
        toStage: transition.next
      };
    } catch (error) {
      await tx.rollback();
      console.error('Error forcing shipment stage advance:', error);
      throw error;
    }
  }

  /**
   * Get the complete status of a shipment including all agent outputs
   */
  async getShipmentStatus(shipmentId: string): Promise<{
    shipment: Shipment;
    documents: Document[];
    complianceScreens: ComplianceScreen[];
    classifications: Classification[];
    buyer?: Buyer;
    approvals: Approval[];
    auditLogs: AuditLog[];
    canAdvance: boolean;
    nextStage?: ShipmentStage;
    missingChecks: string[];
  }> {
    const tx = await beginTransaction();
    
    try {
      // Get shipment
      const shipmentResult = await tx.client.query<Shipment>(
        'SELECT * FROM shipments WHERE id = $1',
        [shipmentId]
      );
      
      if (shipmentResult.rows.length === 0) {
        throw new Error(`Shipment not found: ${shipmentId}`);
      }
      
      const shipment = shipmentResult.rows[0];
      
      // Get documents
      const documentsResult = await tx.client.query<Document>(
        'SELECT * FROM documents WHERE shipment_id = $1 ORDER BY created_at',
        [shipmentId]
      );
      
      // Get compliance screens
      const complianceResult = await tx.client.query<ComplianceScreen>(
        'SELECT * FROM compliance_screens WHERE shipment_id = $1 ORDER BY created_at',
        [shipmentId]
      );
      
      // Get classifications
      const classificationsResult = await tx.client.query<Classification>(
        'SELECT * FROM classifications WHERE shipment_id = $1 ORDER BY created_at DESC',
        [shipmentId]
      );
      
      // Get buyer
      let buyer: Buyer | undefined;
      if (shipment.buyer_id) {
        const buyerResult = await tx.client.query<Buyer>(
          'SELECT * FROM buyers WHERE id = $1',
          [shipment.buyer_id]
        );
        buyer = buyerResult.rows[0];
      }
      
      // Get approvals
      const approvalsResult = await tx.client.query<Approval>(
        'SELECT * FROM approvals WHERE shipment_id = $1 ORDER BY created_at',
        [shipmentId]
      );
      
      // Get audit logs
      const auditLogsResult = await tx.client.query<AuditLog>(
        'SELECT * FROM audit_log WHERE shipment_id = $1 ORDER BY created_at',
        [shipmentId]
      );

      await tx.rollback();

      // Check if can advance
      const { canAdvance, nextStage, missingChecks } = await this.canAdvance(shipmentId);

      return {
        shipment,
        documents: documentsResult.rows,
        complianceScreens: complianceResult.rows,
        classifications: classificationsResult.rows,
        buyer,
        approvals: approvalsResult.rows,
        auditLogs: auditLogsResult.rows,
        canAdvance,
        nextStage,
        missingChecks
      };
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  /**
   * Get all shipments for a tenant with their current stages
   */
  async getTenantShipments(tenantId: string, stage?: ShipmentStage, status?: string): Promise<Shipment[]> {
    let queryText = 'SELECT * FROM shipments WHERE tenant_id = $1';
    const params: any[] = [tenantId];
    
    if (stage) {
      queryText += ' AND stage = $2';
      params.push(stage);
    }
    
    if (status) {
      queryText += ' AND status = $' + (params.length + 1);
      params.push(status);
    }
    
    queryText += ' ORDER BY created_at DESC';
    
    const result = await query<Shipment>(queryText, params);
    return result.rows;
  }

  /**
   * Check if a shipment can be filed (reaches Ready to File stage)
   */
  async canFileShipment(shipmentId: string): Promise<boolean> {
    const currentStage = await this.getCurrentStage(shipmentId);
    
    // Must be at ready_to_file stage
    if (currentStage !== 'ready_to_file') {
      return false;
    }

    const tx = await beginTransaction();
    
    try {
      // Check all required conditions
      const checks = [
        stageChecks.documents_approved(shipmentId, tx),
        stageChecks.compliance_passed(shipmentId, tx),
        stageChecks.buyer_verified(shipmentId, tx),
        stageChecks.customs_classified(shipmentId, tx)
      ];
      
      const results = await Promise.all(checks);
      await tx.rollback();
      
      return results.every(r => r);
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  /**
   * Mark a shipment as filed (terminal state)
   */
  async markAsFiled(shipmentId: string, userId: string): Promise<boolean> {
    const currentStage = await this.getCurrentStage(shipmentId);
    
    // Can only file from ready_to_file stage
    if (currentStage !== 'ready_to_file') {
      throw new Error('Shipment must be in ready_to_file stage to be filed');
    }

    // Check if can file
    const canFile = await this.canFileShipment(shipmentId);
    if (!canFile) {
      throw new Error('Shipment does not meet all requirements for filing');
    }

    const tx = await beginTransaction();
    
    try {
      // Update shipment stage to filed
      await tx.client.query(
        'UPDATE shipments SET stage = $1, status = $2, updated_at = NOW(), updated_by = $3 WHERE id = $4',
        ['filed', 'completed', userId, shipmentId]
      );

      // Log the filing action
      await tx.client.query(
        `INSERT INTO audit_log 
         (shipment_id, tenant_id, actor_type, actor_ref, action, input_ref, output_ref, metadata)
         SELECT $1, tenant_id, 'human', $2, 'shipment_filed', 
                jsonb_build_object('shipment_id', $1),
                jsonb_build_object('shipment_id', $1, 'stage', 'filed'),
                jsonb_build_object('triggered_by', $2, 'action', 'filed')
         FROM shipments WHERE id = $1`,
        [shipmentId, userId]
      );

      await tx.commit();
      return true;
    } catch (error) {
      await tx.rollback();
      console.error('Error marking shipment as filed:', error);
      throw error;
    }
  }

  /**
   * Get shipment progress summary
   */
  async getShipmentProgress(shipmentId: string): Promise<{
    stage: ShipmentStage;
    completionPercentage: number;
    stagesCompleted: ShipmentStage[];
    currentStage: ShipmentStage;
    nextStage?: ShipmentStage;
    blockingIssues: string[];
  }> {
    const currentStage = await this.getCurrentStage(shipmentId);
    const allStages: ShipmentStage[] = [
      'draft',
      'documents_generated',
      'compliance_screened',
      'buyer_verified',
      'customs_classified',
      'ready_to_file',
      'filed'
    ];

    const currentIndex = allStages.indexOf(currentStage);
    const stagesCompleted = allStages.slice(0, currentIndex + 1);
    const completionPercentage = Math.round(((currentIndex + 1) / allStages.length) * 100);

    const { missingChecks } = await this.canAdvance(shipmentId);
    
    return {
      stage: currentStage,
      completionPercentage,
      stagesCompleted,
      currentStage,
      nextStage: STAGE_TRANSITIONS[currentStage]?.next,
      blockingIssues: missingChecks
    };
  }
}

// Export singleton instance
export const stateMachine = ShipmentStateMachine.getInstance();

export default stateMachine;
