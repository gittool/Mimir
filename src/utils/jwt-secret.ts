import crypto from 'crypto';

/**
 * JWT secret for signing and validating tokens
 * IMPORTANT: Set MIMIR_JWT_SECRET in production to persist across restarts
 * If not set, a random secret is generated (tokens won't survive server restarts)
 */
let JWT_SECRET: string;

if (process.env.MIMIR_JWT_SECRET) {
  JWT_SECRET = process.env.MIMIR_JWT_SECRET;
  console.log('[JWT] Using JWT secret from environment variable');
} else {
  JWT_SECRET = crypto.randomBytes(64).toString('hex');
  console.warn('[JWT] ⚠️  No MIMIR_JWT_SECRET set - using random secret (tokens will be invalidated on restart)');
}

export { JWT_SECRET };
