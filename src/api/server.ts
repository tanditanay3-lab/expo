import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { query } from '../db/connection';

// Load environment variables
dotenv.config();

// Import routes
import shipmentRoutes from './routes/shipmentRoutes';
import documentRoutes from './routes/documentRoutes';
import complianceRoutes from './routes/complianceRoutes';
import buyerRoutes from './routes/buyerRoutes';
import customsRoutes from './routes/customsRoutes';
import approvalRoutes from './routes/approvalRoutes';
import auditRoutes from './routes/auditRoutes';
import tenantRoutes from './routes/tenantRoutes';
import authRoutes from './routes/authRoutes';

// Import middleware
import { authMiddleware, tenantMiddleware, errorHandler } from '../middleware';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? process.env.ALLOWED_ORIGINS?.split(',') : '*',
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const dbConnected = await query('SELECT 1');
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: dbConnected ? 'connected' : 'disconnected',
      version: '1.0.0'
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'Consign AI API',
    version: '1.0.0',
    description: 'Multi-Tenant AI SaaS for Export-Import Documentation, Compliance, Buyer Risk & Customs Intelligence',
    endpoints: {
      auth: '/api/v1/auth',
      tenants: '/api/v1/tenants',
      shipments: '/api/v1/shipments',
      documents: '/api/v1/documents',
      compliance: '/api/v1/compliance',
      buyers: '/api/v1/buyers',
      customs: '/api/v1/customs',
      approvals: '/api/v1/approvals',
      audit: '/api/v1/audit'
    }
  });
});

// API v1 routes
const apiRouter = express.Router();

// Auth routes (no auth required)
apiRouter.use('/auth', authRoutes);

// Tenant routes (auth required, but tenant context not always required)
apiRouter.use('/tenants', authMiddleware, tenantRoutes);

// All other routes require auth and tenant context
apiRouter.use(authMiddleware);
apiRouter.use(tenantMiddleware);

// Shipment routes
apiRouter.use('/shipments', shipmentRoutes);

// Document routes
apiRouter.use('/documents', documentRoutes);

// Compliance routes
apiRouter.use('/compliance', complianceRoutes);

// Buyer routes
apiRouter.use('/buyers', buyerRoutes);

// Customs routes
apiRouter.use('/customs', customsRoutes);

// Approval routes
apiRouter.use('/approvals', approvalRoutes);

// Audit routes
apiRouter.use('/audit', auditRoutes);

// Mount API router
app.use('/api/v1', apiRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`
  });
});

// Error handler
app.use(errorHandler);

// Start server
const server = app.listen(PORT, () => {
  console.log(`Consign AI API server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`API docs: http://localhost:${PORT}/api`);
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

export default app;
