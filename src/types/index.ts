// Core Types for Consign AI

// Tenant Types
export type TenantTier = 'starter' | 'growth' | 'scale' | 'enterprise';
export type DeploymentMode = 'saas' | 'vpc' | 'on_prem';
export type SubscriptionStatus = 'active' | 'trial' | 'suspended' | 'cancelled';

// User Types
export type UserRole = 'owner' | 'admin' | 'compliance_manager' | 'finance' | 'user' | 'read_only';
export type UserStatus = 'active' | 'inactive' | 'suspended';

// Shipment Types
export type ShipmentStage = 
  | 'draft'
  | 'documents_generated'
  | 'compliance_screened'
  | 'buyer_verified'
  | 'customs_classified'
  | 'ready_to_file'
  | 'filed'
  | 'cancelled';

export type ShipmentStatus = 'active' | 'on_hold' | 'completed' | 'cancelled';
export type ShipmentPriority = 'low' | 'normal' | 'high' | 'urgent';
export type Incoterms = 
  | 'EXW' | 'FCA' | 'CPT' | 'CIP' | 'DAP' | 'DPU' | 'DDP'
  | 'FAS' | 'FOB' | 'CFR' | 'CIF';

// Document Types
export type DocumentType = 
  | 'commercial_invoice'
  | 'packing_list'
  | 'coo_draft'
  | 'shipping_bill_draft'
  | 'lc_document_package'
  | 'other';

export type DocumentStatus = 'pending' | 'generated' | 'reviewed' | 'approved' | 'edited' | 'rejected';

// Compliance Types
export type ComplianceListSource = 
  | 'OFAC' | 'UN' | 'EU' | 'India_DGFT' | 'India_Customs' | 'India_RBI' | 'other';

export type ComplianceSeverity = 'low' | 'medium' | 'high' | 'critical';
export type ComplianceMatchResult = 'exact_match' | 'fuzzy_match' | 'partial_match' | 'no_match';
export type CompliancePartyType = 'buyer' | 'consignee' | 'shipper' | 'notify_party' | 'other';
export type ComplianceStatus = 'pending' | 'reviewed' | 'acknowledged' | 'resolved' | 'false_positive' | 'escalated';

// Buyer Types
export type BuyerRiskCategory = 'low' | 'medium' | 'high' | 'critical';
export type BuyerVerificationStatus = 'pending' | 'verified' | 'rejected' | 'flagged';

// Classification Types
export type ClassificationMethod = 'rules_based' | 'ml_model' | 'manual_override' | 'hybrid';
export type ClassificationStatus = 'pending' | 'reviewed' | 'approved' | 'rejected' | 'overridden';

// Approval Types
export type ApprovalTargetType = 'document' | 'compliance_screen' | 'buyer_risk' | 'classification' | 'shipment';
export type ApprovalDecision = 'approved' | 'rejected' | 'edited' | 'acknowledged';

// Agent Types
export type AgentType = 'documentation' | 'compliance' | 'buyer_verification' | 'customs_intelligence';
export type AgentStatus = 'pending' | 'processing' | 'completed' | 'failed';

// ERP Types
export type ERPType = 'tally' | 'zoho_books' | 'sap_b1' | 'other';
export type ERPStatus = 'inactive' | 'active' | 'testing' | 'error';

// Payment Types
export type PaymentMethod = 'lc' | 'tt' | 'dd' | 'open_account' | 'cash' | 'other';
export type PaymentStatus = 'pending' | 'received' | 'overdue' | 'partial' | 'failed' | 'refunded';

// Policy Alert Types
export type PolicySource = 'DGFT' | 'RBI' | 'Customs' | 'FEMA' | 'other';
export type PolicyStatus = 'active' | 'expired' | 'withdrawn';
export type PolicySeverity = 'low' | 'medium' | 'high' | 'critical';

// Notification Types
export type NotificationChannel = 'email' | 'sms' | 'push' | 'in_app';
export type NotificationFrequency = 'immediate' | 'daily' | 'weekly' | 'never';

// Audit Types
export type ActorType = 'agent' | 'human' | 'system';

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
  filter?: Record<string, any>;
}

// Tenant Interface
export interface Tenant {
  id: string;
  name: string;
  email: string;
  tier: TenantTier;
  deployment_mode: DeploymentMode;
  subscription_status: SubscriptionStatus;
  plan_limits: Record<string, any>;
  usage_metrics: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

// User Interface
export interface User {
  id: string;
  tenant_id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  status: UserStatus;
  phone?: string;
  avatar_url?: string;
  preferences: Record<string, any>;
  last_login_at?: Date;
  created_at: Date;
  updated_at: Date;
}

// Buyer Interface
export interface Buyer {
  id: string;
  tenant_id: string;
  name: string;
  registration_no?: string;
  gstin?: string;
  pan?: string;
  country: string;
  city?: string;
  state?: string;
  address?: string;
  pincode?: string;
  email?: string;
  phone?: string;
  website?: string;
  business_type?: string;
  risk_score: number;
  risk_score_history: any[];
  risk_category: BuyerRiskCategory;
  payment_terms?: string;
  credit_limit?: number;
  currency: string;
  first_shipment_date?: Date;
  last_shipment_date?: Date;
  total_shipments: number;
  total_value: number;
  payment_history: any[];
  verification_status: BuyerVerificationStatus;
  verification_notes?: string;
  external_data: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

// Shipment Interface
export interface Shipment {
  id: string;
  tenant_id: string;
  shipment_number: string;
  stage: ShipmentStage;
  source_invoice_id?: string;
  buyer_id?: string;
  consignee_id?: string;
  
  // Invoice details
  invoice_number?: string;
  invoice_date?: Date;
  invoice_value: number;
  currency: string;
  incoterms?: Incoterms;
  payment_terms?: string;
  
  // Shipment details
  origin_port?: string;
  destination_port?: string;
  vessel_name?: string;
  voyage_number?: string;
  etd?: Date;
  eta?: Date;
  shipping_line?: string;
  
  // Product details
  product_description?: string;
  product_category?: string;
  quantity: number;
  unit?: string;
  unit_price: number;
  total_value: number;
  
  // Status
  status: ShipmentStatus;
  priority: ShipmentPriority;
  notes?: string;
  internal_notes?: string;
  
  // Agent statuses
  document_generation_status: string;
  compliance_screening_status: string;
  buyer_verification_status: string;
  customs_classification_status: string;
  
  // Metadata
  created_by?: string;
  updated_by?: string;
  created_at: Date;
  updated_at: Date;
}

// Document Interface
export interface Document {
  id: string;
  shipment_id: string;
  tenant_id: string;
  type: DocumentType;
  status: DocumentStatus;
  generated_by_agent_version?: string;
  storage_ref: string;
  file_name: string;
  file_size?: number;
  mime_type?: string;
  content?: string;
  discrepancy_flags: any[];
  validation_errors: any[];
  confidence_score?: number;
  generated_at?: Date;
  reviewed_by?: string;
  reviewed_at?: Date;
  approved_by?: string;
  approved_at?: Date;
  created_at: Date;
  updated_at: Date;
}

// Compliance Screen Interface
export interface ComplianceScreen {
  id: string;
  shipment_id: string;
  tenant_id: string;
  party_ref: string;
  party_type: CompliancePartyType;
  list_source: ComplianceListSource;
  match_result: ComplianceMatchResult;
  match_score?: number;
  severity: ComplianceSeverity;
  citation_ref: string;
  citation_text?: string;
  flag_description?: string;
  recommended_action?: string;
  status: ComplianceStatus;
  resolved_by?: string;
  resolved_at?: Date;
  resolution_notes?: string;
  created_at: Date;
  updated_at: Date;
}

// Classification Interface
export interface Classification {
  id: string;
  shipment_id: string;
  tenant_id: string;
  hs_code: string;
  hs_code_description?: string;
  confidence: number;
  ambiguity_flag: boolean;
  duty_rate: number;
  cess_rate: number;
  total_duty_rate: number;
  duty_estimate: number;
  landed_cost_estimate: number;
  eta_estimate_days: number;
  clearance_time_prediction?: string;
  port_congestion_flag: boolean;
  classification_method: ClassificationMethod;
  classification_notes?: string;
  status: ClassificationStatus;
  reviewed_by?: string;
  reviewed_at?: Date;
  approved_by?: string;
  approved_at?: Date;
  created_at: Date;
  updated_at: Date;
}

// Policy Alert Interface
export interface PolicyAlert {
  id: string;
  tenant_id: string;
  source: PolicySource;
  alert_type: string;
  title: string;
  description: string;
  relevance_tags: string[];
  published_at: Date;
  effective_from?: Date;
  effective_to?: Date;
  status: PolicyStatus;
  severity: PolicySeverity;
  citation_url?: string;
  citation_text?: string;
  affected_products?: string[];
  affected_countries?: string[];
  action_required?: string;
  last_updated: Date;
  created_at: Date;
}

// Audit Log Interface
export interface AuditLog {
  id: string;
  shipment_id?: string;
  tenant_id: string;
  actor_type: ActorType;
  actor_ref: string;
  action: string;
  input_ref: Record<string, any>;
  output_ref: Record<string, any>;
  decision?: string;
  confidence?: number;
  agent_version?: string;
  model_version?: string;
  prompt_version?: string;
  metadata: Record<string, any>;
  ip_address?: string;
  user_agent?: string;
  created_at: Date;
}

// Approval Interface
export interface Approval {
  id: string;
  shipment_id: string;
  tenant_id: string;
  target_type: ApprovalTargetType;
  target_id: string;
  approver_id: string;
  decision: ApprovalDecision;
  comments?: string;
  changes: Record<string, any>;
  created_at: Date;
}

// Invoice Ingestion Interface
export interface InvoiceIngestion {
  id: string;
  shipment_id: string;
  tenant_id: string;
  source_type: string;
  source_ref?: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
  storage_path?: string;
  ingestion_status: string;
  parsing_result: Record<string, any>;
  error_message?: string;
  processed_by_agent_version?: string;
  created_at: Date;
  updated_at: Date;
}

// Payment Interface
export interface Payment {
  id: string;
  shipment_id: string;
  tenant_id: string;
  buyer_id: string;
  payment_date: Date;
  amount: number;
  currency: string;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  lc_number?: string;
  lc_issuing_bank?: string;
  lc_expiry_date?: Date;
  days_overdue: number;
  payment_notes?: string;
  created_at: Date;
  updated_at: Date;
}

// ERP Connector Interface
export interface ERPConnector {
  id: string;
  tenant_id: string;
  erp_type: ERPType;
  name: string;
  config: Record<string, any>;
  api_key?: string;
  api_secret?: string;
  endpoint_url?: string;
  status: ERPStatus;
  last_sync_at?: Date;
  sync_frequency_minutes: number;
  last_error?: string;
  created_at: Date;
  updated_at: Date;
}

// Agent Output Interface
export interface AgentOutput {
  agent: AgentType;
  version: string;
  confidence: number;
  data: Record<string, any>;
  discrepancies: any[];
  warnings: string[];
  errors: string[];
  timestamp: Date;
}

// Shipment Progress Interface
export interface ShipmentProgress {
  shipment_id: string;
  stage: ShipmentStage;
  status: ShipmentStatus;
  documentation: {
    status: string;
    total_documents: number;
    approved_documents: number;
  };
  compliance: {
    status: string;
    total_flags: number;
    resolved_flags: number;
    critical_flags: number;
  };
  buyer_verification: {
    status: string;
    risk_score: number;
    risk_category: BuyerRiskCategory;
  };
  customs_classification: {
    status: string;
    hs_code?: string;
    confidence?: number;
    duty_estimate?: number;
  };
  can_advance: boolean;
  next_stage?: ShipmentStage;
}

// Dashboard Stats Interface
export interface DashboardStats {
  total_shipments: number;
  filed_shipments: number;
  ready_to_file_shipments: number;
  on_hold_shipments: number;
  total_invoice_value: number;
  avg_duty_estimate?: number;
  unique_buyers: number;
  recent_shipments: Shipment[];
  compliance_summary: {
    total_flags: number;
    by_severity: Record<ComplianceSeverity, number>;
  };
  buyer_risk_distribution: Record<BuyerRiskCategory, number>;
}

// Request Types
export interface CreateShipmentRequest {
  buyer_id?: string;
  consignee_id?: string;
  invoice_number?: string;
  invoice_date?: Date;
  invoice_value: number;
  currency?: string;
  incoterms?: Incoterms;
  payment_terms?: string;
  origin_port?: string;
  destination_port?: string;
  vessel_name?: string;
  voyage_number?: string;
  etd?: Date;
  eta?: Date;
  shipping_line?: string;
  product_description?: string;
  product_category?: string;
  quantity: number;
  unit?: string;
  unit_price: number;
  priority?: ShipmentPriority;
  notes?: string;
}

export interface UpdateShipmentRequest {
  stage?: ShipmentStage;
  status?: ShipmentStatus;
  priority?: ShipmentPriority;
  notes?: string;
  internal_notes?: string;
  // Other fields that can be updated
}

export interface ApproveRequest {
  target_type: ApprovalTargetType;
  target_id: string;
  decision: ApprovalDecision;
  comments?: string;
  changes?: Record<string, any>;
}

export interface GenerateDocumentsRequest {
  template_id?: string;
  regenerate?: boolean;
  include_types?: DocumentType[];
}

export interface ScreenComplianceRequest {
  party_ref: string;
  party_type: CompliancePartyType;
  force_rescreen?: boolean;
}

export interface ClassifyRequest {
  product_description: string;
  product_category?: string;
  destination_port?: string;
  force_reclassify?: boolean;
}

export interface SearchRequest {
  query: string;
  filters?: Record<string, any>;
  page?: number;
  pageSize?: number;
}

export default {
  // Tenant types
  TenantTier,
  DeploymentMode,
  SubscriptionStatus,
  
  // User types
  UserRole,
  UserStatus,
  
  // Shipment types
  ShipmentStage,
  ShipmentStatus,
  ShipmentPriority,
  Incoterms,
  
  // Document types
  DocumentType,
  DocumentStatus,
  
  // Compliance types
  ComplianceListSource,
  ComplianceSeverity,
  ComplianceMatchResult,
  CompliancePartyType,
  ComplianceStatus,
  
  // Buyer types
  BuyerRiskCategory,
  BuyerVerificationStatus,
  
  // Classification types
  ClassificationMethod,
  ClassificationStatus,
  
  // Approval types
  ApprovalTargetType,
  ApprovalDecision,
  
  // Agent types
  AgentType,
  AgentStatus,
  
  // ERP types
  ERPType,
  ERPStatus,
  
  // Payment types
  PaymentMethod,
  PaymentStatus,
  
  // Policy types
  PolicySource,
  PolicyStatus,
  PolicySeverity,
  
  // Notification types
  NotificationChannel,
  NotificationFrequency,
  
  // Audit types
  ActorType,
};
