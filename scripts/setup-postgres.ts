/**
 * PostgreSQL Database Setup for Notion Tasks Widget
 * Run this once to set up your local Postgres database
 */
import { Client } from 'pg';
import * as readline from 'readline';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function setupDatabase() {
  console.log('🚀 PostgreSQL Database Setup for Notion Tasks Widget');
  console.log('=====================================================\n');

  try {
    // Get database configuration from user (with defaults)
    const dbHost = (await question('Database host (default: localhost): ')) || 'localhost';
    const dbPort = (await question('Database port (default: 5432): ')) || '5432';
    const dbName = (await question('Database name (default: notion_tasks): ')) || 'notion_tasks';
    const dbUser = (await question('Database user (default: postgres): ')) || 'postgres';
    const dbPassword = await question('Database password: ');

    console.log('\n🔧 Testing database connection...');

    // Test connection to default postgres database first
    const adminClient = new Client({
      host: dbHost,
      port: parseInt(dbPort),
      database: 'postgres',
      user: dbUser,
      password: dbPassword
    });

    await adminClient.connect();
    console.log('✅ Connected to PostgreSQL successfully!');

    // Create database if it doesn't exist
    try {
      await adminClient.query(`CREATE DATABASE "${dbName}"`);
      console.log(`✅ Created database: ${dbName}`);
    } catch (error: any) {
      if (error.code === '42P04') {
        console.log(`ℹ️  Database ${dbName} already exists`);
      } else {
        throw error;
      }
    }

    await adminClient.end();

    // Connect to the new database and create schema
    const client = new Client({
      host: dbHost,
      port: parseInt(dbPort),
      database: dbName,
      user: dbUser,
      password: dbPassword
    });

    await client.connect();
    console.log(`✅ Connected to database: ${dbName}`);

    // Create schema
    console.log('\n📦 Creating tables...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id TEXT PRIMARY KEY,
        applied_at BIGINT NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        client_id TEXT PRIMARY KEY,
        notion_id TEXT,
        payload JSONB NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_modified_local BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
        last_modified_notion BIGINT NOT NULL DEFAULT 0,
        field_local_ts JSONB NOT NULL DEFAULT '{}',
        field_notion_ts JSONB NOT NULL DEFAULT '{}'
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tasks_notion ON tasks(notion_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tasks_sync_status ON tasks(sync_status)`);
    console.log('  ✅ tasks table created');

    await client.query(`
      CREATE TABLE IF NOT EXISTS time_logs (
        client_id TEXT PRIMARY KEY,
        notion_id TEXT,
        payload JSONB NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_modified_local BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
        last_modified_notion BIGINT NOT NULL DEFAULT 0,
        field_local_ts JSONB NOT NULL DEFAULT '{}',
        field_notion_ts JSONB NOT NULL DEFAULT '{}'
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_time_logs_notion ON time_logs(notion_id)`);
    console.log('  ✅ time_logs table created');

    await client.query(`
      CREATE TABLE IF NOT EXISTS writing_entries (
        client_id TEXT PRIMARY KEY,
        notion_id TEXT,
        payload JSONB NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_modified_local BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
        last_modified_notion BIGINT NOT NULL DEFAULT 0,
        field_local_ts JSONB NOT NULL DEFAULT '{}',
        field_notion_ts JSONB NOT NULL DEFAULT '{}'
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_writing_entries_notion ON writing_entries(notion_id)`);
    console.log('  ✅ writing_entries table created');

    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        client_id TEXT PRIMARY KEY,
        notion_id TEXT,
        payload JSONB NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_modified_local BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
        last_modified_notion BIGINT NOT NULL DEFAULT 0,
        field_local_ts JSONB NOT NULL DEFAULT '{}',
        field_notion_ts JSONB NOT NULL DEFAULT '{}'
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_projects_notion ON projects(notion_id)`);
    console.log('  ✅ projects table created');

    await client.query(`
      CREATE TABLE IF NOT EXISTS sync_queue (
        id SERIAL PRIMARY KEY,
        entity_type TEXT NOT NULL,
        client_id TEXT NOT NULL,
        notion_id TEXT,
        operation TEXT NOT NULL,
        payload JSONB NOT NULL,
        changed_fields JSONB NOT NULL DEFAULT '[]',
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        pending_since BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sync_queue_entity ON sync_queue(entity_type, client_id)`);
    console.log('  ✅ sync_queue table created');

    await client.query(`
      CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);
    console.log('  ✅ sync_state table created');

    await client.end();

    // Update .env file
    const envPath = path.join(process.cwd(), '.env');
    let envContent = '';
    
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf-8');
    }

    // Add/update Postgres config
    const pgConfig = `
# PostgreSQL Configuration (added by setup-postgres)
PG_HOST=${dbHost}
PG_PORT=${dbPort}
PG_DATABASE=${dbName}
PG_USER=${dbUser}
PG_PASSWORD=${dbPassword}
`;

    // Check if PG config already exists
    if (!envContent.includes('PG_HOST=')) {
      fs.appendFileSync(envPath, pgConfig);
      console.log('\n✅ Added PostgreSQL configuration to .env file');
    } else {
      console.log('\nℹ️  PostgreSQL configuration already exists in .env');
      console.log('   Update manually if needed:');
      console.log(pgConfig);
    }

    console.log('\n🎉 Database setup completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('1. Run: npm run sync:postgres  (to sync from Notion)');
    console.log('2. Start your app: npm start');

  } catch (error: any) {
    console.error('❌ Database setup failed:', error.message);
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Make sure PostgreSQL is installed and running');
    console.log('2. Check your PostgreSQL password');
    console.log('3. Ensure PostgreSQL is running on the specified host/port');
    console.log('\n   On Windows: Check Services for "postgresql"');
    console.log('   On Mac: brew services start postgresql');
    console.log('   On Linux: sudo systemctl start postgresql');
  } finally {
    rl.close();
  }
}

setupDatabase();





