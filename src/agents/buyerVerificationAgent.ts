import { BaseAgent, AgentResult, AgentFactory } from './baseAgent';
import { query, beginTransaction } from '../db/connection';
import { auditLogger } from '../core/auditLogger';
import { stateMachine } from '../core/stateMachine';
import {
  AgentType,
  Buyer,
  BuyerRiskCategory,
  BuyerVerificationStatus,
  Payment,
  PaymentStatus,
  PaymentMethod,
  Shipment
} from '../types';

// Risk scoring rubric
interface RiskScoringRubric {
  weight: number;
  score: (data: any) => number; // Returns 0-100
  description: string;
}

// Credit bureau data interface
interface CreditBureauData {
  creditScore?: number;
  creditRating?: string;
  paymentHistory?: Array<{
    date: Date;
    amount: number;
    status: string;
    daysLate?: number;
  }>;
  outstandingDebt?: number;
  creditLimit?: number;
  creditUtilization?: number;
  businessRegistration?: {
    registered: boolean;
    registrationDate?: Date;
    legalStatus?: string;
  };
  financials?: {
    revenue?: number;
    profit?: number;
    assets?: number;
    liabilities?: number;
  };
}

// Corporate registry data interface
interface CorporateRegistryData {
  companyName: string;
  registrationNumber: string;
  registrationDate: Date;
  legalForm: string;
  status: string;
  directors: Array<{
    name: string;
    position: string;
    nationality: string;
  }>;
  shareholders: Array<{
    name: string;
    ownershipPercentage: number;
  }>;
  registeredAddress: string;
  businessActivities: string[];
}

// Buyer verification request
interface BuyerVerificationRequest {
  buyerId: string;
  forceReverify?: boolean;
  includeFinancials?: boolean;
  includeTradeReferences?: boolean;
}

// Risk score breakdown
interface RiskScoreBreakdown {
  paymentHistory: number;
  creditRating: number;
  businessLongevity: number;
  financialHealth: number;
  tradeReferences: number;
  externalData: number;
  overall: number;
}

// Risk scoring rubric configuration
const RISK_SCORING_RUBRIC: RiskScoringRubric[] = [
  {
    weight: 0.35,
    score: (data: any) => {
      // Payment history score (0-100)
      const paymentHistory = data.paymentHistory || [];
      if (paymentHistory.length === 0) return 50; // Neutral score for no history

      const onTimePayments = paymentHistory.filter((p: any) => p.daysLate === 0 || !p.daysLate).length;
      const latePayments = paymentHistory.filter((p: any) => p.daysLate && p.daysLate > 0).length;
      const defaultedPayments = paymentHistory.filter((p: any) => p.status === 'defaulted' || p.daysLate > 90).length;

      const onTimeRatio = onTimePayments / paymentHistory.length;
      const lateRatio = latePayments / paymentHistory.length;
      const defaultRatio = defaultedPayments / paymentHistory.length;

      // Calculate score
      let score = onTimeRatio * 100;
      score -= lateRatio * 30; // Penalty for late payments
      score -= defaultRatio * 60; // Heavy penalty for defaults

      return Math.max(0, Math.min(100, score));
    },
    description: 'Payment history and timeliness'
  },
  {
    weight: 0.25,
    score: (data: any) => {
      // Credit rating score (0-100)
      const creditScore = data.creditScore;
      const creditRating = data.creditRating?.toLowerCase();

      if (creditScore) {
        // Convert credit score to 0-100 scale
        // Assuming credit score is 300-850 range
        return Math.max(0, Math.min(100, ((creditScore - 300) / 550) * 100));
      }

      if (creditRating) {
        const ratingScores: Record<string, number> = {
          'excellent': 100,
          'very good': 85,
          'good': 70,
          'fair': 55,
          'poor': 30,
          'very poor': 10,
          'default': 0
        };
        return ratingScores[creditRating] || 50;
      }

      return 50; // Neutral score
    },
    description: 'Credit rating and score'
  },
  {
    weight: 0.15,
    score: (data: any) => {
      // Business longevity score (0-100)
      const firstShipmentDate = data.firstShipmentDate;
      const registrationDate = data.registrationDate;

      if (!firstShipmentDate && !registrationDate) return 50;

      const startDate = firstShipmentDate || registrationDate;
      const yearsInBusiness = (new Date().getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24 * 365);

      // Score based on years in business
      if (yearsInBusiness >= 10) return 100;
      if (yearsInBusiness >= 5) return 80;
      if (yearsInBusiness >= 3) return 60;
      if (yearsInBusiness >= 1) return 40;
      return 20;
    },
    description: 'Business longevity and history'
  },
  {
    weight: 0.15,
    score: (data: any) => {
      // Financial health score (0-100)
      const financials = data.financials || {};
      const creditUtilization = data.creditUtilization;

      let score = 50; // Base score

      // Revenue check
      if (financials.revenue && financials.revenue > 1000000) {
        score += 20; // Good revenue
      }

      // Profitability check
      if (financials.profit && financials.profit > 0) {
        score += 15; // Profitable
      }

      // Credit utilization check
      if (creditUtilization !== undefined) {
        if (creditUtilization < 0.3) {
          score += 15; // Low utilization is good
        } else if (creditUtilization > 0.8) {
          score -= 20; // High utilization is risky
        }
      }

      return Math.max(0, Math.min(100, score));
    },
    description: 'Financial health and stability'
  },
  {
    weight: 0.05,
    score: (data: any) => {
      // Trade references score (0-100)
      const tradeReferences = data.tradeReferences || [];
      if (tradeReferences.length === 0) return 50;

      const positiveReferences = tradeReferences.filter((r: any) => r.rating >= 4).length;
      const negativeReferences = tradeReferences.filter((r: any) => r.rating <= 2).length;

      const positiveRatio = positiveReferences / tradeReferences.length;
      const negativeRatio = negativeReferences / tradeReferences.length;

      let score = positiveRatio * 100;
      score -= negativeRatio * 50;

      return Math.max(0, Math.min(100, score));
    },
    description: 'Trade references and reputation'
  },
  {
    weight: 0.05,
    score: (data: any) => {
      // External data quality score (0-100)
      const hasCreditData = !!data.creditData;
      const hasRegistryData = !!data.registryData;
      const hasPaymentHistory = (data.paymentHistory || []).length > 0;

      let score = 0;
      if (hasCreditData) score += 40;
      if (hasRegistryData) score += 30;
      if (hasPaymentHistory) score += 30;

      return Math.min(100, score);
    },
    description: 'External data availability and quality'
  }
];

// Risk category thresholds
const RISK_CATEGORY_THRESHOLDS = {
  low: 70,
  medium: 50,
  high: 30,
  critical: 0
};

export class BuyerVerificationAgent extends BaseAgent {
  private creditBureauMockData: Map<string, CreditBureauData>;
  private registryMockData: Map<string, CorporateRegistryData>;

  constructor() {
    super({
      agentType: 'buyer_verification',
      version: '1.0.0',
      model: 'claude-3-sonnet-20240229',
      confidenceThreshold: 0.75
    });

    // Mock data for demonstration
    this.creditBureauMockData = new Map();
    this.registryMockData = new Map();
    this.initializeMockData();
  }

  getAgentType(): AgentType {
    return 'buyer_verification';
  }

  protected getRequiredStage(): string | null {
    return 'compliance_screened';
  }

  private initializeMockData(): void {
    // Mock credit bureau data
    this.creditBureauMockData.set('buyer_1', {
      creditScore: 750,
      creditRating: 'Good',
      paymentHistory: [
        { date: new Date('2024-01-15'), amount: 100000, status: 'paid', daysLate: 0 },
        { date: new Date('2024-02-20'), amount: 150000, status: 'paid', daysLate: 5 },
        { date: new Date('2024-03-10'), amount: 200000, status: 'paid', daysLate: 0 },
        { date: new Date('2024-04-05'), amount: 120000, status: 'paid', daysLate: 2 }
      ],
      outstandingDebt: 500000,
      creditLimit: 2000000,
      creditUtilization: 0.25,
      businessRegistration: {
        registered: true,
        registrationDate: new Date('2015-01-01'),
        legalStatus: 'Active'
      },
      financials: {
        revenue: 10000000,
        profit: 1500000,
        assets: 5000000,
        liabilities: 2000000
      }
    });

    this.creditBureauMockData.set('buyer_2', {
      creditScore: 600,
      creditRating: 'Fair',
      paymentHistory: [
        { date: new Date('2024-01-15'), amount: 50000, status: 'paid', daysLate: 15 },
        { date: new Date('2024-02-20'), amount: 75000, status: 'paid', daysLate: 30 },
        { date: new Date('2024-03-10'), amount: 100000, status: 'paid', daysLate: 10 },
        { date: new Date('2024-04-05'), amount: 60000, status: 'defaulted', daysLate: 90 }
      ],
      outstandingDebt: 1000000,
      creditLimit: 1500000,
      creditUtilization: 0.67,
      businessRegistration: {
        registered: true,
        registrationDate: new Date('2018-01-01'),
        legalStatus: 'Active'
      },
      financials: {
        revenue: 5000000,
        profit: 200000,
        assets: 3000000,
        liabilities: 2500000
      }
    });

    // Mock registry data
    this.registryMockData.set('buyer_1', {
      companyName: 'Reliable Imports Ltd',
      registrationNumber: 'REG-123456',
      registrationDate: new Date('2010-01-01'),
      legalForm: 'Private Limited Company',
      status: 'Active',
      directors: [
        { name: 'John Smith', position: 'Managing Director', nationality: 'USA' },
        { name: 'Jane Doe', position: 'Finance Director', nationality: 'UK' }
      ],
      shareholders: [
        { name: 'John Smith', ownershipPercentage: 60 },
        { name: 'Jane Doe', ownershipPercentage: 40 }
      ],
      registeredAddress: '123 Business Ave, New York, USA',
      businessActivities: ['Import', 'Wholesale', 'Retail']
    });

    this.registryMockData.set('buyer_2', {
      companyName: 'Risky Traders Inc',
      registrationNumber: 'REG-789012',
      registrationDate: new Date('2020-01-01'),
      legalForm: 'Limited Liability Company',
      status: 'Active',
      directors: [
        { name: 'Bob Johnson', position: 'CEO', nationality: 'Unknown' }
      ],
      shareholders: [
        { name: 'Bob Johnson', ownershipPercentage: 100 }
      ],
      registeredAddress: '456 High St, London, UK',
      businessActivities: ['Import', 'Export']
    });
  }

  async execute(
    shipmentId: string,
    tenantId: string,
    options: {
      buyerId?: string;
      verificationRequests?: BuyerVerificationRequest[];
    } = {}
  ): Promise<AgentResult> {
    this.startExecution();

    try {
      // Get shipment data
      const shipment = await this.getShipmentData(shipmentId);
      if (!shipment) {
        return this.handleError(new Error('Shipment not found'), 'execute');
      }

      // Determine which buyers to verify
      const buyerIds = options.verificationRequests?.map(r => r.buyerId) || [];
      
      // Add shipment buyer if not already included
      if (shipment.buyer_id && !buyerIds.includes(shipment.buyer_id)) {
        buyerIds.push(shipment.buyer_id);
      }

      // Add consignee if different from buyer
      if (shipment.consignee_id && shipment.consignee_id !== shipment.buyer_id && !buyerIds.includes(shipment.consignee_id)) {
        buyerIds.push(shipment.consignee_id);
      }

      if (buyerIds.length === 0) {
        return this.generateOutput({
          message: 'No buyers to verify',
          verifiedBuyers: []
        }, 1.0);
      }

      // Verify each buyer
      const verificationResults: Array<{
        buyerId: string;
        buyer: Buyer;
        riskScore: number;
        riskCategory: BuyerRiskCategory;
        scoreBreakdown: RiskScoreBreakdown;
        verificationStatus: BuyerVerificationStatus;
        paymentHistory: Payment[];
        creditData?: CreditBureauData;
        registryData?: CorporateRegistryData;
        recommendations: string[];
      }> = [];

      for (const buyerId of buyerIds) {
        const result = await this.verifyBuyer(buyerId, tenantId, options);
        verificationResults.push(result);
      }

      // Update shipment buyer verification status
      const allLowRisk = verificationResults.every(r => r.riskCategory === 'low');
      const status = allLowRisk ? 'completed' : 'flagged';
      
      await this.updateShipmentAgentStatus(
        shipmentId,
        'buyer_verification_status',
        status
      );

      // Log the buyer verification
      await this.logAction(
        shipmentId,
        tenantId,
        'buyer_verification_completed',
        { shipmentId, buyerIds, options },
        {
          verificationResults,
          allLowRisk,
          buyerCount: verificationResults.length
        },
        allLowRisk ? 1.0 : 0.5
      );

      // Check if we can auto-advance the stage
      const canAdvance = await stateMachine.canAdvance(shipmentId);
      if (canAdvance.canAdvance && allLowRisk) {
        await stateMachine.advanceStage(shipmentId, 'system');
      }

      return this.endExecution(this.generateOutput(
        {
          message: 'Buyer verification completed',
          verificationResults,
          allLowRisk,
          highRiskBuyers: verificationResults.filter(r => r.riskCategory === 'high' || r.riskCategory === 'critical')
        },
        allLowRisk ? 1.0 : 0.5,
        verificationResults.filter(r => r.riskCategory !== 'low').map(r => ({
          type: 'buyer_risk_flag',
          buyerId: r.buyerId,
          riskCategory: r.riskCategory,
          riskScore: r.riskScore,
          message: `Buyer risk: ${r.riskCategory}`
        })),
        verificationResults.some(r => r.creditData === undefined) ? ['External credit data not available for some buyers'] : []
      ));

    } catch (error) {
      return this.handleError(error as Error, 'execute');
    }
  }

  /**
   * Verify a single buyer
   */
  private async verifyBuyer(
    buyerId: string,
    tenantId: string,
    options: {
      verificationRequests?: BuyerVerificationRequest[];
    } = {}
  ): Promise<{
    buyerId: string;
    buyer: Buyer;
    riskScore: number;
    riskCategory: BuyerRiskCategory;
    scoreBreakdown: RiskScoreBreakdown;
    verificationStatus: BuyerVerificationStatus;
    paymentHistory: Payment[];
    creditData?: CreditBureauData;
    registryData?: CorporateRegistryData;
    recommendations: string[];
  }> {
    try {
      // Get buyer data
      const buyer = await this.getBuyerData(buyerId);
      if (!buyer) {
        throw new Error(`Buyer not found: ${buyerId}`);
      }

      // Get payment history
      const paymentHistory = await this.getPaymentHistory(buyerId, tenantId);

      // Get external data (credit bureau and registry)
      const creditData = this.creditBureauMockData.get(buyerId) || this.creditBureauMockData.get('buyer_1');
      const registryData = this.registryMockData.get(buyerId) || this.registryMockData.get('buyer_1');

      // Prepare data for risk scoring
      const scoringData = {
        paymentHistory,
        creditScore: creditData?.creditScore,
        creditRating: creditData?.creditRating,
        creditUtilization: creditData?.creditUtilization,
        firstShipmentDate: buyer.first_shipment_date,
        registrationDate: registryData?.registrationDate,
        financials: creditData?.financials,
        tradeReferences: [], // Would come from external data in real implementation
        creditData: creditData ? 'available' : undefined,
        registryData: registryData ? 'available' : undefined
      };

      // Calculate risk score
      const { score, breakdown } = this.calculateRiskScore(scoringData);

      // Determine risk category
      const riskCategory = this.determineRiskCategory(score);

      // Determine verification status
      const verificationStatus = this.determineVerificationStatus(riskCategory, scoringData);

      // Generate recommendations
      const recommendations = this.generateRecommendations(score, breakdown, buyer, creditData);

      // Update buyer record with new risk score
      await this.updateBuyerRiskScore(buyerId, score, riskCategory, breakdown);

      return {
        buyerId,
        buyer,
        riskScore: score,
        riskCategory,
        scoreBreakdown: breakdown,
        verificationStatus,
        paymentHistory,
        creditData,
        registryData,
        recommendations
      };

    } catch (error) {
      console.error(`Error verifying buyer ${buyerId}:`, error);
      throw error;
    }
  }

  /**
   * Calculate risk score using the rubric
   */
  private calculateRiskScore(data: any): { score: number; breakdown: RiskScoreBreakdown } {
    let totalWeightedScore = 0;
    let totalWeight = 0;
    const breakdown: Partial<RiskScoreBreakdown> = {};

    for (const component of RISK_SCORING_RUBRIC) {
      const componentScore = component.score(data);
      const weightedScore = componentScore * component.weight;
      
      totalWeightedScore += weightedScore;
      totalWeight += component.weight;
      
      // Store breakdown (convert to property name)
      const propertyName = component.description
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-zA-Z0-9_]/g, '') as keyof RiskScoreBreakdown;
      
      breakdown[propertyName] = componentScore;
    }

    // Calculate overall score (0-100)
    const overallScore = totalWeight > 0 ? (totalWeightedScore / totalWeight) : 50;

    return {
      score: Math.round(overallScore),
      breakdown: {
        ...breakdown,
        overall: Math.round(overallScore)
      } as RiskScoreBreakdown
    };
  }

  /**
   * Determine risk category based on score
   */
  private determineRiskCategory(score: number): BuyerRiskCategory {
    if (score >= RISK_CATEGORY_THRESHOLDS.low) return 'low';
    if (score >= RISK_CATEGORY_THRESHOLDS.medium) return 'medium';
    if (score >= RISK_CATEGORY_THRESHOLDS.high) return 'high';
    return 'critical';
  }

  /**
   * Determine verification status
   */
  private determineVerificationStatus(
    riskCategory: BuyerRiskCategory,
    data: any
  ): BuyerVerificationStatus {
    if (riskCategory === 'critical' || riskCategory === 'high') {
      return 'flagged';
    }
    
    if (data.creditData === undefined && data.registryData === undefined) {
      return 'pending';
    }
    
    return 'verified';
  }

  /**
   * Generate recommendations based on risk score and data
   */
  private generateRecommendations(
    score: number,
    breakdown: RiskScoreBreakdown,
    buyer: Buyer,
    creditData?: CreditBureauData
  ): string[] {
    const recommendations: string[] = [];

    // General recommendations based on score
    if (score < 30) {
      recommendations.push('CRITICAL RISK: Do not proceed with shipment without senior management approval and additional due diligence.');
    } else if (score < 50) {
      recommendations.push('HIGH RISK: Requires additional verification and approval before proceeding.');
    } else if (score < 70) {
      recommendations.push('MODERATE RISK: Monitor closely and consider payment terms carefully.');
    } else {
      recommendations.push('LOW RISK: Buyer appears reliable based on available data.');
    }

    // Specific recommendations based on breakdown
    if (breakdown.paymentHistory && breakdown.paymentHistory < 50) {
      recommendations.push('Poor payment history detected. Consider requiring advance payment or letter of credit.');
    }

    if (breakdown.creditRating && breakdown.creditRating < 50) {
      recommendations.push('Low credit rating. Review credit terms and consider shorter payment periods.');
    }

    if (breakdown.businessLongevity && breakdown.businessLongevity < 50) {
      recommendations.push('Limited business history. Verify company registration and references.');
    }

    if (breakdown.financialHealth && breakdown.financialHealth < 50) {
      recommendations.push('Financial health concerns. Request recent financial statements.');
    }

    if (breakdown.externalData && breakdown.externalData < 50) {
      recommendations.push('Limited external data available. Conduct additional due diligence.');
    }

    // Recommendations based on buyer data
    if (buyer.total_shipments === 0) {
      recommendations.push('First-time buyer. Consider starting with a smaller shipment to test reliability.');
    }

    if (buyer.total_value > 1000000 && breakdown.creditRating && breakdown.creditRating < 70) {
      recommendations.push('High-value buyer with moderate credit rating. Consider requiring bank guarantee.');
    }

    // Remove duplicates
    return Array.from(new Set(recommendations));
  }

  /**
   * Get payment history for a buyer
   */
  private async getPaymentHistory(buyerId: string, tenantId: string): Promise<Payment[]> {
    try {
      const result = await query<Payment>(
        `SELECT * FROM payments 
         WHERE buyer_id = $1 AND tenant_id = $2 
         ORDER BY payment_date DESC`,
        [buyerId, tenantId]
      );
      return result.rows;
    } catch (error) {
      console.error('Error fetching payment history:', error);
      return [];
    }
  }

  /**
   * Update buyer risk score in database
   */
  private async updateBuyerRiskScore(
    buyerId: string,
    score: number,
    riskCategory: BuyerRiskCategory,
    breakdown: RiskScoreBreakdown
  ): Promise<void> {
    try {
      // Get current risk score history
      const buyer = await this.getBuyerData(buyerId);
      if (!buyer) return;

      const currentHistory = buyer.risk_score_history || [];
      const newHistory = [
        ...currentHistory,
        {
          score,
          category: riskCategory,
          breakdown,
          timestamp: new Date().toISOString()
        }
      ];

      // Update buyer record
      await query(
        `UPDATE buyers 
         SET risk_score = $1, risk_category = $2, risk_score_history = $3, 
             verification_status = $4, updated_at = NOW()
         WHERE id = $5`,
        [score, riskCategory, JSON.stringify(newHistory), 'verified', buyerId]
      );

    } catch (error) {
      console.error('Error updating buyer risk score:', error);
    }
  }

  /**
   * Get buyer verification status
   */
  async getStatus(shipmentId: string): Promise<{
    status: string;
    verifiedBuyers: number;
    flaggedBuyers: number;
    averageRiskScore: number;
    requiresApproval: boolean;
  }> {
    try {
      const shipment = await this.getShipmentData(shipmentId);
      if (!shipment) {
        return {
          status: 'not_started',
          verifiedBuyers: 0,
          flaggedBuyers: 0,
          averageRiskScore: 0,
          requiresApproval: false
        };
      }

      const buyerIds = [shipment.buyer_id];
      if (shipment.consignee_id && shipment.consignee_id !== shipment.buyer_id) {
        buyerIds.push(shipment.consignee_id);
      }

      const buyers = await query<Buyer>(
        'SELECT * FROM buyers WHERE id = ANY($1)',
        [buyerIds]
      );

      const verifiedBuyers = buyers.rows.filter(b => b.verification_status === 'verified').length;
      const flaggedBuyers = buyers.rows.filter(b => b.risk_category === 'high' || b.risk_category === 'critical').length;
      
      const averageRiskScore = buyers.rows.length > 0 
        ? buyers.rows.reduce((sum, b) => sum + b.risk_score, 0) / buyers.rows.length
        : 0;

      const requiresApproval = flaggedBuyers > 0 || 
        buyers.rows.some(b => b.verification_status !== 'verified');

      return {
        status: buyers.rows.length > 0 ? 'completed' : 'pending',
        verifiedBuyers,
        flaggedBuyers,
        averageRiskScore,
        requiresApproval
      };

    } catch (error) {
      console.error('Error getting buyer verification status:', error);
      return {
        status: 'error',
        verifiedBuyers: 0,
        flaggedBuyers: 0,
        averageRiskScore: 0,
        requiresApproval: false
      };
    }
  }

  /**
   * Get buyer risk score and history
   */
  async getBuyerRiskScore(buyerId: string, tenantId: string): Promise<{
    buyer: Buyer;
    riskScore: number;
    riskCategory: BuyerRiskCategory;
    scoreHistory: any[];
    paymentHistory: Payment[];
    recommendations: string[];
  } | null> {
    try {
      const buyer = await this.getBuyerData(buyerId);
      if (!buyer) return null;

      const paymentHistory = await this.getPaymentHistory(buyerId, tenantId);
      const recommendations = this.generateRecommendations(
        buyer.risk_score,
        {} as RiskScoreBreakdown,
        buyer
      );

      return {
        buyer,
        riskScore: buyer.risk_score,
        riskCategory: buyer.risk_category as BuyerRiskCategory,
        scoreHistory: buyer.risk_score_history || [],
        paymentHistory,
        recommendations
      };

    } catch (error) {
      console.error('Error getting buyer risk score:', error);
      return null;
    }
  }

  /**
   * Update buyer verification status
   */
  async updateVerificationStatus(
    buyerId: string,
    tenantId: string,
    status: BuyerVerificationStatus,
    notes?: string
  ): Promise<boolean> {
    try {
      await query(
        'UPDATE buyers SET verification_status = $1, verification_notes = $2, updated_at = NOW() WHERE id = $3 AND tenant_id = $4',
        [status, notes, buyerId, tenantId]
      );
      return true;
    } catch (error) {
      console.error('Error updating verification status:', error);
      return false;
    }
  }

  /**
   * Add payment history for a buyer
   */
  async addPaymentHistory(
    buyerId: string,
    tenantId: string,
    paymentData: {
      shipmentId: string;
      paymentDate: Date;
      amount: number;
      currency: string;
      paymentMethod: PaymentMethod;
      paymentStatus: PaymentStatus;
      daysOverdue?: number;
      notes?: string;
    }
  ): Promise<Payment> {
    try {
      const result = await query<Payment>(
        `INSERT INTO payments (
          shipment_id, tenant_id, buyer_id, payment_date, amount, 
          currency, payment_method, payment_status, days_overdue, payment_notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *`,
        [
          paymentData.shipmentId,
          tenantId,
          buyerId,
          paymentData.paymentDate,
          paymentData.amount,
          paymentData.currency,
          paymentData.paymentMethod,
          paymentData.paymentStatus,
          paymentData.daysOverdue || 0,
          paymentData.notes
        ]
      );

      // Update buyer payment history
      await query(
        `UPDATE buyers 
         SET payment_history = COALESCE(payment_history, '[]'::jsonb) || $1, 
             total_shipments = total_shipments + 1,
             total_value = total_value + $2,
             last_shipment_date = GREATEST(COALESCE(last_shipment_date, '1970-01-01'::timestamp), $3),
             updated_at = NOW()
         WHERE id = $4`,
        [
          JSON.stringify([{
            paymentDate: paymentData.paymentDate,
            amount: paymentData.amount,
            status: paymentData.paymentStatus,
            daysOverdue: paymentData.daysOverdue || 0
          }]),
          paymentData.amount,
          paymentData.paymentDate,
          buyerId
        ]
      );

      // Recalculate risk score
      const buyer = await this.getBuyerData(buyerId);
      if (buyer) {
        const paymentHistory = await this.getPaymentHistory(buyerId, tenantId);
        const scoringData = {
          paymentHistory,
          creditScore: undefined,
          creditRating: undefined,
          firstShipmentDate: buyer.first_shipment_date || paymentData.paymentDate,
          registrationDate: undefined,
          financials: undefined,
          tradeReferences: [],
          creditData: undefined,
          registryData: undefined
        };

        const { score, breakdown } = this.calculateRiskScore(scoringData);
        const riskCategory = this.determineRiskCategory(score);
        await this.updateBuyerRiskScore(buyerId, score, riskCategory, breakdown);
      }

      return result.rows[0];

    } catch (error) {
      console.error('Error adding payment history:', error);
      throw error;
    }
  }

  /**
   * Get buyers for a tenant with risk scores
   */
  async getTenantBuyers(
    tenantId: string,
    options: {
      riskCategory?: BuyerRiskCategory;
      search?: string;
      page?: number;
      pageSize?: number;
    } = {}
  ): Promise<{ buyers: Buyer[]; total: number }> {
    try {
      const { riskCategory, search, page = 1, pageSize = 50 } = options;

      let queryText = 'SELECT * FROM buyers WHERE tenant_id = $1';
      const params: any[] = [tenantId];
      let paramIndex = 2;

      if (riskCategory) {
        queryText += ` AND risk_category = $${paramIndex++}`;
        params.push(riskCategory);
      }

      if (search) {
        queryText += ` AND (name ILIKE $${paramIndex} OR registration_no ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`;
        params.push(`%${search}%`);
        paramIndex++;
      }

      // Count total
      const countQuery = `SELECT COUNT(*) FROM (${queryText}) AS subquery`;
      const countResult = await query<{ count: string }>(countQuery, params);
      const total = parseInt(countResult.rows[0].count);

      // Add pagination
      queryText += ` ORDER BY risk_score DESC, name LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
      params.push(pageSize, (page - 1) * pageSize);

      const result = await query<Buyer>(queryText, params);

      return {
        buyers: result.rows,
        total
      };

    } catch (error) {
      console.error('Error getting tenant buyers:', error);
      return { buyers: [], total: 0 };
    }
  }

  /**
   * Get buyer statistics for a tenant
   */
  async getBuyerStats(tenantId: string): Promise<{
    totalBuyers: number;
    byRiskCategory: Record<BuyerRiskCategory, number>;
    averageRiskScore: number;
    newBuyersThisMonth: number;
    highValueBuyers: number;
  }> {
    try {
      // Get all buyers for tenant
      const buyers = await query<Buyer>(
        'SELECT * FROM buyers WHERE tenant_id = $1',
        [tenantId]
      );

      const totalBuyers = buyers.rows.length;
      
      // Count by risk category
      const byRiskCategory: Record<BuyerRiskCategory, number> = {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0
      };

      let totalRiskScore = 0;
      let newBuyersThisMonth = 0;
      let highValueBuyers = 0;

      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      for (const buyer of buyers.rows) {
        byRiskCategory[buyer.risk_category as BuyerRiskCategory]++;
        totalRiskScore += buyer.risk_score;

        if (buyer.first_shipment_date && new Date(buyer.first_shipment_date) >= thisMonth) {
          newBuyersThisMonth++;
        }

        if (buyer.total_value > 1000000) {
          highValueBuyers++;
        }
      }

      const averageRiskScore = totalBuyers > 0 ? totalRiskScore / totalBuyers : 0;

      return {
        totalBuyers,
        byRiskCategory,
        averageRiskScore,
        newBuyersThisMonth,
        highValueBuyers
      };

    } catch (error) {
      console.error('Error getting buyer stats:', error);
      return {
        totalBuyers: 0,
        byRiskCategory: { low: 0, medium: 0, high: 0, critical: 0 },
        averageRiskScore: 0,
        newBuyersThisMonth: 0,
        highValueBuyers: 0
      };
    }
  }
}

// Register the agent with the factory
AgentFactory.registerAgent('buyer_verification', new BuyerVerificationAgent());

export default BuyerVerificationAgent;
