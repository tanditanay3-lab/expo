import { query, beginTransaction, DatabaseTransaction } from '../db/connection';
import { auditLogger } from '../core/auditLogger';
import { approvalSystem } from '../core/approvalSystem';
import { stateMachine } from '../core/stateMachine';
import {
  AgentType,
  AgentStatus,
  AgentOutput,
  Shipment,
  Document,
  ComplianceScreen,
  Classification,
  Buyer
} from '../types';

// Agent configuration interface
interface AgentConfig {
  agentType: AgentType;
  version: string;
  model: string;
  maxRetries: number;
  timeout: number;
  confidenceThreshold: number;
}

// Agent result interface
export interface AgentResult<T = any> {
  success: boolean;
  data?: T;
  discrepancies: any[];
  warnings: string[];
  errors: string[];
  confidence: number;
  timestamp: Date;
  processingTime: number;
}

// Base agent class
export abstract class BaseAgent {
  protected config: AgentConfig;
  protected status: AgentStatus = 'pending';
  protected startTime: number = 0;

  constructor(config: Partial<AgentConfig> = {}) {
    this.config = {
      agentType: this.getAgentType(),
      version: config.version || '1.0.0',
      model: config.model || 'claude-3-sonnet-20240229',
      maxRetries: config.maxRetries || 3,
      timeout: config.timeout || 60000,
      confidenceThreshold: config.confidenceThreshold || 0.7
    };
  }

  // Abstract method to get agent type
  abstract getAgentType(): AgentType;

  // Abstract method to execute the agent
  abstract execute(shipmentId: string, tenantId: string, options?: Record<string, any>): Promise<AgentResult>;

  // Get agent configuration
  getConfig(): AgentConfig {
    return this.config;
  }

  // Get agent status
  getStatus(): AgentStatus {
    return this.status;
  }

  // Set agent status
  protected setStatus(status: AgentStatus): void {
    this.status = status;
  }

  // Start execution timer
  protected startExecution(): void {
    this.startTime = Date.now();
    this.status = 'processing';
  }

  // End execution and return result
  protected endExecution<T>(result: AgentResult<T>): AgentResult<T> {
    const processingTime = Date.now() - this.startTime;
    this.status = result.success ? 'completed' : 'failed';
    return { ...result, processingTime };
  }

  // Log agent action to audit trail
  protected async logAction(
    shipmentId: string,
    tenantId: string,
    action: string,
    input: Record<string, any>,
    output: Record<string, any>,
    confidence: number,
    metadata?: Record<string, any>
  ): Promise<void> {
    await auditLogger.logAgentAction(
      shipmentId,
      tenantId,
      this.config.agentType,
      this.config.version,
      action,
      input,
      output,
      confidence,
      this.config.model,
      undefined,
      metadata
    );
  }

  // Check if agent can execute (shipment stage check)
  protected async canExecute(shipmentId: string): Promise<boolean> {
    try {
      const currentStage = await stateMachine.getCurrentStage(shipmentId);
      const requiredStage = this.getRequiredStage();
      
      // If no required stage, agent can always execute
      if (!requiredStage) return true;
      
      // Check if current stage meets or exceeds required stage
      const allStages: string[] = [
        'draft',
        'documents_generated',
        'compliance_screened',
        'buyer_verified',
        'customs_classified',
        'ready_to_file',
        'filed'
      ];
      
      const currentIndex = allStages.indexOf(currentStage);
      const requiredIndex = allStages.indexOf(requiredStage);
      
      return currentIndex >= requiredIndex;
    } catch (error) {
      console.error('Error checking agent execution permission:', error);
      return false;
    }
  }

  // Get required stage for agent execution (override in subclasses)
  protected getRequiredStage(): string | null {
    return null;
  }

  // Validate input
  protected validateInput(input: Record<string, any>): { valid: boolean; errors: string[] } {
    return { valid: true, errors: [] };
  }

  // Handle errors
  protected handleError(error: Error, context: string): AgentResult {
    console.error(`[${this.config.agentType}] Error in ${context}:`, error);
    return {
      success: false,
      errors: [error.message || 'Unknown error'],
      discrepancies: [],
      warnings: [],
      confidence: 0,
      timestamp: new Date(),
      processingTime: Date.now() - this.startTime
    };
  }

  // Get shipment data
  protected async getShipmentData(shipmentId: string): Promise<Shipment | null> {
    try {
      const result = await query<Shipment>(
        'SELECT * FROM shipments WHERE id = $1',
        [shipmentId]
      );
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error fetching shipment data:', error);
      return null;
    }
  }

  // Get buyer data
  protected async getBuyerData(buyerId: string): Promise<Buyer | null> {
    try {
      const result = await query<Buyer>(
        'SELECT * FROM buyers WHERE id = $1',
        [buyerId]
      );
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error fetching buyer data:', error);
      return null;
    }
  }

  // Update shipment agent status
  protected async updateShipmentAgentStatus(
    shipmentId: string,
    statusField: string,
    status: string
  ): Promise<void> {
    try {
      await query(
        `UPDATE shipments SET ${statusField} = $1, updated_at = NOW() WHERE id = $2`,
        [status, shipmentId]
      );
    } catch (error) {
      console.error('Error updating shipment agent status:', error);
    }
  }

  // Check confidence threshold
  protected checkConfidence(confidence: number): boolean {
    return confidence >= this.config.confidenceThreshold;
  }

  // Generate agent output
  protected generateOutput<T>(
    data: T,
    confidence: number,
    discrepancies: any[] = [],
    warnings: string[] = [],
    errors: string[] = []
  ): AgentResult<T> {
    return {
      success: errors.length === 0,
      data,
      discrepancies,
      warnings,
      errors,
      confidence,
      timestamp: new Date()
    };
  }
}

// Agent factory
export class AgentFactory {
  private static agents: Map<AgentType, BaseAgent> = new Map();

  static registerAgent(agentType: AgentType, agent: BaseAgent): void {
    this.agents.set(agentType, agent);
  }

  static getAgent(agentType: AgentType): BaseAgent | undefined {
    return this.agents.get(agentType);
  }

  static getAllAgents(): Map<AgentType, BaseAgent> {
    return new Map(this.agents);
  }

  static async executeAgent(
    agentType: AgentType,
    shipmentId: string,
    tenantId: string,
    options?: Record<string, any>
  ): Promise<AgentResult> {
    const agent = this.getAgent(agentType);
    if (!agent) {
      throw new Error(`Agent not found: ${agentType}`);
    }

    // Check if agent can execute
    const canExecute = await agent.canExecute(shipmentId);
    if (!canExecute) {
      return {
        success: false,
        errors: [`Agent ${agentType} cannot execute at current shipment stage`],
        discrepancies: [],
        warnings: [],
        confidence: 0,
        timestamp: new Date(),
        processingTime: 0
      };
    }

    // Execute the agent
    return agent.execute(shipmentId, tenantId, options);
  }
}

export default BaseAgent;
