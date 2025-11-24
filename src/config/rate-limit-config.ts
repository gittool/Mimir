/**
 * Rate Limiter Configuration
 * 
 * Defines rate limits for different LLM providers.
 * Set requestsPerHour to -1 to bypass rate limiting entirely.
 */

export interface RateLimitSettings {
  requestsPerHour: number;
  enableDynamicThrottling: boolean;
  warningThreshold: number;
  logLevel: 'silent' | 'normal' | 'verbose';
}

export const DEFAULT_RATE_LIMITS: Record<string, RateLimitSettings> = {
  copilot: {
    requestsPerHour: 2500, // Conservative limit (50% of 5000 to account for estimation errors)
    enableDynamicThrottling: true,
    warningThreshold: 0.80, // Warn at 80% capacity
    logLevel: 'normal',
  },
  ollama: {
    requestsPerHour: -1, // Bypass rate limiting for local models
    enableDynamicThrottling: false,
    warningThreshold: 0.80,
    logLevel: 'silent',
  },
  openai: {
    requestsPerHour: 3000, // Default for OpenAI API
    enableDynamicThrottling: true,
    warningThreshold: 0.80,
    logLevel: 'normal',
  },
  anthropic: {
    requestsPerHour: 1000, // Conservative for Claude API
    enableDynamicThrottling: true,
    warningThreshold: 0.80,
    logLevel: 'normal',
  },
};

/**
 * Load rate limit configuration for a specific provider
 * 
 * Retrieves the default rate limit settings for a provider and applies
 * any custom overrides. Falls back to copilot settings if provider is unknown.
 * 
 * Rate limiting helps prevent API quota exhaustion and ensures fair resource
 * usage across multiple agents or concurrent requests.
 * 
 * @param provider - LLM provider name ('copilot', 'ollama', 'openai', 'anthropic')
 * @param overrides - Optional partial settings to override defaults
 * @returns Complete rate limit configuration with all settings
 * 
 * @example
 * ```ts
 * // Load default copilot settings
 * const config = loadRateLimitConfig('copilot');
 * console.log(config.requestsPerHour); // 2500
 * 
 * // Load with custom overrides
 * const customConfig = loadRateLimitConfig('openai', {
 *   requestsPerHour: 5000,
 *   logLevel: 'verbose'
 * });
 * 
 * // Disable rate limiting for local models
 * const ollamaConfig = loadRateLimitConfig('ollama');
 * console.log(ollamaConfig.requestsPerHour); // -1 (unlimited)
 * ```
 */
export function loadRateLimitConfig(
  provider: string,
  overrides?: Partial<RateLimitSettings>
): RateLimitSettings {
  const baseConfig = DEFAULT_RATE_LIMITS[provider.toLowerCase()] || DEFAULT_RATE_LIMITS.copilot;
  
  return {
    ...baseConfig,
    ...overrides,
  };
}

/**
 * Update rate limit for a provider at runtime
 * 
 * Dynamically adjusts the rate limit for a specific provider without
 * restarting the application. Useful for responding to API quota changes
 * or adjusting limits based on usage patterns.
 * 
 * Note: This modifies the global DEFAULT_RATE_LIMITS object, so changes
 * affect all future rate limiter instances for this provider.
 * 
 * @param provider - LLM provider name (case-insensitive)
 * @param newLimit - New requests per hour limit (-1 for unlimited)
 * 
 * @example
 * ```ts
 * // Increase OpenAI limit during off-peak hours
 * updateRateLimit('openai', 5000);
 * 
 * // Temporarily disable rate limiting for testing
 * updateRateLimit('copilot', -1);
 * 
 * // Restore default limit
 * updateRateLimit('copilot', 2500);
 * ```
 */
export function updateRateLimit(provider: string, newLimit: number): void {
  if (DEFAULT_RATE_LIMITS[provider.toLowerCase()]) {
    DEFAULT_RATE_LIMITS[provider.toLowerCase()].requestsPerHour = newLimit;
  }
}
