import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

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

    // Update last used timestamp and usage count (async, don't wait)
    const graphManagerUpdate = new GraphManager(
      process.env.NEO4J_URI || 'bolt://localhost:7687',
      process.env.NEO4J_USER || 'neo4j',
      process.env.NEO4J_PASSWORD || 'password'
    );
    
    graphManagerUpdate.updateNode(keys[0].id, {
      lastUsedAt: new Date().toISOString(),
      usageCount: (keyData.usageCount || 0) + 1
    }).then(() => graphManagerUpdate.close()).catch(console.error);

    // Set req.user with API key's permissions
    (req as any).user = {
      id: keyData.userId,
      email: keyData.userEmail,
      roles: keyData.permissions || ['viewer'],
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
