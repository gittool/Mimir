import { Driver } from 'neo4j-driver';

/**
 * Data Retention Configuration
 * Default: Forever (no automatic deletion)
 */
export interface DataRetentionConfig {
  enabled: boolean;
  defaultDays: number; // 0 = forever (default)
  nodeTypePolicies: Record<string, number>; // Override per node type
  auditDays: number; // Audit log retention (0 = forever)
  runIntervalMs: number; // How often to run cleanup
}

/**
 * Load data retention configuration from environment variables
 * 
 * Configures automatic cleanup of old data based on retention policies.
 * By default, data is kept forever (retention = 0 days).
 * 
 * **Environment Variables:**
 * - `MIMIR_DATA_RETENTION_ENABLED`: Enable/disable retention (default: false)
 * - `MIMIR_DATA_RETENTION_DEFAULT_DAYS`: Default retention in days (0 = forever)
 * - `MIMIR_DATA_RETENTION_POLICIES`: JSON object with per-type policies
 * - `MIMIR_DATA_RETENTION_AUDIT_DAYS`: Audit log retention (0 = forever)
 * - `MIMIR_DATA_RETENTION_INTERVAL_MS`: Cleanup interval in ms (default: 24h)
 * 
 * @returns Data retention configuration object
 * 
 * @example
 * ```ts
 * // Enable retention with 30-day default
 * process.env.MIMIR_DATA_RETENTION_ENABLED = 'true';
 * process.env.MIMIR_DATA_RETENTION_DEFAULT_DAYS = '30';
 * 
 * // Custom policies per node type
 * process.env.MIMIR_DATA_RETENTION_POLICIES = JSON.stringify({
 *   'Session': 7,      // Delete sessions after 7 days
 *   'TempFile': 1,     // Delete temp files after 1 day
 *   'Project': 0       // Keep projects forever
 * });
 * 
 * const config = loadDataRetentionConfig();
 * console.log(config.defaultDays); // 30
 * ```
 */
export function loadDataRetentionConfig(): DataRetentionConfig {
  const enabled = process.env.MIMIR_DATA_RETENTION_ENABLED === 'true';
  
  // Parse node type policies from JSON if provided
  let nodeTypePolicies: Record<string, number> = {};
  if (process.env.MIMIR_DATA_RETENTION_POLICIES) {
    try {
      nodeTypePolicies = JSON.parse(process.env.MIMIR_DATA_RETENTION_POLICIES);
    } catch (error) {
      console.error('Failed to parse MIMIR_DATA_RETENTION_POLICIES:', error);
    }
  }
  
  return {
    enabled,
    defaultDays: parseInt(process.env.MIMIR_DATA_RETENTION_DEFAULT_DAYS || '0', 10), // 0 = forever
    nodeTypePolicies,
    auditDays: parseInt(process.env.MIMIR_DATA_RETENTION_AUDIT_DAYS || '0', 10), // 0 = forever
    runIntervalMs: parseInt(process.env.MIMIR_DATA_RETENTION_INTERVAL_MS || '86400000', 10), // 24 hours
  };
}

/**
 * Get retention days for a specific node type
 */
function getRetentionDays(nodeType: string, config: DataRetentionConfig): number {
  // Check for node-specific policy
  if (config.nodeTypePolicies[nodeType] !== undefined) {
    return config.nodeTypePolicies[nodeType];
  }
  
  // Fall back to default
  return config.defaultDays;
}

/**
 * Run data retention cleanup to delete expired nodes
 * 
 * Scans all node types in the database and deletes nodes that exceed
 * their retention period. Uses `createdAt` timestamp to determine age.
 * 
 * **Process:**
 * 1. Discover all node types (labels) in database
 * 2. For each type, check retention policy
 * 3. Delete nodes older than retention period
 * 4. Log deletion statistics
 * 
 * Nodes without a `createdAt` property are not deleted (assumed permanent).
 * 
 * @param driver - Neo4j driver instance
 * @param config - Data retention configuration
 * @returns Promise that resolves when cleanup is complete
 * 
 * @example
 * ```ts
 * const driver = neo4j.driver('bolt://localhost:7687');
 * const config = loadDataRetentionConfig();
 * 
 * // Run cleanup manually
 * await runDataRetentionCleanup(driver, config);
 * // Output: [Data Retention] Deleted 15 Session nodes older than 7 days
 * 
 * // Cleanup respects per-type policies
 * // Session nodes: 7 days
 * // TempFile nodes: 1 day
 * // Project nodes: forever (0 days = never deleted)
 * ```
 */
export async function runDataRetentionCleanup(driver: Driver, config: DataRetentionConfig): Promise<void> {
  if (!config.enabled) {
    return;
  }

  const session = driver.session();
  
  try {
    console.log('[Data Retention] Starting cleanup...');
    
    // Get all node types
    const nodeTypesResult = await session.run(`
      MATCH (n)
      RETURN DISTINCT labels(n) as labels
    `);
    
    const nodeTypes = new Set<string>();
    for (const record of nodeTypesResult.records) {
      const labels = record.get('labels') as string[];
      for (const label of labels) {
        nodeTypes.add(label);
      }
    }
    
    let totalDeleted = 0;
    
    // Process each node type
    for (const nodeType of nodeTypes) {
      const retentionDays = getRetentionDays(nodeType, config);
      
      // Skip if retention is forever (0)
      if (retentionDays === 0) {
        continue;
      }
      
      // Calculate cutoff timestamp
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
      const cutoffTimestamp = cutoffDate.toISOString();
      
      // Delete nodes older than retention period
      const result = await session.run(`
        MATCH (n:${nodeType})
        WHERE n.createdAt < $cutoffTimestamp
        DETACH DELETE n
        RETURN count(n) as deleted
      `, { cutoffTimestamp });
      
      const deleted = result.records[0]?.get('deleted').toNumber() || 0;
      
      if (deleted > 0) {
        console.log(`[Data Retention] Deleted ${deleted} ${nodeType} nodes older than ${retentionDays} days`);
        totalDeleted += deleted;
      }
    }
    
    if (totalDeleted > 0) {
      console.log(`[Data Retention] Cleanup complete - deleted ${totalDeleted} nodes total`);
    } else {
      console.log('[Data Retention] Cleanup complete - no nodes to delete');
    }
    
  } catch (error: any) {
    console.error('[Data Retention] Cleanup failed:', error.message);
  } finally {
    await session.close();
  }
}

/**
 * Start automatic data retention cleanup scheduler
 * 
 * Runs cleanup immediately on start, then schedules recurring cleanup
 * at the configured interval. Returns a timer that can be stopped later.
 * 
 * If retention is disabled, returns null and does nothing.
 * 
 * @param driver - Neo4j driver instance
 * @param config - Data retention configuration
 * @returns Timer handle for stopping scheduler, or null if disabled
 * 
 * @example
 * ```ts
 * const driver = neo4j.driver('bolt://localhost:7687');
 * const config = loadDataRetentionConfig();
 * 
 * // Start scheduler (runs every 24 hours by default)
 * const timer = startDataRetentionScheduler(driver, config);
 * // Output: [Data Retention] Scheduler started
 * //         Default retention: 30 days
 * //         Run interval: 1440 minutes
 * 
 * // Stop scheduler on shutdown
 * process.on('SIGTERM', () => {
 *   stopDataRetentionScheduler(timer);
 *   driver.close();
 * });
 * ```
 */
export function startDataRetentionScheduler(driver: Driver, config: DataRetentionConfig): NodeJS.Timeout | null {
  if (!config.enabled) {
    return null;
  }

  console.log('[Data Retention] Scheduler started');
  console.log(`   Default retention: ${config.defaultDays === 0 ? 'Forever' : `${config.defaultDays} days`}`);
  console.log(`   Audit retention: ${config.auditDays === 0 ? 'Forever' : `${config.auditDays} days`}`);
  console.log(`   Run interval: ${config.runIntervalMs / 1000 / 60} minutes`);
  
  if (Object.keys(config.nodeTypePolicies).length > 0) {
    console.log('   Node-specific policies:');
    for (const [nodeType, days] of Object.entries(config.nodeTypePolicies)) {
      console.log(`     ${nodeType}: ${days === 0 ? 'Forever' : `${days} days`}`);
    }
  }

  // Run immediately on start
  runDataRetentionCleanup(driver, config);

  // Schedule recurring cleanup
  return setInterval(() => {
    runDataRetentionCleanup(driver, config);
  }, config.runIntervalMs);
}

/**
 * Stop the data retention cleanup scheduler
 * 
 * Clears the interval timer to stop automatic cleanup.
 * Safe to call with null timer (no-op).
 * 
 * @param timer - Timer handle from startDataRetentionScheduler()
 * 
 * @example
 * ```ts
 * const timer = startDataRetentionScheduler(driver, config);
 * 
 * // Later, stop the scheduler
 * stopDataRetentionScheduler(timer);
 * // Output: [Data Retention] Scheduler stopped
 * ```
 */
export function stopDataRetentionScheduler(timer: NodeJS.Timeout | null): void {
  if (timer) {
    clearInterval(timer);
    console.log('[Data Retention] Scheduler stopped');
  }
}
