# Consign AI - Multi-Tenant AI SaaS for Export-Import

**Consign AI** is a comprehensive multi-tenant SaaS platform designed for Indian export-import SMEs. It automates the entire shipment documentation, compliance screening, buyer verification, and customs classification process using four specialized AI agents.

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- PostgreSQL 14+
- Redis 6+
- Anthropic API Key

### Installation

1. **Clone the repository:**
```bash
git clone <repository-url>
cd consign-ai
```

2. **Install dependencies:**
```bash
npm install
```

3. **Set up environment variables:**
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. **Set up database:**
```bash
# Create database
createdb consign_ai

# Run schema
npm run migrate

# Seed database (optional)
npm run seed
```

5. **Start the server:**
```bash
npm run dev
```

6. **Start the queue workers (in separate terminal):**
```bash
npm run worker
```

7. **Start the compliance monitor (in separate terminal):**
```bash
npm run compliance-monitor
```

The server will start on `http://localhost:3000`

## 🏗️ Architecture

### Core Components

1. **Consign Core** - The central state machine and orchestration layer
   - Shipment lifecycle management
   - State transitions with validation
   - Audit trail management
   - Approval system

2. **Four AI Agents:**
   - **Documentation Agent** - Generates commercial invoice, packing list, COO, shipping bill, LC documents
   - **Compliance Agent** - Sanctions screening, policy alerts, DGFT/RBI monitoring
   - **Buyer Verification Agent** - Risk scoring, payment history tracking, credit checks
   - **Customs Intelligence Agent** - HS classification, duty calculation, clearance time prediction

3. **API Layer** - RESTful API with comprehensive endpoints
4. **Database** - PostgreSQL with row-level security for multi-tenancy
5. **Queue System** - BullMQ with Redis for background job processing
6. **Audit System** - Complete audit trail for compliance and traceability

### Shipment Lifecycle

```
Draft → Documents Generated → Compliance Screened → Buyer Verified → Customs Classified → Ready to File → Filed
```

Each stage transition is gated by:
- Required agent outputs
- Human approvals where needed
- Validation checks

## 📡 API Endpoints

### Authentication
- `POST /api/v1/auth/signup` - Sign up new tenant
- `POST /api/v1/auth/login` - Login
- `POST /api/v1/auth/logout` - Logout
- `POST /api/v1/auth/refresh` - Refresh token
- `POST /api/v1/auth/forgot-password` - Forgot password
- `POST /api/v1/auth/reset-password` - Reset password
- `POST /api/v1/auth/change-password` - Change password
- `GET /api/v1/auth/me` - Get current user info

### Tenants
- `GET /api/v1/tenants/me` - Get current tenant
- `PUT /api/v1/tenants/me` - Update current tenant
- `GET /api/v1/tenants/stats` - Get tenant statistics
- `GET /api/v1/tenants/tiers` - Get available tiers
- `GET /api/v1/tenants/deployment-modes` - Get deployment modes

### Shipments
- `GET /api/v1/shipments` - List shipments
- `GET /api/v1/shipments/:id` - Get shipment details
- `POST /api/v1/shipments` - Create shipment
- `PUT /api/v1/shipments/:id` - Update shipment
- `DELETE /api/v1/shipments/:id` - Delete shipment
- `POST /api/v1/shipments/:id/advance` - Advance to next stage
- `POST /api/v1/shipments/:id/force-advance` - Force advance (admin)
- `POST /api/v1/shipments/:id/file` - Mark as filed
- `GET /api/v1/shipments/:id/status` - Get shipment status
- `GET /api/v1/shipments/:id/progress` - Get shipment progress
- `POST /api/v1/shipments/:id/run-agents` - Run all agents
- `GET /api/v1/shipments/:id/pending-approvals` - Get pending approvals
- `GET /api/v1/shipments/dashboard` - Get dashboard data

### Documents
- `GET /api/v1/documents` - List documents
- `GET /api/v1/documents/:id` - Get document details
- `POST /api/v1/documents/generate` - Generate documents
- `POST /api/v1/documents/:id/approve` - Approve document
- `POST /api/v1/documents/:id/reject` - Reject document
- `POST /api/v1/documents/:id/edit` - Edit document
- `GET /api/v1/documents/:id/content` - Get document content
- `POST /api/v1/documents/validate` - Validate documents
- `GET /api/v1/documents/types` - Get document types
- `GET /api/v1/documents/status` - Get document status

### Compliance
- `GET /api/v1/compliance/screens` - List compliance screens
- `GET /api/v1/compliance/screens/:id` - Get compliance screen
- `POST /api/v1/compliance/screen` - Screen a party
- `POST /api/v1/compliance/screens/:id/acknowledge` - Acknowledge screen
- `GET /api/v1/compliance/alerts` - List policy alerts
- `GET /api/v1/compliance/alerts/:id` - Get policy alert
- `POST /api/v1/compliance/monitor` - Run policy monitoring
- `GET /api/v1/compliance/status` - Get compliance status
- `GET /api/v1/compliance/sources` - Get compliance sources
- `GET /api/v1/compliance/policy-sources` - Get policy sources
- `GET /api/v1/compliance/severity-levels` - Get severity levels
- `GET /api/v1/compliance/party-types` - Get party types

### Buyers
- `GET /api/v1/buyers` - List buyers
- `GET /api/v1/buyers/:id` - Get buyer details
- `POST /api/v1/buyers` - Create buyer
- `PUT /api/v1/buyers/:id` - Update buyer
- `DELETE /api/v1/buyers/:id` - Delete buyer
- `POST /api/v1/buyers/:id/verify` - Verify buyer
- `GET /api/v1/buyers/:id/risk-score` - Get risk score
- `POST /api/v1/buyers/:id/payments` - Add payment
- `GET /api/v1/buyers/:id/payments` - Get payments
- `GET /api/v1/buyers/stats` - Get buyer statistics
- `GET /api/v1/buyers/risk-categories` - Get risk categories
- `GET /api/v1/buyers/verification-statuses` - Get verification statuses

### Customs
- `GET /api/v1/customs/classifications` - List classifications
- `GET /api/v1/customs/classifications/:id` - Get classification
- `POST /api/v1/customs/classify` - Classify product
- `POST /api/v1/customs/classifications/:id/approve` - Approve classification
- `POST /api/v1/customs/classifications/:id/reclassify` - Reclassify product
- `GET /api/v1/customs/hs-codes` - Get HS code suggestions
- `GET /api/v1/customs/hs-codes/:code` - Get HS code details
- `GET /api/v1/customs/duty-rates` - Calculate duty rates
- `GET /api/v1/customs/clearance-time` - Predict clearance time
- `GET /api/v1/customs/ports` - Get port information
- `GET /api/v1/customs/status` - Get customs status
- `GET /api/v1/customs/classification-methods` - Get classification methods
- `GET /api/v1/customs/classification-statuses` - Get classification statuses

### Approvals
- `GET /api/v1/approvals` - List approvals
- `GET /api/v1/approvals/:id` - Get approval
- `POST /api/v1/approvals` - Record approval
- `POST /api/v1/approvals/:id/revoke` - Revoke approval
- `GET /api/v1/approvals/shipment/:shipmentId` - Get shipment approvals
- `GET /api/v1/approvals/stats` - Get approval statistics
- `GET /api/v1/approvals/target-types` - Get target types
- `GET /api/v1/approvals/decision-types` - Get decision types

### Audit
- `GET /api/v1/audit/logs` - List audit logs
- `GET /api/v1/audit/logs/:id` - Get audit log entry
- `GET /api/v1/audit/shipment/:shipmentId` - Get shipment audit log
- `GET /api/v1/audit/export/:shipmentId` - Export audit trail
- `GET /api/v1/audit/search` - Search audit logs
- `GET /api/v1/audit/actor-types` - Get actor types
- `GET /api/v1/audit/stats` - Get audit statistics

## 📦 Project Structure

```
consign-ai/
├── src/
│   ├── api/
│   │   ├── server.ts           # Express server
│   │   └── routes/             # API route files
│   │
│   ├── agents/
│   │   ├── baseAgent.ts       # Base agent class
│   │   ├── documentationAgent.ts
│   │   ├── complianceAgent.ts
│   │   ├── buyerVerificationAgent.ts
│   │   └── customsIntelligenceAgent.ts
│   │
│   ├── core/
│   │   ├── stateMachine.ts    # Shipment state machine
│   │   ├── auditLogger.ts     # Audit logging
│   │   └── approvalSystem.ts  # Approval system
│   │
│   ├── db/
│   │   ├── connection.ts       # Database connection
│   │   ├── schema.sql          # Database schema
│   │   ├── migrations/         # Database migrations
│   │   └── seed.ts             # Seed data
│   │
│   ├── workers/
│   │   ├── queueWorker.ts      # Queue worker for background jobs
│   │   └── complianceMonitor.ts # Compliance monitoring
│   │
│   ├── config/
│   │   └── index.ts           # Configuration
│   │
│   ├── middleware/
│   │   └── index.ts           # Express middleware
│   │
│   ├── types/
│   │   └── index.ts           # TypeScript types
│   │
│   ├── utils/
│   │   └── index.ts           # Utility functions
│   │
│   └── index.ts               # Main entry point
│
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `NODE_ENV` | Environment | development |
| `DB_HOST` | Database host | localhost |
| `DB_PORT` | Database port | 5432 |
| `DB_NAME` | Database name | consign_ai |
| `DB_USER` | Database user | postgres |
| `DB_PASSWORD` | Database password | - |
| `REDIS_HOST` | Redis host | localhost |
| `REDIS_PORT` | Redis port | 6379 |
| `REDIS_PASSWORD` | Redis password | - |
| `ANTHROPIC_API_KEY` | Anthropic API key | - |
| `ANTHROPIC_API_VERSION` | API version | 2023-06-01 |
| `JWT_SECRET` | JWT secret | - |
| `JWT_EXPIRES_IN` | JWT expiry | 24h |
| `UPLOAD_DIR` | Upload directory | ./uploads |
| `DOCUMENT_STORAGE_DIR` | Document storage | ./storage/documents |

## 🎯 Features

### Documentation Agent
- ✅ Invoice parsing (PDF, Excel, manual entry)
- ✅ Document generation (5 document types)
- ✅ Cross-field validation
- ✅ Template-based generation
- ✅ Confidence scoring

### Compliance Agent
- ✅ Sanctions list screening (OFAC, UN, EU, India)
- ✅ Policy alert monitoring (DGFT, RBI, Customs)
- ✅ Fuzzy name matching
- ✅ Severity-based flagging
- ✅ Scheduled re-screening

### Buyer Verification Agent
- ✅ Risk scoring with defined rubric
- ✅ Payment history tracking
- ✅ Credit bureau integration (mock)
- ✅ Corporate registry lookup (mock)
- ✅ Risk category classification

### Customs Intelligence Agent
- ✅ HS code classification (rules-based)
- ✅ Duty and cess calculation
- ✅ Landed cost estimation
- ✅ Clearance time prediction
- ✅ Port congestion monitoring

### Core Features
- ✅ Multi-tenant architecture with row-level security
- ✅ Deterministic state machine for shipment lifecycle
- ✅ Complete audit trail for compliance
- ✅ Human-in-the-loop approval system
- ✅ Background job processing with BullMQ
- ✅ RESTful API with comprehensive endpoints
- ✅ JWT-based authentication
- ✅ Role-based access control

## 🚀 Deployment

### Development
```bash
npm run dev
```

### Production
```bash
npm run build
npm start
```

### Docker (Recommended for Production)

Create a `Dockerfile`:
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
```

Create a `docker-compose.yml`:
```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DB_HOST=postgres
      - DB_PORT=5432
      - DB_NAME=consign_ai
      - DB_USER=postgres
      - DB_PASSWORD=your_password
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - ANTHROPIC_API_KEY=your_api_key
      - JWT_SECRET=your_jwt_secret
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:14
    environment:
      - POSTGRES_DB=consign_ai
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=your_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:6
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"

volumes:
  postgres_data:
  redis_data:
```

Run with Docker:
```bash
docker-compose up -d
```

## 📊 Monitoring

### Health Check
```bash
curl http://localhost:3000/health
```

### API Info
```bash
curl http://localhost:3000/api
```

### Logs
- Application logs: `console.log` output
- Audit logs: Available via API endpoints
- Error logs: Structured error responses

## 🔒 Security

### Authentication
- JWT-based authentication with configurable expiry
- Secure password hashing with bcrypt
- Role-based access control (owner, admin, compliance_manager, finance, user, read_only)

### Data Protection
- Row-level security for multi-tenancy
- Tenant isolation enforced at database level
- Sensitive data encryption (recommended for production)
- Audit trail for all actions

### Compliance
- Complete audit trail for all agent actions and human decisions
- Immutable audit log (append-only)
- Exportable audit trails for compliance reporting
- No auto-submission to government portals (human approval required)

## 📚 Documentation

### API Documentation
All API endpoints are documented with:
- Request/response schemas
- Authentication requirements
- Error codes
- Examples

### Architecture Documentation
- [Technical Architecture](docs/TECHNICAL_ARCHITECTURE.md)
- [Data Model](docs/DATA_MODEL.md)
- [Agent Design](docs/AGENT_DESIGN.md)
- [State Machine](docs/STATE_MACHINE.md)

### User Documentation
- [Getting Started](docs/GETTING_STARTED.md)
- [User Guide](docs/USER_GUIDE.md)
- [Admin Guide](docs/ADMIN_GUIDE.md)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -am 'Add some feature'`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with Node.js, TypeScript, Express, PostgreSQL, Redis
- AI-powered by Anthropic Claude
- Queue system powered by BullMQ
- Database migrations with custom solution

## 📞 Support

For support and questions:
- Email: support@consign.ai
- Documentation: [https://docs.consign.ai](https://docs.consign.ai)
- Community: [https://community.consign.ai](https://community.consign.ai)

---

**Consign AI** - Automating Export-Import Documentation, Compliance, and Intelligence

*Made with ❤️ for Indian Export-Import SMEs*
