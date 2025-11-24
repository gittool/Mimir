/**
 * @file src/config/oauth-constants.ts
 * @description Centralized OAuth configuration constants
 * 
 * This file consolidates OAuth-related constants used across the application
 * to ensure consistency and make configuration changes easier to maintain.
 */

/**
 * Default timeout for OAuth userinfo requests in milliseconds
 * Can be overridden via MIMIR_OAUTH_TIMEOUT_MS environment variable
 */
export const DEFAULT_OAUTH_TIMEOUT_MS = 10000; // 10 seconds

/**
 * Get configured OAuth timeout from environment or use default
 * 
 * Reads `MIMIR_OAUTH_TIMEOUT_MS` environment variable and validates it.
 * Falls back to default (10 seconds) if not set or invalid.
 * 
 * @returns Timeout in milliseconds for OAuth userinfo requests
 * 
 * @example
 * ```ts
 * // Use default timeout
 * const timeout = getOAuthTimeout();
 * console.log(timeout); // 10000
 * 
 * // Custom timeout via environment
 * process.env.MIMIR_OAUTH_TIMEOUT_MS = '30000';
 * const customTimeout = getOAuthTimeout();
 * console.log(customTimeout); // 30000
 * 
 * // Invalid value falls back to default
 * process.env.MIMIR_OAUTH_TIMEOUT_MS = 'invalid';
 * const fallbackTimeout = getOAuthTimeout();
 * // Logs warning, returns 10000
 * ```
 */
export function getOAuthTimeout(): number {
  const envTimeout = process.env.MIMIR_OAUTH_TIMEOUT_MS;
  if (!envTimeout) {
    return DEFAULT_OAUTH_TIMEOUT_MS;
  }
  
  const timeoutMs = parseInt(envTimeout, 10);
  if (isNaN(timeoutMs) || timeoutMs <= 0) {
    console.warn(`[OAuth] Invalid MIMIR_OAUTH_TIMEOUT_MS value: ${envTimeout}, using default ${DEFAULT_OAUTH_TIMEOUT_MS}ms`);
    return DEFAULT_OAUTH_TIMEOUT_MS;
  }
  
  return timeoutMs;
}
