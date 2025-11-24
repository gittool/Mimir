import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { createSecureFetchOptions } from '../utils/fetch-helper.js';

/**
 * Audit Event Structure (Generic, Not Domain-Specific)
 */
export interface AuditEvent {
  timestamp: string;
  userId: string | null;
  action: string;
  resource: string;
  method: string;
  outcome: 'success' | 'failure';
  statusCode: number;
  metadata: {
    ipAddress: string;
    userAgent?: string;
    duration?: number;
    errorMessage?: string;
    [key: string]: any;
  };
}

/**
 * Audit Logger Configuration
 */
export interface AuditLoggerConfig {
  enabled: boolean;
  destination: 'stdout' | 'file' | 'webhook' | 'all';
  format: 'json' | 'text';
  level: 'info' | 'debug' | 'warn' | 'error';
  filePath?: string;
  webhookUrl?: string;
  webhookAuthHeader?: string;
  batchSize?: number;
  batchIntervalMs?: number;
}

/**
 * Load audit logger configuration from environment variables
 * 
 * Reads audit logging settings from environment and returns a configuration
 * object with defaults for any missing values.
 * 
 * **Environment Variables**:
 * - `MIMIR_ENABLE_AUDIT_LOGGING`: Enable/disable audit logging (default: false)
 * - `MIMIR_AUDIT_LOG_DESTINATION`: Where to send logs (stdout/file/webhook/all)
 * - `MIMIR_AUDIT_LOG_FORMAT`: Log format (json/text)
 * - `MIMIR_AUDIT_LOG_LEVEL`: Log level (info/debug/warn/error)
 * - `MIMIR_AUDIT_LOG_FILE`: File path for file destination
 * - `MIMIR_AUDIT_WEBHOOK_URL`: Webhook URL for webhook destination
 * - `MIMIR_AUDIT_WEBHOOK_AUTH_HEADER`: Authorization header for webhook
 * - `MIMIR_AUDIT_WEBHOOK_BATCH_SIZE`: Batch size for webhook (default: 100)
 * - `MIMIR_AUDIT_WEBHOOK_BATCH_INTERVAL_MS`: Batch interval (default: 5000ms)
 * 
 * @returns Audit logger configuration object
 * 
 * @example
 * // Load configuration
 * const config = loadAuditLoggerConfig();
 * console.log('Audit logging enabled:', config.enabled);
 * console.log('Destination:', config.destination);
 * 
 * @example
 * // Use with middleware
 * const config = loadAuditLoggerConfig();
 * app.use(auditLogger(config));
 */
export function loadAuditLoggerConfig(): AuditLoggerConfig {
  const enabled = process.env.MIMIR_ENABLE_AUDIT_LOGGING === 'true';
  
  return {
    enabled,
    destination: (process.env.MIMIR_AUDIT_LOG_DESTINATION as any) || 'stdout',
    format: (process.env.MIMIR_AUDIT_LOG_FORMAT as any) || 'json',
    level: (process.env.MIMIR_AUDIT_LOG_LEVEL as any) || 'info',
    filePath: process.env.MIMIR_AUDIT_LOG_FILE,
    webhookUrl: process.env.MIMIR_AUDIT_WEBHOOK_URL,
    webhookAuthHeader: process.env.MIMIR_AUDIT_WEBHOOK_AUTH_HEADER,
    batchSize: parseInt(process.env.MIMIR_AUDIT_WEBHOOK_BATCH_SIZE || '100', 10),
    batchIntervalMs: parseInt(process.env.MIMIR_AUDIT_WEBHOOK_BATCH_INTERVAL_MS || '5000', 10),
  };
}

/**
 * Webhook batch queue
 */
let webhookBatch: AuditEvent[] = [];
let webhookTimer: NodeJS.Timeout | null = null;

/**
 * Flush webhook batch
 */
async function flushWebhookBatch(config: AuditLoggerConfig) {
  if (webhookBatch.length === 0 || !config.webhookUrl) {
    return;
  }

  const events = [...webhookBatch];
  webhookBatch = [];

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (config.webhookAuthHeader) {
      headers['Authorization'] = config.webhookAuthHeader;
    }

    const fetchOptions = createSecureFetchOptions(config.webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ events }),
    });

    const response = await fetch(config.webhookUrl, fetchOptions);

    if (!response.ok) {
      console.error(`[Audit] Webhook failed: ${response.status} ${response.statusText}`);
    }
  } catch (error: any) {
    console.error(`[Audit] Webhook error:`, error.message);
  }
}

/**
 * Write audit event to configured destinations
 * 
 * Sends audit events to one or more destinations based on configuration:
 * - **stdout**: Logs to console
 * - **file**: Appends to log file
 * - **webhook**: Queues for batch HTTP POST
 * - **all**: Sends to all destinations
 * 
 * Webhook events are batched for efficiency and sent when batch size
 * is reached or after the configured interval.
 * 
 * @param event - Audit event to write
 * @param config - Audit logger configuration
 * 
 * @example
 * // Write single event
 * const event: AuditEvent = {
 *   timestamp: new Date().toISOString(),
 *   userId: 'user-123',
 *   action: 'write',
 *   resource: '/api/nodes',
 *   method: 'POST',
 *   outcome: 'success',
 *   statusCode: 201,
 *   metadata: { ipAddress: '192.168.1.1' }
 * };
 * 
 * const config = loadAuditLoggerConfig();
 * writeAuditEvent(event, config);
 * 
 * @example
 * // Custom event with error
 * const failureEvent: AuditEvent = {
 *   timestamp: new Date().toISOString(),
 *   userId: null,
 *   action: 'delete',
 *   resource: '/api/nodes/123',
 *   method: 'DELETE',
 *   outcome: 'failure',
 *   statusCode: 403,
 *   metadata: {
 *     ipAddress: '10.0.0.1',
 *     errorMessage: 'Permission denied'
 *   }
 * };
 * writeAuditEvent(failureEvent, config);
 */
export function writeAuditEvent(event: AuditEvent, config: AuditLoggerConfig) {
  if (!config.enabled) {
    return;
  }

  const output = config.format === 'json' 
    ? JSON.stringify(event)
    : `[${event.timestamp}] ${event.userId || 'anonymous'} ${event.method} ${event.resource} ${event.outcome} ${event.statusCode}`;

  // Write to stdout
  if (config.destination === 'stdout' || config.destination === 'all') {
    console.log(output);
  }

  // Write to file
  if ((config.destination === 'file' || config.destination === 'all') && config.filePath) {
    try {
      const dir = path.dirname(config.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.appendFileSync(config.filePath, output + '\n');
    } catch (error: any) {
      console.error(`[Audit] File write error:`, error.message);
    }
  }

  // Queue for webhook
  if ((config.destination === 'webhook' || config.destination === 'all') && config.webhookUrl) {
    webhookBatch.push(event);

    // Flush if batch size reached
    if (webhookBatch.length >= (config.batchSize || 100)) {
      flushWebhookBatch(config);
    } else {
      // Set timer to flush batch
      if (!webhookTimer) {
        webhookTimer = setTimeout(() => {
          flushWebhookBatch(config);
          webhookTimer = null;
        }, config.batchIntervalMs || 5000);
      }
    }
  }
}

/**
 * Extract user ID from request
 */
function getUserId(req: Request): string | null {
  if (req.user) {
    const user = req.user as any;
    return user.id || user.email || user.username || 'authenticated';
  }
  return null;
}

/**
 * Get action from request
 */
function getAction(req: Request): string {
  const method = req.method;

  // Map HTTP methods to actions
  if (method === 'GET') return 'read';
  if (method === 'POST') return 'write';
  if (method === 'PUT' || method === 'PATCH') return 'update';
  if (method === 'DELETE') return 'delete';
  
  return method.toLowerCase();
}

/**
 * Express middleware for automatic audit logging
 * 
 * Intercepts all HTTP requests and logs them as audit events.
 * Captures request details, user information, timing, and outcomes.
 * 
 * **Automatically Logs**:
 * - User ID (from req.user)
 * - HTTP method and path
 * - Response status code
 * - Request duration
 * - IP address and user agent
 * - Error messages for failures
 * 
 * **Skipped Routes**:
 * - `/health` endpoint (to avoid log spam)
 * 
 * @param config - Audit logger configuration
 * 
 * @returns Express middleware function
 * 
 * @example
 * // Basic usage
 * import { loadAuditLoggerConfig, auditLogger } from './middleware/audit-logger.js';
 * 
 * const config = loadAuditLoggerConfig();
 * app.use(auditLogger(config));
 * 
 * @example
 * // With custom configuration
 * const config: AuditLoggerConfig = {
 *   enabled: true,
 *   destination: 'file',
 *   format: 'json',
 *   level: 'info',
 *   filePath: '/var/log/mimir/audit.log'
 * };
 * app.use(auditLogger(config));
 * 
 * @example
 * // Webhook destination
 * const config: AuditLoggerConfig = {
 *   enabled: true,
 *   destination: 'webhook',
 *   format: 'json',
 *   level: 'info',
 *   webhookUrl: 'https://logs.example.com/audit',
 *   webhookAuthHeader: 'Bearer secret-token',
 *   batchSize: 50,
 *   batchIntervalMs: 10000
 * };
 * app.use(auditLogger(config));
 */
export function auditLogger(config: AuditLoggerConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip if audit logging disabled
    if (!config.enabled) {
      return next();
    }

    // Skip health check endpoint
    if (req.path === '/health') {
      return next();
    }

    const startTime = Date.now();

    // Capture response
    const originalSend = res.send;
    res.send = function (data: any) {
      const duration = Date.now() - startTime;

      const event: AuditEvent = {
        timestamp: new Date().toISOString(),
        userId: getUserId(req),
        action: getAction(req),
        resource: req.path,
        method: req.method,
        outcome: res.statusCode >= 200 && res.statusCode < 400 ? 'success' : 'failure',
        statusCode: res.statusCode,
        metadata: {
          ipAddress: (req.headers['x-real-ip'] as string) || 
                     (req.headers['x-forwarded-for'] as string)?.split(',')[0] || 
                     req.ip || 
                     'unknown',
          userAgent: req.headers['user-agent'],
          duration,
        },
      };

      // Add error message for failures
      if (event.outcome === 'failure' && typeof data === 'string') {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error || parsed.message) {
            event.metadata.errorMessage = parsed.error || parsed.message;
          }
        } catch {
          // Not JSON, ignore
        }
      }

      // Write audit event
      writeAuditEvent(event, config);

      return originalSend.call(this, data);
    };

    next();
  };
}

/**
 * Shutdown handler - flush remaining webhook events
 * 
 * Ensures all queued audit events are sent before application shutdown.
 * Should be called during graceful shutdown to prevent data loss.
 * 
 * @param config - Audit logger configuration
 * 
 * @example
 * // Graceful shutdown
 * process.on('SIGTERM', async () => {
 *   console.log('Shutting down...');
 *   const config = loadAuditLoggerConfig();
 *   await shutdownAuditLogger(config);
 *   process.exit(0);
 * });
 * 
 * @example
 * // With server cleanup
 * async function shutdown() {
 *   await server.close();
 *   await shutdownAuditLogger(auditConfig);
 *   await database.disconnect();
 *   console.log('Cleanup complete');
 * }
 */
export async function shutdownAuditLogger(config: AuditLoggerConfig) {
  if (webhookTimer) {
    clearTimeout(webhookTimer);
    webhookTimer = null;
  }
  await flushWebhookBatch(config);
}
