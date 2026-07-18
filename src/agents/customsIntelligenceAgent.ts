import { BaseAgent, AgentResult, AgentFactory } from './baseAgent';
import { query, beginTransaction } from '../db/connection';
import { auditLogger } from '../core/auditLogger';
import { stateMachine } from '../core/stateMachine';
import {
  AgentType,
  Classification,
  ClassificationMethod,
  ClassificationStatus,
  Shipment,
  Buyer
} from '../types';

// HS Code database entry
interface HSCodeEntry {
  hs_code: string;
  description: string;
  chapter: string;
  heading: string;
  subheading: string;
  duty_rate: number;
  cess_rate: number;
  total_duty_rate: number;
  unit: string;
  category: string;
  country_specific_rates: Record<string, {
    duty_rate: number;
    cess_rate: number;
    total_duty_rate: number;
    effective_date: Date;
  }>;
  restrictions: string[];
  required_documents: string[];
  notes: string;
}

// Classification request
interface ClassificationRequest {
  productDescription: string;
  productCategory?: string;
  destinationPort?: string;
  destinationCountry?: string;
  forceReclassify?: boolean;
  manualOverride?: string;
}

// Port congestion data
interface PortCongestionData {
  port_code: string;
  port_name: string;
  country: string;
  congestion_level: 'low' | 'medium' | 'high' | 'critical';
  average_clearance_time_days: number;
  current_wait_time_days: number;
  last_updated: Date;
}

// Historical clearance data
interface HistoricalClearanceData {
  port_code: string;
  hs_code: string;
  average_clearance_time_days: number;
  min_clearance_time_days: number;
  max_clearance_time_days: number;
  sample_size: number;
  last_updated: Date;
}

// Duty calculation result
interface DutyCalculationResult {
  hs_code: string;
  duty_rate: number;
  cess_rate: number;
  total_duty_rate: number;
  duty_amount: number;
  cess_amount: number;
  total_duty_amount: number;
  landed_cost: number;
  currency: string;
  calculation_basis: string;
}

// HS Code database (simplified for demonstration)
const HS_CODE_DATABASE: HSCodeEntry[] = [
  {
    hs_code: '61091000',
    description: 'T-shirts, singlets and other vests, knitted or crocheted, of cotton',
    chapter: '61',
    heading: '6109',
    subheading: '610910',
    duty_rate: 10.0,
    cess_rate: 0.0,
    total_duty_rate: 10.0,
    unit: 'PCS',
    category: 'Textiles',
    country_specific_rates: {
      'USA': { duty_rate: 8.0, cess_rate: 0.0, total_duty_rate: 8.0, effective_date: new Date('2024-01-01') },
      'EU': { duty_rate: 12.0, cess_rate: 0.0, total_duty_rate: 12.0, effective_date: new Date('2024-01-01') }
    },
    restrictions: ['Import license required for quantities above 1000 units'],
    required_documents: ['Commercial Invoice', 'Packing List', 'Certificate of Origin'],
    notes: 'Subject to anti-dumping duty in some countries'
  },
  {
    hs_code: '62034200',
    description: 'Men\'s or boys\' suits, of synthetic fibres',
    chapter: '62',
    heading: '6203',
    subheading: '620342',
    duty_rate: 15.0,
    cess_rate: 2.0,
    total_duty_rate: 17.0,
    unit: 'PCS',
    category: 'Textiles',
    country_specific_rates: {},
    restrictions: [],
    required_documents: ['Commercial Invoice', 'Packing List'],
    notes: ''
  },
  {
    hs_code: '85171200',
    description: 'Telephones for cellular networks or for other wireless networks',
    chapter: '85',
    heading: '8517',
    subheading: '851712',
    duty_rate: 20.0,
    cess_rate: 1.0,
    total_duty_rate: 21.0,
    unit: 'PCS',
    category: 'Electronics',
    country_specific_rates: {},
    restrictions: ['Import license required', 'BIS certification required'],
    required_documents: ['Commercial Invoice', 'Packing List', 'BIS Certificate'],
    notes: 'Subject to mandatory BIS certification'
  },
  {
    hs_code: '22030000',
    description: 'Beer made from malt',
    chapter: '22',
    heading: '2203',
    subheading: '220300',
    duty_rate: 150.0,
    cess_rate: 0.0,
    total_duty_rate: 150.0,
    unit: 'LTR',
    category: 'Beverages',
    country_specific_rates: {},
    restrictions: ['Import permit required', 'Age restriction applies'],
    required_documents: ['Commercial Invoice', 'Import Permit', 'Health Certificate'],
    notes: 'Subject to additional state taxes'
  },
  {
    hs_code: '08030010',
    description: 'Bananas, fresh or dried',
    chapter: '08',
    heading: '0803',
    subheading: '080300',
    duty_rate: 30.0,
    cess_rate: 0.0,
    total_duty_rate: 30.0,
    unit: 'KG',
    category: 'Agricultural',
    country_specific_rates: {},
    restrictions: ['Phytosanitary certificate required'],
    required_documents: ['Commercial Invoice', 'Packing List', 'Phytosanitary Certificate'],
    notes: 'Subject to quality inspection'
  }
];

// Port congestion data (mock)
const PORT_CONGESTION_DATA: PortCongestionData[] = [
  {
    port_code: 'INNHA',
    port_name: 'Nhava Sheva (JNPT)',
    country: 'India',
    congestion_level: 'medium',
    average_clearance_time_days: 3,
    current_wait_time_days: 2,
    last_updated: new Date()
  },
  {
    port_code: 'INMAA',
    port_name: 'Chennai',
    country: 'India',
    congestion_level: 'low',
    average_clearance_time_days: 2,
    current_wait_time_days: 1,
    last_updated: new Date()
  },
  {
    port_code: 'INCCU',
    port_name: 'Cochin',
    country: 'India',
    congestion_level: 'high',
    average_clearance_time_days: 5,
    current_wait_time_days: 4,
    last_updated: new Date()
  },
  {
    port_code: 'USNYC',
    port_name: 'New York',
    country: 'USA',
    congestion_level: 'medium',
    average_clearance_time_days: 4,
    current_wait_time_days: 3,
    last_updated: new Date()
  },
  {
    port_code: 'NLRTM',
    port_name: 'Rotterdam',
    country: 'Netherlands',
    congestion_level: 'low',
    average_clearance_time_days: 2,
    current_wait_time_days: 1,
    last_updated: new Date()
  }
];

// Historical clearance data (mock)
const HISTORICAL_CLEARANCE_DATA: HistoricalClearanceData[] = [
  {
    port_code: 'INNHA',
    hs_code: '61091000',
    average_clearance_time_days: 2.5,
    min_clearance_time_days: 1,
    max_clearance_time_days: 5,
    sample_size: 100,
    last_updated: new Date()
  },
  {
    port_code: 'INNHA',
    hs_code: '85171200',
    average_clearance_time_days: 3.5,
    min_clearance_time_days: 2,
    max_clearance_time_days: 7,
    sample_size: 50,
    last_updated: new Date()
  },
  {
    port_code: 'INMAA',
    hs_code: '61091000',
    average_clearance_time_days: 1.8,
    min_clearance_time_days: 1,
    max_clearance_time_days: 3,
    sample_size: 80,
    last_updated: new Date()
  }
];

export class CustomsIntelligenceAgent extends BaseAgent {
  private hsCodeDatabase: Map<string, HSCodeEntry>;
  private portCongestionData: Map<string, PortCongestionData>;
  private historicalClearanceData: Map<string, HistoricalClearanceData[]>;

  constructor() {
    super({
      agentType: 'customs_intelligence',
      version: '1.0.0',
      model: 'claude-3-sonnet-20240229',
      confidenceThreshold: 0.8
    });

    // Initialize databases
    this.hsCodeDatabase = new Map();
    this.portCongestionData = new Map();
    this.historicalClearanceData = new Map();
    
    this.loadDatabases();
  }

  getAgentType(): AgentType {
    return 'customs_intelligence';
  }

  protected getRequiredStage(): string | null {
    return 'buyer_verified';
  }

  private loadDatabases(): void {
    // Load HS Code database
    for (const entry of HS_CODE_DATABASE) {
      this.hsCodeDatabase.set(entry.hs_code, entry);
    }

    // Load port congestion data
    for (const port of PORT_CONGESTION_DATA) {
      this.portCongestionData.set(port.port_code, port);
    }

    // Load historical clearance data
    for (const entry of HISTORICAL_CLEARANCE_DATA) {
      const key = `${entry.port_code}_${entry.hs_code}`;
      if (!this.historicalClearanceData.has(key)) {
        this.historicalClearanceData.set(key, []);
      }
      this.historicalClearanceData.get(key)?.push(entry);
    }
  }

  async execute(
    shipmentId: string,
    tenantId: string,
    options: {
      classificationRequests?: ClassificationRequest[];
      calculateDuty?: boolean;
      predictClearanceTime?: boolean;
    } = {}
  ): Promise<AgentResult> {
    this.startExecution();

    try {
      // Get shipment data
      const shipment = await this.getShipmentData(shipmentId);
      if (!shipment) {
        return this.handleError(new Error('Shipment not found'), 'execute');
      }

      // Check if classification already exists
      const existingClassifications = await query<Classification>(
        'SELECT * FROM classifications WHERE shipment_id = $1 ORDER BY created_at DESC',
        [shipmentId]
      );

      if (existingClassifications.rows.length > 0 && !options.classificationRequests?.some(r => r.forceReclassify)) {
        return this.generateOutput({
          message: 'Customs classification already completed',
          classifications: existingClassifications.rows
        }, 1.0);
      }

      // Prepare classification request
      const classificationRequest: ClassificationRequest = {
        productDescription: shipment.product_description || '',
        productCategory: shipment.product_category,
        destinationPort: shipment.destination_port,
        destinationCountry: undefined, // Would get from buyer data
        forceReclassify: false
      };

      // Get destination country from buyer
      if (shipment.buyer_id) {
        const buyer = await this.getBuyerData(shipment.buyer_id);
        if (buyer) {
          classificationRequest.destinationCountry = buyer.country;
        }
      }

      // Classify the product
      const classification = await this.classifyProduct(
        shipmentId,
        tenantId,
        classificationRequest
      );

      // Calculate duty and landed cost
      const dutyCalculation = await this.calculateDuty(
        shipmentId,
        tenantId,
        classification.hs_code,
        shipment.total_value,
        shipment.currency,
        classificationRequest.destinationCountry
      );

      // Predict clearance time
      const clearancePrediction = await this.predictClearanceTime(
        shipmentId,
        tenantId,
        classification.hs_code,
        shipment.destination_port,
        shipment.origin_port
      );

      // Create classification record
      const classificationRecord = await this.createClassificationRecord(
        shipmentId,
        tenantId,
        classification,
        dutyCalculation,
        clearancePrediction
      );

      // Update shipment customs classification status
      const status = classification.confidence >= this.config.confidenceThreshold ? 'completed' : 'flagged';
      await this.updateShipmentAgentStatus(
        shipmentId,
        'customs_classification_status',
        status
      );

      // Log the customs classification
      await this.logAction(
        shipmentId,
        tenantId,
        'customs_classification_completed',
        { shipmentId, classificationRequest, options },
        {
          classification,
          dutyCalculation,
          clearancePrediction,
          confidence: classification.confidence
        },
        classification.confidence
      );

      // Check if we can auto-advance the stage
      const canAdvance = await stateMachine.canAdvance(shipmentId);
      if (canAdvance.canAdvance && classification.confidence >= this.config.confidenceThreshold) {
        await stateMachine.advanceStage(shipmentId, 'system');
      }

      return this.endExecution(this.generateOutput(
        {
          message: 'Customs classification completed',
          classification,
          dutyCalculation,
          clearancePrediction,
          classificationRecord
        },
        classification.confidence,
        classification.ambiguity ? [{ type: 'hs_code_ambiguity', message: 'HS code classification has low confidence' }] : [],
        clearancePrediction.portCongestion ? ['Port congestion detected'] : []
      ));

    } catch (error) {
      return this.handleError(error as Error, 'execute');
    }
  }

  /**
   * Classify a product using HS code database
   */
  private async classifyProduct(
    shipmentId: string,
    tenantId: string,
    request: ClassificationRequest
  ): Promise<{
    hs_code: string;
    hs_code_description: string;
    confidence: number;
    ambiguity: boolean;
    classification_method: ClassificationMethod;
    alternative_codes: string[];
    notes: string;
  }> {
    try {
      // In a real implementation, this would:
      // 1. Use a rules-based classifier for initial classification
      // 2. Use ML model for secondary classification
      // 3. Use LLM for disambiguation of borderline cases
      // 4. Return the most confident classification

      // For now, we'll use a simple keyword-based classifier
      const productDescription = request.productDescription.toLowerCase();
      const productCategory = request.productCategory?.toLowerCase() || '';

      // Try to find exact match first
      for (const [hsCode, entry] of this.hsCodeDatabase) {
        const description = entry.description.toLowerCase();
        
        // Check for exact match
        if (productDescription.includes(description) || description.includes(productDescription)) {
          return {
            hs_code: hsCode,
            hs_code_description: entry.description,
            confidence: 0.95,
            ambiguity: false,
            classification_method: 'rules_based',
            alternative_codes: [],
            notes: `Exact match found: ${entry.description}`
          };
        }
      }

      // Try keyword matching
      const keywordMatches: Array<{ hsCode: string; entry: HSCodeEntry; score: number }> = [];

      for (const [hsCode, entry] of this.hsCodeDatabase) {
        const description = entry.description.toLowerCase();
        const category = entry.category.toLowerCase();
        
        let score = 0;

        // Check for keyword matches in description
        const keywords = [
          't-shirt', 'shirt', 'garment', 'clothing', 'apparel',
          'phone', 'mobile', 'cellular', 'telephone',
          'banana', 'fruit', 'agricultural',
          'beer', 'alcohol', 'beverage'
        ];

        for (const keyword of keywords) {
          if (productDescription.includes(keyword) && description.includes(keyword)) {
            score += 20;
          }
        }

        // Check category match
        if (productCategory && category.includes(productCategory)) {
          score += 30;
        }

        // Check if product description contains category
        if (productCategory && productDescription.includes(productCategory)) {
          score += 15;
        }

        if (score > 0) {
          keywordMatches.push({ hsCode, entry, score });
        }
      }

      // Sort by score
      keywordMatches.sort((a, b) => b.score - a.score);

      if (keywordMatches.length > 0) {
        const bestMatch = keywordMatches[0];
        const secondBest = keywordMatches.length > 1 ? keywordMatches[1] : null;

        // Check for ambiguity
        const ambiguity = secondBest && (bestMatch.score - secondBest.score) < 10;

        return {
          hs_code: bestMatch.hsCode,
          hs_code_description: bestMatch.entry.description,
          confidence: ambiguity ? 0.6 : 0.85,
          ambiguity,
          classification_method: 'rules_based',
          alternative_codes: secondBest ? [secondBest.hsCode] : [],
          notes: ambiguity 
            ? `Ambiguous classification. Consider: ${secondBest?.hsCode} (${secondBest?.entry.description})`
            : `Keyword match: ${bestMatch.entry.description}`
        };
      }

      // No match found - return default
      return {
        hs_code: '99990000',
        hs_code_description: 'Other goods not elsewhere specified',
        confidence: 0.3,
        ambiguity: true,
        classification_method: 'rules_based',
        alternative_codes: [],
        notes: 'No matching HS code found. Manual classification required.'
      };

    } catch (error) {
      console.error('Error classifying product:', error);
      return {
        hs_code: '99990000',
        hs_code_description: 'Classification error',
        confidence: 0,
        ambiguity: true,
        classification_method: 'rules_based',
        alternative_codes: [],
        notes: `Classification error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Calculate duty and landed cost
   */
  private async calculateDuty(
    shipmentId: string,
    tenantId: string,
    hsCode: string,
    value: number,
    currency: string,
    destinationCountry?: string
  ): Promise<DutyCalculationResult> {
    try {
      // Get HS code entry
      const entry = this.hsCodeDatabase.get(hsCode);
      if (!entry) {
        throw new Error(`HS code not found: ${hsCode}`);
      }

      // Get country-specific rates if available
      let dutyRate = entry.duty_rate;
      let cessRate = entry.cess_rate;
      let totalDutyRate = entry.total_duty_rate;

      if (destinationCountry && entry.country_specific_rates[destinationCountry]) {
        const countryRates = entry.country_specific_rates[destinationCountry];
        dutyRate = countryRates.duty_rate;
        cessRate = countryRates.cess_rate;
        totalDutyRate = countryRates.total_duty_rate;
      }

      // Calculate duty amounts
      const dutyAmount = (value * dutyRate) / 100;
      const cessAmount = (value * cessRate) / 100;
      const totalDutyAmount = dutyAmount + cessAmount;
      const landedCost = value + totalDutyAmount;

      return {
        hs_code: hsCode,
        duty_rate: dutyRate,
        cess_rate: cessRate,
        total_duty_rate: totalDutyRate,
        duty_amount: dutyAmount,
        cess_amount: cessAmount,
        total_duty_amount: totalDutyAmount,
        landed_cost: landedCost,
        currency,
        calculation_basis: 'CIF Value'
      };

    } catch (error) {
      console.error('Error calculating duty:', error);
      return {
        hs_code: hsCode,
        duty_rate: 0,
        cess_rate: 0,
        total_duty_rate: 0,
        duty_amount: 0,
        cess_amount: 0,
        total_duty_amount: 0,
        landed_cost: value,
        currency,
        calculation_basis: 'Error'
      };
    }
  }

  /**
   * Predict clearance time
   */
  private async predictClearanceTime(
    shipmentId: string,
    tenantId: string,
    hsCode: string,
    destinationPort?: string,
    originPort?: string
  ): Promise<{
    eta_estimate_days: number;
    min_eta_days: number;
    max_eta_days: number;
    port_congestion: boolean;
    congestion_level?: string;
    port_name?: string;
    clearance_time_prediction: string;
    confidence: number;
  }> {
    try {
      let etaEstimate = 3; // Default estimate
      let minEta = 1;
      let maxEta = 5;
      let portCongestion = false;
      let congestionLevel: string | undefined;
      let portName: string | undefined;
      let confidence = 0.7;

      // Get port data
      if (destinationPort) {
        const portData = this.portCongestionData.get(destinationPort);
        if (portData) {
          etaEstimate = portData.average_clearance_time_days;
          minEta = Math.max(1, etaEstimate - 1);
          maxEta = etaEstimate + 2;
          portCongestion = portData.congestion_level === 'high' || portData.congestion_level === 'critical';
          congestionLevel = portData.congestion_level;
          portName = portData.port_name;
          confidence = 0.9;
        }
      }

      // Get historical clearance data for this HS code and port
      if (destinationPort && hsCode) {
        const key = `${destinationPort}_${hsCode}`;
        const historicalData = this.historicalClearanceData.get(key);
        
        if (historicalData && historicalData.length > 0) {
          const data = historicalData[0];
          etaEstimate = data.average_clearance_time_days;
          minEta = data.min_clearance_time_days;
          maxEta = data.max_clearance_time_days;
          confidence = Math.min(0.95, confidence + 0.1);
        }
      }

      // Generate prediction text
      const clearanceTimePrediction = this.generateClearanceTimePrediction(
        etaEstimate,
        portCongestion,
        congestionLevel,
        portName
      );

      return {
        eta_estimate_days: etaEstimate,
        min_eta_days: minEta,
        max_eta_days: maxEta,
        port_congestion: portCongestion,
        congestion_level: congestionLevel,
        port_name: portName,
        clearance_time_prediction: clearanceTimePrediction,
        confidence
      };

    } catch (error) {
      console.error('Error predicting clearance time:', error);
      return {
        eta_estimate_days: 3,
        min_eta_days: 1,
        max_eta_days: 5,
        port_congestion: false,
        clearance_time_prediction: 'Clearance time could not be estimated',
        confidence: 0.3
      };
    }
  }

  /**
   * Generate clearance time prediction text
   */
  private generateClearanceTimePrediction(
    etaDays: number,
    portCongestion: boolean,
    congestionLevel?: string,
    portName?: string
  ): string {
    const portInfo = portName ? ` at ${portName}` : '';
    const congestionInfo = portCongestion && congestionLevel 
      ? ` (${congestionLevel} congestion)` 
      : '';

    if (etaDays <= 2) {
      return `Fast clearance expected${portInfo} - approximately ${etaDays} day(s)${congestionInfo}.`;
    } else if (etaDays <= 4) {
      return `Standard clearance time${portInfo} - approximately ${etaDays} day(s)${congestionInfo}.`;
    } else if (etaDays <= 7) {
      return `Extended clearance time${portInfo} - approximately ${etaDays} day(s)${congestionInfo}.`;
    } else {
      return `Long clearance time expected${portInfo} - approximately ${etaDays} day(s)${congestionInfo}.`;
    }
  }

  /**
   * Create classification record in database
   */
  private async createClassificationRecord(
    shipmentId: string,
    tenantId: string,
    classification: {
      hs_code: string;
      hs_code_description: string;
      confidence: number;
      ambiguity: boolean;
      classification_method: ClassificationMethod;
      alternative_codes: string[];
      notes: string;
    },
    dutyCalculation: DutyCalculationResult,
    clearancePrediction: {
      eta_estimate_days: number;
      min_eta_days: number;
      max_eta_days: number;
      port_congestion: boolean;
      clearance_time_prediction: string;
      confidence: number;
    }
  ): Promise<Classification> {
    try {
      const result = await query<Classification>(
        `INSERT INTO classifications (
          shipment_id, tenant_id, hs_code, hs_code_description, 
          confidence, ambiguity_flag, duty_rate, cess_rate, total_duty_rate,
          duty_estimate, landed_cost_estimate, eta_estimate_days, 
          clearance_time_prediction, port_congestion_flag, 
          classification_method, classification_notes, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'generated')
        RETURNING *`,
        [
          shipmentId,
          tenantId,
          classification.hs_code,
          classification.hs_code_description,
          classification.confidence,
          classification.ambiguity,
          dutyCalculation.duty_rate,
          dutyCalculation.cess_rate,
          dutyCalculation.total_duty_rate,
          dutyCalculation.duty_amount,
          dutyCalculation.landed_cost,
          clearancePrediction.eta_estimate_days,
          clearancePrediction.clearance_time_prediction,
          clearancePrediction.port_congestion,
          classification.classification_method,
          classification.notes
        ]
      );

      return result.rows[0];

    } catch (error) {
      console.error('Error creating classification record:', error);
      throw error;
    }
  }

  /**
   * Reclassify a product with manual override
   */
  async reclassifyProduct(
    shipmentId: string,
    tenantId: string,
    request: ClassificationRequest
  ): Promise<AgentResult> {
    try {
      // Delete existing classification
      await query(
        'DELETE FROM classifications WHERE shipment_id = $1',
        [shipmentId]
      );

      // Perform new classification
      const result = await this.execute(shipmentId, tenantId, {
        classificationRequests: [request],
        calculateDuty: true,
        predictClearanceTime: true
      });

      // Log the reclassification
      await this.logAction(
        shipmentId,
        tenantId,
        'product_reclassified',
        { request },
        { result },
        0.9
      );

      return result;

    } catch (error) {
      return this.handleError(error as Error, 'reclassifyProduct');
    }
  }

  /**
   * Approve a classification
   */
  async approveClassification(
    classificationId: string,
    userId: string,
    tenantId: string
  ): Promise<AgentResult> {
    try {
      // Update classification status
      await query(
        `UPDATE classifications 
         SET status = $1, approved_by = $2, approved_at = NOW()
         WHERE id = $3 AND tenant_id = $4`,
        ['approved', userId, classificationId, tenantId]
      );

      // Log the approval
      await this.logAction(
        '', // Will be updated from classification
        tenantId,
        'classification_approved',
        { classificationId, userId },
        { approved: true },
        1.0
      );

      // Get the shipment ID for this classification
      const classification = await query<Classification>(
        'SELECT shipment_id FROM classifications WHERE id = $1',
        [classificationId]
      );

      if (classification.rows.length > 0) {
        // Check if we can advance the shipment
        const canAdvance = await stateMachine.canAdvance(classification.rows[0].shipment_id);
        if (canAdvance.canAdvance) {
          await stateMachine.advanceStage(classification.rows[0].shipment_id, userId);
        }
      }

      return this.generateOutput({
        message: 'Classification approved',
        classificationId
      }, 1.0);

    } catch (error) {
      return this.handleError(error as Error, 'approveClassification');
    }
  }

  /**
   * Get HS code suggestions for a product description
   */
  async getHSCodeSuggestions(
    productDescription: string,
    productCategory?: string,
    limit: number = 5
  ): Promise<Array<{
    hs_code: string;
    description: string;
    category: string;
    duty_rate: number;
    total_duty_rate: number;
    match_score: number;
  }>> {
    try {
      const suggestions: Array<{
        hs_code: string;
        description: string;
        category: string;
        duty_rate: number;
        total_duty_rate: number;
        match_score: number;
      }> = [];

      const searchTerm = productDescription.toLowerCase();

      for (const [hsCode, entry] of this.hsCodeDatabase) {
        const description = entry.description.toLowerCase();
        const category = entry.category.toLowerCase();

        let score = 0;

        // Check for exact match
        if (searchTerm.includes(description) || description.includes(searchTerm)) {
          score = 100;
        } else {
          // Check for keyword matches
          const keywords = searchTerm.split(/\s+/);
          for (const keyword of keywords) {
            if (keyword.length > 3 && description.includes(keyword)) {
              score += 20;
            }
          }

          // Check category match
          if (productCategory && category.includes(productCategory.toLowerCase())) {
            score += 30;
          }
        }

        if (score > 0) {
          suggestions.push({
            hs_code: hsCode,
            description: entry.description,
            category: entry.category,
            duty_rate: entry.duty_rate,
            total_duty_rate: entry.total_duty_rate,
            match_score: score
          });
        }
      }

      // Sort by score
      suggestions.sort((a, b) => b.match_score - a.match_score);

      return suggestions.slice(0, limit);

    } catch (error) {
      console.error('Error getting HS code suggestions:', error);
      return [];
    }
  }

  /**
   * Get customs classification status for a shipment
   */
  async getStatus(shipmentId: string): Promise<{
    status: string;
    hsCode?: string;
    confidence?: number;
    dutyEstimate?: number;
    etaEstimateDays?: number;
    requiresApproval: boolean;
  }> {
    try {
      const classification = await query<Classification>(
        'SELECT * FROM classifications WHERE shipment_id = $1 ORDER BY created_at DESC LIMIT 1',
        [shipmentId]
      );

      if (classification.rows.length === 0) {
        return {
          status: 'not_started',
          requiresApproval: false
        };
      }

      const c = classification.rows[0];

      return {
        status: c.status,
        hsCode: c.hs_code,
        confidence: c.confidence,
        dutyEstimate: c.duty_estimate,
        etaEstimateDays: c.eta_estimate_days,
        requiresApproval: c.confidence < this.config.confidenceThreshold && c.status !== 'approved'
      };

    } catch (error) {
      console.error('Error getting customs classification status:', error);
      return {
        status: 'error',
        requiresApproval: false
      };
    }
  }

  /**
   * Get port information
   */
  async getPortInformation(portCode: string): Promise<{
    port_code: string;
    port_name: string;
    country: string;
    congestion_level: string;
    average_clearance_time_days: number;
    current_wait_time_days: number;
    last_updated: Date;
  } | null> {
    const portData = this.portCongestionData.get(portCode);
    if (!portData) return null;

    return {
      port_code: portData.port_code,
      port_name: portData.port_name,
      country: portData.country,
      congestion_level: portData.congestion_level,
      average_clearance_time_days: portData.average_clearance_time_days,
      current_wait_time_days: portData.current_wait_time_days,
      last_updated: portData.last_updated
    };
  }

  /**
   * Get HS code details
   */
  async getHSCodeDetails(hsCode: string): Promise<HSCodeEntry | null> {
    return this.hsCodeDatabase.get(hsCode) || null;
  }

  /**
   * Get duty rates for a specific HS code and country
   */
  async getDutyRates(
    hsCode: string,
    destinationCountry?: string
  ): Promise<{
    hs_code: string;
    description: string;
    base_duty_rate: number;
    base_cess_rate: number;
    base_total_duty_rate: number;
    country_specific_duty_rate?: number;
    country_specific_cess_rate?: number;
    country_specific_total_duty_rate?: number;
    country: string | null;
    restrictions: string[];
    required_documents: string[];
  } | null> {
    const entry = this.hsCodeDatabase.get(hsCode);
    if (!entry) return null;

    let countryRates = undefined;
    if (destinationCountry && entry.country_specific_rates[destinationCountry]) {
      countryRates = entry.country_specific_rates[destinationCountry];
    }

    return {
      hs_code: entry.hs_code,
      description: entry.description,
      base_duty_rate: entry.duty_rate,
      base_cess_rate: entry.cess_rate,
      base_total_duty_rate: entry.total_duty_rate,
      country_specific_duty_rate: countryRates?.duty_rate,
      country_specific_cess_rate: countryRates?.cess_rate,
      country_specific_total_duty_rate: countryRates?.total_duty_rate,
      country: destinationCountry || null,
      restrictions: entry.restrictions,
      required_documents: entry.required_documents
    };
  }
}

// Register the agent with the factory
AgentFactory.registerAgent('customs_intelligence', new CustomsIntelligenceAgent());

export default CustomsIntelligenceAgent;
