import { query, beginTransaction } from './connection';
import bcrypt from 'bcrypt';
import {
  TenantTier,
  DeploymentMode,
  SubscriptionStatus,
  UserRole,
  UserStatus,
  BuyerRiskCategory,
  BuyerVerificationStatus,
  ShipmentStage,
  ShipmentStatus,
  ShipmentPriority,
  Incoterms,
  DocumentType,
  DocumentStatus,
  ComplianceListSource,
  ComplianceSeverity,
  ComplianceMatchResult,
  CompliancePartyType,
  ComplianceStatus,
  ClassificationMethod,
  ClassificationStatus,
  PolicySource,
  PolicySeverity,
  PolicyStatus
} from '../types';

async function seedDatabase() {
  console.log('Starting database seeding...');

  const tx = await beginTransaction();

  try {
    // Check if database is already seeded
    const checkResult = await tx.client.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM tenants WHERE email = $1',
      ['admin@consign.ai']
    );

    if (parseInt(checkResult.rows[0].count) > 0) {
      console.log('Database already seeded. Skipping...');
      await tx.rollback();
      return;
    }

    console.log('Seeding tenants...');
    
    // Create admin tenant
    const adminPasswordHash = await bcrypt.hash('admin123', 10);
    
    await tx.client.query(
      `INSERT INTO tenants (
        name, email, password_hash, tier, deployment_mode, 
        subscription_status, billing_email, phone, address, city, 
        state, country, pincode, gstin, pan, plan_limits, usage_metrics, 
        onboarding_complete
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        'Admin Tenant',
        'admin@consign.ai',
        adminPasswordHash,
        'enterprise' as TenantTier,
        'saas' as DeploymentMode,
        'active' as SubscriptionStatus,
        'admin@consign.ai',
        '+919876543210',
        '123 Admin Street',
        'Mumbai',
        'Maharashtra',
        'India',
        '400001',
        '27AABCD1234PZ',
        'ABCDP1234D',
        JSON.stringify({ shipments: -1, documents: -1, users: -1 }),
        JSON.stringify({ shipments: 0, documents: 0 }),
        true
      ]
    );

    // Create admin user
    await tx.client.query(
      `INSERT INTO users (
        tenant_id, email, password_hash, first_name, last_name, 
        phone, role, status, preferences
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        (await tx.client.query<{ id: string }>('SELECT id FROM tenants WHERE email = $1', ['admin@consign.ai'])).rows[0].id,
        'admin@consign.ai',
        adminPasswordHash,
        'Admin',
        'User',
        '+919876543210',
        'owner' as UserRole,
        'active' as UserStatus,
        JSON.stringify({})
      ]
    );

    // Create sample tenants
    const sampleTenants = [
      {
        name: 'Textile Exports Ltd',
        email: 'textile@exports.com',
        password: 'textile123',
        tier: 'growth' as TenantTier,
        deploymentMode: 'saas' as DeploymentMode,
        subscriptionStatus: 'active' as SubscriptionStatus,
        billingEmail: 'accounts@textileexports.com',
        phone: '+919876543211',
        address: '456 Textile Road',
        city: 'Surat',
        state: 'Gujarat',
        country: 'India',
        pincode: '395002',
        gstin: '27AABCD5678PZ',
        pan: 'ABCDP5678D',
        planLimits: { shipments: 100, documents: 500, users: 5, buyers: 200 },
        usageMetrics: { shipments: 10, documents: 50 }
      },
      {
        name: 'Agro Products Pvt Ltd',
        email: 'agro@products.com',
        password: 'agro123',
        tier: 'scale' as TenantTier,
        deploymentMode: 'saas' as DeploymentMode,
        subscriptionStatus: 'active' as SubscriptionStatus,
        billingEmail: 'finance@agroproducts.com',
        phone: '+919876543212',
        address: '789 Agro Street',
        city: 'Pune',
        state: 'Maharashtra',
        country: 'India',
        pincode: '411001',
        gstin: '27AABCD9012PZ',
        pan: 'ABCDP9012D',
        planLimits: { shipments: 300, documents: 1500, users: 10, buyers: 500 },
        usageMetrics: { shipments: 50, documents: 250 }
      },
      {
        name: 'Engineering Goods Co',
        email: 'engineering@goods.com',
        password: 'engineering123',
        tier: 'starter' as TenantTier,
        deploymentMode: 'saas' as DeploymentMode,
        subscriptionStatus: 'trial' as SubscriptionStatus,
        billingEmail: 'sales@engineeringgoods.com',
        phone: '+919876543213',
        address: '321 Engineering Lane',
        city: 'Chennai',
        state: 'Tamil Nadu',
        country: 'India',
        pincode: '600001',
        gstin: '33AABCD3456PZ',
        pan: 'ABCDP3456D',
        planLimits: { shipments: 20, documents: 100, users: 1, buyers: 50 },
        usageMetrics: { shipments: 5, documents: 25 }
      }
    ];

    for (const tenantData of sampleTenants) {
      const passwordHash = await bcrypt.hash(tenantData.password, 10);
      
      const tenantResult = await tx.client.query<{ id: string }>(
        `INSERT INTO tenants (
          name, email, password_hash, tier, deployment_mode, 
          subscription_status, billing_email, phone, address, city, 
          state, country, pincode, gstin, pan, plan_limits, usage_metrics, 
          onboarding_complete
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        RETURNING id`,
        [
          tenantData.name,
          tenantData.email,
          passwordHash,
          tenantData.tier,
          tenantData.deploymentMode,
          tenantData.subscriptionStatus,
          tenantData.billingEmail,
          tenantData.phone,
          tenantData.address,
          tenantData.city,
          tenantData.state,
          tenantData.country,
          tenantData.pincode,
          tenantData.gstin,
          tenantData.pan,
          JSON.stringify(tenantData.planLimits),
          JSON.stringify(tenantData.usageMetrics),
          true
        ]
      );

      const tenantId = tenantResult.rows[0].id;

      // Create owner user for each tenant
      await tx.client.query(
        `INSERT INTO users (
          tenant_id, email, password_hash, first_name, last_name, 
          phone, role, status, preferences
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          tenantId,
          tenantData.email,
          passwordHash,
          tenantData.name.split(' ')[0],
          tenantData.name.split(' ').slice(1).join(' '),
          tenantData.phone,
          'owner' as UserRole,
          'active' as UserStatus,
          JSON.stringify({})
        ]
      );

      console.log(`Created tenant: ${tenantData.name}`);
    }

    // Get tenant IDs
    const tenantsResult = await tx.client.query<{ id: string; email: string }>(
      'SELECT id, email FROM tenants WHERE email != $1',
      ['admin@consign.ai']
    );

    const tenants = tenantsResult.rows;

    console.log('Seeding buyers...');
    
    // Create sample buyers for each tenant
    const sampleBuyers = [
      {
        name: 'Global Imports LLC',
        registration_no: 'IMP-001',
        gstin: '',
        pan: '',
        country: 'USA',
        city: 'New York',
        state: 'NY',
        address: '123 Import Ave, New York, NY 10001',
        pincode: '10001',
        email: 'contact@globalimports.com',
        phone: '+12125551234',
        website: 'https://globalimports.com',
        business_type: 'Importer',
        risk_score: 85.00,
        risk_category: 'low' as BuyerRiskCategory,
        payment_terms: 'LC at sight',
        credit_limit: 1000000,
        currency: 'USD',
        verification_status: 'verified' as BuyerVerificationStatus,
        external_data: { creditScore: 750, creditRating: 'Good' }
      },
      {
        name: 'European Traders GmbH',
        registration_no: 'IMP-002',
        gstin: '',
        pan: '',
        country: 'Germany',
        city: 'Berlin',
        state: 'Berlin',
        address: '456 Trade Street, Berlin, Germany',
        pincode: '10115',
        email: 'info@europeantraders.de',
        phone: '+49301234567',
        website: 'https://europeantraders.de',
        business_type: 'Wholesaler',
        risk_score: 75.00,
        risk_category: 'medium' as BuyerRiskCategory,
        payment_terms: 'TT 30 days',
        credit_limit: 500000,
        currency: 'EUR',
        verification_status: 'verified' as BuyerVerificationStatus,
        external_data: { creditScore: 680, creditRating: 'Fair' }
      },
      {
        name: 'Asian Distributors',
        registration_no: 'IMP-003',
        gstin: '',
        pan: '',
        country: 'Singapore',
        city: 'Singapore',
        state: '',
        address: '789 Distribution Center, Singapore',
        pincode: '068897',
        email: 'sales@asiandistributors.sg',
        phone: '+6567890123',
        website: 'https://asiandistributors.sg',
        business_type: 'Distributor',
        risk_score: 65.00,
        risk_category: 'medium' as BuyerRiskCategory,
        payment_terms: 'Open Account',
        credit_limit: 250000,
        currency: 'SGD',
        verification_status: 'flagged' as BuyerVerificationStatus,
        external_data: { creditScore: 620, creditRating: 'Fair' }
      },
      {
        name: 'Risky Traders Inc',
        registration_no: 'IMP-004',
        gstin: '',
        pan: '',
        country: 'UK',
        city: 'London',
        state: 'London',
        address: '321 Risk Street, London, UK',
        pincode: 'SW1A 1AA',
        email: 'contact@riskytraders.co.uk',
        phone: '+442071234567',
        website: 'https://riskytraders.co.uk',
        business_type: 'Trader',
        risk_score: 35.00,
        risk_category: 'high' as BuyerRiskCategory,
        payment_terms: 'Open Account',
        credit_limit: 100000,
        currency: 'GBP',
        verification_status: 'flagged' as BuyerVerificationStatus,
        external_data: { creditScore: 550, creditRating: 'Poor' }
      }
    ];

    for (const tenant of tenants) {
      for (const buyerData of sampleBuyers) {
        await tx.client.query(
          `INSERT INTO buyers (
            tenant_id, name, registration_no, gstin, pan, country, 
            city, state, address, pincode, email, phone, website, 
            business_type, risk_score, risk_category, payment_terms, 
            credit_limit, currency, verification_status, external_data
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)`,
          [
            tenant.id,
            buyerData.name,
            buyerData.registration_no,
            buyerData.gstin,
            buyerData.pan,
            buyerData.country,
            buyerData.city,
            buyerData.state,
            buyerData.address,
            buyerData.pincode,
            buyerData.email,
            buyerData.phone,
            buyerData.website,
            buyerData.business_type,
            buyerData.risk_score,
            buyerData.risk_category,
            buyerData.payment_terms,
            buyerData.credit_limit,
            buyerData.currency,
            buyerData.verification_status,
            buyerData.external_data
          ]
        );
      }
    }

    console.log('Seeding shipments...');
    
    // Create sample shipments for each tenant
    const sampleShipments = [
      {
        shipment_number: 'TEXT-2024-001',
        stage: 'draft' as ShipmentStage,
        buyer_id: null, // Will be set per tenant
        consignee_id: null,
        invoice_number: 'INV-2024-001',
        invoice_date: new Date('2024-01-15'),
        invoice_value: 500000,
        currency: 'INR',
        incoterms: 'FOB' as Incoterms,
        payment_terms: 'LC at sight',
        origin_port: 'Nhava Sheva',
        destination_port: 'New York',
        vessel_name: 'MV Global Carrier',
        voyage_number: 'GC-001',
        etd: new Date('2024-02-01'),
        eta: new Date('2024-02-15'),
        shipping_line: 'Global Shipping',
        product_description: 'Cotton T-Shirts, 100% Cotton, Various Colors',
        product_category: 'Textiles',
        quantity: 1000,
        unit: 'PCS',
        unit_price: 500,
        total_value: 500000,
        status: 'active' as ShipmentStatus,
        priority: 'normal' as ShipmentPriority,
        notes: 'First shipment of the year',
        document_generation_status: 'pending',
        compliance_screening_status: 'pending',
        buyer_verification_status: 'pending',
        customs_classification_status: 'pending'
      },
      {
        shipment_number: 'TEXT-2024-002',
        stage: 'documents_generated' as ShipmentStage,
        buyer_id: null,
        consignee_id: null,
        invoice_number: 'INV-2024-002',
        invoice_date: new Date('2024-01-20'),
        invoice_value: 750000,
        currency: 'INR',
        incoterms: 'CIF' as Incoterms,
        payment_terms: 'TT 30 days',
        origin_port: 'Nhava Sheva',
        destination_port: 'Rotterdam',
        vessel_name: 'MV Euro Trader',
        voyage_number: 'ET-002',
        etd: new Date('2024-02-05'),
        eta: new Date('2024-02-20'),
        shipping_line: 'Euro Shipping',
        product_description: 'Men\'s Formal Shirts, Cotton Blend',
        product_category: 'Textiles',
        quantity: 500,
        unit: 'PCS',
        unit_price: 1500,
        total_value: 750000,
        status: 'active' as ShipmentStatus,
        priority: 'high' as ShipmentPriority,
        notes: 'Urgent order for spring collection',
        document_generation_status: 'completed',
        compliance_screening_status: 'pending',
        buyer_verification_status: 'pending',
        customs_classification_status: 'pending'
      },
      {
        shipment_number: 'AGRO-2024-001',
        stage: 'compliance_screened' as ShipmentStage,
        buyer_id: null,
        consignee_id: null,
        invoice_number: 'INV-2024-003',
        invoice_date: new Date('2024-01-10'),
        invoice_value: 1000000,
        currency: 'USD',
        incoterms: 'FOB' as Incoterms,
        payment_terms: 'LC 60 days',
        origin_port: 'Mumbai',
        destination_port: 'Singapore',
        vessel_name: 'MV Agro Carrier',
        voyage_number: 'AC-003',
        etd: new Date('2024-01-25'),
        eta: new Date('2024-01-30'),
        shipping_line: 'Agro Shipping',
        product_description: 'Basmathi Rice, Premium Quality, 50kg bags',
        product_category: 'Agro Products',
        quantity: 200,
        unit: 'BAG',
        unit_price: 5000,
        total_value: 1000000,
        status: 'active' as ShipmentStatus,
        priority: 'normal' as ShipmentPriority,
        notes: 'Large order for Singapore market',
        document_generation_status: 'completed',
        compliance_screening_status: 'completed',
        buyer_verification_status: 'pending',
        customs_classification_status: 'pending'
      }
    ];

    for (const tenant of tenants) {
      for (const shipmentData of sampleShipments) {
        // Get a random buyer for this tenant
        const buyerResult = await tx.client.query<{ id: string }>(
          'SELECT id FROM buyers WHERE tenant_id = $1 ORDER BY RANDOM() LIMIT 1',
          [tenant.id]
        );

        const buyerId = buyerResult.rows.length > 0 ? buyerResult.rows[0].id : null;

        const shipmentResult = await tx.client.query<{ id: string }>(
          `INSERT INTO shipments (
            tenant_id, shipment_number, stage, buyer_id, consignee_id, 
            invoice_number, invoice_date, invoice_value, currency, incoterms, 
            payment_terms, origin_port, destination_port, vessel_name, voyage_number,
            etd, eta, shipping_line, product_description, product_category,
            quantity, unit, unit_price, total_value, status, priority, notes,
            document_generation_status, compliance_screening_status, 
            buyer_verification_status, customs_classification_status, created_by, updated_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)
          RETURNING id`,
          [
            tenant.id,
            shipmentData.shipment_number,
            shipmentData.stage,
            buyerId,
            null,
            shipmentData.invoice_number,
            shipmentData.invoice_date,
            shipmentData.invoice_value,
            shipmentData.currency,
            shipmentData.incoterms,
            shipmentData.payment_terms,
            shipmentData.origin_port,
            shipmentData.destination_port,
            shipmentData.vessel_name,
            shipmentData.voyage_number,
            shipmentData.etd,
            shipmentData.eta,
            shipmentData.shipping_line,
            shipmentData.product_description,
            shipmentData.product_category,
            shipmentData.quantity,
            shipmentData.unit,
            shipmentData.unit_price,
            shipmentData.total_value,
            shipmentData.status,
            shipmentData.priority,
            shipmentData.notes,
            shipmentData.document_generation_status,
            shipmentData.compliance_screening_status,
            shipmentData.buyer_verification_status,
            shipmentData.customs_classification_status,
            (await tx.client.query<{ id: string }>('SELECT id FROM users WHERE tenant_id = $1 LIMIT 1', [tenant.id])).rows[0]?.id || null,
            (await tx.client.query<{ id: string }>('SELECT id FROM users WHERE tenant_id = $1 LIMIT 1', [tenant.id])).rows[0]?.id || null
          ]
        );

        const shipmentId = shipmentResult.rows[0].id;

        // Create documents for shipments that have been generated
        if (shipmentData.stage === 'documents_generated' || shipmentData.stage === 'compliance_screened') {
          const documentTypes: DocumentType[] = [
            'commercial_invoice',
            'packing_list',
            'coo_draft'
          ];

          for (const docType of documentTypes) {
            await tx.client.query(
              `INSERT INTO documents (
                shipment_id, tenant_id, type, status, 
                generated_by_agent_version, storage_ref, file_name, 
                content, discrepancy_flags, validation_errors, confidence_score
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
              [
                shipmentId,
                tenant.id,
                docType,
                'approved' as DocumentStatus,
                '1.0.0',
                `documents/${shipmentId}/${docType}.txt`,
                `${shipmentData.shipment_number}_${docType}.txt`,
                `Content for ${docType}`,
                JSON.stringify([]),
                JSON.stringify([]),
                0.95
              ]
            );
          }
        }

        // Create compliance screens for shipments that have been screened
        if (shipmentData.stage === 'compliance_screened') {
          await tx.client.query(
            `INSERT INTO compliance_screens (
              shipment_id, tenant_id, party_ref, party_type, 
              list_source, match_result, match_score, severity, 
              citation_ref, citation_text, flag_description, 
              recommended_action, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
              shipmentId,
              tenant.id,
              buyerId || 'unknown',
              'buyer' as CompliancePartyType,
              'OFAC' as ComplianceListSource,
              'no_match' as ComplianceMatchResult,
              0.0,
              'low' as ComplianceSeverity,
              'OFAC-001',
              'No match found in OFAC list',
              'Party screened against OFAC sanctions list',
              'No action required',
              'resolved' as ComplianceStatus
            ]
          );
        }

        console.log(`Created shipment: ${shipmentData.shipment_number} for tenant ${tenant.email}`);
      }
    }

    console.log('Seeding policy alerts...');
    
    // Create sample policy alerts for each tenant
    const samplePolicyAlerts = [
      {
        source: 'DGFT' as PolicySource,
        alert_type: 'policy_update',
        title: 'Updated Export Policy for Textiles',
        description: 'DGFT has updated the export policy for textile products to the USA and EU markets.',
        relevance_tags: ['textiles', 'apparel', 'export', 'USA', 'EU'],
        published_at: new Date('2024-01-01'),
        effective_from: new Date('2024-01-15'),
        status: 'active' as PolicyStatus,
        severity: 'high' as PolicySeverity,
        citation_url: 'https://dgft.gov.in/policy-updates',
        affected_products: ['textiles', 'apparel', 'garments'],
        affected_countries: ['USA', 'EU', 'UK'],
        action_required: 'Review export procedures for textile shipments to USA and EU'
      },
      {
        source: 'RBI' as PolicySource,
        alert_type: 'regulatory_change',
        title: 'New FEMA Regulations for Export Payments',
        description: 'RBI has announced new FEMA regulations affecting export payments and repatriation.',
        relevance_tags: ['payment', 'FEMA', 'export', 'repatriation'],
        published_at: new Date('2024-01-05'),
        effective_from: new Date('2024-02-01'),
        status: 'active' as PolicyStatus,
        severity: 'medium' as PolicySeverity,
        citation_url: 'https://rbi.org.in/fema-updates',
        affected_products: [],
        affected_countries: [],
        action_required: 'Review payment terms and repatriation procedures'
      },
      {
        source: 'Customs' as PolicySource,
        alert_type: 'duty_rate_change',
        title: 'Revised Duty Rates for Electronics',
        description: 'Customs department has revised duty rates for certain electronic products.',
        relevance_tags: ['electronics', 'duty', 'import', 'customs'],
        published_at: new Date('2024-01-10'),
        effective_from: new Date('2024-01-20'),
        status: 'active' as PolicyStatus,
        severity: 'medium' as PolicySeverity,
        citation_url: 'https://www.cbic.gov.in/duty-updates',
        affected_products: ['electronics', 'mobile phones', 'laptops'],
        affected_countries: [],
        action_required: 'Review duty calculations for electronic products'
      }
    ];

    for (const tenant of tenants) {
      for (const alertData of samplePolicyAlerts) {
        await tx.client.query(
          `INSERT INTO policy_alerts (
            tenant_id, source, alert_type, title, description, 
            relevance_tags, published_at, effective_from, status, 
            severity, citation_url, affected_products, affected_countries, action_required
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            tenant.id,
            alertData.source,
            alertData.alert_type,
            alertData.title,
            alertData.description,
            alertData.relevance_tags,
            alertData.published_at,
            alertData.effective_from,
            alertData.status,
            alertData.severity,
            alertData.citation_url,
            alertData.affected_products,
            alertData.affected_countries,
            alertData.action_required
          ]
        );
      }
    }

    console.log('Seeding sanctions lists...');
    
    // Create sample sanctions list entries
    const sampleSanctions = [
      {
        list_name: 'OFAC Specially Designated Nationals',
        list_source: 'OFAC' as ComplianceListSource,
        entry_id: 'SDN-001',
        name: 'John Doe',
        entity_type: 'Individual',
        country: 'USA',
        address: '123 Main St, New York, NY',
        remarks: 'Narcotics trafficking',
        listing_date: new Date('2020-01-01'),
        last_updated: new Date('2024-01-01'),
        status: 'active'
      },
      {
        list_name: 'UN Security Council Sanctions',
        list_source: 'UN' as ComplianceListSource,
        entry_id: 'UN-001',
        name: 'ABC Corporation',
        entity_type: 'Entity',
        country: 'North Korea',
        address: 'Pyongyang, North Korea',
        remarks: 'Nuclear proliferation',
        listing_date: new Date('2015-01-01'),
        last_updated: new Date('2024-01-01'),
        status: 'active'
      },
      {
        list_name: 'EU Consolidated Sanctions',
        list_source: 'EU' as ComplianceListSource,
        entry_id: 'EU-001',
        name: 'XYZ Trading Ltd',
        entity_type: 'Entity',
        country: 'Russia',
        address: 'Moscow, Russia',
        remarks: 'Sanctions evasion',
        listing_date: new Date('2022-03-01'),
        last_updated: new Date('2024-01-01'),
        status: 'active'
      }
    ];

    for (const sanction of sampleSanctions) {
      await tx.client.query(
        `INSERT INTO sanctions_lists (
          list_name, list_source, entry_id, name, entity_type, 
          country, address, remarks, listing_date, last_updated, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          sanction.list_name,
          sanction.list_source,
          sanction.entry_id,
          sanction.name,
          sanction.entity_type,
          sanction.country,
          sanction.address,
          sanction.remarks,
          sanction.listing_date,
          sanction.last_updated,
          sanction.status
        ]
      );
    }

    console.log('Seeding classifications...');
    
    // Create sample classifications for shipments
    const sampleClassifications = [
      {
        hs_code: '61091000',
        hs_code_description: 'T-shirts, singlets and other vests, knitted or crocheted, of cotton',
        confidence: 0.95,
        ambiguity_flag: false,
        duty_rate: 10.0,
        cess_rate: 0.0,
        total_duty_rate: 10.0,
        duty_estimate: 50000,
        landed_cost_estimate: 550000,
        eta_estimate_days: 3,
        clearance_time_prediction: 'Standard clearance time - approximately 3 days',
        port_congestion_flag: false,
        classification_method: 'rules_based' as ClassificationMethod,
        classification_notes: 'Exact match found in HS code database',
        status: 'approved' as ClassificationStatus
      },
      {
        hs_code: '62034200',
        hs_code_description: 'Men\'s or boys\' suits, of synthetic fibres',
        confidence: 0.85,
        ambiguity_flag: false,
        duty_rate: 15.0,
        cess_rate: 2.0,
        total_duty_rate: 17.0,
        duty_estimate: 127500,
        landed_cost_estimate: 877500,
        eta_estimate_days: 4,
        clearance_time_prediction: 'Standard clearance time - approximately 4 days',
        port_congestion_flag: false,
        classification_method: 'rules_based' as ClassificationMethod,
        classification_notes: 'Keyword match: Men\'s suits',
        status: 'approved' as ClassificationStatus
      },
      {
        hs_code: '10063000',
        hs_code_description: 'Rice, semi-milled or wholly milled, whether or not polished or glaze',
        confidence: 0.90,
        ambiguity_flag: false,
        duty_rate: 30.0,
        cess_rate: 0.0,
        total_duty_rate: 30.0,
        duty_estimate: 300000,
        landed_cost_estimate: 1300000,
        eta_estimate_days: 2,
        clearance_time_prediction: 'Fast clearance expected - approximately 2 days',
        port_congestion_flag: false,
        classification_method: 'rules_based' as ClassificationMethod,
        classification_notes: 'Exact match found: Basmati Rice',
        status: 'approved' as ClassificationStatus
      }
    ];

    // Get shipments that need classifications
    const shipmentsResult = await tx.client.query<{ id: string; tenant_id: string }>(
      `SELECT id, tenant_id FROM shipments 
       WHERE stage IN ('customs_classified', 'ready_to_file', 'filed')
       ORDER BY RANDOM() 
       LIMIT 3`
    );

    const shipments = shipmentsResult.rows;

    for (let i = 0; i < shipments.length; i++) {
      const shipment = shipments[i];
      const classification = sampleClassifications[i];

      await tx.client.query(
        `INSERT INTO classifications (
          shipment_id, tenant_id, hs_code, hs_code_description, 
          confidence, ambiguity_flag, duty_rate, cess_rate, total_duty_rate,
          duty_estimate, landed_cost_estimate, eta_estimate_days, 
          clearance_time_prediction, port_congestion_flag, 
          classification_method, classification_notes, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
        [
          shipment.id,
          shipment.tenant_id,
          classification.hs_code,
          classification.hs_code_description,
          classification.confidence,
          classification.ambiguity_flag,
          classification.duty_rate,
          classification.cess_rate,
          classification.total_duty_rate,
          classification.duty_estimate,
          classification.landed_cost_estimate,
          classification.eta_estimate_days,
          classification.clearance_time_prediction,
          classification.port_congestion_flag,
          classification.classification_method,
          classification.classification_notes,
          classification.status
        ]
      );

      // Update shipment stage if classification is complete
      if (classification.status === 'approved') {
        await tx.client.query(
          'UPDATE shipments SET customs_classification_status = $1 WHERE id = $2',
          ['completed', shipment.id]
        );
      }
    }

    console.log('Seeding payments...');
    
    // Create sample payments
    const samplePayments = [
      {
        payment_date: new Date('2024-01-20'),
        amount: 500000,
        currency: 'INR',
        payment_method: 'lc' as const,
        payment_status: 'received' as const,
        lc_number: 'LC-2024-001',
        lc_issuing_bank: 'Bank of America',
        lc_expiry_date: new Date('2024-03-01'),
        days_overdue: 0,
        payment_notes: 'Payment received on time'
      },
      {
        payment_date: new Date('2024-01-25'),
        amount: 750000,
        currency: 'INR',
        payment_method: 'tt' as const,
        payment_status: 'received' as const,
        days_overdue: 0,
        payment_notes: 'TT payment received'
      },
      {
        payment_date: new Date('2024-01-18'),
        amount: 1000000,
        currency: 'USD',
        payment_method: 'lc' as const,
        payment_status: 'received' as const,
        lc_number: 'LC-2024-002',
        lc_issuing_bank: 'DBS Bank',
        lc_expiry_date: new Date('2024-03-15'),
        days_overdue: 0,
        payment_notes: 'LC payment for agro products'
      }
    ];

    // Get shipments for payments
    const allShipmentsResult = await tx.client.query<{ id: string; tenant_id: string; buyer_id: string }>(
      'SELECT id, tenant_id, buyer_id FROM shipments WHERE buyer_id IS NOT NULL ORDER BY RANDOM() LIMIT 3'
    );

    const allShipments = allShipmentsResult.rows;

    for (let i = 0; i < allShipments.length; i++) {
      const shipment = allShipments[i];
      const payment = samplePayments[i];

      await tx.client.query(
        `INSERT INTO payments (
          shipment_id, tenant_id, buyer_id, payment_date, amount, 
          currency, payment_method, payment_status, lc_number, 
          lc_issuing_bank, lc_expiry_date, days_overdue, payment_notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          shipment.id,
          shipment.tenant_id,
          shipment.buyer_id,
          payment.payment_date,
          payment.amount,
          payment.currency,
          payment.payment_method,
          payment.payment_status,
          payment.lc_number,
          payment.lc_issuing_bank,
          payment.lc_expiry_date,
          payment.days_overdue,
          payment.payment_notes
        ]
      );
    }

    console.log('Seeding audit logs...');
    
    // Create sample audit log entries
    const sampleAuditLogs = [
      {
        shipment_id: null,
        tenant_id: null,
        actor_type: 'system' as const,
        actor_ref: 'system',
        action: 'database_seeded',
        input_ref: {},
        output_ref: { message: 'Database seeding started' },
        decision: null,
        confidence: null,
        agent_version: null,
        model_version: null,
        prompt_version: null,
        metadata: { seeded_by: 'seed_script' },
        ip_address: null,
        user_agent: null
      }
    ];

    for (const tenant of tenants) {
      for (const log of sampleAuditLogs) {
        await tx.client.query(
          `INSERT INTO audit_log (
            shipment_id, tenant_id, actor_type, actor_ref, action, 
            input_ref, output_ref, decision, confidence, 
            agent_version, model_version, prompt_version, metadata, 
            ip_address, user_agent
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            log.shipment_id,
            tenant.id,
            log.actor_type,
            log.actor_ref,
            log.action,
            log.input_ref,
            log.output_ref,
            log.decision,
            log.confidence,
            log.agent_version,
            log.model_version,
            log.prompt_version,
            log.metadata,
            log.ip_address,
            log.user_agent
          ]
        );
      }
    }

    await tx.commit();
    
    console.log('Database seeding completed successfully!');
    console.log('');
    console.log('Created:');
    console.log(`- ${tenants.length + 1} tenants (including admin)`);
    console.log(`- ${tenants.length} users (tenant owners)`);
    console.log(`- ${sampleBuyers.length * tenants.length} buyers`);
    console.log(`- ${sampleShipments.length * tenants.length} shipments`);
    console.log(`- ${documentTypes.length * sampleShipments.filter(s => s.stage === 'documents_generated' || s.stage === 'compliance_screened').length * tenants.length} documents`);
    console.log(`- ${samplePolicyAlerts.length * tenants.length} policy alerts`);
    console.log(`- ${sampleSanctions.length} sanctions list entries`);
    console.log(`- ${sampleClassifications.length} classifications`);
    console.log(`- ${samplePayments.length} payments`);
    console.log(`- ${sampleAuditLogs.length * tenants.length} audit log entries`);

  } catch (error) {
    await tx.rollback();
    console.error('Error seeding database:', error);
    throw error;
  }
}

// Run seeding if this file is executed directly
if (require.main === module) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Seeding failed:', error);
      process.exit(1);
    });
}

export { seedDatabase };
