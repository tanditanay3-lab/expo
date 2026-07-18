import { BaseAgent, AgentResult, AgentFactory } from './baseAgent';
import { query, beginTransaction } from '../db/connection';
import { auditLogger } from '../core/auditLogger';
import { stateMachine } from '../core/stateMachine';
import {
  AgentType,
  ComplianceScreen,
  ComplianceListSource,
  ComplianceSeverity,
  ComplianceMatchResult,
  CompliancePartyType,
  ComplianceStatus,
  PolicyAlert,
  PolicySource,
  PolicySeverity,
  Shipment,
  Buyer
} from '../types';

// Sanctions list entry interface
interface SanctionsListEntry {
  id: string;
  list_name: string;
  list_source: ComplianceListSource;
  entry_id: string;
  name: string;
  entity_type: string;
  country: string;
  address?: string;
  remarks?: string;
  listing_date: Date;
  last_updated: Date;
  status: string;
}

// Screening request interface
interface ScreeningRequest {
  partyRef: string;
  partyType: CompliancePartyType;
  partyName?: string;
  partyCountry?: string;
  partyAddress?: string;
  forceRescreen?: boolean;
}

// Policy monitoring options
interface PolicyMonitoringOptions {
  sources?: PolicySource[];
  productCategories?: string[];
  destinationCountries?: string[];
  since?: Date;
}

// Screening result interface
export interface ScreeningResult {
  partyRef: string;
  partyType: CompliancePartyType;
  partyName: string;
  matches: Array<{
    listSource: ComplianceListSource;
    entryId: string;
    entryName: string;
    matchType: ComplianceMatchResult;
    matchScore: number;
    severity: ComplianceSeverity;
    citationRef: string;
    citationText: string;
    recommendedAction: string;
  }>;
  overallSeverity: ComplianceSeverity;
  requiresApproval: boolean;
  screeningId: string;
}

// Known sanctions lists configuration
const SANCTIONS_LISTS: ComplianceListSource[] = [
  'OFAC',
  'UN',
  'EU',
  'India_DGFT',
  'India_Customs',
  'India_RBI'
];

// Severity mapping for different list sources
const SEVERITY_MAPPING: Record<ComplianceListSource, ComplianceSeverity> = {
  OFAC: 'critical',
  UN: 'critical',
  EU: 'high',
  India_DGFT: 'high',
  India_Customs: 'high',
  India_RBI: 'high',
  other: 'medium'
};

// Policy source URLs (would be configured in production)
const POLICY_SOURCE_URLS: Record<PolicySource, string> = {
  DGFT: 'https://dgft.gov.in',
  RBI: 'https://rbi.org.in',
  Customs: 'https://www.cbic.gov.in',
  FEMA: 'https://rbi.org.in',
  other: ''
};

export class ComplianceAgent extends BaseAgent {
  private sanctionsCache: Map<string, SanctionsListEntry[]>;
  private policyCache: Map<string, PolicyAlert[]>;

  constructor() {
    super({
      agentType: 'compliance',
      version: '1.0.0',
      model: 'claude-3-sonnet-20240229',
      confidenceThreshold: 0.9
    });

    this.sanctionsCache = new Map();
    this.policyCache = new Map();
  }

  getAgentType(): AgentType {
    return 'compliance';
  }

  protected getRequiredStage(): string | null {
    return 'documents_generated';
  }

  async execute(
    shipmentId: string,
    tenantId: string,
    options: {
      screeningRequests?: ScreeningRequest[];
      policyMonitoring?: PolicyMonitoringOptions;
    } = {}
  ): Promise<AgentResult> {
    this.startExecution();

    try {
      // Get shipment data
      const shipment = await this.getShipmentData(shipmentId);
      if (!shipment) {
        return this.handleError(new Error('Shipment not found'), 'execute');
      }

      // Check if compliance screening already completed
      const existingScreens = await query<ComplianceScreen>(
        'SELECT * FROM compliance_screens WHERE shipment_id = $1',
        [shipmentId]
      );

      if (existingScreens.rows.length > 0 && !options.screeningRequests?.some(r => r.forceRescreen)) {
        return this.generateOutput({
          message: 'Compliance screening already completed',
          screeningCount: existingScreens.rows.length,
          screens: existingScreens.rows
        }, 1.0);
      }

      // Prepare screening requests from shipment data
      const screeningRequests: ScreeningRequest[] = options.screeningRequests || [];

      // Add buyer screening if not already included
      if (shipment.buyer_id && !screeningRequests.some(r => r.partyRef === shipment.buyer_id)) {
        const buyer = await this.getBuyerData(shipment.buyer_id);
        if (buyer) {
          screeningRequests.push({
            partyRef: shipment.buyer_id,
            partyType: 'buyer',
            partyName: buyer.name,
            partyCountry: buyer.country,
            partyAddress: buyer.address
          });
        }
      }

      // Add consignee screening if different from buyer
      if (shipment.consignee_id && shipment.consignee_id !== shipment.buyer_id) {
        const consignee = await this.getBuyerData(shipment.consignee_id);
        if (consignee && !screeningRequests.some(r => r.partyRef === shipment.consignee_id)) {
          screeningRequests.push({
            partyRef: shipment.consignee_id,
            partyType: 'consignee',
            partyName: consignee.name,
            partyCountry: consignee.country,
            partyAddress: consignee.address
          });
        }
      }

      // Perform screening
      const screeningResults: ScreeningResult[] = [];
      const allMatches: ComplianceScreen[] = [];
      let overallSeverity: ComplianceSeverity = 'low';

      for (const request of screeningRequests) {
        const result = await this.screenParty(shipmentId, tenantId, request);
        screeningResults.push(result);
        
        // Update overall severity
        if (result.overallSeverity === 'critical') {
          overallSeverity = 'critical';
        } else if (result.overallSeverity === 'high' && overallSeverity !== 'critical') {
          overallSeverity = 'high';
        } else if (result.overallSeverity === 'medium' && overallSeverity !== 'critical' && overallSeverity !== 'high') {
          overallSeverity = 'medium';
        }

        // Collect all matches
        for (const match of result.matches) {
          const screenRecord = await this.createComplianceScreenRecord(
            shipmentId,
            tenantId,
            request,
            match,
            result.screeningId
          );
          allMatches.push(screenRecord);
        }
      }

      // Check for policy alerts
      const policyAlerts = await this.checkPolicyAlerts(
        shipmentId,
        tenantId,
        options.policyMonitoring || {}
      );

      // Update shipment compliance status
      const status = overallSeverity === 'low' ? 'completed' : 'flagged';
      await this.updateShipmentAgentStatus(
        shipmentId,
        'compliance_screening_status',
        status
      );

      // Log the compliance screening
      await this.logAction(
        shipmentId,
        tenantId,
        'compliance_screening_completed',
        { shipmentId, screeningRequests, options },
        {
          screeningResults,
          overallSeverity,
          matchCount: allMatches.length,
          policyAlerts: policyAlerts.length
        },
        overallSeverity === 'low' ? 1.0 : 0.5
      );

      // Check if we can auto-advance the stage
      const canAdvance = await stateMachine.canAdvance(shipmentId);
      if (canAdvance.canAdvance && overallSeverity === 'low') {
        await stateMachine.advanceStage(shipmentId, 'system');
      }

      return this.endExecution(this.generateOutput(
        {
          message: 'Compliance screening completed',
          screeningResults,
          complianceScreens: allMatches,
          policyAlerts,
          overallSeverity,
          requiresApproval: overallSeverity !== 'low'
        },
        overallSeverity === 'low' ? 1.0 : 0.5,
        allMatches.map(m => ({
          type: 'compliance_flag',
          severity: m.severity,
          message: m.flag_description
        })),
        policyAlerts.length > 0 ? ['New policy alerts detected'] : []
      ));

    } catch (error) {
      return this.handleError(error as Error, 'execute');
    }
  }

  /**
   * Screen a single party against sanctions lists
   */
  private async screenParty(
    shipmentId: string,
    tenantId: string,
    request: ScreeningRequest
  ): Promise<ScreeningResult> {
    try {
      const matches: ScreeningResult['matches'] = [];
      let overallSeverity: ComplianceSeverity = 'low';

      // Get sanctions lists (in production, this would use cached or real-time data)
      const sanctionsLists = await this.getSanctionsLists();

      // Screen against each list
      for (const listSource of SANCTIONS_LISTS) {
        const listEntries = sanctionsLists.get(listSource) || [];
        
        for (const entry of listEntries) {
          // Perform fuzzy matching
          const matchScore = this.calculateMatchScore(
            request.partyName || '',
            entry.name,
            request.partyAddress,
            entry.address
          );

          // Threshold for match
          if (matchScore >= 0.8) {
            const matchType: ComplianceMatchResult = matchScore >= 0.95 ? 'exact_match' : 'fuzzy_match';
            const severity = SEVERITY_MAPPING[listSource] || 'medium';

            // Update overall severity
            if (severity === 'critical') {
              overallSeverity = 'critical';
            } else if (severity === 'high' && overallSeverity !== 'critical') {
              overallSeverity = 'high';
            } else if (severity === 'medium' && overallSeverity !== 'critical' && overallSeverity !== 'high') {
              overallSeverity = 'medium';
            }

            matches.push({
              listSource,
              entryId: entry.entry_id,
              entryName: entry.name,
              matchType,
              matchScore,
              severity,
              citationRef: `${listSource}-${entry.entry_id}`,
              citationText: `Matched against ${listSource} entry: ${entry.name}`,
              recommendedAction: this.getRecommendedAction(severity, listSource)
            });
          }
        }
      }

      // Create screening record
      const screeningId = await this.createScreeningRecord(
        shipmentId,
        tenantId,
        request,
        matches,
        overallSeverity
      );

      return {
        partyRef: request.partyRef,
        partyType: request.partyType,
        partyName: request.partyName || 'Unknown',
        matches,
        overallSeverity,
        requiresApproval: overallSeverity !== 'low',
        screeningId
      };

    } catch (error) {
      console.error('Error screening party:', error);
      return {
        partyRef: request.partyRef,
        partyType: request.partyType,
        partyName: request.partyName || 'Unknown',
        matches: [],
        overallSeverity: 'low',
        requiresApproval: false,
        screeningId: ''
      };
    }
  }

  /**
   * Get sanctions lists (in production, this would fetch from database or API)
   */
  private async getSanctionsLists(): Promise<Map<ComplianceListSource, SanctionsListEntry[]>> {
    // Check cache
    if (this.sanctionsCache.size > 0) {
      return this.sanctionsCache;
    }

    // Fetch from database
    try {
      const result = await query<SanctionsListEntry>(
        'SELECT * FROM sanctions_lists WHERE status = $1',
        ['active']
      );

      const lists = new Map<ComplianceListSource, SanctionsListEntry[]>();
      
      for (const entry of result.rows) {
        if (!lists.has(entry.list_source as ComplianceListSource)) {
          lists.set(entry.list_source as ComplianceListSource, []);
        }
        lists.get(entry.list_source as ComplianceListSource)?.push(entry);
      }

      this.sanctionsCache = lists;
      return lists;

    } catch (error) {
      console.error('Error fetching sanctions lists:', error);
      // Return empty lists
      return new Map();
    }
  }

  /**
   * Calculate match score between party and sanctions entry
   */
  private calculateMatchScore(
    partyName: string,
    entryName: string,
    partyAddress?: string,
    entryAddress?: string
  ): number {
    // Simple name matching (in production, use fuzzy matching library)
    const nameSimilarity = this.calculateStringSimilarity(partyName, entryName);
    
    // Address matching if available
    let addressSimilarity = 0;
    if (partyAddress && entryAddress) {
      addressSimilarity = this.calculateStringSimilarity(partyAddress, entryAddress) * 0.3;
    }

    // Combined score
    const score = nameSimilarity * 0.7 + addressSimilarity;
    
    return Math.min(score, 1.0);
  }

  /**
   * Calculate string similarity (simple implementation)
   */
  private calculateStringSimilarity(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;

    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();

    if (s1 === s2) return 1.0;

    // Count matching characters
    const chars1 = new Set(s1.split(''));
    const chars2 = new Set(s2.split(''));
    
    let matchingChars = 0;
    for (const char of chars1) {
      if (chars2.has(char)) {
        matchingChars++;
      }
    }

    const maxLength = Math.max(s1.length, s2.length);
    if (maxLength === 0) return 0;

    return matchingChars / maxLength;
  }

  /**
   * Get recommended action based on severity and list source
   */
  private getRecommendedAction(severity: ComplianceSeverity, listSource: ComplianceListSource): string {
    switch (severity) {
      case 'critical':
        return `IMMEDIATE ACTION REQUIRED: Party matched against ${listSource}. Do not proceed with shipment. Contact compliance officer immediately.`;
      
      case 'high':
        return `HIGH RISK: Party matched against ${listSource}. Requires senior management approval before proceeding.`;
      
      case 'medium':
        return `MODERATE RISK: Party matched against ${listSource}. Review carefully and document justification for proceeding.`;
      
      default:
        return `LOW RISK: Party matched against ${listSource}. No action required, but monitor for changes.`;
    }
  }

  /**
   * Create compliance screen record in database
   */
  private async createComplianceScreenRecord(
    shipmentId: string,
    tenantId: string,
    request: ScreeningRequest,
    match: ScreeningResult['matches'][0],
    screeningId: string
  ): Promise<ComplianceScreen> {
    try {
      const result = await query<ComplianceScreen>(
        `INSERT INTO compliance_screens (
          shipment_id, tenant_id, party_ref, party_type, 
          list_source, match_result, match_score, severity, 
          citation_ref, citation_text, flag_description, 
          recommended_action, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending')
        RETURNING *`,
        [
          shipmentId,
          tenantId,
          request.partyRef,
          request.partyType,
          match.listSource,
          match.matchType,
          match.matchScore,
          match.severity,
          match.citationRef,
          match.citationText,
          `Matched against ${match.listSource}: ${match.entryName}`,
          match.recommendedAction
        ]
      );

      return result.rows[0];

    } catch (error) {
      console.error('Error creating compliance screen record:', error);
      throw error;
    }
  }

  /**
   * Create screening record
   */
  private async createScreeningRecord(
    shipmentId: string,
    tenantId: string,
    request: ScreeningRequest,
    matches: ScreeningResult['matches'],
    overallSeverity: ComplianceSeverity
  ): Promise<string> {
    try {
      // In a real implementation, we might create a separate screening record
      // For now, we'll just return a generated ID
      const screeningId = `screen_${shipmentId}_${request.partyRef}_${Date.now()}`;
      return screeningId;

    } catch (error) {
      console.error('Error creating screening record:', error);
      return `screen_${shipmentId}_${request.partyRef}_error`;
    }
  }

  /**
   * Check for relevant policy alerts
   */
  private async checkPolicyAlerts(
    shipmentId: string,
    tenantId: string,
    options: PolicyMonitoringOptions
  ): Promise<PolicyAlert[]> {
    try {
      // Get shipment data for context
      const shipment = await this.getShipmentData(shipmentId);
      if (!shipment) return [];

      // Get buyer data
      let buyerCountry: string | undefined;
      if (shipment.buyer_id) {
        const buyer = await this.getBuyerData(shipment.buyer_id);
        if (buyer) {
          buyerCountry = buyer.country;
        }
      }

      // Determine product categories and destination countries
      const productCategories = options.productCategories || 
        (shipment.product_category ? [shipment.product_category] : []);
      const destinationCountries = options.destinationCountries || 
        (buyerCountry ? [buyerCountry] : []);

      // Get policy alerts from database
      let queryText = 'SELECT * FROM policy_alerts WHERE tenant_id = $1 AND status = $2';
      const params: any[] = [tenantId, 'active'];
      let paramIndex = 3;

      // Filter by source if specified
      if (options.sources && options.sources.length > 0) {
        queryText += ` AND source = ANY($${paramIndex++})`;
        params.push(options.sources);
      }

      // Filter by relevance tags (product categories)
      if (productCategories.length > 0) {
        queryText += ` AND relevance_tags && $${paramIndex++}`;
        params.push(productCategories);
      }

      // Filter by affected countries
      if (destinationCountries.length > 0) {
        queryText += ` AND affected_countries && $${paramIndex++}`;
        params.push(destinationCountries);
      }

      // Filter by date
      if (options.since) {
        queryText += ` AND published_at >= $${paramIndex++}`;
        params.push(options.since);
      }

      queryText += ' ORDER BY published_at DESC';

      const result = await query<PolicyAlert>(queryText, params);
      
      return result.rows;

    } catch (error) {
      console.error('Error checking policy alerts:', error);
      return [];
    }
  }

  /**
   * Monitor policies for updates (scheduled job)
   */
  async monitorPolicies(options: PolicyMonitoringOptions = {}): Promise<AgentResult> {
    this.startExecution();

    try {
      // Get all tenants
      const tenants = await query<{ id: string; tier: string }>(
        'SELECT id, tier FROM tenants WHERE subscription_status = $1',
        ['active']
      );

      const newAlerts: PolicyAlert[] = [];
      const updatedAlerts: PolicyAlert[] = [];

      // In a real implementation, this would:
      // 1. Fetch latest policies from DGFT, RBI, Customs websites
      // 2. Compare with existing policies
      // 3. Create new alerts for changes
      // 4. Update existing alerts if modified

      // For now, we'll simulate finding some updates
      const mockAlerts = [
        {
          source: 'DGFT' as PolicySource,
          alert_type: 'policy_update',
          title: 'Updated Export Policy for Textiles',
          description: 'DGFT has updated the export policy for textile products to certain countries.',
          relevance_tags: ['textiles', 'apparel', 'export'],
          published_at: new Date(),
          effective_from: new Date(),
          severity: 'high' as PolicySeverity,
          citation_url: 'https://dgft.gov.in/policy-updates',
          affected_products: ['textiles', 'apparel', 'garments'],
          affected_countries: ['USA', 'EU', 'UK'],
          action_required: 'Review export procedures for textile shipments'
        },
        {
          source: 'RBI' as PolicySource,
          alert_type: 'regulatory_change',
          title: 'New FEMA Regulations',
          description: 'RBI has announced new FEMA regulations affecting export payments.',
          relevance_tags: ['payment', 'FEMA', 'export'],
          published_at: new Date(),
          effective_from: new Date(),
          severity: 'medium' as PolicySeverity,
          citation_url: 'https://rbi.org.in/fema-updates',
          affected_products: [],
          affected_countries: [],
          action_required: 'Review payment terms for new shipments'
        }
      ];

      // Create alerts for each tenant
      for (const tenant of tenants.rows) {
        for (const alert of mockAlerts) {
          const result = await query<PolicyAlert>(
            `INSERT INTO policy_alerts (
              tenant_id, source, alert_type, title, description, 
              relevance_tags, published_at, effective_from, status, 
              severity, citation_url, affected_products, affected_countries, action_required
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            ON CONFLICT (tenant_id, source, alert_type, title) DO NOTHING
            RETURNING *`,
            [
              tenant.id,
              alert.source,
              alert.alert_type,
              alert.title,
              alert.description,
              alert.relevance_tags,
              alert.published_at,
              alert.effective_from,
              alert.status || 'active',
              alert.severity,
              alert.citation_url,
              alert.affected_products,
              alert.affected_countries,
              alert.action_required
            ]
          );

          if (result.rows.length > 0) {
            newAlerts.push(result.rows[0]);
          }
        }
      }

      // Log the policy monitoring
      await this.logAction(
        '', // No specific shipment
        '', // No specific tenant
        'policy_monitoring_completed',
        { options },
        {
          newAlerts: newAlerts.length,
          updatedAlerts: updatedAlerts.length,
          tenantsProcessed: tenants.rows.length
        },
        1.0
      );

      return this.endExecution(this.generateOutput(
        {
          message: 'Policy monitoring completed',
          newAlerts,
          updatedAlerts,
          tenantsProcessed: tenants.rows.length
        },
        1.0
      ));

    } catch (error) {
      return this.handleError(error as Error, 'monitorPolicies');
    }
  }

  /**
   * Rescreen a specific party
   */
  async rescreenParty(
    shipmentId: string,
    tenantId: string,
    request: ScreeningRequest
  ): Promise<AgentResult<ScreeningResult>> {
    try {
      // Delete existing screens for this party
      await query(
        'DELETE FROM compliance_screens WHERE shipment_id = $1 AND party_ref = $2',
        [shipmentId, request.partyRef]
      );

      // Perform new screening
      const result = await this.screenParty(shipmentId, tenantId, request);

      // Log the rescreening
      await this.logAction(
        shipmentId,
        tenantId,
        'party_rescreened',
        { request },
        { result },
        0.9
      );

      return this.generateOutput(result, 0.9);

    } catch (error) {
      return this.handleError(error as Error, 'rescreenParty');
    }
  }

  /**
   * Acknowledge a compliance flag
   */
  async acknowledgeFlag(
    screenId: string,
    userId: string,
    tenantId: string,
    resolutionNotes?: string
  ): Promise<AgentResult> {
    try {
      // Update the compliance screen status
      await query(
        `UPDATE compliance_screens 
         SET status = $1, resolved_by = $2, resolved_at = NOW(), resolution_notes = $3
         WHERE id = $4 AND tenant_id = $5`,
        ['resolved', userId, resolutionNotes, screenId, tenantId]
      );

      // Log the acknowledgment
      await this.logAction(
        '', // Will be updated from the screen record
        tenantId,
        'compliance_flag_acknowledged',
        { screenId, userId },
        { resolved: true, resolutionNotes },
        1.0
      );

      // Check if all flags are resolved
      const unresolvedFlags = await query<{ count: string }>(
        `SELECT COUNT(*) as count 
         FROM compliance_screens 
         WHERE shipment_id = (SELECT shipment_id FROM compliance_screens WHERE id = $1) 
           AND status != 'resolved'`,
        [screenId]
      );

      const allResolved = parseInt(unresolvedFlags.rows[0].count) === 0;

      return this.generateOutput({
        message: 'Compliance flag acknowledged',
        screenId,
        allFlagsResolved: allResolved
      }, 1.0);

    } catch (error) {
      return this.handleError(error as Error, 'acknowledgeFlag');
    }
  }

  /**
   * Get compliance screening status for a shipment
   */
  async getStatus(shipmentId: string): Promise<{
    status: string;
    overallSeverity: ComplianceSeverity;
    flagCount: number;
    criticalFlags: number;
    highFlags: number;
    mediumFlags: number;
    lowFlags: number;
    requiresApproval: boolean;
  }> {
    try {
      const screens = await query<ComplianceScreen>(
        'SELECT * FROM compliance_screens WHERE shipment_id = $1',
        [shipmentId]
      );

      const flagCount = screens.rows.length;
      const criticalFlags = screens.rows.filter(s => s.severity === 'critical').length;
      const highFlags = screens.rows.filter(s => s.severity === 'high').length;
      const mediumFlags = screens.rows.filter(s => s.severity === 'medium').length;
      const lowFlags = screens.rows.filter(s => s.severity === 'low').length;

      let overallSeverity: ComplianceSeverity = 'low';
      if (criticalFlags > 0) {
        overallSeverity = 'critical';
      } else if (highFlags > 0) {
        overallSeverity = 'high';
      } else if (mediumFlags > 0) {
        overallSeverity = 'medium';
      }

      const unresolvedFlags = screens.rows.filter(s => s.status !== 'resolved').length;

      return {
        status: unresolvedFlags === 0 ? 'completed' : 'flagged',
        overallSeverity,
        flagCount,
        criticalFlags,
        highFlags,
        mediumFlags,
        lowFlags,
        requiresApproval: overallSeverity !== 'low' || unresolvedFlags > 0
      };

    } catch (error) {
      console.error('Error getting compliance status:', error);
      return {
        status: 'error',
        overallSeverity: 'low',
        flagCount: 0,
        criticalFlags: 0,
        highFlags: 0,
        mediumFlags: 0,
        lowFlags: 0,
        requiresApproval: false
      };
    }
  }

  /**
   * Get policy alerts for a tenant
   */
  async getPolicyAlerts(
    tenantId: string,
    options: {
      source?: PolicySource;
      severity?: PolicySeverity;
      status?: string;
      page?: number;
      pageSize?: number;
    } = {}
  ): Promise<{ alerts: PolicyAlert[]; total: number }> {
    try {
      const { source, severity, status, page = 1, pageSize = 50 } = options;

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
      params.push(pageSize, (page - 1) * pageSize);

      const result = await query<PolicyAlert>(queryText, params);

      return {
        alerts: result.rows,
        total
      };

    } catch (error) {
      console.error('Error getting policy alerts:', error);
      return { alerts: [], total: 0 };
    }
  }
}

// Register the agent with the factory
AgentFactory.registerAgent('compliance', new ComplianceAgent());

export default ComplianceAgent;
