import { Worker, Queue, Job } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';
import { query } from '../db/connection';
import { AgentFactory } from '../agents/baseAgent';
import { auditLogger } from '../core/auditLogger';
import { stateMachine } from '../core/stateMachine';

// Load environment variables
dotenv.config();

// Queue names
const QUEUE_NAMES = {
  DOCUMENT_GENERATION: 'document_generation',
  COMPLIANCE_SCREENING: 'compliance_screening',
  BUYER_VERIFICATION: 'buyer_verification',
  CUSTOMS_CLASSIFICATION: 'customs_classification',
  POLICY_MONITORING: 'policy_monitoring',
  SHIPMENT_PROCESSING: 'shipment_processing'
};

// Create Redis connection
const connection = new IORedis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: null,
});

// Create queues
const queues: Record<string, Queue> = {};
for (const [name, queueName] of Object.entries(QUEUE_NAMES)) {
  queues[name] = new Queue(queueName, { connection });
}

// Job types
interface DocumentGenerationJob {
  shipmentId: string;
  tenantId: string;
  userId: string;
  options?: any;
}

interface ComplianceScreeningJob {
  shipmentId: string;
  tenantId: string;
  userId: string;
  options?: any;
}

interface BuyerVerificationJob {
  shipmentId: string;
  tenantId: string;
  userId: string;
  options?: any;
}

interface CustomsClassificationJob {
  shipmentId: string;
  tenantId: string;
  userId: string;
  options?: any;
}

interface PolicyMonitoringJob {
  tenantId: string;
  options?: any;
}

interface ShipmentProcessingJob {
  shipmentId: string;
  tenantId: string;
  userId: string;
  runAllAgents?: boolean;
}

// Worker for document generation
const documentWorker = new Worker(
  QUEUE_NAMES.DOCUMENT_GENERATION,
  async (job: Job<DocumentGenerationJob>) => {
    const { shipmentId, tenantId, userId, options } = job.data;
    
    try {
      console.log(`Processing document generation for shipment ${shipmentId}`);
      
      const docAgent = AgentFactory.getAgent('documentation');
      if (!docAgent) {
        throw new Error('Documentation agent not available');
      }

      const result = await docAgent.execute(shipmentId, tenantId, options);

      // Log the job completion
      await auditLogger.logSystemAction(
        tenantId,
        'document_generation_job_completed',
        { shipmentId, jobId: job.id },
        { result },
        { processedBy: 'queue_worker' }
      );

      return { success: true, result };
    } catch (error) {
      console.error(`Error processing document generation job ${job.id}:`, error);
      
      await auditLogger.logSystemAction(
        tenantId,
        'document_generation_job_failed',
        { shipmentId, jobId: job.id },
        { error: error instanceof Error ? error.message : 'Unknown error' },
        { processedBy: 'queue_worker' }
      );

      throw error;
    }
  },
  { connection }
);

// Worker for compliance screening
const complianceWorker = new Worker(
  QUEUE_NAMES.COMPLIANCE_SCREENING,
  async (job: Job<ComplianceScreeningJob>) => {
    const { shipmentId, tenantId, userId, options } = job.data;
    
    try {
      console.log(`Processing compliance screening for shipment ${shipmentId}`);
      
      const complianceAgent = AgentFactory.getAgent('compliance');
      if (!complianceAgent) {
        throw new Error('Compliance agent not available');
      }

      const result = await complianceAgent.execute(shipmentId, tenantId, options);

      // Log the job completion
      await auditLogger.logSystemAction(
        tenantId,
        'compliance_screening_job_completed',
        { shipmentId, jobId: job.id },
        { result },
        { processedBy: 'queue_worker' }
      );

      return { success: true, result };
    } catch (error) {
      console.error(`Error processing compliance screening job ${job.id}:`, error);
      
      await auditLogger.logSystemAction(
        tenantId,
        'compliance_screening_job_failed',
        { shipmentId, jobId: job.id },
        { error: error instanceof Error ? error.message : 'Unknown error' },
        { processedBy: 'queue_worker' }
      );

      throw error;
    }
  },
  { connection }
);

// Worker for buyer verification
const buyerWorker = new Worker(
  QUEUE_NAMES.BUYER_VERIFICATION,
  async (job: Job<BuyerVerificationJob>) => {
    const { shipmentId, tenantId, userId, options } = job.data;
    
    try {
      console.log(`Processing buyer verification for shipment ${shipmentId}`);
      
      const buyerAgent = AgentFactory.getAgent('buyer_verification');
      if (!buyerAgent) {
        throw new Error('Buyer verification agent not available');
      }

      const result = await buyerAgent.execute(shipmentId, tenantId, options);

      // Log the job completion
      await auditLogger.logSystemAction(
        tenantId,
        'buyer_verification_job_completed',
        { shipmentId, jobId: job.id },
        { result },
        { processedBy: 'queue_worker' }
      );

      return { success: true, result };
    } catch (error) {
      console.error(`Error processing buyer verification job ${job.id}:`, error);
      
      await auditLogger.logSystemAction(
        tenantId,
        'buyer_verification_job_failed',
        { shipmentId, jobId: job.id },
        { error: error instanceof Error ? error.message : 'Unknown error' },
        { processedBy: 'queue_worker' }
      );

      throw error;
    }
  },
  { connection }
);

// Worker for customs classification
const customsWorker = new Worker(
  QUEUE_NAMES.CUSTOMS_CLASSIFICATION,
  async (job: Job<CustomsClassificationJob>) => {
    const { shipmentId, tenantId, userId, options } = job.data;
    
    try {
      console.log(`Processing customs classification for shipment ${shipmentId}`);
      
      const customsAgent = AgentFactory.getAgent('customs_intelligence');
      if (!customsAgent) {
        throw new Error('Customs intelligence agent not available');
      }

      const result = await customsAgent.execute(shipmentId, tenantId, options);

      // Log the job completion
      await auditLogger.logSystemAction(
        tenantId,
        'customs_classification_job_completed',
        { shipmentId, jobId: job.id },
        { result },
        { processedBy: 'queue_worker' }
      );

      return { success: true, result };
    } catch (error) {
      console.error(`Error processing customs classification job ${job.id}:`, error);
      
      await auditLogger.logSystemAction(
        tenantId,
        'customs_classification_job_failed',
        { shipmentId, jobId: job.id },
        { error: error instanceof Error ? error.message : 'Unknown error' },
        { processedBy: 'queue_worker' }
      );

      throw error;
    }
  },
  { connection }
);

// Worker for policy monitoring
const policyWorker = new Worker(
  QUEUE_NAMES.POLICY_MONITORING,
  async (job: Job<PolicyMonitoringJob>) => {
    const { tenantId, options } = job.data;
    
    try {
      console.log(`Processing policy monitoring for tenant ${tenantId}`);
      
      const complianceAgent = AgentFactory.getAgent('compliance');
      if (!complianceAgent) {
        throw new Error('Compliance agent not available');
      }

      const result = await (complianceAgent as any).monitorPolicies(options);

      // Log the job completion
      await auditLogger.logSystemAction(
        tenantId,
        'policy_monitoring_job_completed',
        { jobId: job.id },
        { result },
        { processedBy: 'queue_worker' }
      );

      return { success: true, result };
    } catch (error) {
      console.error(`Error processing policy monitoring job ${job.id}:`, error);
      
      await auditLogger.logSystemAction(
        tenantId,
        'policy_monitoring_job_failed',
        { jobId: job.id },
        { error: error instanceof Error ? error.message : 'Unknown error' },
        { processedBy: 'queue_worker' }
      );

      throw error;
    }
  },
  { connection }
);

// Worker for shipment processing (runs all agents)
const shipmentWorker = new Worker(
  QUEUE_NAMES.SHIPMENT_PROCESSING,
  async (job: Job<ShipmentProcessingJob>) => {
    const { shipmentId, tenantId, userId, runAllAgents = true } = job.data;
    
    try {
      console.log(`Processing shipment ${shipmentId} for tenant ${tenantId}`);
      
      const results: Record<string, any> = {};

      if (runAllAgents) {
        // Run all agents sequentially
        const docAgent = AgentFactory.getAgent('documentation');
        const complianceAgent = AgentFactory.getAgent('compliance');
        const buyerAgent = AgentFactory.getAgent('buyer_verification');
        const customsAgent = AgentFactory.getAgent('customs_intelligence');

        if (docAgent) {
          results.documentation = await docAgent.execute(shipmentId, tenantId);
        }

        if (complianceAgent) {
          results.compliance = await complianceAgent.execute(shipmentId, tenantId);
        }

        if (buyerAgent) {
          results.buyer_verification = await buyerAgent.execute(shipmentId, tenantId);
        }

        if (customsAgent) {
          results.customs_intelligence = await customsAgent.execute(shipmentId, tenantId);
        }
      }

      // Log the job completion
      await auditLogger.logSystemAction(
        tenantId,
        'shipment_processing_job_completed',
        { shipmentId, jobId: job.id },
        { results },
        { processedBy: 'queue_worker' }
      );

      return { success: true, results };
    } catch (error) {
      console.error(`Error processing shipment job ${job.id}:`, error);
      
      await auditLogger.logSystemAction(
        tenantId,
        'shipment_processing_job_failed',
        { shipmentId, jobId: job.id },
        { error: error instanceof Error ? error.message : 'Unknown error' },
        { processedBy: 'queue_worker' }
      );

      throw error;
    }
  },
  { connection }
);

// Error handlers for workers
[documentWorker, complianceWorker, buyerWorker, customsWorker, policyWorker, shipmentWorker].forEach(worker => {
  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed with error:`, err);
  });

  worker.on('error', (err) => {
    console.error('Worker error:', err);
  });
});

// Queue event listeners
Object.values(queues).forEach(queue => {
  queue.on('error', (err) => {
    console.error('Queue error:', err);
  });
});

// Utility functions
export async function addDocumentGenerationJob(data: DocumentGenerationJob): Promise<Job> {
  return queues.DOCUMENT_GENERATION.add('document_generation', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true,
    removeOnFail: false
  });
}

export async function addComplianceScreeningJob(data: ComplianceScreeningJob): Promise<Job> {
  return queues.COMPLIANCE_SCREENING.add('compliance_screening', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true,
    removeOnFail: false
  });
}

export async function addBuyerVerificationJob(data: BuyerVerificationJob): Promise<Job> {
  return queues.BUYER_VERIFICATION.add('buyer_verification', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true,
    removeOnFail: false
  });
}

export async function addCustomsClassificationJob(data: CustomsClassificationJob): Promise<Job> {
  return queues.CUSTOMS_CLASSIFICATION.add('customs_classification', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true,
    removeOnFail: false
  });
}

export async function addPolicyMonitoringJob(data: PolicyMonitoringJob): Promise<Job> {
  return queues.POLICY_MONITORING.add('policy_monitoring', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true,
    removeOnFail: false
  });
}

export async function addShipmentProcessingJob(data: ShipmentProcessingJob): Promise<Job> {
  return queues.SHIPMENT_PROCESSING.add('shipment_processing', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true,
    removeOnFail: false
  });
}

// Export queues for external use
export { queues, QUEUE_NAMES, connection };

console.log('Queue workers initialized and listening for jobs...');

// Keep the process running
process.on('SIGTERM', async () => {
  console.log('Shutting down queue workers...');
  await Promise.all([
    documentWorker.close(),
    complianceWorker.close(),
    buyerWorker.close(),
    customsWorker.close(),
    policyWorker.close(),
    shipmentWorker.close()
  ]);
  await connection.disconnect();
  console.log('Queue workers shut down');
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Shutting down queue workers...');
  await Promise.all([
    documentWorker.close(),
    complianceWorker.close(),
    buyerWorker.close(),
    customsWorker.close(),
    policyWorker.close(),
    shipmentWorker.close()
  ]);
  await connection.disconnect();
  console.log('Queue workers shut down');
  process.exit(0);
});
