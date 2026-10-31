import prisma from '../config/prisma.js';
import logger from '../utils/logger.js';

/**
 * Script to safely wipe all user-generated data, chat history, attachments,
 * whiteboards, community posts, and user accounts from PostgreSQL to reclaim disk storage,
 * while preserving the database schema, migrations, and table structures.
 */
async function clearUserData() {
  logger.info('[DB Cleanup] Starting cleanup of user data to free disk storage...');

  try {
    // 1. Fetch all existing user/data tables dynamically from information_schema
    const tablesResult = (await prisma.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables 
       WHERE table_schema = 'public' 
         AND table_type = 'BASE TABLE' 
         AND table_name != '_prisma_migrations'
       ORDER BY table_name;`
    )) as Array<{ table_name: string }>;

    const existingTables = tablesResult.map((r) => r.table_name);
    console.log(`[DB Cleanup] Found ${existingTables.length} tables to truncate:`);
    console.log(existingTables.join(', '));

    if (existingTables.length === 0) {
      console.log('No tables found to clear.');
      return;
    }

    // 2. Truncate all tables at once with CASCADE to cleanly wipe storage and reset sequences
    const formattedTableList = existingTables.map((t) => `"${t}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${formattedTableList} CASCADE;`);

    logger.info(`[DB Cleanup] Successfully truncated all tables: ${existingTables.join(', ')}`);
    console.log(`\n✅ Successfully wiped all user data from ${existingTables.length} tables!`);
    console.log('✅ Database storage has been reclaimed, while schema and migrations are preserved.');
  } catch (error: any) {
    logger.error(`[DB Cleanup] Failed to clear user data: ${error.message}`);
    console.error('❌ Error clearing user data:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

clearUserData();
