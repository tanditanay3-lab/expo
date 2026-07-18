import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { query } from '../connection';

const MIGRATIONS_DIR = join(__dirname, 'migrations');
const MIGRATION_TABLE = 'schema_migrations';

interface Migration {
  id: string;
  name: string;
  executed_at: Date | null;
}

async function ensureMigrationsTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
      id VARCHAR(255) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      executed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);
}

async function getExecutedMigrations(): Promise<Set<string>> {
  const rows = await query<{ id: string }>(`
    SELECT id FROM ${MIGRATION_TABLE} ORDER BY executed_at
  `);
  return new Set(rows.rows.map(row => row.id));
}

async function getMigrationFiles(): Promise<{ id: string; name: string; content: string }[]> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter(file => file.endsWith('.sql'))
    .sort();

  return files.map(file => {
    const id = file.replace('.sql', '');
    const content = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    return { id, name: file, content };
  });
}

async function executeMigration(id: string, name: string, content: string): Promise<void> {
  console.log(`Executing migration: ${name}`);
  
  const start = Date.now();
  
  try {
    // Execute the migration
    await query(content);
    
    // Record the migration
    await query(
      `INSERT INTO ${MIGRATION_TABLE} (id, name) VALUES ($1, $2)`,
      [id, name]
    );
    
    const duration = Date.now() - start;
    console.log(`Migration ${name} completed in ${duration}ms`);
  } catch (error) {
    console.error(`Migration ${name} failed:`, error);
    throw error;
  }
}

async function runMigrations(): Promise<void> {
  console.log('Starting database migrations...');
  
  await ensureMigrationsTable();
  const executedMigrations = await getExecutedMigrations();
  const migrationFiles = await getMigrationFiles();
  
  for (const migration of migrationFiles) {
    if (!executedMigrations.has(migration.id)) {
      await executeMigration(migration.id, migration.name, migration.content);
    } else {
      console.log(`Migration ${migration.name} already executed, skipping`);
    }
  }
  
  console.log('All migrations completed successfully');
}

// Run migrations if this file is executed directly
if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

export { runMigrations, ensureMigrationsTable, getExecutedMigrations, getMigrationFiles, executeMigration };
