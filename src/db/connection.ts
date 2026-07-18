import { Pool, PoolClient } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'consign_ai',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Set application name for connection tracking
pool.on('connect', (client) => {
  client.query('SET application_name = $1', ['consign-ai']);
});

// Error handling
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

export interface DatabaseTransaction {
  client: PoolClient;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
}

export async function getClient(): Promise<PoolClient> {
  const client = await pool.connect();
  return client;
}

export async function releaseClient(client: PoolClient): Promise<void> {
  client.release();
}

export async function beginTransaction(): Promise<DatabaseTransaction> {
  const client = await pool.connect();
  await client.query('BEGIN');
  
  return {
    client,
    commit: async () => {
      await client.query('COMMIT');
      client.release();
    },
    rollback: async () => {
      await client.query('ROLLBACK');
      client.release();
    },
  };
}

export async function query<T = any>(text: string, params?: any[]): Promise<T> {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  
  if (process.env.NODE_ENV === 'development') {
    console.log('Executed query', { text: text.substring(0, 50), duration, rows: result.rowCount });
  }
  
  return result as T;
}

export async function getSingleRow<T = any>(text: string, params?: any[]): Promise<T | null> {
  const result = await query(text, params);
  return result.rows[0] || null;
}

export async function getRows<T = any>(text: string, params?: any[]): Promise<T[]> {
  const result = await query(text, params);
  return result.rows as T[];
}

export async function execute(text: string, params?: any[]): Promise<void> {
  await query(text, params);
}

export function setTenantContext(tenantId: string): void {
  // This would be used in a connection middleware
  // For now, we'll handle tenant isolation in the query layer
}

export async function testConnection(): Promise<boolean> {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch (error) {
    console.error('Database connection test failed:', error);
    return false;
  }
}

export default pool;
