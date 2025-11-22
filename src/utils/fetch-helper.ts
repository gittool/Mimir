/**
 * @file src/utils/fetch-helper.ts
 * @description Utility for SSL-aware fetch requests with automatic certificate handling
 */

import https from 'https';

/**
 * Create fetch options with SSL handling based on NODE_TLS_REJECT_UNAUTHORIZED
 * 
 * @param url - The URL to fetch
 * @param options - Base fetch options
 * @returns Fetch options with SSL agent configured if needed
 */
export function createFetchOptions(url: string, options: RequestInit = {}): RequestInit {
  const fetchOptions = { ...options };
  
  // Handle NODE_TLS_REJECT_UNAUTHORIZED for HTTPS requests
  if (url.startsWith('https://') && process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    // For Node.js fetch (undici), we need to pass an agent
    (fetchOptions as any).agent = new https.Agent({
      rejectUnauthorized: false
    });
  }
  
  return fetchOptions;
}

/**
 * Add Authorization header to fetch options if API key is configured
 * 
 * @param options - Fetch options
 * @param apiKeyEnvVar - Environment variable name for API key (default: MIMIR_LLM_API_KEY)
 * @returns Fetch options with Authorization header if API key exists
 */
export function addAuthHeader(options: RequestInit, apiKeyEnvVar: string = 'MIMIR_LLM_API_KEY'): RequestInit {
  const apiKey = process.env[apiKeyEnvVar];
  
  if (apiKey) {
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${apiKey}`);
    return { ...options, headers };
  }
  
  return options;
}

/**
 * Convenience function: Create SSL-aware fetch options with optional auth
 * 
 * @param url - The URL to fetch
 * @param options - Base fetch options
 * @param apiKeyEnvVar - Optional environment variable name for API key
 * @returns Fetch options with SSL and auth configured
 */
export function createSecureFetchOptions(
  url: string,
  options: RequestInit = {},
  apiKeyEnvVar?: string
): RequestInit {
  let fetchOptions = createFetchOptions(url, options);
  
  if (apiKeyEnvVar) {
    fetchOptions = addAuthHeader(fetchOptions, apiKeyEnvVar);
  }
  
  return fetchOptions;
}
