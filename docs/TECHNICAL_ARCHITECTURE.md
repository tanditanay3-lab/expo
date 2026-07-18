# Consign AI - Technical Architecture

## Overview

Consign AI is built as a **deterministic, auditable orchestrator** that invokes four narrowly-scoped, tool-using AI agents as bounded workers. This architecture ensures:

1. **Predictable behavior** - Shipment lifecycle follows a fixed state machine
2. **Auditability** - Every action is logged with full context
3. **Safety** - Human-in-the-loop for critical decisions
4. **Scalability** - Multi-tenant from day one
5. **Compliance** - Meets regulatory requirements for trade documentation

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Consign AI SaaS                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    Presentation Layer                          │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │ │
│  │  │   Next.js   │  │   React     │  │   Dashboard UI      │  │ │
│  │  │   Frontend  │  │   Components│  │   Review Queues     │  │ │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘  │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                    │                                 │
│                                    ▼                                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    API Layer (Express)                         │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │ │
│  │  │  REST API   │  │  Auth       │  │   Middleware        │  │ │
│  │  │  Endpoints  │  │  JWT        │  │   Validation        │  │ │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘  │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                    │                                 │
│                                    ▼                                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                 Orchestration Layer (Consign Core)            │ │
│  │  ┌─────────────────────────────────────────────────────────┐ │ │
│  │  │                    Shipment State Machine                  │ │ │
│  │  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────┐  │ │ │
│  │  │  │  Draft  │─▶│Documents│─▶│Compliance│─▶│Buyer Verified│  │ │ │
│  │  │  └─────────┘  └─────────┘  └─────────┘  └─────────────┘  │ │ │
│  │  │                    │         │         │         │        │ │ │
│  │  │                    ▼         ▼         ▼         ▼        │ │ │
│  │  │              ┌─────────────────────────────────┐       │ │ │
│  │  │              │       Ready to File               │       │ │ │
│  │  │              └─────────────────────────────────┘       │ │ │
│  │  │                    │                                    │ │ │
│  │  │                    ▼                                    │ │ │
│  │  │              ┌─────────────────────────────────┐       │ │ │
│  │  │              │          Filed (Terminal)          │       │ │ │
│  │  │              └─────────────────────────────────┘       │ │ │
│  │  └─────────────────────────────────────────────────────────┘ │ │
│  │                                                                  │ │
│  │  ┌─────────────────────────────────────────────────────────┐ │ │
│  │  │                    Audit Logger                          │ │ │
│  │  │  - Append-only log of all actions                        │ │ │
│  │  │  - Agent actions, human decisions, system events        │ │ │
│  │  │  - Exportable for compliance reporting                  │ │ │
│  │  └─────────────────────────────────────────────────────────┘ │ │
│  │                                                                  │ │
│  │  ┌─────────────────────────────────────────────────────────┐ │ │
│  │  │                    Approval System                        │ │ │
│  │  │  - Human-in-the-loop for critical decisions              │ │ │
│  │  │  - Document approvals, compliance flags, buyer risk      │ │ │
│  │  │  - Classification approvals                              │ │ │
│  │  └─────────────────────────────────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                    │                                 │
│                                    ▼                                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    Agent Workers                              │ │
│  │  ┌─────────────────┐  ┌─────────────────┐                   │ │
│  │  │ Documentation   │  │ Compliance       │                   │ │
│  │  │ Agent           │  │ Agent           │                   │ │
│  │  │                 │  │                 │                   │ │
│  │  │ - Invoice OCR   │  │ - Sanctions      │                   │ │
│  │  │ - Template fill │  │   screening      │                   │ │
│  │  │ - Validation    │  │ - Policy alerts  │                   │ │
│  │  │ - Cross-check   │  │ - DGFT/RBI       │                   │ │
│  │  └─────────────────┘  └─────────────────┘                   │ │
│  │                                                                  │ │
│  │  ┌─────────────────┐  ┌─────────────────┐                   │ │
│  │  │ Buyer           │  │ Customs          │                   │ │
│  │  │ Verification    │  │ Intelligence     │                   │ │
│  │  │ Agent           │  │ Agent           │                   │ │
│  │  │                 │  │                 │                   │ │
│  │  │ - Risk scoring  │  │ - HS code       │                   │ │
│  │  │ - Credit checks  │  │   classification │                   │ │
│  │  │ - Payment hist   │  │ - Duty calc     │                   │ │
│  │  │ - Trade refs     │  │ - Clearance     │                   │ │
│  │  │                 │  │   prediction    │                   │ │
│  │  └─────────────────┘  └─────────────────┘                   │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                    │                                 │
│                                    ▼                                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    Data Layer                                │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │ │
│  │  │ PostgreSQL  │  │   Redis     │  │   Object Storage    │  │ │
│  │  │ - Tenants   │  │ - Queue     │  │   - Documents       │  │ │
│  │  │ - Shipments │  │ - Cache     │  │   - Invoices        │  │ │
│  │  │ - Buyers    │  │ - Sessions  │  │   - Reports         │  │ │
│  │  │ - Documents │  │             │  │                     │  │ │
│  │  │ - Compliance│  │             │  │                     │  │ │
│  │  │ - Audit Log │  │             │  │                     │  │ │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘  │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    Integration Layer                           │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │ │
│  │  │  Tally      │  │  ICEGATE    │  │   External APIs     │  │ │
│  │  │  Connector  │  │  (Read-only)│  │   - Sanctions lists │  │ │
│  │  └─────────────┘  └─────────────┘  │   - Credit bureaus   │  │ │
│  │                                          │   - Corporate reg.  │  │ │
│  │                                          └─────────────────────┘  │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **LLM & Tool Use** | Claude (Anthropic Messages API) | AI agent execution with tool use |
| **Orchestration** | Custom Node/TypeScript state machine | Shipment lifecycle management |
| **Structured Data** | PostgreSQL 14+ | Primary database with row-level security |
| **Vector Search** | pgvector | Regulation RAG for Compliance Agent |
| **Document Generation** | Template engine + PDF generation | Deterministic document creation |
| **Job Queue** | BullMQ + Redis | Background job processing |
| **Connector Jobs** | n8n (future) | ERP and external system integrations |
| **Frontend** | Next.js + React | User interface and dashboards |
| **Auth & Tenancy** | JWT + Row-level PostgreSQL | Authentication and multi-tenancy |

## Core Components

### 1. Consign Core (Orchestration Layer)

#### Shipment State Machine

The state machine is the backbone of the system, managing the shipment lifecycle through seven stages:

```typescript
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
```

#### Key Features:

- **Deterministic Transitions**: Each stage transition is gated by explicit checks
- **No Autonomous Decisions**: LLMs don't decide stage transitions
- **Human-in-the-Loop**: Critical decisions require explicit approval
- **Audit Trail**: Every transition is logged with full context

#### State Machine Methods:

```typescript
// Get current stage
async getCurrentStage(shipmentId: string): Promise<ShipmentStage>

// Check if can advance
async canAdvance(shipmentId: string): Promise<{ canAdvance: boolean; nextStage?: ShipmentStage; missingChecks: string[] }>

// Advance to next stage
async advanceStage(shipmentId: string, userId: string): Promise<{ success: boolean; fromStage: ShipmentStage; toStage: ShipmentStage }>

// Force advance (admin override)
async forceAdvanceStage(shipmentId: string, userId: string, overrideReason?: string): Promise<{ success: boolean; fromStage: ShipmentStage; toStage: ShipmentStage }>

// Mark as filed
async markAsFiled(shipmentId: string, userId: string): Promise<boolean>

// Get shipment status
async getShipmentStatus(shipmentId: string): Promise<ShipmentStatus>

// Get shipment progress
async getShipmentProgress(shipmentId: string): Promise<ShipmentProgress>
```

### 2. Audit Logger

The audit logger ensures complete traceability of all actions:

```typescript
interface AuditLogInput {
  shipmentId?: string;
  tenantId: string;
  actorType: ActorType; // 'agent' | 'human' | 'system'
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
```

#### Key Features:

- **Append-only**: No updates or deletes to audit log entries
- **Comprehensive**: Logs agent actions, human decisions, system events
- **Searchable**: Full-text search and filtering capabilities
- **Exportable**: JSON export for compliance reporting
- **Tenant-isolated**: Each tenant can only see their own audit logs

#### Audit Logger Methods:

```typescript
// Log any action
async log(entry: AuditLogInput): Promise<AuditLog>

// Log agent action
async logAgentAction(...): Promise<AuditLog>

// Log human action
async logHumanAction(...): Promise<AuditLog>

// Log system action
async logSystemAction(...): Promise<AuditLog>

// Get audit logs
async getShipmentAuditLog(shipmentId: string, tenantId: string): Promise<AuditLog[]>
async getTenantAuditLog(tenantId: string, options: {...}): Promise<{ logs: AuditLog[]; total: number }>

// Export audit trail
async exportShipmentAuditLog(shipmentId: string, tenantId: string): Promise<{ shipmentNumber: string; auditTrail: any[] }>
```

### 3. Approval System

The approval system enforces human-in-the-loop for critical decisions:

```typescript
interface ApprovalRequest {
  shipmentId: string;
  tenantId: string;
  targetType: ApprovalTargetType; // 'document' | 'compliance_screen' | 'buyer_risk' | 'classification' | 'shipment'
  targetId: string;
  approverId: string;
  decision: ApprovalDecision; // 'approved' | 'rejected' | 'edited' | 'acknowledged'
  comments?: string;
  changes?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}
```

#### Key Features:

- **Target-specific Approvals**: Different approval types for different objects
- **Decision Tracking**: Records what was decided and by whom
- **Change Tracking**: Captures changes made during editing
- **Revocation**: Allows revoking approvals with proper authorization
- **Pending Approvals**: Tracks what needs approval for a shipment to advance

#### Approval System Methods:

```typescript
// Record an approval
async recordApproval(request: ApprovalRequest): Promise<Approval>

// Get approvals
async getShipmentApprovals(shipmentId: string, tenantId: string): Promise<Approval[]>
async getTargetApprovals(shipmentId: string, targetType: ApprovalTargetType, targetId: string): Promise<Approval[]>

// Check approval status
async isApproved(shipmentId: string, targetType: ApprovalTargetType, targetId: string): Promise<boolean>
async isRejected(shipmentId: string, targetType: ApprovalTargetType, targetId: string): Promise<boolean>

// Get pending approvals
async getPendingApprovals(shipmentId: string, tenantId: string): Promise<Array<{ targetType: ApprovalTargetType; targetId: string; targetDetails: any; required: boolean }>>

// Revoke an approval
async revokeApproval(approvalId: string, userId: string, reason?: string): Promise<boolean>

// Get approval statistics
async getApprovalStats(tenantId: string): Promise<{ totalApprovals: number; byType: Record<ApprovalTargetType, number>; byDecision: Record<ApprovalDecision, number>; pendingApprovals: number; recentApprovals: Approval[] }>
```

## Agent Architecture

### Base Agent Class

All agents inherit from the `BaseAgent` class which provides:

```typescript
abstract class BaseAgent {
  protected config: AgentConfig;
  protected status: AgentStatus;
  protected startTime: number;

  // Abstract methods
  abstract getAgentType(): AgentType;
  abstract execute(shipmentId: string, tenantId: string, options?: Record<string, any>): Promise<AgentResult>;

  // Common functionality
  protected startExecution(): void;
  protected endExecution<T>(result: AgentResult<T>): AgentResult<T>;
  protected logAction(...): Promise<void>;
  protected canExecute(shipmentId: string): Promise<boolean>;
  protected getRequiredStage(): string | null;
  protected validateInput(input: Record<string, any>): { valid: boolean; errors: string[] };
  protected handleError(error: Error, context: string): AgentResult;
  protected getShipmentData(shipmentId: string): Promise<Shipment | null>;
  protected getBuyerData(buyerId: string): Promise<Buyer | null>;
  protected updateShipmentAgentStatus(shipmentId: string, statusField: string, status: string): Promise<void>;
  protected checkConfidence(confidence: number): boolean;
  protected generateOutput<T>(data: T, confidence: number, discrepancies?: any[], warnings?: string[], errors?: string[]): AgentResult<T>;
}
```

### Agent Factory

The `AgentFactory` manages agent instances and provides a unified interface:

```typescript
class AgentFactory {
  private static agents: Map<AgentType, BaseAgent> = new Map();

  static registerAgent(agentType: AgentType, agent: BaseAgent): void;
  static getAgent(agentType: AgentType): BaseAgent | undefined;
  static getAllAgents(): Map<AgentType, BaseAgent>;
  static async executeAgent(agentType: AgentType, shipmentId: string, tenantId: string, options?: Record<string, any>): Promise<AgentResult>;
}
```

### Documentation Agent

**Purpose**: Generate all required shipment documents from invoice data

**Capabilities**:
- Invoice parsing (PDF, Excel, manual entry)
- Document generation (5 types)
- Cross-field validation
- Template-based generation
- Confidence scoring

**Document Types**:
1. Commercial Invoice
2. Packing List
3. Certificate of Origin (Draft)
4. Shipping Bill (Draft)
5. LC Document Package

**Validation Rules**:
- Invoice value matches total (quantity × unit price)
- Positive quantity and unit price
- Valid currency code (ISO 4217)
- Valid Incoterms
- Cross-field consistency checks

### Compliance Agent

**Purpose**: Screen parties against sanctions lists and monitor policy changes

**Capabilities**:
- Sanctions list screening (OFAC, UN, EU, India DGFT, India Customs, India RBI)
- Fuzzy name matching
- Policy alert monitoring (DGFT, RBI, Customs, FEMA)
- Scheduled re-screening
- Severity-based flagging

**Sanctions Lists**:
- OFAC (Office of Foreign Assets Control)
- UN (United Nations)
- EU (European Union)
- India DGFT (Directorate General of Foreign Trade)
- India Customs
- India RBI (Reserve Bank of India)

**Severity Levels**:
- Critical: Immediate action required
- High: Requires senior management approval
- Medium: Review recommended
- Low: No action required

### Buyer Verification Agent

**Purpose**: Assess buyer risk based on multiple data sources

**Capabilities**:
- Risk scoring with defined rubric
- Payment history tracking
- Credit bureau integration
- Corporate registry lookup
- Trade reference aggregation
- Risk category classification

**Risk Scoring Rubric**:

| Component | Weight | Description |
|-----------|--------|-------------|
| Payment History | 35% | On-time payments, late payments, defaults |
| Credit Rating | 25% | Credit score and rating from bureaus |
| Business Longevity | 15% | Years in business, registration date |
| Financial Health | 15% | Revenue, profitability, credit utilization |
| Trade References | 5% | Positive/negative references from other traders |
| External Data Quality | 5% | Availability and quality of external data |

**Risk Categories**:
- Low: Score ≥ 70
- Medium: Score ≥ 50
- High: Score ≥ 30
- Critical: Score < 30

### Customs Intelligence Agent

**Purpose**: Classify products and predict customs-related information

**Capabilities**:
- HS code classification (rules-based + ML)
- Duty and cess calculation
- Landed cost estimation
- Clearance time prediction
- Port congestion monitoring

**HS Code Database**:
- Chapter-level classification
- Heading and subheading details
- Country-specific duty rates
- Restrictions and required documents
- Historical classification data

**Classification Methods**:
1. Rules-based: Exact and keyword matching
2. ML Model: Statistical classification
3. Manual Override: Human-provided classification
4. Hybrid: Combination of methods

**Clearance Time Prediction**:
- Historical data by port and HS code
- Current port congestion levels
- Seasonal patterns
- Confidence scoring

## Database Design

### Core Tables

#### 1. Tenants

```sql
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    tier VARCHAR(50) NOT NULL CHECK (tier IN ('starter', 'growth', 'scale', 'enterprise')),
    deployment_mode VARCHAR(50) NOT NULL DEFAULT 'saas' CHECK (deployment_mode IN ('saas', 'vpc', 'on_prem')),
    subscription_status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (subscription_status IN ('active', 'trial', 'suspended', 'cancelled')),
    plan_limits JSONB NOT NULL DEFAULT '{"shipments": 20, "documents": 100, "users": 1}'::jsonb,
    usage_metrics JSONB NOT NULL DEFAULT '{"shipments": 0, "documents": 0}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

#### 2. Users

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    role VARCHAR(50) NOT NULL DEFAULT 'user' CHECK (role IN ('owner', 'admin', 'compliance_manager', 'finance', 'user', 'read_only')),
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
    preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

#### 3. Buyers

```sql
CREATE TABLE buyers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    registration_no VARCHAR(100),
    gstin VARCHAR(50),
    pan VARCHAR(50),
    country VARCHAR(100) NOT NULL,
    city VARCHAR(100),
    state VARCHAR(100),
    address TEXT,
    pincode VARCHAR(20),
    email VARCHAR(255),
    phone VARCHAR(20),
    website VARCHAR(255),
    business_type VARCHAR(100),
    risk_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    risk_score_history JSONB NOT NULL DEFAULT '[]'::jsonb,
    risk_category VARCHAR(50) NOT NULL DEFAULT 'low' CHECK (risk_category IN ('low', 'medium', 'high', 'critical')),
    payment_terms VARCHAR(100),
    credit_limit DECIMAL(15,2),
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    verification_status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected', 'flagged')),
    verification_notes TEXT,
    external_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

#### 4. Shipments

```sql
CREATE TABLE shipments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    shipment_number VARCHAR(100) NOT NULL,
    stage VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (stage IN ('draft', 'documents_generated', 'compliance_screened', 'buyer_verified', 'customs_classified', 'ready_to_file', 'filed', 'cancelled')),
    source_invoice_id UUID,
    buyer_id UUID REFERENCES buyers(id) ON DELETE SET NULL,
    consignee_id UUID REFERENCES buyers(id) ON DELETE SET NULL,
    invoice_number VARCHAR(100),
    invoice_date DATE,
    invoice_value DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    incoterms VARCHAR(10) CHECK (incoterms IN ('EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF')),
    payment_terms VARCHAR(100),
    origin_port VARCHAR(100),
    destination_port VARCHAR(100),
    vessel_name VARCHAR(100),
    voyage_number VARCHAR(100),
    etd DATE,
    eta DATE,
    shipping_line VARCHAR(100),
    product_description TEXT,
    product_category VARCHAR(100),
    quantity DECIMAL(15,3) NOT NULL DEFAULT 0,
    unit VARCHAR(20),
    unit_price DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    total_value DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'on_hold', 'completed', 'cancelled')),
    priority VARCHAR(20) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    notes TEXT,
    internal_notes TEXT,
    document_generation_status VARCHAR(50) DEFAULT 'pending',
    compliance_screening_status VARCHAR(50) DEFAULT 'pending',
    buyer_verification_status VARCHAR(50) DEFAULT 'pending',
    customs_classification_status VARCHAR(50) DEFAULT 'pending',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

#### 5. Documents

```sql
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL CHECK (type IN ('commercial_invoice', 'packing_list', 'coo_draft', 'shipping_bill_draft', 'lc_document_package', 'other')),
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generated', 'reviewed', 'approved', 'edited', 'rejected')),
    generated_by_agent_version VARCHAR(50),
    storage_ref VARCHAR(255) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_size INTEGER,
    mime_type VARCHAR(100),
    content TEXT,
    discrepancy_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
    validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
    confidence_score DECIMAL(5,2),
    generated_at TIMESTAMP WITH TIME ZONE,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

#### 6. Compliance Screens

```sql
CREATE TABLE compliance_screens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    party_ref VARCHAR(255) NOT NULL,
    party_type VARCHAR(50) NOT NULL CHECK (party_type IN ('buyer', 'consignee', 'shipper', 'notify_party', 'other')),
    list_source VARCHAR(100) NOT NULL CHECK (list_source IN ('OFAC', 'UN', 'EU', 'India_DGFT', 'India_Customs', 'India_RBI', 'other')),
    match_result VARCHAR(50) NOT NULL CHECK (match_result IN ('exact_match', 'fuzzy_match', 'partial_match', 'no_match')),
    match_score DECIMAL(5,2),
    severity VARCHAR(50) NOT NULL DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    citation_ref VARCHAR(500) NOT NULL,
    citation_text TEXT,
    flag_description TEXT,
    recommended_action TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'acknowledged', 'resolved', 'false_positive', 'escalated')),
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

#### 7. Classifications

```sql
CREATE TABLE classifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    hs_code VARCHAR(20) NOT NULL,
    hs_code_description TEXT,
    confidence DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    ambiguity_flag BOOLEAN NOT NULL DEFAULT FALSE,
    duty_rate DECIMAL(10,4) NOT NULL DEFAULT 0.0000,
    cess_rate DECIMAL(10,4) NOT NULL DEFAULT 0.0000,
    total_duty_rate DECIMAL(10,4) NOT NULL DEFAULT 0.0000,
    duty_estimate DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    landed_cost_estimate DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    eta_estimate_days INTEGER NOT NULL DEFAULT 0,
    clearance_time_prediction TEXT,
    port_congestion_flag BOOLEAN NOT NULL DEFAULT FALSE,
    classification_method VARCHAR(50) NOT NULL DEFAULT 'rules_based' CHECK (classification_method IN ('rules_based', 'ml_model', 'manual_override', 'hybrid')),
    classification_notes TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'approved', 'rejected', 'overridden')),
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

#### 8. Audit Log

```sql
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID REFERENCES shipments(id) ON DELETE SET NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    actor_type VARCHAR(50) NOT NULL CHECK (actor_type IN ('agent', 'human', 'system')),
    actor_ref VARCHAR(255) NOT NULL,
    action VARCHAR(100) NOT NULL,
    input_ref JSONB NOT NULL DEFAULT '{}'::jsonb,
    output_ref JSONB NOT NULL DEFAULT '{}'::jsonb,
    decision VARCHAR(255),
    confidence DECIMAL(5,2),
    agent_version VARCHAR(50),
    model_version VARCHAR(50),
    prompt_version VARCHAR(50),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

#### 9. Approvals

```sql
CREATE TABLE approvals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    target_type VARCHAR(50) NOT NULL CHECK (target_type IN ('document', 'compliance_screen', 'buyer_risk', 'classification', 'shipment')),
    target_id UUID NOT NULL,
    approver_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    decision VARCHAR(50) NOT NULL CHECK (decision IN ('approved', 'rejected', 'edited', 'acknowledged')),
    comments TEXT,
    changes JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

### Supporting Tables

#### 10. Policy Alerts

```sql
CREATE TABLE policy_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    source VARCHAR(100) NOT NULL CHECK (source IN ('DGFT', 'RBI', 'Customs', 'FEMA', 'other')),
    alert_type VARCHAR(100) NOT NULL,
    title VARCHAR(500) NOT NULL,
    description TEXT NOT NULL,
    relevance_tags VARCHAR(255)[] NOT NULL DEFAULT '{}'::varchar[],
    published_at TIMESTAMP WITH TIME ZONE NOT NULL,
    effective_from TIMESTAMP WITH TIME ZONE,
    effective_to TIMESTAMP WITH TIME ZONE,
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'withdrawn')),
    severity VARCHAR(50) NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    citation_url VARCHAR(500),
    citation_text TEXT,
    affected_products TEXT[],
    affected_countries VARCHAR(255)[],
    action_required TEXT,
    last_updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

#### 11. Sanctions Lists

```sql
CREATE TABLE sanctions_lists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    list_name VARCHAR(100) NOT NULL,
    list_source VARCHAR(100) NOT NULL,
    entry_id VARCHAR(255) NOT NULL,
    name VARCHAR(500) NOT NULL,
    entity_type VARCHAR(100),
    country VARCHAR(100),
    address TEXT,
    remarks TEXT,
    listing_date DATE,
    last_updated DATE,
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'removed')),
    embedding vector(1536),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

#### 12. Regulation Corpus (for RAG)

```sql
CREATE TABLE regulation_corpus (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source VARCHAR(100) NOT NULL CHECK (source IN ('DGFT', 'RBI', 'Customs', 'FEMA', 'UN', 'OFAC', 'EU', 'other')),
    document_id VARCHAR(255) NOT NULL,
    title VARCHAR(500) NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    published_at TIMESTAMP WITH TIME ZONE,
    effective_from TIMESTAMP WITH TIME ZONE,
    effective_to TIMESTAMP WITH TIME ZONE,
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'withdrawn')),
    last_updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

### Row-Level Security

PostgreSQL Row-Level Security (RLS) policies ensure tenant isolation:

```sql
-- Enable RLS on all tenant-specific tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyers ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_screens ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;

-- Create policies for each table
CREATE POLICY tenant_isolation_policy ON tenants USING (true);

CREATE POLICY user_tenant_policy ON users USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY buyer_tenant_policy ON buyers USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ... policies for all other tables

-- Function to set tenant context
CREATE OR REPLACE FUNCTION set_tenant_context(tenant_id uuid)
RETURNS void AS $$
BEGIN
    PERFORM set_config('app.current_tenant_id', tenant_id::text, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

## API Design

### RESTful Design Principles

1. **Resource-oriented**: Each entity has its own endpoint
2. **HTTP methods**: Proper use of GET, POST, PUT, DELETE
3. **Stateless**: No server-side session storage
4. **JSON responses**: Consistent response format
5. **Error handling**: Structured error responses

### Response Format

```typescript
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
```

### Authentication

- **JWT-based**: Stateless authentication with JSON Web Tokens
- **Bearer token**: `Authorization: Bearer <token>` header
- **Token expiry**: Configurable (default: 24 hours)
- **Refresh tokens**: Optional refresh token mechanism

### Rate Limiting

- **Per-tenant limits**: Rate limiting based on tenant tier
- **Per-endpoint limits**: Different limits for different endpoints
- **Sliding window**: Configurable time windows

## Background Processing

### Queue System (BullMQ + Redis)

The system uses BullMQ for background job processing:

```typescript
// Queue names
const QUEUE_NAMES = {
  DOCUMENT_GENERATION: 'document_generation',
  COMPLIANCE_SCREENING: 'compliance_screening',
  BUYER_VERIFICATION: 'buyer_verification',
  CUSTOMS_CLASSIFICATION: 'customs_classification',
  POLICY_MONITORING: 'policy_monitoring',
  SHIPMENT_PROCESSING: 'shipment_processing'
};
```

### Worker Types

1. **Document Generation Worker**: Generates documents for shipments
2. **Compliance Screening Worker**: Screens parties against sanctions lists
3. **Buyer Verification Worker**: Verifies buyer risk
4. **Customs Classification Worker**: Classifies products and calculates duties
5. **Policy Monitoring Worker**: Monitors for policy updates
6. **Shipment Processing Worker**: Runs all agents for a shipment

### Job Features

- **Retries**: Automatic retries with exponential backoff
- **Priority**: Job priority queues
- **Concurrency**: Configurable worker concurrency
- **Rate limiting**: Per-queue rate limiting
- **Error handling**: Comprehensive error logging

## Security Considerations

### Data Protection

1. **Encryption at rest**: Database encryption (recommended for production)
2. **Encryption in transit**: TLS for all external communications
3. **Password hashing**: bcrypt with salt
4. **Token security**: JWT with strong secrets and short expiry
5. **Sensitive data**: Masking of sensitive fields in logs and responses

### Access Control

1. **Role-based access**: Different permissions for different roles
2. **Tenant isolation**: Row-level security prevents cross-tenant access
3. **Resource ownership**: Users can only access their own resources
4. **Admin privileges**: Special permissions for admin users

### Audit & Compliance

1. **Immutable audit log**: Append-only, no updates or deletes
2. **Complete traceability**: Every action is logged with full context
3. **Exportable trails**: Audit trails can be exported for compliance
4. **Human-in-the-loop**: Critical decisions require explicit approval
5. **No auto-submission**: No automatic submission to government portals

## Performance Considerations

### Caching

1. **Sanctions lists**: Cached in memory with periodic refresh
2. **Policy data**: Cached with TTL
3. **HS code database**: Pre-loaded in memory
4. **Port data**: Cached for quick access

### Database Optimization

1. **Indexes**: Proper indexing on frequently queried columns
2. **Query optimization**: Efficient queries with proper joins
3. **Connection pooling**: PostgreSQL connection pooling
4. **Batch operations**: Bulk inserts and updates where possible

### Agent Performance

1. **Confidence thresholds**: Early termination for low-confidence results
2. **Parallel processing**: Run independent checks in parallel
3. **Caching**: Cache frequent agent outputs
4. **Timeouts**: Configurable timeouts for agent execution

## Scalability

### Horizontal Scaling

1. **Stateless API**: Can be scaled horizontally
2. **Queue workers**: Multiple workers can process jobs in parallel
3. **Database read replicas**: For read-heavy workloads
4. **Redis cluster**: For high-throughput queue processing

### Vertical Scaling

1. **Database**: Larger instances for database
2. **Redis**: Larger instances for caching and queues
3. **Workers**: More CPU/memory for worker processes

### Multi-Tenancy

1. **Shared infrastructure**: All tenants share the same infrastructure
2. **Isolation**: Row-level security ensures data isolation
3. **Resource limits**: Per-tenant resource limits based on tier
4. **Usage tracking**: Track usage for billing and limits

## Deployment Architecture

### Development Environment

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Client     │───▶│    API      │───▶│  PostgreSQL  │
└─────────────┘    └─────────────┘    └─────────────┘
                      │
                      ▼
                ┌─────────────┐
                │   Redis     │
                └─────────────┘
```

### Production Environment

```
┌─────────────┐    ┌─────────────────────────────────────────────┐
│   Clients    │───▶│                    Load Balancer              │
└─────────────┘    └─────────────────────────────────────────────┘
                     │                    │                    │
                     ▼                    ▼                    ▼
              ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
              │   API #1    │    │   API #2    │    │   API #3    │
              └─────────────┘    └─────────────┘    └─────────────┘
                     │                    │                    │
                     └────────────────────┬───────────────────┘
                                          │
                                          ▼
                              ┌─────────────────────────────┐
                              │        PostgreSQL            │
                              │   (Primary + Read Replicas)  │
                              └─────────────────────────────┘
                                          │
                                          ▼
                              ┌─────────────────────────────┐
                              │          Redis               │
                              │        (Cluster Mode)         │
                              └─────────────────────────────┘
                                          │
                                          ▼
                              ┌─────────────────────────────┐
                              │       Queue Workers          │
                              │   (Multiple Instances)       │
                              └─────────────────────────────┘
```

### Enterprise Deployment (On-Prem/VPC)

```
┌─────────────────────────────────────────────────────────────────┐
│                        Enterprise VPC                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │   Load      │    │    API      │    │   PostgreSQL        │  │
│  │   Balancer  │───▶│   Servers   │───▶│   (Dedicated)        │  │
│  └─────────────┘    └─────────────┘    └─────────────────────┘  │
│                      │                                          │
│                      ▼                                          │
│                ┌─────────────┐                                  │
│                │   Redis     │                                  │
│                └─────────────┘                                  │
│                      │                                          │
│                      ▼                                          │
│                ┌─────────────┐                                  │
│                │  Workers    │                                  │
│                └─────────────┘                                  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    Security Components                        │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │ │
│  │  │  Firewall   │  │   VPN       │  │   Monitoring        │  │ │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘  │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────┘
```

## Monitoring & Observability

### Metrics

1. **Application Metrics**:
   - Request rates
   - Error rates
   - Response times
   - Active users

2. **Agent Metrics**:
   - Execution times
   - Success rates
   - Confidence scores
   - Error rates

3. **Database Metrics**:
   - Query performance
   - Connection counts
   - Cache hit rates

4. **Queue Metrics**:
   - Job counts
   - Processing times
   - Error rates
   - Queue lengths

### Logging

1. **Application Logs**: Structured JSON logs
2. **Audit Logs**: Complete audit trail via API
3. **Error Logs**: Detailed error information
4. **Access Logs**: Request/response logging

### Alerting

1. **Error Alerts**: Notifications for critical errors
2. **Performance Alerts**: Alerts for slow responses
3. **Resource Alerts**: Alerts for high resource usage
4. **Compliance Alerts**: Alerts for compliance issues

## Disaster Recovery

### Backup Strategy

1. **Database Backups**:
   - Daily full backups
   - Hourly incremental backups
   - Point-in-time recovery
   - Offsite storage

2. **Redis Backups**:
   - Periodic snapshots
   - AOF persistence

3. **Document Storage**:
   - Versioned storage
   - Multiple backups
   - Offsite storage

### Recovery Procedures

1. **Database Recovery**:
   - Restore from latest backup
   - Apply incremental backups
   - Verify data integrity

2. **Application Recovery**:
   - Redeploy application
   - Verify health checks
   - Monitor for errors

3. **Queue Recovery**:
   - Restart workers
   - Verify queue integrity
   - Reprocess failed jobs

## Future Enhancements

### Architecture Improvements

1. **Microservices**: Split into separate services for better scalability
2. **Event Sourcing**: Use event sourcing for audit trail
3. **CQRS**: Separate read and write models
4. **GraphQL**: Add GraphQL API alongside REST

### Agent Improvements

1. **LangGraph Integration**: For complex agent workflows
2. **Fine-tuned Models**: Custom models for specific tasks
3. **Multi-model Support**: Support for multiple LLM providers
4. **Agent Chaining**: Chain agents for complex workflows

### Integration Improvements

1. **ERP Connectors**: Additional ERP system connectors
2. **Banking Integration**: Direct banking system integration
3. **Government Portals**: ICEGATE and other portal integrations
4. **Third-party APIs**: More external data sources

### Performance Improvements

1. **Caching Layer**: Redis caching for frequent queries
2. **CDN**: Content delivery network for documents
3. **Database Sharding**: Horizontal database scaling
4. **Read Replicas**: Database read scaling

## Conclusion

The Consign AI architecture is designed to be:

- **Deterministic**: Predictable behavior with fixed workflows
- **Auditable**: Complete traceability of all actions
- **Safe**: Human-in-the-loop for critical decisions
- **Scalable**: Multi-tenant from day one
- **Compliant**: Meets regulatory requirements
- **Maintainable**: Clean separation of concerns
- **Extensible**: Easy to add new features and agents

This architecture provides a solid foundation for a production-ready, multi-tenant SaaS platform for export-import documentation, compliance, buyer verification, and customs intelligence.
