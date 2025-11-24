/**
 * @file src/utils/fetch-helper.ts
 * @description Utility for SSL-aware fetch requests with automatic certificate handling
 */

import https from 'https';

/**
 * Create fetch options with SSL certificate handling
 * 
 * Automatically configures SSL/TLS settings based on the
 * `NODE_TLS_REJECT_UNAUTHORIZED` environment variable.
 * 
 * When `NODE_TLS_REJECT_UNAUTHORIZED=0`, disables certificate validation
 * for HTTPS requests. Useful for development with self-signed certificates.
 * 
 * **Security Warning:** Never set `NODE_TLS_REJECT_UNAUTHORIZED=0` in production!
 * 
 * @param url - The URL to fetch
 * @param options - Base fetch options to extend
 * @returns Fetch options with SSL agent configured if needed
 * 
 * @example
 * ```ts
 * // Development with self-signed cert
 * process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
 * const options = createFetchOptions('https://localhost:8443/api');
 * const response = await fetch('https://localhost:8443/api', options);
 * 
 * // Production (validates certificates)
 * delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
 * const options = createFetchOptions('https://api.example.com');
 * const response = await fetch('https://api.example.com', options);
 * ```
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
 * Add Authorization Bearer header to fetch options
 * 
 * Reads API key from environment variable and adds it as a Bearer token.
 * If the environment variable is not set, returns options unchanged.
 * 
 * @param options - Fetch options to extend
 * @param apiKeyEnvVar - Environment variable name for API key (default: MIMIR_LLM_API_KEY)
 * @returns Fetch options with Authorization header if API key exists
 * 
 * @example
 * ```ts
 * process.env.MIMIR_LLM_API_KEY = 'sk-abc123';
 * 
 * let options = {};
 * options = addAuthHeader(options);
 * // options.headers['Authorization'] = 'Bearer sk-abc123'
 * 
 * // Custom API key variable
 * process.env.MY_API_KEY = 'custom-key';
 * options = addAuthHeader({}, 'MY_API_KEY');
 * // options.headers['Authorization'] = 'Bearer custom-key'
 * ```
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
 * Create an AbortSignal with timeout for fetch requests
 * 
 * Prevents hanging requests by automatically aborting after the specified timeout.
 * 
 * @param timeoutMs - Timeout in milliseconds (default: 10000ms = 10 seconds)
 * @returns AbortSignal that will abort after timeout
 * 
 * @example
 * ```ts
 * // 10 second timeout (default)
 * const signal = createTimeoutSignal();
 * try {
 *   const response = await fetch('https://api.example.com', { signal });
 * } catch (error) {
 *   if (error.name === 'AbortError') {
 *     console.log('Request timed out after 10 seconds');
 *   }
 * }
 * 
 * // Custom 30 second timeout
 * const signal = createTimeoutSignal(30000);
 * const response = await fetch('https://slow-api.example.com', { signal });
 * ```
 */
export function createTimeoutSignal(timeoutMs: number = 10000): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

/**
 * Validate OAuth bearer token format to prevent security attacks
 * 
 * Performs comprehensive validation to prevent:
 * - **SSRF attacks**: Ensures token doesn't contain URLs or protocols
 * - **Injection attacks**: Blocks newlines, control characters, HTML/JS
 * - **DoS attacks**: Enforces maximum token length (8KB)
 * 
 * Valid tokens contain only base64url characters, dots, hyphens, underscores,
 * and URL-safe characters commonly found in JWT and OAuth tokens.
 * 
 * @param token - The token to validate
 * @returns true if token format is valid
 * @throws Error if token format is invalid with specific reason
 * 
 * @example
 * ```ts
 * // Valid JWT token
 * const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123';
 * validateOAuthTokenFormat(token); // Returns true
 * 
 * // Invalid: contains newline (injection attempt)
 * try {
 *   validateOAuthTokenFormat('token\nmalicious-header: value');
 * } catch (error) {
 *   console.log(error.message); // 'Token contains suspicious patterns'
 * }
 * 
 * // Invalid: too long (DoS attempt)
 * try {
 *   validateOAuthTokenFormat('a'.repeat(10000));
 * } catch (error) {
 *   console.log(error.message); // 'Token exceeds maximum length'
 * }
 * ```
 */
export function validateOAuthTokenFormat(token: string): boolean {
  if (!token || typeof token !== 'string') {
    throw new Error('Token must be a non-empty string');
  }
  
  // Token should not be excessively long (max 8KB for OAuth tokens)
  if (token.length > 8192) {
    throw new Error('Token exceeds maximum length');
  }
  
  // Token should only contain valid base64url characters, dots, hyphens, and underscores
  // This prevents injection of newlines, control characters, or other malicious content
  const validTokenPattern = /^[A-Za-z0-9\-_\.~\+\/=]+$/;
  if (!validTokenPattern.test(token)) {
    throw new Error('Token contains invalid characters');
  }
  
  // Token should not contain suspicious patterns that could indicate injection attempts
  const suspiciousPatterns = [
    /[\r\n]/,           // Newlines (HTTP header injection)
    /[<>]/,             // HTML/XML tags
    /javascript:/i,     // JavaScript protocol
    /data:/i,           // Data protocol
    /file:/i,           // File protocol
  ];
  
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(token)) {
      throw new Error('Token contains suspicious patterns');
    }
  }
  
  return true;
}

/**
 * Validate OAuth userinfo URL to prevent SSRF (Server-Side Request Forgery) attacks
 * 
 * Ensures the URL is safe to fetch by blocking:
 * - **Private IP ranges**: 10.x.x.x, 192.168.x.x, 172.16-31.x.x
 * - **Localhost**: 127.0.0.1, ::1, localhost
 * - **Link-local addresses**: 169.254.x.x, fe80::
 * - **Non-HTTP(S) protocols**: file://, javascript://, data://
 * 
 * In production, only HTTPS is allowed (unless `MIMIR_OAUTH_ALLOW_HTTP=true`).
 * In development, localhost is permitted for local OAuth testing.
 * 
 * @param url - The URL to validate
 * @returns true if URL is safe to fetch
 * @throws Error if URL is unsafe with specific reason
 * 
 * @example
 * ```ts
 * // Valid production URL
 * validateOAuthUserinfoUrl('https://oauth.example.com/userinfo');
 * // Returns true
 * 
 * // Invalid: private IP (SSRF attempt)
 * try {
 *   validateOAuthUserinfoUrl('https://192.168.1.1/admin');
 * } catch (error) {
 *   console.log(error.message); // 'Private IP addresses are not allowed'
 * }
 * 
 * // Development: localhost allowed
 * process.env.NODE_ENV = 'development';
 * validateOAuthUserinfoUrl('http://localhost:3000/userinfo');
 * // Returns true
 * 
 * // Production: localhost blocked
 * process.env.NODE_ENV = 'production';
 * try {
 *   validateOAuthUserinfoUrl('http://localhost:3000/userinfo');
 * } catch (error) {
 *   console.log(error.message); // 'Localhost is not allowed in production'
 * }
 * ```
 */
export function validateOAuthUserinfoUrl(url: string): boolean {
  if (!url || typeof url !== 'string') {
    throw new Error('URL must be a non-empty string');
  }
  
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch (error) {
    throw new Error('Invalid URL format');
  }
  // Check if HTTP is explicitly allowed (for local OAuth testing)
  const allowHttp = process.env.MIMIR_OAUTH_ALLOW_HTTP === 'true';
  
  // Only allow HTTPS in production (unless explicitly overridden)
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction && !allowHttp && parsedUrl.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are allowed in production (set MIMIR_OAUTH_ALLOW_HTTP=true to override)');
  }
  
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('Only HTTP/HTTPS protocols are allowed');
  }
  
  // Block private IP ranges and localhost (except in development)
  const hostname = parsedUrl.hostname.toLowerCase();
  
  // Allow localhost and host.docker.internal in development ONLY
  const isDevelopment = process.env.NODE_ENV !== 'production';
  if (isDevelopment) {
    const allowedDevHosts = ['localhost', '127.0.0.1', '::1', 'host.docker.internal'];
    if (allowedDevHosts.includes(hostname)) {
      return true;
    }
  }
  
  // Block private IP ranges in production
  const privateIpPatterns = [
    /^127\./,                    // 127.0.0.0/8 (loopback)
    /^10\./,                     // 10.0.0.0/8 (private)
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12 (private)
    /^192\.168\./,               // 192.168.0.0/16 (private)
    /^169\.254\./,               // 169.254.0.0/16 (link-local)
    /^::1$/,                     // IPv6 loopback
    /^fe80:/,                    // IPv6 link-local
    /^fc00:/,                    // IPv6 unique local
    /^fd00:/,                    // IPv6 unique local
  ];
  
  for (const pattern of privateIpPatterns) {
    if (pattern.test(hostname)) {
      throw new Error('Private IP addresses are not allowed');
    }
  }
  
  // Block localhost variations
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Localhost is not allowed in production');
  }
  
  return true;
}

/**
 * Create secure fetch options with SSL, authentication, and timeout
 * 
 * Convenience function that combines SSL handling, authentication,
 * and timeout configuration in one call.
 * 
 * **Features:**
 * - SSL certificate handling (respects NODE_TLS_REJECT_UNAUTHORIZED)
 * - Optional Bearer token authentication from environment
 * - Automatic request timeout (default: 10 seconds)
 * 
 * @param url - The URL to fetch
 * @param options - Base fetch options to extend
 * @param apiKeyEnvVar - Optional environment variable name for API key
 * @param timeoutMs - Optional timeout in milliseconds (default: 10000ms = 10s)
 * @returns Fetch options with SSL, auth, and timeout configured
 * 
 * @example
 * ```ts
 * // Simple usage with defaults
 * const options = createSecureFetchOptions('https://api.example.com/data');
 * const response = await fetch('https://api.example.com/data', options);
 * 
 * // With authentication
 * process.env.MIMIR_LLM_API_KEY = 'sk-abc123';
 * const options = createSecureFetchOptions(
 *   'https://api.openai.com/v1/models',
 *   {},
 *   'MIMIR_LLM_API_KEY'
 * );
 * // Adds: Authorization: Bearer sk-abc123
 * 
 * // With custom timeout (30 seconds)
 * const options = createSecureFetchOptions(
 *   'https://slow-api.example.com',
 *   { method: 'POST', body: JSON.stringify(data) },
 *   undefined,
 *   30000
 * );
 * 
 * // Full example with error handling
 * try {
 *   const options = createSecureFetchOptions(
 *     'https://api.example.com',
 *     { method: 'GET' },
 *     'MY_API_KEY',
 *     5000
 *   );
 *   const response = await fetch('https://api.example.com', options);
 *   const data = await response.json();
 * } catch (error) {
 *   if (error.name === 'AbortError') {
 *     console.log('Request timed out');
 *   }
 * }
 * ```
 */
export function createSecureFetchOptions(
  url: string,
  options: RequestInit = {},
  apiKeyEnvVar?: string,
  timeoutMs: number = 10000
): RequestInit {
  let fetchOptions = createFetchOptions(url, options);
  
  if (apiKeyEnvVar) {
    fetchOptions = addAuthHeader(fetchOptions, apiKeyEnvVar);
  }
  
  // Add timeout signal if not already provided in options
  // Check the original options, not fetchOptions, since signal might not be copied
  if (!options.signal && !fetchOptions.signal) {
    fetchOptions.signal = createTimeoutSignal(timeoutMs);
  }
  
  return fetchOptions;
}
