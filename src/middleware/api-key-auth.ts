import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

// JWT secret from environment
// Only required when security is enabled
const JWT_SECRET: string = process.env.MIMIR_JWT_SECRET || (() => {
  if (process.env.MIMIR_ENABLE_SECURITY === 'true') {
    throw new Error('MIMIR_JWT_SECRET must be set when MIMIR_ENABLE_SECURITY=true');
  }
  return 'dev-only-secret-not-for-production';
})();

// Legacy helper functions removed - no longer needed with JWT stateless auth

/**
 * Middleware to authenticate requests using JWT tokens
 * Validates JWT signature and expiration (stateless, no database lookup)
 */
export async function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  // OAuth 2.0 RFC 6750 compliant: Check Authorization: Bearer header first
  let token: string | undefined;
  let source = 'none';
  
  const authHeader = req.headers['authorization'] as string;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7); // Remove 'Bearer ' prefix
    source = 'Authorization header';
  }
  
  // Fallback to X-API-Key header (common alternative)
  if (!token) {
    token = req.headers['x-api-key'] as string;
    if (token) source = 'X-API-Key header';
  }
  
  // Check HTTP-only cookie (for browser UI)
  if (!token && req.cookies) {
    token = req.cookies.mimir_api_key;
    if (token) source = 'HTTP-only cookie';
  }
  
  // For SSE (EventSource can't send custom headers), accept query parameters
  // Accept both 'access_token' (OAuth 2.0 RFC 6750) and 'api_key' (common alternative)
  if (!token) {
    token = (req.query.access_token as string) || (req.query.api_key as string);
    if (token) source = 'query parameter';
  }
  
  if (!token) {
    return next(); // No token provided, continue to next middleware
  }
  
  console.log(`[JWT Auth] Received token from ${source}`);

  try {
    // Verify JWT signature and decode payload
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256']
    }) as any;

    console.log(`[JWT Auth] Valid token for user: ${decoded.email}, roles: ${decoded.roles?.join(', ')}`);

    // Attach user info to request for downstream middleware/routes
    req.user = {
      id: decoded.sub,
      email: decoded.email,
      roles: decoded.roles || ['viewer']
    };

    return next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      console.log('[JWT Auth] Token expired');
      return res.status(401).json({ error: 'Token expired' });
    }
    if (error.name === 'JsonWebTokenError') {
      console.log('[JWT Auth] Invalid token:', error.message);
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    console.error('[JWT Auth] Token validation error:', error);
    return res.status(401).json({ error: 'Authentication failed' });
  }
}

// Legacy database-based API key validation removed - now using JWT stateless auth

/**
 * Middleware that requires either session auth OR API key auth
 * Use this to protect routes that accept both authentication methods
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Check session authentication first
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }

  // Check API key authentication
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    return apiKeyAuth(req, res, next);
  }

  // No authentication provided
  return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
}
