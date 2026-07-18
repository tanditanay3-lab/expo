-- Consign AI Database Schema
-- Multi-Tenant AI SaaS for Export-Import Documentation, Compliance, Buyer Risk & Customs Intelligence

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgvector";

-- Tenants table - Multi-tenant boundary
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    tier VARCHAR(50) NOT NULL CHECK (tier IN ('starter', 'growth', 'scale', 'enterprise')),
    deployment_mode VARCHAR(50) NOT NULL DEFAULT 'saas' CHECK (deployment_mode IN ('saas', 'vpc', 'on_prem')),
    billing_email VARCHAR(255),
    phone VARCHAR(20),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    country VARCHAR(100) DEFAULT 'India',
    pincode VARCHAR(20),
    gstin VARCHAR(50),
    pan VARCHAR(50),
    subscription_status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (subscription_status IN ('active', 'trial', 'suspended', 'cancelled')),
    trial_ends_at TIMESTAMP WITH TIME ZONE,
    current_period_end TIMESTAMP WITH TIME ZONE,
    plan_limits JSONB NOT NULL DEFAULT '{"shipments": 20, "documents": 100, "users": 1}'::jsonb,
    usage_metrics JSONB NOT NULL DEFAULT '{"shipments": 0, "documents": 0}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMP WITH TIME ZONE,
    onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE
);

-- Users table - Multi-tenant users
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
    avatar_url VARCHAR(500),
    preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, email)
);

-- Buyers table - Shared buyer records across shipments
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
    first_shipment_date TIMESTAMP WITH TIME ZONE,
    last_shipment_date TIMESTAMP WITH TIME ZONE,
    total_shipments INTEGER NOT NULL DEFAULT 0,
    total_value DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    payment_history JSONB NOT NULL DEFAULT '[]'::jsonb,
    verification_status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected', 'flagged')),
    verification_notes TEXT,
    external_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, registration_no) WHERE registration_no IS NOT NULL,
    UNIQUE(tenant_id, email) WHERE email IS NOT NULL
);

-- Shipments table - Core state-machine object
CREATE TABLE shipments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    shipment_number VARCHAR(100) NOT NULL,
    stage VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (stage IN ('draft', 'documents_generated', 'compliance_screened', 'buyer_verified', 'customs_classified', 'ready_to_file', 'filed', 'cancelled')),
    source_invoice_id UUID,
    buyer_id UUID REFERENCES buyers(id) ON DELETE SET NULL,
    consignee_id UUID REFERENCES buyers(id) ON DELETE SET NULL,
    
    -- Invoice details
    invoice_number VARCHAR(100),
    invoice_date DATE,
    invoice_value DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    incoterms VARCHAR(10) CHECK (incoterms IN ('EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF')),
    payment_terms VARCHAR(100),
    
    -- Shipment details
    origin_port VARCHAR(100),
    destination_port VARCHAR(100),
    vessel_name VARCHAR(100),
    voyage_number VARCHAR(100),
    etd DATE,
    eta DATE,
    shipping_line VARCHAR(100),
    
    -- Product details
    product_description TEXT,
    product_category VARCHAR(100),
    quantity DECIMAL(15,3) NOT NULL DEFAULT 0,
    unit VARCHAR(20),
    unit_price DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    total_value DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    
    -- Status and timestamps
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'on_hold', 'completed', 'cancelled')),
    priority VARCHAR(20) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    notes TEXT,
    internal_notes TEXT,
    
    -- Agent results
    document_generation_status VARCHAR(50) DEFAULT 'pending',
    compliance_screening_status VARCHAR(50) DEFAULT 'pending',
    buyer_verification_status VARCHAR(50) DEFAULT 'pending',
    customs_classification_status VARCHAR(50) DEFAULT 'pending',
    
    -- Metadata
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Indexes
    INDEX idx_shipments_tenant_id (tenant_id),
    INDEX idx_shipments_stage (stage),
    INDEX idx_shipments_buyer_id (buyer_id),
    INDEX idx_shipments_shipment_number (shipment_number),
    INDEX idx_shipments_created_at (created_at),
    INDEX idx_shipments_status (status)
);

-- Documents table - Generated document set
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
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    INDEX idx_documents_shipment_id (shipment_id),
    INDEX idx_documents_tenant_id (tenant_id),
    INDEX idx_documents_type (type),
    INDEX idx_documents_status (status)
);

-- Compliance Screens table - Screening results
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
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    INDEX idx_compliance_screens_shipment_id (shipment_id),
    INDEX idx_compliance_screens_tenant_id (tenant_id),
    INDEX idx_compliance_screens_party_ref (party_ref),
    INDEX idx_compliance_screens_severity (severity),
    INDEX idx_compliance_screens_status (status),
    INDEX idx_compliance_screens_list_source (list_source)
);

-- Policy Alerts table - DGFT/RBI/customs policy alerts
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
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    INDEX idx_policy_alerts_tenant_id (tenant_id),
    INDEX idx_policy_alerts_source (source),
    INDEX idx_policy_alerts_status (status),
    INDEX idx_policy_alerts_severity (severity),
    INDEX idx_policy_alerts_published_at (published_at),
    INDEX idx_policy_alerts_relevance_tags (relevance_tags)
);

-- Classifications table - Customs Intelligence Agent output
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
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    INDEX idx_classifications_shipment_id (shipment_id),
    INDEX idx_classifications_tenant_id (tenant_id),
    INDEX idx_classifications_hs_code (hs_code),
    INDEX idx_classifications_status (status),
    INDEX idx_classifications_confidence (confidence)
);

-- Audit Log table - Append-only compliance trail
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

-- Approvals table - Explicit human sign-off records
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

-- Invoice ingestion history
CREATE TABLE invoice_ingestions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    source_type VARCHAR(50) NOT NULL CHECK (source_type IN ('upload', 'tally', 'zoho', 'sap', 'manual', 'other')),
    source_ref VARCHAR(255),
    file_name VARCHAR(255),
    file_size INTEGER,
    mime_type VARCHAR(100),
    storage_path VARCHAR(500),
    ingestion_status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (ingestion_status IN ('pending', 'processing', 'completed', 'failed')),
    parsing_result JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT,
    processed_by_agent_version VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Payment history tracking
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    buyer_id UUID NOT NULL REFERENCES buyers(id) ON DELETE CASCADE,
    payment_date DATE NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    payment_method VARCHAR(50) CHECK (payment_method IN ('lc', 'tt', 'dd', 'open_account', 'cash', 'other')),
    payment_status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'received', 'overdue', 'partial', 'failed', 'refunded')),
    lc_number VARCHAR(100),
    lc_issuing_bank VARCHAR(255),
    lc_expiry_date DATE,
    days_overdue INTEGER NOT NULL DEFAULT 0,
    payment_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    INDEX idx_payments_shipment_id (shipment_id),
    INDEX idx_payments_tenant_id (tenant_id),
    INDEX idx_payments_buyer_id (buyer_id),
    INDEX idx_payments_payment_status (payment_status),
    INDEX idx_payments_payment_date (payment_date)
);

-- ERP Connector configurations
CREATE TABLE erp_connectors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    erp_type VARCHAR(50) NOT NULL CHECK (erp_type IN ('tally', 'zoho_books', 'sap_b1', 'other')),
    name VARCHAR(100) NOT NULL,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    api_key VARCHAR(255),
    api_secret VARCHAR(255),
    endpoint_url VARCHAR(500),
    status VARCHAR(50) NOT NULL DEFAULT 'inactive' CHECK (status IN ('inactive', 'active', 'testing', 'error')),
    last_sync_at TIMESTAMP WITH TIME ZONE,
    sync_frequency_minutes INTEGER NOT NULL DEFAULT 60,
    last_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Regulation corpus for RAG (Compliance Agent)
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
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    INDEX idx_regulation_corpus_source (source),
    INDEX idx_regulation_corpus_status (status)
);

-- Sanctions/denied-party lists
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
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    INDEX idx_sanctions_lists_list_source (list_source),
    INDEX idx_sanctions_lists_name (name),
    INDEX idx_sanctions_lists_status (status)
);

-- Webhook endpoints for external integrations
CREATE TABLE webhooks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    url VARCHAR(500) NOT NULL,
    events VARCHAR(100)[] NOT NULL DEFAULT '{}'::varchar[],
    secret_key VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'testing')),
    last_triggered_at TIMESTAMP WITH TIME ZONE,
    last_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- API Keys for tenant access
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    name VARCHAR(100) NOT NULL,
    key_hash VARCHAR(255) NOT NULL,
    key_prefix VARCHAR(10) NOT NULL,
    permissions JSONB NOT NULL DEFAULT '{"read": true, "write": false}'::jsonb,
    rate_limit_per_minute INTEGER NOT NULL DEFAULT 60,
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'revoked')),
    last_used_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Notification preferences
CREATE TABLE notification_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_type VARCHAR(100) NOT NULL,
    channel VARCHAR(50) NOT NULL CHECK (channel IN ('email', 'sms', 'push', 'in_app')),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    frequency VARCHAR(50) NOT NULL DEFAULT 'immediate' CHECK (frequency IN ('immediate', 'daily', 'weekly', 'never')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    UNIQUE(user_id, notification_type, channel)
);

-- Notifications log
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    notification_type VARCHAR(100) NOT NULL,
    title VARCHAR(500) NOT NULL,
    message TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
    channel VARCHAR(50) NOT NULL CHECK (channel IN ('email', 'sms', 'push', 'in_app')),
    sent_at TIMESTAMP WITH TIME ZONE,
    read_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create materialized view for shipment dashboard
CREATE MATERIALIZED VIEW IF NOT EXISTS shipment_dashboard AS
SELECT 
    s.id,
    s.tenant_id,
    s.shipment_number,
    s.stage,
    s.status,
    s.priority,
    s.invoice_number,
    s.invoice_date,
    s.invoice_value,
    s.currency,
    b.name as buyer_name,
    b.country as buyer_country,
    s.created_at,
    s.updated_at,
    COUNT(DISTINCT d.id) as document_count,
    MAX(CASE WHEN d.status = 'approved' THEN 1 ELSE 0 END) as all_documents_approved,
    COUNT(DISTINCT cs.id) as compliance_flags_count,
    MAX(CASE WHEN cs.severity = 'critical' THEN 1 ELSE 0 END) as has_critical_flags,
    c.hs_code,
    c.confidence as classification_confidence,
    c.duty_estimate,
    c.eta_estimate_days
FROM shipments s
LEFT JOIN buyers b ON s.buyer_id = b.id
LEFT JOIN documents d ON s.id = d.shipment_id
LEFT JOIN compliance_screens cs ON s.id = cs.shipment_id
LEFT JOIN classifications c ON s.id = c.shipment_id
GROUP BY s.id, s.tenant_id, s.shipment_number, s.stage, s.status, s.priority, 
         s.invoice_number, s.invoice_date, s.invoice_value, s.currency,
         b.name, b.country, s.created_at, s.updated_at, c.hs_code, c.confidence, 
         c.duty_estimate, c.eta_estimate_days;

-- Create index on materialized view
CREATE INDEX IF NOT EXISTS idx_shipment_dashboard_tenant_id ON shipment_dashboard(tenant_id);
CREATE INDEX IF NOT EXISTS idx_shipment_dashboard_stage ON shipment_dashboard(stage);

-- Create function to refresh materialized view
CREATE OR REPLACE FUNCTION refresh_shipment_dashboard()
RETURNS TRIGGER AS $$
BEGIN
    REFRESH MATERIALIZED VIEW shipment_dashboard;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create triggers to refresh materialized view
CREATE TRIGGER refresh_dashboard_on_shipment_change
AFTER INSERT OR UPDATE OR DELETE ON shipments
FOR EACH STATEMENT
EXECUTE FUNCTION refresh_shipment_dashboard();

CREATE TRIGGER refresh_dashboard_on_document_change
AFTER INSERT OR UPDATE OR DELETE ON documents
FOR EACH STATEMENT
EXECUTE FUNCTION refresh_shipment_dashboard();

CREATE TRIGGER refresh_dashboard_on_compliance_change
AFTER INSERT OR UPDATE OR DELETE ON compliance_screens
FOR EACH STATEMENT
EXECUTE FUNCTION refresh_shipment_dashboard();

CREATE TRIGGER refresh_dashboard_on_classification_change
AFTER INSERT OR UPDATE OR DELETE ON classifications
FOR EACH STATEMENT
EXECUTE FUNCTION refresh_shipment_dashboard();

-- Create function for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to all relevant tables
CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_buyers_updated_at BEFORE UPDATE ON buyers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_shipments_updated_at BEFORE UPDATE ON shipments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_documents_updated_at BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_compliance_screens_updated_at BEFORE UPDATE ON compliance_screens FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_classifications_updated_at BEFORE UPDATE ON classifications FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_invoice_ingestions_updated_at BEFORE UPDATE ON invoice_ingestions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create row-level security policies for multi-tenancy
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
ALTER TABLE invoice_ingestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Create policies for each table
CREATE POLICY tenant_isolation_policy ON tenants
    USING (true);

CREATE POLICY user_tenant_policy ON users
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY buyer_tenant_policy ON buyers
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY shipment_tenant_policy ON shipments
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY document_tenant_policy ON documents
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY compliance_screen_tenant_policy ON compliance_screens
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY policy_alert_tenant_policy ON policy_alerts
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY classification_tenant_policy ON classifications
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY audit_log_tenant_policy ON audit_log
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY approval_tenant_policy ON approvals
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY invoice_ingestion_tenant_policy ON invoice_ingestions
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY payment_tenant_policy ON payments
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY erp_connector_tenant_policy ON erp_connectors
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY webhook_tenant_policy ON webhooks
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY api_key_tenant_policy ON api_keys
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY notification_preference_tenant_policy ON notification_preferences
    USING (user_id IN (SELECT id FROM users WHERE tenant_id = current_setting('app.current_tenant_id')::uuid));

CREATE POLICY notification_tenant_policy ON notifications
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Create function to set tenant context
CREATE OR REPLACE FUNCTION set_tenant_context(tenant_id uuid)
RETURNS void AS $$
BEGIN
    PERFORM set_config('app.current_tenant_id', tenant_id::text, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to clear tenant context
CREATE OR REPLACE FUNCTION clear_tenant_context()
RETURNS void AS $$
BEGIN
    PERFORM set_config('app.current_tenant_id', '', false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create views for common queries
CREATE VIEW tenant_shipment_stats AS
SELECT 
    t.id as tenant_id,
    t.name as tenant_name,
    t.tier,
    COUNT(s.id) as total_shipments,
    COUNT(CASE WHEN s.stage = 'filed' THEN 1 END) as filed_shipments,
    COUNT(CASE WHEN s.stage = 'ready_to_file' THEN 1 END) as ready_to_file_shipments,
    COUNT(CASE WHEN s.status = 'on_hold' THEN 1 END) as on_hold_shipments,
    SUM(CASE WHEN s.invoice_value IS NOT NULL THEN s.invoice_value ELSE 0 END) as total_invoice_value,
    AVG(c.duty_estimate) as avg_duty_estimate,
    COUNT(DISTINCT b.id) as unique_buyers
FROM tenants t
LEFT JOIN shipments s ON t.id = s.tenant_id
LEFT JOIN buyers b ON s.buyer_id = b.id
LEFT JOIN classifications c ON s.id = c.shipment_id
WHERE s.status != 'cancelled'
GROUP BY t.id, t.name, t.tier;

CREATE VIEW compliance_summary AS
SELECT 
    s.tenant_id,
    s.id as shipment_id,
    s.shipment_number,
    COUNT(cs.id) as total_flags,
    COUNT(CASE WHEN cs.severity = 'critical' THEN 1 END) as critical_flags,
    COUNT(CASE WHEN cs.severity = 'high' THEN 1 END) as high_flags,
    COUNT(CASE WHEN cs.severity = 'medium' THEN 1 END) as medium_flags,
    COUNT(CASE WHEN cs.severity = 'low' THEN 1 END) as low_flags,
    MAX(CASE WHEN cs.severity = 'critical' THEN 1 ELSE 0 END) as has_critical_flags
FROM shipments s
LEFT JOIN compliance_screens cs ON s.id = cs.shipment_id
GROUP BY s.tenant_id, s.id, s.shipment_number;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_shipments_tenant_stage_status ON shipments(tenant_id, stage, status);
CREATE INDEX IF NOT EXISTS idx_documents_shipment_type_status ON documents(shipment_id, type, status);
CREATE INDEX IF NOT EXISTS idx_compliance_screens_shipment_severity ON compliance_screens(shipment_id, severity);
CREATE INDEX IF NOT EXISTS idx_classifications_shipment_confidence ON classifications(shipment_id, confidence);

-- Create function for full-text search on shipments
CREATE INDEX IF NOT EXISTS idx_shipments_search ON shipments USING GIN (
    to_tsvector('english', 
        COALESCE(shipment_number, '') || ' ' ||
        COALESCE(invoice_number, '') || ' ' ||
        COALESCE(product_description, '') || ' ' ||
        COALESCE(product_category, '')
    )
);

-- Create function for full-text search on buyers
CREATE INDEX IF NOT EXISTS idx_buyers_search ON buyers USING GIN (
    to_tsvector('english', 
        COALESCE(name, '') || ' ' ||
        COALESCE(registration_no, '') || ' ' ||
        COALESCE(address, '') || ' ' ||
        COALESCE(city, '') || ' ' ||
        COALESCE(state, '') || ' ' ||
        COALESCE(country, '')
    )
);

-- Create function for audit trail export
CREATE OR REPLACE FUNCTION export_audit_trail(p_shipment_id uuid)
RETURNS TABLE (
    id UUID,
    timestamp TIMESTAMP WITH TIME ZONE,
    actor_type VARCHAR(50),
    actor_name VARCHAR(255),
    action VARCHAR(100),
    details JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        al.id,
        al.created_at as timestamp,
        al.actor_type,
        CASE 
            WHEN al.actor_type = 'human' THEN u.email
            WHEN al.actor_type = 'agent' THEN al.actor_ref
            ELSE al.actor_ref
        END as actor_name,
        al.action,
        jsonb_build_object(
            'input', al.input_ref,
            'output', al.output_ref,
            'decision', al.decision,
            'confidence', al.confidence,
            'metadata', al.metadata
        ) as details
    FROM audit_log al
    LEFT JOIN users u ON al.actor_ref = u.id::text AND al.actor_type = 'human'
    WHERE al.shipment_id = p_shipment_id
    ORDER BY al.created_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function for shipment progress tracking
CREATE OR REPLACE FUNCTION get_shipment_progress(p_shipment_id uuid)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
    doc_count INTEGER;
    doc_approved INTEGER;
    comp_count INTEGER;
    comp_resolved INTEGER;
    buyer_score DECIMAL(5,2);
    hs_confidence DECIMAL(5,2);
BEGIN
    SELECT jsonb_build_object(
        'shipment_id', p_shipment_id,
        'stage', s.stage,
        'status', s.status,
        'documentation', jsonb_build_object(
            'status', s.document_generation_status,
            'total_documents', COUNT(d.id),
            'approved_documents', COUNT(CASE WHEN d.status = 'approved' THEN 1 END)
        ),
        'compliance', jsonb_build_object(
            'status', s.compliance_screening_status,
            'total_flags', COUNT(cs.id),
            'resolved_flags', COUNT(CASE WHEN cs.status = 'resolved' THEN 1 END),
            'critical_flags', COUNT(CASE WHEN cs.severity = 'critical' AND cs.status != 'resolved' THEN 1 END)
        ),
        'buyer_verification', jsonb_build_object(
            'status', s.buyer_verification_status,
            'risk_score', b.risk_score,
            'risk_category', b.risk_category
        ),
        'customs_classification', jsonb_build_object(
            'status', s.customs_classification_status,
            'hs_code', c.hs_code,
            'confidence', c.confidence,
            'duty_estimate', c.duty_estimate
        ),
        'can_advance', (
            CASE 
                WHEN s.stage = 'draft' AND s.document_generation_status = 'completed' THEN TRUE
                WHEN s.stage = 'documents_generated' AND 
                     COUNT(CASE WHEN d.status != 'approved' THEN 1 END) = 0 THEN TRUE
                WHEN s.stage = 'compliance_screened' AND 
                     COUNT(CASE WHEN cs.severity IN ('critical', 'high') AND cs.status != 'resolved' THEN 1 END) = 0 THEN TRUE
                WHEN s.stage = 'buyer_verified' AND 
                     (b.risk_category NOT IN ('high', 'critical') OR 
                      EXISTS (SELECT 1 FROM approvals a WHERE a.shipment_id = p_shipment_id AND a.target_type = 'buyer_risk')) THEN TRUE
                WHEN s.stage = 'customs_classified' AND 
                     (c.confidence >= 0.8 OR 
                      EXISTS (SELECT 1 FROM approvals a WHERE a.shipment_id = p_shipment_id AND a.target_type = 'classification')) THEN TRUE
                ELSE FALSE
            END
        ),
        'next_stage', (
            CASE s.stage
                WHEN 'draft' THEN 'documents_generated'
                WHEN 'documents_generated' THEN 'compliance_screened'
                WHEN 'compliance_screened' THEN 'buyer_verified'
                WHEN 'buyer_verified' THEN 'customs_classified'
                WHEN 'customs_classified' THEN 'ready_to_file'
                ELSE NULL
            END
        )
    ) INTO result
    FROM shipments s
    LEFT JOIN documents d ON s.id = d.shipment_id
    LEFT JOIN compliance_screens cs ON s.id = cs.shipment_id
    LEFT JOIN buyers b ON s.buyer_id = b.id
    LEFT JOIN classifications c ON s.id = c.shipment_id
    WHERE s.id = p_shipment_id
    GROUP BY s.id, s.stage, s.status, s.document_generation_status, 
             s.compliance_screening_status, s.buyer_verification_status,
             s.customs_classification_status, b.risk_score, b.risk_category,
             c.hs_code, c.confidence, c.duty_estimate;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to check if shipment can be filed
CREATE OR REPLACE FUNCTION can_file_shipment(p_shipment_id uuid)
RETURNS BOOLEAN AS $$
DECLARE
    can_file BOOLEAN;
    critical_flags INTEGER;
    high_risk BOOLEAN;
    low_confidence BOOLEAN;
    missing_approvals INTEGER;
BEGIN
    -- Check for unresolved critical compliance flags
    SELECT COUNT(*) INTO critical_flags
    FROM compliance_screens
    WHERE shipment_id = p_shipment_id 
      AND severity IN ('critical', 'high')
      AND status != 'resolved';
    
    -- Check for high-risk buyer without approval
    SELECT EXISTS(
        SELECT 1 FROM shipments s
        JOIN buyers b ON s.buyer_id = b.id
        WHERE s.id = p_shipment_id 
          AND b.risk_category IN ('high', 'critical')
          AND NOT EXISTS (
              SELECT 1 FROM approvals a 
              WHERE a.shipment_id = p_shipment_id 
                AND a.target_type = 'buyer_risk'
          )
    ) INTO high_risk;
    
    -- Check for low-confidence classification without approval
    SELECT EXISTS(
        SELECT 1 FROM classifications c
        WHERE c.shipment_id = p_shipment_id 
          AND c.confidence < 0.8
          AND NOT EXISTS (
              SELECT 1 FROM approvals a 
              WHERE a.shipment_id = p_shipment_id 
                AND a.target_type = 'classification'
          )
    ) INTO low_confidence;
    
    -- Check for missing document approvals
    SELECT COUNT(*) INTO missing_approvals
    FROM documents
    WHERE shipment_id = p_shipment_id 
      AND status != 'approved';
    
    can_file := (critical_flags = 0) AND (high_risk = FALSE) AND 
                (low_confidence = FALSE) AND (missing_approvals = 0);
    
    RETURN can_file;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to advance shipment stage
CREATE OR REPLACE FUNCTION advance_shipment_stage(p_shipment_id uuid, p_user_id uuid)
RETURNS BOOLEAN AS $$
DECLARE
    current_stage VARCHAR(50);
    next_stage VARCHAR(50);
    can_advance BOOLEAN;
    shipment_record RECORD;
BEGIN
    -- Get current shipment
    SELECT * INTO shipment_record
    FROM shipments
    WHERE id = p_shipment_id;
    
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    
    current_stage := shipment_record.stage;
    
    -- Determine next stage
    next_stage := CASE current_stage
        WHEN 'draft' THEN 'documents_generated'
        WHEN 'documents_generated' THEN 'compliance_screened'
        WHEN 'compliance_screened' THEN 'buyer_verified'
        WHEN 'buyer_verified' THEN 'customs_classified'
        WHEN 'customs_classified' THEN 'ready_to_file'
        ELSE NULL
    END;
    
    IF next_stage IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Check if can advance
    SELECT can_file_shipment(p_shipment_id) INTO can_advance;
    
    IF NOT can_advance THEN
        RETURN FALSE;
    END IF;
    
    -- Update shipment stage
    UPDATE shipments
    SET stage = next_stage,
        updated_at = NOW(),
        updated_by = p_user_id
    WHERE id = p_shipment_id;
    
    -- Log the stage transition
    INSERT INTO audit_log (shipment_id, tenant_id, actor_type, actor_ref, action, input_ref, output_ref, metadata)
    VALUES (p_shipment_id, shipment_record.tenant_id, 'human', p_user_id::text, 
            'stage_transition', 
            jsonb_build_object('from_stage', current_stage, 'to_stage', next_stage),
            jsonb_build_object('shipment_id', p_shipment_id, 'new_stage', next_stage),
            jsonb_build_object('triggered_by', p_user_id));
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to generate shipment number
CREATE OR REPLACE FUNCTION generate_shipment_number(p_tenant_id uuid)
RETURNS VARCHAR(100) AS $$
DECLARE
    tenant_code VARCHAR(10);
    current_year VARCHAR(4);
    sequence_num INTEGER;
    shipment_number VARCHAR(100);
BEGIN
    -- Get tenant code (first 3 letters of tenant name)
    SELECT UPPER(SUBSTRING(name, 1, 3)) INTO tenant_code
    FROM tenants
    WHERE id = p_tenant_id;
    
    -- Get current year
    current_year := TO_CHAR(NOW(), 'YYYY');
    
    -- Get next sequence number
    SELECT COALESCE(MAX(CAST(SUBSTRING(shipment_number FROM '-[0-9]+$') AS INTEGER)), 0) + 1
    INTO sequence_num
    FROM shipments
    WHERE tenant_id = p_tenant_id 
      AND shipment_number LIKE tenant_code || '-' || current_year || '-%';
    
    -- Generate shipment number
    shipment_number := tenant_code || '-' || current_year || '-' || LPAD(sequence_num::text, 5, '0');
    
    RETURN shipment_number;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create initial admin user function
CREATE OR REPLACE FUNCTION create_initial_admin()
RETURNS VOID AS $$
DECLARE
    admin_exists INTEGER;
BEGIN
    SELECT COUNT(*) INTO admin_exists
    FROM tenants
    WHERE email = 'admin@consign.ai';
    
    IF admin_exists = 0 THEN
        INSERT INTO tenants (name, email, password_hash, tier, deployment_mode, subscription_status)
        VALUES ('Admin Tenant', 'admin@consign.ai', 
                '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoE5aV16QO9c0zY9cQl9gY8L1Jy7K', -- bcrypt hash of 'admin123'
                'enterprise', 'saas', 'active');
        
        INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role, status)
        VALUES (
            (SELECT id FROM tenants WHERE email = 'admin@consign.ai'),
            'admin@consign.ai',
            '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoE5aV16QO9c0zY9cQl9gY8L1Jy7K',
            'Admin',
            'User',
            'owner',
            'active'
        );
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Execute initial admin creation
SELECT create_initial_admin();
