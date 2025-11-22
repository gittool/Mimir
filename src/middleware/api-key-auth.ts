import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * Get validation interval from MIMIR_SESSION_MAX_AGE_HOURS
 * Defaults to 24 hours if not set, or never if set to 0
 */
function getValidationInterval(): number {
  const sessionMaxAgeHours = parseInt(process.env.MIMIR_SESSION_MAX_AGE_HOURS || '24', 10);
  
  // If 0 (never expire), use a very large number (effectively never re-validate)
  if (sessionMaxAgeHours === 0) {
    return Number.MAX_SAFE_INTEGER;
  }
  
  // Convert hours to milliseconds
  return sessionMaxAgeHours * 60 * 60 * 1000;
}

/**
 * Get user's current roles from active session or OAuth provider
 * This allows us to re-validate API key permissions against current user state
 */
async function getUserCurrentRoles(userId: string): Promise<{ roles: string[] } | null> {
  try {
    // Query Neo4j for user's most recent session or stored roles
    const { GraphManager } = await import('../managers/GraphManager.js');
    const graphManager = new GraphManager(
      process.env.NEO4J_URI || 'bolt://localhost:7687',
      process.env.NEO4J_USER || 'neo4j',
      process.env.NEO4J_PASSWORD || 'password'
    );

    // Look for user's active session or stored user profile
    const users = await graphManager.queryNodes(undefined, { type: 'user', userId });
    
    await graphManager.close();

    if (users.length > 0) {
      const userProps = users[0].properties as any;
      return { roles: userProps.roles || ['viewer'] };
    }

    // If no user found, return null (will use cached permissions)
    return null;
  } catch (error) {
    console.error('[API Key Auth] Error fetching user roles:', error);
    return null;
  }
}

/**
 * Intersect two permission arrays to get the most restrictive set
 * This ensures API keys can't have more permissions than the user currently has
 */
function intersectPermissions(keyPermissions: string[], userRoles: string[]): string[] {
  // If user has wildcard (*), key permissions are valid
  if (userRoles.includes('*')) {
    return keyPermissions;
  }

  // If key has wildcard, use user's current roles
  if (keyPermissions.includes('*')) {
    return userRoles;
  }

  // Return intersection of both arrays
  return keyPermissions.filter(perm => userRoles.includes(perm));
}

/**
 * Middleware to authenticate requests using API keys
 * Checks X-API-Key header and validates against stored keys in Neo4j
 */
export async function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'] as string;
  
  if (!apiKey) {
    return next(); // No API key provided, continue to next middleware
  }

  try {
    // Hash the provided API key
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    // Query Neo4j for matching API key
    const { GraphManager } = await import('../managers/GraphManager.js');
    const graphManager = new GraphManager(
      process.env.NEO4J_URI || 'bolt://localhost:7687',
      process.env.NEO4J_USER || 'neo4j',
      process.env.NEO4J_PASSWORD || 'password'
    );

    const keys = await graphManager.queryNodes(undefined, { type: 'apiKey', keyHash, status: 'active' });

    await graphManager.close();

    if (keys.length === 0) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    const keyData = keys[0].properties as any;

    // Check expiration
    if (keyData.expiresAt) {
      const expiresAt = new Date(keyData.expiresAt);
      if (expiresAt < new Date()) {
        return res.status(401).json({ error: 'API key expired' });
      }
    }

    // Periodic re-validation: Check if permissions need to be re-validated
    const validationIntervalMs = getValidationInterval();
    let effectivePermissions = keyData.permissions || ['viewer'];
    let needsUpdate = false;
    
    if (keyData.lastValidated) {
      const timeSinceValidation = Date.now() - new Date(keyData.lastValidated).getTime();
      
      if (timeSinceValidation > validationIntervalMs) {
        // Re-validate permissions against user's current session/roles
        // This ensures API key permissions don't exceed user's current roles
        try {
          const userSession = await getUserCurrentRoles(keyData.userId);
          if (userSession) {
            // Use intersection of key permissions and current user roles
            effectivePermissions = intersectPermissions(keyData.permissions, userSession.roles);
            needsUpdate = true;
            console.log(`[API Key Auth] Re-validated permissions for key ${keys[0].id}: ${effectivePermissions.join(', ')}`);
          }
        } catch (error) {
          console.warn(`[API Key Auth] Could not re-validate permissions, using cached: ${error}`);
        }
      }
    }

    // Update last used timestamp, usage count, and permissions if re-validated (async, don't wait)
    const graphManagerUpdate = new GraphManager(
      process.env.NEO4J_URI || 'bolt://localhost:7687',
      process.env.NEO4J_USER || 'neo4j',
      process.env.NEO4J_PASSWORD || 'password'
    );
    
    const updates: any = {
      lastUsedAt: new Date().toISOString(),
      usageCount: (keyData.usageCount || 0) + 1
    };
    
    if (needsUpdate) {
      updates.permissions = effectivePermissions;
      updates.lastValidated = new Date().toISOString();
    }
    
    graphManagerUpdate.updateNode(keys[0].id, updates)
      .then(() => graphManagerUpdate.close())
      .catch(console.error);

    // Set req.user with API key's effective permissions
    (req as any).user = {
      id: keyData.userId,
      email: keyData.userEmail,
      roles: effectivePermissions,
      authMethod: 'apiKey',
      apiKeyId: keys[0].id
    };

    next();
  } catch (error: any) {
    console.error('[API Key Auth] Error:', error);
    return res.status(500).json({ error: 'Authentication error', details: error.message });
  }
}

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
