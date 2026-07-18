import dotenv from 'dotenv';
import app from './api/server';
import { testConnection } from './db/connection';
import { AgentFactory } from './agents/baseAgent';
import { DocumentationAgent } from './agents/documentationAgent';
import { ComplianceAgent } from './agents/complianceAgent';
import { BuyerVerificationAgent } from './agents/buyerVerificationAgent';
import { CustomsIntelligenceAgent } from './agents/customsIntelligenceAgent';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3000;

async function main() {
  console.log('Starting Consign AI server...');

  // Test database connection
  const dbConnected = await testConnection();
  if (!dbConnected) {
    console.error('Failed to connect to database. Exiting...');
    process.exit(1);
  }
  console.log('Database connection established');

  // Initialize agents
  console.log('Initializing AI agents...');
  new DocumentationAgent();
  new ComplianceAgent();
  new BuyerVerificationAgent();
  new CustomsIntelligenceAgent();
  console.log('AI agents initialized');

  // Log registered agents
  const agents = AgentFactory.getAllAgents();
  console.log(`Registered agents: ${Array.from(agents.keys()).join(', ')}`);

  // Start the server
  const server = app.listen(PORT, () => {
    console.log(`Consign AI API server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`API docs: http://localhost:${PORT}/api`);
    console.log('');
    console.log('Available endpoints:');
    console.log('- GET /health - Health check');
    console.log('- GET /api - API information');
    console.log('- POST /api/v1/auth/signup - Sign up');
    console.log('- POST /api/v1/auth/login - Login');
    console.log('- GET /api/v1/shipments - List shipments');
    console.log('- POST /api/v1/shipments - Create shipment');
    console.log('- GET /api/v1/documents - List documents');
    console.log('- POST /api/v1/documents/generate - Generate documents');
    console.log('- GET /api/v1/compliance/screens - List compliance screens');
    console.log('- POST /api/v1/compliance/screen - Screen a party');
    console.log('- GET /api/v1/buyers - List buyers');
    console.log('- POST /api/v1/buyers - Create buyer');
    console.log('- GET /api/v1/customs/classifications - List classifications');
    console.log('- POST /api/v1/customs/classify - Classify a product');
    console.log('- GET /api/v1/approvals - List approvals');
    console.log('- POST /api/v1/approvals - Record approval');
    console.log('- GET /api/v1/audit/logs - List audit logs');
    console.log('- GET /api/v1/tenants/me - Get tenant info');
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log('SIGINT received. Shutting down gracefully...');
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });

  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
  });
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

export default app;
