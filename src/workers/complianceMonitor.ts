import { query } from '../db/connection';
import { AgentFactory } from '../agents/baseAgent';
import { auditLogger } from '../core/auditLogger';
import { addPolicyMonitoringJob } from './queueWorker';

// Policy source configuration
interface PolicySourceConfig {
  name: string;
  url: string;
  enabled: boolean;
  checkIntervalHours: number;
  lastChecked?: Date;
  lastUpdated?: Date;
}

// Configured policy sources
const POLICY_SOURCES: PolicySourceConfig[] = [
  {
    name: 'DGFT',
    url: 'https://dgft.gov.in',
    enabled: true,
    checkIntervalHours: 24
  },
  {
    name: 'RBI',
    url: 'https://rbi.org.in',
    enabled: true,
    checkIntervalHours: 24
  },
  {
    name: 'Customs',
    url: 'https://www.cbic.gov.in',
    enabled: true,
    checkIntervalHours: 24
  },
  {
    name: 'FEMA',
    url: 'https://rbi.org.in',
    enabled: true,
    checkIntervalHours: 48
  }
];

/**
 * Check if policy monitoring should run
 */
function shouldRunPolicyMonitoring(): boolean {
  // In a real implementation, this would check the last run time
  // For now, we'll run it every time
  return true;
}

/**
 * Get tenants that need policy monitoring
 */
async function getTenantsForMonitoring(): Promise<Array<{ id: string; tier: string }>> {
  try {
    const result = await query<{ id: string; tier: string; subscription_status: string }>(
      `SELECT id, tier, subscription_status 
       FROM tenants 
       WHERE subscription_status = 'active'
       ORDER BY tier DESC`
    );
    return result.rows;
  } catch (error) {
    console.error('Error getting tenants for monitoring:', error);
    return [];
  }
}

/**
 * Run policy monitoring for all tenants
 */
async function runPolicyMonitoring() {
  try {
    console.log('Starting policy monitoring...');

    const tenants = await getTenantsForMonitoring();
    console.log(`Found ${tenants.length} active tenants for policy monitoring`);

    for (const tenant of tenants) {
      try {
        // Add policy monitoring job to queue
        await addPolicyMonitoringJob({
          tenantId: tenant.id,
          options: {
            sources: POLICY_SOURCES.filter(s => s.enabled).map(s => s.name as any),
            since: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
          }
        });

        console.log(`Added policy monitoring job for tenant ${tenant.id}`);

        // Update last checked time for this tenant
        await query(
          'UPDATE tenants SET last_policy_check = NOW() WHERE id = $1',
          [tenant.id]
        );

        // Small delay between tenants
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Error adding policy monitoring job for tenant ${tenant.id}:`, error);
      }
    }

    console.log('Policy monitoring jobs added for all tenants');

    // Log the monitoring run
    await auditLogger.logSystemAction(
      '', // No specific tenant
      'policy_monitoring_run',
      { tenantCount: tenants.length },
      { completed: true },
      { triggeredBy: 'scheduled_job' }
    );

  } catch (error) {
    console.error('Error running policy monitoring:', error);
    
    await auditLogger.logSystemAction(
      '',
      'policy_monitoring_run_failed',
      {},
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { triggeredBy: 'scheduled_job' }
    );
  }
}

/**
 * Check for stale policy data
 */
async function checkStalePolicyData() {
  try {
    console.log('Checking for stale policy data...');

    // Get policy alerts that haven't been updated recently
    const result = await query<{
      id: string;
      source: string;
      last_updated: Date;
      tenant_id: string;
    }>(
      `SELECT id, source, last_updated, tenant_id 
       FROM policy_alerts 
       WHERE last_updated < NOW() - INTERVAL '7 days'
       AND status = 'active'`
    );

    const staleAlerts = result.rows;
    console.log(`Found ${staleAlerts.length} stale policy alerts`);

    for (const alert of staleAlerts) {
      try {
        // Mark as expired or trigger re-check
        await query(
          'UPDATE policy_alerts SET status = $1 WHERE id = $2',
          ['expired', alert.id]
        );

        console.log(`Marked policy alert ${alert.id} as expired`);

        // Log the expiration
        await auditLogger.logSystemAction(
          alert.tenant_id,
          'policy_alert_expired',
          { alertId: alert.id, source: alert.source },
          { expired: true },
          { triggeredBy: 'stale_data_check' }
        );
      } catch (error) {
        console.error(`Error marking policy alert ${alert.id} as expired:`, error);
      }
    }

    console.log('Stale policy data check completed');

  } catch (error) {
    console.error('Error checking stale policy data:', error);
  }
}

/**
 * Check for new policy updates from sources
 */
async function checkPolicySources() {
  try {
    console.log('Checking policy sources for updates...');

    // In a real implementation, this would:
    // 1. Fetch latest policies from each source
    // 2. Compare with existing policies
    // 3. Create new alerts for changes
    // 4. Update existing alerts if modified

    // For now, we'll simulate this by running the compliance agent's monitorPolicies
    const complianceAgent = AgentFactory.getAgent('compliance');
    if (complianceAgent) {
      await (complianceAgent as any).monitorPolicies();
    }

    console.log('Policy sources check completed');

  } catch (error) {
    console.error('Error checking policy sources:', error);
  }
}

/**
 * Main monitoring function
 */
async function runComplianceMonitoring() {
  try {
    console.log('Starting compliance monitoring...');

    // Run policy monitoring
    await runPolicyMonitoring();

    // Check for stale policy data
    await checkStalePolicyData();

    // Check policy sources
    await checkPolicySources();

    console.log('Compliance monitoring completed successfully');

  } catch (error) {
    console.error('Error in compliance monitoring:', error);
  }
}

// Run monitoring if this file is executed directly
if (require.main === module) {
  // Run immediately
  runComplianceMonitoring().then(() => {
    console.log('Compliance monitoring run completed');
    process.exit(0);
  }).catch((error) => {
    console.error('Compliance monitoring failed:', error);
    process.exit(1);
  });
}

// Export functions for use in other modules
export {
  runComplianceMonitoring,
  runPolicyMonitoring,
  checkStalePolicyData,
  checkPolicySources,
  getTenantsForMonitoring,
  POLICY_SOURCES
};
