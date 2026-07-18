import { BaseAgent, AgentResult, AgentFactory } from './baseAgent';
import { query, beginTransaction } from '../db/connection';
import { auditLogger } from '../core/auditLogger';
import { stateMachine } from '../core/stateMachine';
import {
  AgentType,
  DocumentType,
  DocumentStatus,
  Shipment,
  Document,
  Incoterms
} from '../types';

// Invoice parsing result interface
interface InvoiceParsingResult {
  invoiceNumber?: string;
  invoiceDate?: Date;
  invoiceValue: number;
  currency: string;
  buyerName?: string;
  buyerAddress?: string;
  buyerCountry?: string;
  sellerName?: string;
  sellerAddress?: string;
  productDescription?: string;
  productCategory?: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  totalValue: number;
  incoterms?: Incoterms;
  paymentTerms?: string;
  originPort?: string;
  destinationPort?: string;
  vesselName?: string;
  voyageNumber?: string;
  etd?: Date;
  eta?: Date;
  shippingLine?: string;
}

// Document generation options
interface DocumentGenerationOptions {
  regenerate?: boolean;
  includeTypes?: DocumentType[];
  templateId?: string;
  manualOverrides?: Record<string, any>;
}

// Document template interface
interface DocumentTemplate {
  id: string;
  name: string;
  type: DocumentType;
  template: string;
  variables: string[];
  version: string;
}

// Default templates for document generation
const DEFAULT_TEMPLATES: Record<DocumentType, string> = {
  commercial_invoice: `
# COMMERCIAL INVOICE

**Invoice No:** {{invoiceNumber}}
**Date:** {{invoiceDate}}

**Seller:**
{{sellerName}}
{{sellerAddress}}

**Buyer:**
{{buyerName}}
{{buyerAddress}}
{{buyerCountry}}

**Shipment Details:**
- Product: {{productDescription}}
- Quantity: {{quantity}} {{unit}}
- Unit Price: {{currency}} {{unitPrice}}
- Total Value: {{currency}} {{totalValue}}

**Terms:**
- Incoterms: {{incoterms}}
- Payment Terms: {{paymentTerms}}

**Shipping Information:**
- Origin Port: {{originPort}}
- Destination Port: {{destinationPort}}
- Vessel: {{vesselName}}
- Voyage No: {{voyageNumber}}
- ETD: {{etd}}
- ETA: {{eta}}

**Total Invoice Value:** {{currency}} {{invoiceValue}}

---
*This is a system-generated document. Please review and verify all details before submission.*
`,

  packing_list: `
# PACKING LIST

**Shipment No:** {{shipmentNumber}}
**Invoice No:** {{invoiceNumber}}
**Date:** {{invoiceDate}}

**Consignee:**
{{buyerName}}
{{buyerAddress}}
{{buyerCountry}}

**Product Details:**
- Description: {{productDescription}}
- Category: {{productCategory}}
- Quantity: {{quantity}} {{unit}}
- Gross Weight: {{grossWeight}} kg
- Net Weight: {{netWeight}} kg
- Volume: {{volume}} m³

**Packaging:**
- Number of Packages: {{packageCount}}
- Package Type: {{packageType}}
- Marks & Numbers: {{marksAndNumbers}}

**Shipping Marks:**
{{shippingMarks}}

---
*This packing list is automatically generated from the invoice data.*
`,

  coo_draft: `
# CERTIFICATE OF ORIGIN (DRAFT)

**Certificate No:** COO-{{shipmentNumber}}
**Date:** {{invoiceDate}}

**Exporter:**
{{sellerName}}
{{sellerAddress}}

**Consignee:**
{{buyerName}}
{{buyerAddress}}
{{buyerCountry}}

**Product Details:**
- Description: {{productDescription}}
- HS Code: {{hsCode}}
- Quantity: {{quantity}} {{unit}}
- Value: {{currency}} {{totalValue}}

**Origin Criteria:**
- Country of Origin: India
- Manufacturing Process: {{manufacturingProcess}}
- Raw Materials: {{rawMaterials}}

**Certification:**
We hereby certify that the goods described above are of Indian origin and comply with the rules of origin as specified in the relevant trade agreements.

**Authorized Signatory:**
_________________________
Name: {{signatoryName}}
Designation: {{signatoryDesignation}}
Date: {{invoiceDate}}

---
*This is a draft certificate. Please verify all details and obtain proper authorization before submission.*
`,

  shipping_bill_draft: `
# SHIPPING BILL (DRAFT)

**Bill No:** SB-{{shipmentNumber}}
**Date:** {{invoiceDate}}

**Exporter:**
{{sellerName}}
{{sellerAddress}}

**Consignee:**
{{buyerName}}
{{buyerAddress}}
{{buyerCountry}}

**Vessel Details:**
- Name: {{vesselName}}
- Voyage No: {{voyageNumber}}
- Shipping Line: {{shippingLine}}
- Port of Loading: {{originPort}}
- Port of Discharge: {{destinationPort}}
- ETD: {{etd}}
- ETA: {{eta}}

**Cargo Details:**
- Description: {{productDescription}}
- Quantity: {{quantity}} {{unit}}
- Value: {{currency}} {{totalValue}}
- HS Code: {{hsCode}}

**Freight Details:**
- Freight Prepaid/Collect: {{freightTerms}}
- Freight Amount: {{currency}} {{freightAmount}}

**Customs Information:**
- Customs Port: {{customsPort}}
- Assessment No: {{assessmentNumber}}
- Duty Amount: {{currency}} {{dutyAmount}}

---
*This is a draft shipping bill. Please complete all required fields and verify with customs authorities.*
`,

  lc_document_package: `
# LC DOCUMENT PACKAGE

**LC Number:** {{lcNumber}}
**Issuing Bank:** {{lcIssuingBank}}
**Beneficiary:** {{sellerName}}
**Applicant:** {{buyerName}}

**Documents Included:**
1. Commercial Invoice ({{invoiceNumber}})
2. Packing List
3. Certificate of Origin
4. Shipping Bill
5. Bill of Lading
6. Insurance Certificate
7. Inspection Certificate

**Shipment Details:**
- Invoice No: {{invoiceNumber}}
- Invoice Date: {{invoiceDate}}
- Invoice Value: {{currency}} {{invoiceValue}}
- Product: {{productDescription}}
- Quantity: {{quantity}} {{unit}}

**Shipping Details:**
- Vessel: {{vesselName}}
- Voyage No: {{voyageNumber}}
- ETD: {{etd}}
- ETA: {{eta}}

**LC Terms:**
- LC Amount: {{currency}} {{lcAmount}}
- LC Expiry: {{lcExpiryDate}}
- Payment Terms: {{paymentTerms}}
- Negotiation Bank: {{negotiationBank}}

---
*This document package is prepared for LC submission. Please ensure all documents are properly signed and stamped.*
`,

  other: `
# DOCUMENT

**Type:** {{documentType}}
**Shipment No:** {{shipmentNumber}}
**Date:** {{invoiceDate}}

**Content:**
{{content}}

---
*System-generated document*
`
};

// Cross-field validation rules
const VALIDATION_RULES = [
  {
    name: 'invoice_value_matches',
    check: (data: InvoiceParsingResult) => data.invoiceValue === data.totalValue,
    error: 'Invoice value does not match total value (quantity × unit price)'
  },
  {
    name: 'positive_quantity',
    check: (data: InvoiceParsingResult) => data.quantity > 0,
    error: 'Quantity must be positive'
  },
  {
    name: 'positive_unit_price',
    check: (data: InvoiceParsingResult) => data.unitPrice > 0,
    error: 'Unit price must be positive'
  },
  {
    name: 'valid_currency',
    check: (data: InvoiceParsingResult) => /^[A-Z]{3}$/.test(data.currency),
    error: 'Currency must be a 3-letter ISO code'
  },
  {
    name: 'valid_incoterms',
    check: (data: InvoiceParsingResult) => {
      if (!data.incoterms) return true;
      const validIncoterms: Incoterms[] = [
        'EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP',
        'FAS', 'FOB', 'CFR', 'CIF'
      ];
      return validIncoterms.includes(data.incoterms as Incoterms);
    },
    error: 'Invalid Incoterms'
  }
];

export class DocumentationAgent extends BaseAgent {
  private templates: Map<DocumentType, DocumentTemplate>;

  constructor() {
    super({
      agentType: 'documentation',
      version: '1.0.0',
      model: 'claude-3-sonnet-20240229',
      confidenceThreshold: 0.85
    });

    // Initialize templates
    this.templates = new Map();
    this.loadDefaultTemplates();
  }

  getAgentType(): AgentType {
    return 'documentation';
  }

  protected getRequiredStage(): string | null {
    return 'draft';
  }

  private loadDefaultTemplates(): void {
    Object.entries(DEFAULT_TEMPLATES).forEach(([type, template]) => {
      this.templates.set(type as DocumentType, {
        id: `default_${type}`,
        name: `Default ${type.replace('_', ' ')}`,
        type: type as DocumentType,
        template,
        variables: this.extractTemplateVariables(template),
        version: '1.0.0'
      });
    });
  }

  private extractTemplateVariables(template: string): string[] {
    const variablePattern = /\{\{([^}]+)\}\}/g;
    const variables: Set<string> = new Set();
    let match;

    while ((match = variablePattern.exec(template)) !== null) {
      variables.add(match[1].trim());
    }

    return Array.from(variables);
  }

  async execute(
    shipmentId: string,
    tenantId: string,
    options: DocumentGenerationOptions = {}
  ): Promise<AgentResult> {
    this.startExecution();

    try {
      // Get shipment data
      const shipment = await this.getShipmentData(shipmentId);
      if (!shipment) {
        return this.handleError(new Error('Shipment not found'), 'execute');
      }

      // Check if we need to regenerate or if documents already exist
      if (!options.regenerate) {
        const existingDocs = await query<Document>(
          'SELECT * FROM documents WHERE shipment_id = $1',
          [shipmentId]
        );

        if (existingDocs.rows.length > 0) {
          return this.generateOutput({
            message: 'Documents already generated',
            documentCount: existingDocs.rows.length,
            documents: existingDocs.rows
          }, 1.0);
        }
      }

      // Parse invoice data (in a real implementation, this would use OCR/parsing tools)
      const parsingResult = await this.parseInvoice(shipmentId, tenantId);
      
      if (!parsingResult.success) {
        return parsingResult;
      }

      // Validate parsed data
      const validation = this.validateParsedData(parsingResult.data);
      
      if (!validation.valid) {
        return this.generateOutput(
          {
            message: 'Invoice parsing completed with validation errors',
            parsedData: parsingResult.data,
            validationErrors: validation.errors
          },
          0.5,
          [],
          validation.errors
        );
      }

      // Generate documents
      const generatedDocs: Document[] = [];
      const documentTypes = options.includeTypes || [
        'commercial_invoice',
        'packing_list',
        'coo_draft',
        'shipping_bill_draft',
        'lc_document_package'
      ];

      for (const docType of documentTypes) {
        const docResult = await this.generateDocument(
          shipmentId,
          tenantId,
          docType,
          parsingResult.data,
          shipment
        );
        
        if (docResult) {
          generatedDocs.push(docResult);
        }
      }

      // Perform cross-field validation
      const crossValidation = this.performCrossFieldValidation(parsingResult.data);

      // Update shipment status
      await this.updateShipmentAgentStatus(
        shipmentId,
        'document_generation_status',
        'completed'
      );

      // Log the document generation
      await this.logAction(
        shipmentId,
        tenantId,
        'documents_generated',
        { shipmentId, options },
        {
          documentCount: generatedDocs.length,
          validationResults: crossValidation,
          parsingConfidence: parsingResult.confidence
        },
        parsingResult.confidence
      );

      // Check if we can auto-advance the stage
      const canAdvance = await stateMachine.canAdvance(shipmentId);
      if (canAdvance.canAdvance) {
        // Auto-advance if all documents are valid
        if (crossValidation.discrepancies.length === 0) {
          await stateMachine.advanceStage(shipmentId, 'system');
        }
      }

      return this.endExecution(this.generateOutput(
        {
          message: 'Documents generated successfully',
          documentCount: generatedDocs.length,
          documents: generatedDocs,
          validationResults: crossValidation,
          parsingResult: parsingResult.data
        },
        parsingResult.confidence,
        crossValidation.discrepancies,
        crossValidation.warnings
      ));

    } catch (error) {
      return this.handleError(error as Error, 'execute');
    }
  }

  /**
   * Parse invoice data from various sources
   */
  private async parseInvoice(
    shipmentId: string,
    tenantId: string
  ): Promise<AgentResult<InvoiceParsingResult>> {
    try {
      // In a real implementation, this would:
      // 1. Check for uploaded invoice files
      // 2. Use OCR to extract text from PDFs/images
      // 3. Parse structured data from Excel/CSV
      // 4. Use LLM for field extraction and validation
      
      // For now, we'll get data from the shipment record
      const shipment = await this.getShipmentData(shipmentId);
      if (!shipment) {
        return {
          success: false,
          errors: ['Shipment not found'],
          discrepancies: [],
          warnings: [],
          confidence: 0,
          timestamp: new Date()
        };
      }

      // Get buyer data if available
      let buyerData: any = {};
      if (shipment.buyer_id) {
        const buyer = await this.getBuyerData(shipment.buyer_id);
        if (buyer) {
          buyerData = {
            buyerName: buyer.name,
            buyerAddress: buyer.address,
            buyerCountry: buyer.country,
            buyerCity: buyer.city,
            buyerState: buyer.state
          };
        }
      }

      // Build parsing result from shipment data
      const parsingResult: InvoiceParsingResult = {
        invoiceNumber: shipment.invoice_number,
        invoiceDate: shipment.invoice_date,
        invoiceValue: shipment.invoice_value,
        currency: shipment.currency,
        productDescription: shipment.product_description,
        productCategory: shipment.product_category,
        quantity: shipment.quantity,
        unit: shipment.unit,
        unitPrice: shipment.unit_price,
        totalValue: shipment.total_value,
        incoterms: shipment.incoterms,
        paymentTerms: shipment.payment_terms,
        originPort: shipment.origin_port,
        destinationPort: shipment.destination_port,
        vesselName: shipment.vessel_name,
        voyageNumber: shipment.voyage_number,
        etd: shipment.etd,
        eta: shipment.eta,
        shippingLine: shipment.shipping_line,
        ...buyerData
      };

      // Calculate confidence based on data completeness
      const confidence = this.calculateParsingConfidence(parsingResult);

      return {
        success: true,
        data: parsingResult,
        discrepancies: [],
        warnings: [],
        errors: [],
        confidence,
        timestamp: new Date()
      };

    } catch (error) {
      console.error('Error parsing invoice:', error);
      return {
        success: false,
        errors: [error instanceof Error ? error.message : 'Unknown parsing error'],
        discrepancies: [],
        warnings: [],
        confidence: 0,
        timestamp: new Date()
      };
    }
  }

  /**
   * Calculate parsing confidence based on data completeness
   */
  private calculateParsingConfidence(data: InvoiceParsingResult): number {
    const requiredFields = [
      'invoiceNumber',
      'invoiceDate',
      'invoiceValue',
      'currency',
      'productDescription',
      'quantity',
      'unitPrice'
    ];

    const optionalFields = [
      'buyerName',
      'incoterms',
      'paymentTerms',
      'originPort',
      'destinationPort'
    ];

    let score = 0;
    const totalWeight = requiredFields.length + optionalFields.length * 0.5;

    // Check required fields
    for (const field of requiredFields) {
      if (data[field as keyof InvoiceParsingResult]) {
        score += 1;
      }
    }

    // Check optional fields
    for (const field of optionalFields) {
      if (data[field as keyof InvoiceParsingResult]) {
        score += 0.5;
      }
    }

    // Calculate confidence (0-1)
    const confidence = score / totalWeight;
    
    // Cap at 0.95 to account for potential errors
    return Math.min(confidence, 0.95);
  }

  /**
   * Validate parsed data
   */
  private validateParsedData(data: InvoiceParsingResult): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const rule of VALIDATION_RULES) {
      try {
        if (!rule.check(data)) {
          errors.push(rule.error);
        }
      } catch (error) {
        errors.push(`Validation error: ${rule.error}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Perform cross-field validation
   */
  private performCrossFieldValidation(data: InvoiceParsingResult): {
    discrepancies: any[];
    warnings: string[];
  } {
    const discrepancies: any[] = [];
    const warnings: string[] = [];

    // Check if invoice value matches calculated total
    const calculatedTotal = data.quantity * data.unitPrice;
    if (Math.abs(data.invoiceValue - calculatedTotal) > 0.01) {
      discrepancies.push({
        type: 'value_mismatch',
        field: 'invoiceValue',
        expected: calculatedTotal,
        actual: data.invoiceValue,
        severity: 'high',
        message: 'Invoice value does not match quantity × unit price'
      });
    }

    // Check if currency is valid
    if (!/^[A-Z]{3}$/.test(data.currency)) {
      warnings.push(`Currency code '${data.currency}' may not be valid`);
    }

    // Check if quantity is reasonable
    if (data.quantity > 1000000) {
      warnings.push('Unusually large quantity detected');
    }

    // Check if unit price is reasonable
    if (data.unitPrice > 1000000) {
      warnings.push('Unusually high unit price detected');
    }

    return { discrepancies, warnings };
  }

  /**
   * Generate a single document
   */
  private async generateDocument(
    shipmentId: string,
    tenantId: string,
    docType: DocumentType,
    data: InvoiceParsingResult,
    shipment: Shipment
  ): Promise<Document | null> {
    try {
      const template = this.templates.get(docType);
      if (!template) {
        console.warn(`No template found for document type: ${docType}`);
        return null;
      }

      // Prepare template variables
      const variables = this.prepareTemplateVariables(data, shipment, docType);

      // Render the template
      const content = this.renderTemplate(template.template, variables);

      // Generate file name
      const fileName = this.generateFileName(docType, shipment, data);

      // Create document record
      const result = await query<Document>(
        `INSERT INTO documents (
          shipment_id, tenant_id, type, status, 
          generated_by_agent_version, storage_ref, file_name, 
          content, discrepancy_flags, validation_errors, confidence_score, generated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
        RETURNING *`,
        [
          shipmentId,
          tenantId,
          docType,
          'generated',
          this.config.version,
          `documents/${shipmentId}/${fileName}`,
          fileName,
          content,
          JSON.stringify([]), // discrepancy_flags
          JSON.stringify([]), // validation_errors
          0.95 // confidence_score
        ]
      );

      return result.rows[0];

    } catch (error) {
      console.error(`Error generating document ${docType}:`, error);
      return null;
    }
  }

  /**
   * Prepare template variables
   */
  private prepareTemplateVariables(
    data: InvoiceParsingResult,
    shipment: Shipment,
    docType: DocumentType
  ): Record<string, any> {
    const variables: Record<string, any> = {
      // Shipment info
      shipmentNumber: shipment.shipment_number,
      invoiceNumber: data.invoiceNumber || shipment.invoice_number || 'N/A',
      invoiceDate: data.invoiceDate ? this.formatDate(data.invoiceDate) : shipment.invoice_date ? this.formatDate(shipment.invoice_date) : 'N/A',
      
      // Seller info (would come from tenant data in real implementation)
      sellerName: 'Exporter Company',
      sellerAddress: '123 Export Street, Mumbai, India',
      
      // Buyer info
      buyerName: data.buyerName || 'Buyer Company',
      buyerAddress: data.buyerAddress || 'Buyer Address',
      buyerCountry: data.buyerCountry || 'N/A',
      buyerCity: data.buyerCity || 'N/A',
      buyerState: data.buyerState || 'N/A',
      
      // Product info
      productDescription: data.productDescription || shipment.product_description || 'N/A',
      productCategory: data.productCategory || shipment.product_category || 'N/A',
      quantity: data.quantity || shipment.quantity || 0,
      unit: data.unit || shipment.unit || 'PCS',
      unitPrice: data.unitPrice || shipment.unit_price || 0,
      totalValue: data.totalValue || shipment.total_value || 0,
      
      // Financial info
      invoiceValue: data.invoiceValue || shipment.invoice_value || 0,
      currency: data.currency || shipment.currency || 'INR',
      incoterms: data.incoterms || shipment.incoterms || 'FOB',
      paymentTerms: data.paymentTerms || shipment.payment_terms || 'LC at sight',
      
      // Shipping info
      originPort: data.originPort || shipment.origin_port || 'N/A',
      destinationPort: data.destinationPort || shipment.destination_port || 'N/A',
      vesselName: data.vesselName || shipment.vessel_name || 'N/A',
      voyageNumber: data.voyageNumber || shipment.voyage_number || 'N/A',
      etd: data.etd ? this.formatDate(data.etd) : shipment.etd ? this.formatDate(shipment.etd) : 'N/A',
      eta: data.eta ? this.formatDate(data.eta) : shipment.eta ? this.formatDate(shipment.eta) : 'N/A',
      shippingLine: data.shippingLine || shipment.shipping_line || 'N/A',
      
      // Additional fields for specific document types
      grossWeight: '100 kg',
      netWeight: '95 kg',
      volume: '0.5 m³',
      packageCount: '10',
      packageType: 'Cartons',
      marksAndNumbers: 'MARK-001',
      shippingMarks: 'Handle with care',
      manufacturingProcess: 'Manufactured in India',
      rawMaterials: '100% Indian raw materials',
      signatoryName: 'Authorized Signatory',
      signatoryDesignation: 'Director',
      hsCode: 'N/A',
      freightTerms: 'Prepaid',
      freightAmount: '0',
      customsPort: data.destinationPort || shipment.destination_port || 'N/A',
      assessmentNumber: 'ASMT-001',
      dutyAmount: '0',
      lcNumber: 'LC-001',
      lcIssuingBank: 'Bank of Baroda',
      lcAmount: data.invoiceValue || shipment.invoice_value || 0,
      lcExpiryDate: data.invoiceDate ? this.formatDate(new Date(data.invoiceDate.getTime() + 30 * 24 * 60 * 60 * 1000)) : 'N/A',
      negotiationBank: 'State Bank of India',
      documentType: docType.replace('_', ' ').toUpperCase()
    };

    return variables;
  }

  /**
   * Render template with variables
   */
  private renderTemplate(template: string, variables: Record<string, any>): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (match, variableName) => {
      const trimmedName = variableName.trim();
      return variables[trimmedName] !== undefined ? variables[trimmedName] : match;
    });
  }

  /**
   * Generate file name for document
   */
  private generateFileName(docType: DocumentType, shipment: Shipment, data: InvoiceParsingResult): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const shipmentNumber = shipment.shipment_number || 'SHIPMENT';
    const invoiceNumber = data.invoiceNumber || shipment.invoice_number || 'INV';
    
    const typeMap: Record<DocumentType, string> = {
      commercial_invoice: 'COMMERCIAL_INVOICE',
      packing_list: 'PACKING_LIST',
      coo_draft: 'COO_DRAFT',
      shipping_bill_draft: 'SHIPPING_BILL',
      lc_document_package: 'LC_DOCUMENTS',
      other: 'DOCUMENT'
    };

    return `${shipmentNumber}_${invoiceNumber}_${typeMap[docType]}_${timestamp}.txt`;
  }

  /**
   * Format date for display
   */
  private formatDate(date: Date | string): string {
    if (!date) return 'N/A';
    
    if (typeof date === 'string') {
      return new Date(date).toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    }

    return date.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  /**
   * Regenerate documents for a shipment
   */
  async regenerateDocuments(
    shipmentId: string,
    tenantId: string,
    options: DocumentGenerationOptions = {}
  ): Promise<AgentResult> {
    // Delete existing documents
    await query(
      'DELETE FROM documents WHERE shipment_id = $1',
      [shipmentId]
    );

    // Reset shipment status
    await query(
      'UPDATE shipments SET document_generation_status = $1 WHERE id = $2',
      ['pending', shipmentId]
    );

    // Execute document generation
    return this.execute(shipmentId, tenantId, { ...options, regenerate: true });
  }

  /**
   * Validate generated documents
   */
  async validateDocuments(shipmentId: string, tenantId: string): Promise<AgentResult> {
    try {
      const documents = await query<Document>(
        'SELECT * FROM documents WHERE shipment_id = $1',
        [shipmentId]
      );

      const validationResults: any[] = [];
      const warnings: string[] = [];
      const errors: string[] = [];

      for (const doc of documents.rows) {
        const result = await this.validateDocument(doc);
        validationResults.push(result);
        
        if (result.errors.length > 0) {
          errors.push(...result.errors);
        }
        
        if (result.warnings.length > 0) {
          warnings.push(...result.warnings);
        }
      }

      const confidence = validationResults.every(r => r.errors.length === 0) ? 1.0 : 0.5;

      return this.generateOutput(
        {
          message: 'Document validation completed',
          validationResults,
          valid: errors.length === 0
        },
        confidence,
        [],
        warnings,
        errors
      );

    } catch (error) {
      return this.handleError(error as Error, 'validateDocuments');
    }
  }

  /**
   * Validate a single document
   */
  private async validateDocument(doc: Document): Promise<{
    documentId: string;
    documentType: DocumentType;
    errors: string[];
    warnings: string[];
    valid: boolean;
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check if content is empty
    if (!doc.content || doc.content.trim().length === 0) {
      errors.push('Document content is empty');
    }

    // Check if file name is valid
    if (!doc.file_name || doc.file_name.length < 5) {
      warnings.push('File name may be too short');
    }

    // Type-specific validations
    switch (doc.type) {
      case 'commercial_invoice':
        if (!doc.content.includes('Invoice No') || !doc.content.includes('Invoice No:')) {
          warnings.push('Commercial invoice may be missing invoice number');
        }
        break;

      case 'packing_list':
        if (!doc.content.includes('Packing List') && !doc.content.includes('PACKING LIST')) {
          warnings.push('Packing list may be missing title');
        }
        break;

      case 'coo_draft':
        if (!doc.content.includes('Certificate of Origin') && !doc.content.includes('CERTIFICATE OF ORIGIN')) {
          warnings.push('COO draft may be missing certificate title');
        }
        break;
    }

    return {
      documentId: doc.id,
      documentType: doc.type,
      errors,
      warnings,
      valid: errors.length === 0
    };
  }

  /**
   * Get document generation status
   */
  async getStatus(shipmentId: string): Promise<{
    status: string;
    documentCount: number;
    generatedAt?: Date;
    validationStatus: string;
  }> {
    try {
      const result = await query<{
        document_generation_status: string;
        created_at: Date;
      }>(
        'SELECT document_generation_status, created_at FROM shipments WHERE id = $1',
        [shipmentId]
      );

      if (result.rows.length === 0) {
        return {
          status: 'not_started',
          documentCount: 0,
          validationStatus: 'pending'
        };
      }

      const shipment = result.rows[0];
      
      const docsResult = await query<Document>(
        'SELECT COUNT(*) as count, MIN(generated_at) as generated_at FROM documents WHERE shipment_id = $1',
        [shipmentId]
      );

      const docCount = docsResult.rows[0]?.count || 0;
      const generatedAt = docsResult.rows[0]?.generated_at;

      return {
        status: shipment.document_generation_status,
        documentCount: parseInt(docCount),
        generatedAt,
        validationStatus: docCount > 0 ? 'completed' : 'pending'
      };

    } catch (error) {
      console.error('Error getting document generation status:', error);
      return {
        status: 'error',
        documentCount: 0,
        validationStatus: 'failed'
      };
    }
  }
}

// Register the agent with the factory
AgentFactory.registerAgent('documentation', new DocumentationAgent());

export default DocumentationAgent;
