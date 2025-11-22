import { Router } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import passport from '../config/passport.js';
import { GraphManager } from '../managers/GraphManager.js';

const router = Router();

// JWT secret from environment
// Only required when security is enabled
const JWT_SECRET: string = process.env.MIMIR_JWT_SECRET || (() => {
  if (process.env.MIMIR_ENABLE_SECURITY === 'true') {
    throw new Error('MIMIR_JWT_SECRET must be set when MIMIR_ENABLE_SECURITY=true');
  }
  return 'dev-only-secret-not-for-production';
})();

/**
 * POST /auth/token
 * OAuth 2.0 RFC 6749 compliant token endpoint
 * Supports grant_type: password (Resource Owner Password Credentials)
 * Returns access_token in response body (not cookies)
 */
router.post('/auth/token', async (req, res) => {
  const { grant_type, username, password, scope } = req.body;

  // Only support password grant type for now
  if (grant_type !== 'password') {
    return res.status(400).json({
      error: 'unsupported_grant_type',
      error_description: 'Only "password" grant type is supported'
    });
  }

  if (!username || !password) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'username and password are required'
    });
  }

  // Authenticate using passport's local strategy
  passport.authenticate('local', async (err: any, user: any, info: any) => {
    if (err) {
      return res.status(500).json({
        error: 'server_error',
        error_description: err.message
      });
    }
    if (!user) {
      return res.status(401).json({
        error: 'invalid_grant',
        error_description: info?.message || 'Invalid username or password'
      });
    }

    try {
      // Generate JWT access token (stateless, no database storage needed)
      const expiresInDays = 90; // 90 days for programmatic access
      const expiresInSeconds = expiresInDays * 24 * 60 * 60;
      
      const payload = {
        sub: user.id,           // Subject (user ID)
        email: user.email,      // User email
        roles: user.roles || ['viewer'], // User roles/permissions
        iat: Math.floor(Date.now() / 1000), // Issued at
        exp: Math.floor(Date.now() / 1000) + expiresInSeconds // Expiration
      };

      const accessToken = jwt.sign(payload, JWT_SECRET, {
        algorithm: 'HS256'
      });

      // RFC 6749 compliant response
      return res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: expiresInSeconds, // seconds
        scope: scope || 'default'
      });
    } catch (error: any) {
      console.error('[Auth] Token generation error:', error);
      return res.status(500).json({
        error: 'server_error',
        error_description: error.message
      });
    }
  })(req, res);
});

// Development: Login with username/password - returns API key in HTTP-only cookie (for browser UI)
router.post('/auth/login', async (req, res, next) => {
  passport.authenticate('local', async (err: any, user: any, info: any) => {
    if (err) {
      return res.status(500).json({ error: 'Authentication error', details: err.message });
    }
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials', message: info?.message || 'Authentication failed' });
    }
    
    try {
      // Generate API key for this user session
      const apiKey = `mimir_${crypto.randomBytes(32).toString('hex')}`;
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      
      // Store API key in Neo4j
      const graphManager = new GraphManager(
        process.env.NEO4J_URI || 'bolt://localhost:7687',
        process.env.NEO4J_USER || 'neo4j',
        process.env.NEO4J_PASSWORD || 'password'
      );
      
      const expiresInDays = 7; // 7 days for login sessions
      const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
      
      await graphManager.addNode('custom', {
        type: 'apiKey',
        keyHash,
        name: 'Login Session',
        userId: user.id,
        userEmail: user.email,
        permissions: user.roles || ['viewer'],
        createdAt: new Date().toISOString(),
        expiresAt,
        lastUsedAt: null,
        lastValidated: new Date().toISOString(),
        usageCount: 0,
        status: 'active'
      });
      
      await graphManager.close();
      
      // Set API key in HTTP-only cookie (secure in production)
      res.cookie('mimir_api_key', apiKey, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: expiresInDays * 24 * 60 * 60 * 1000 // 7 days in milliseconds
      });
      
      return res.json({ 
        success: true,
        expiresAt,
        user: { 
          id: user.id, 
          email: user.email, 
          roles: user.roles || [] 
        } 
      });
    } catch (error: any) {
      console.error('[Auth] Error generating API key:', error);
      return res.status(500).json({ error: 'Failed to generate API key', details: error.message });
    }
  })(req, res, next);
});

// Production: OAuth login - returns API key
router.get('/auth/oauth/login', 
  passport.authenticate('oauth', { session: false })
);

router.get('/auth/oauth/callback', 
  passport.authenticate('oauth', { session: false }), 
  async (req: any, res) => {
    try {
      const user = req.user;
      
      // Generate API key for OAuth user
      const apiKey = `mimir_${crypto.randomBytes(32).toString('hex')}`;
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      
      const graphManager = new GraphManager(
        process.env.NEO4J_URI || 'bolt://localhost:7687',
        process.env.NEO4J_USER || 'neo4j',
        process.env.NEO4J_PASSWORD || 'password'
      );
      
      const expiresInDays = 7;
      const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
      
      await graphManager.addNode('custom', {
        type: 'apiKey',
        keyHash,
        name: 'OAuth Login Session',
        userId: user.id,
        userEmail: user.email,
        permissions: user.roles || ['viewer'],
        createdAt: new Date().toISOString(),
        expiresAt,
        lastUsedAt: null,
        lastValidated: new Date().toISOString(),
        usageCount: 0,
        status: 'active'
      });
      
      await graphManager.close();
      
      // Set API key in HTTP-only cookie
      res.cookie('mimir_api_key', apiKey, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: expiresInDays * 24 * 60 * 60 * 1000
      });
      
      // Redirect to frontend
      res.redirect('/');
    } catch (error: any) {
      console.error('[Auth] OAuth callback error:', error);
      res.redirect('/login?error=oauth_failed');
    }
  }
);

// Logout - revoke API key and clear cookie
router.post('/auth/logout', async (req, res) => {
  try {
    // Get API key from cookie
    const apiKey = req.cookies?.mimir_api_key;
    
    if (apiKey) {
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      
      const graphManager = new GraphManager(
        process.env.NEO4J_URI || 'bolt://localhost:7687',
        process.env.NEO4J_USER || 'neo4j',
        process.env.NEO4J_PASSWORD || 'password'
      );
      
      const keys = await graphManager.queryNodes(undefined, { type: 'apiKey', keyHash });
      
      if (keys.length > 0) {
        await graphManager.updateNode(keys[0].id, { status: 'revoked' });
      }
      
      await graphManager.close();
    }
    
    // Clear the cookie
    res.clearCookie('mimir_api_key', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });
    
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error: any) {
    console.error('[Auth] Logout error:', error);
    res.status(500).json({ error: 'Logout failed', details: error.message });
  }
});

// Check auth status - verify API key
router.get('/auth/status', async (req, res) => {
  try {
    // If security is disabled, always return authenticated
    if (process.env.MIMIR_ENABLE_SECURITY !== 'true') {
      return res.json({ 
        authenticated: true,
        securityEnabled: false
      });
    }

    // Extract API key from cookie
    const apiKey = req.cookies?.mimir_api_key;
    if (!apiKey) {
      return res.json({ authenticated: false });
    }

    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    
    const graphManager = new GraphManager(
      process.env.NEO4J_URI || 'bolt://localhost:7687',
      process.env.NEO4J_USER || 'neo4j',
      process.env.NEO4J_PASSWORD || 'password'
    );
    
    const keys = await graphManager.queryNodes(undefined, { type: 'apiKey', keyHash, status: 'active' });
    await graphManager.close();
    
    if (keys.length === 0) {
      return res.json({ authenticated: false, error: 'Invalid or expired API key' });
    }
    
    const keyData = keys[0].properties as any;
    
    // Check expiration
    if (keyData.expiresAt && new Date(keyData.expiresAt) < new Date()) {
      return res.json({ authenticated: false, error: 'API key expired' });
    }
    
    return res.json({ 
      authenticated: true,
      user: {
        id: keyData.userId,
        email: keyData.userEmail,
        roles: keyData.permissions
      }
    });
  } catch (error: any) {
    console.error('[Auth] Status check error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get auth configuration for frontend
router.get('/auth/config', (req, res) => {
  console.log('[Auth] /auth/config endpoint hit');
  
  const securityEnabled = process.env.MIMIR_ENABLE_SECURITY === 'true';
  
  if (!securityEnabled) {
    return res.json({
      devLoginEnabled: false,
      oauthProviders: []
    });
  }

  // Check if dev mode is enabled (MIMIR_DEV_USER_* vars present)
  const hasDevUsers = Object.keys(process.env).some(key => 
    key.startsWith('MIMIR_DEV_USER_') && process.env[key]
  );

  // Check if OAuth is configured
  const oauthEnabled = !!(
    process.env.MIMIR_OAUTH_CLIENT_ID &&
    process.env.MIMIR_OAUTH_CLIENT_SECRET &&
    process.env.MIMIR_OAUTH_ISSUER
  );

  // Build OAuth providers array
  const oauthProviders = [];
  if (oauthEnabled) {
    oauthProviders.push({
      name: 'oauth',
      url: '/auth/oauth/login',
      displayName: process.env.MIMIR_OAUTH_PROVIDER_NAME || 'OAuth 2.0'
    });
  }

  const config = {
    devLoginEnabled: hasDevUsers,
    oauthProviders
  };

  console.log('[Auth] Sending config:', JSON.stringify(config));
  res.json(config);
});

export default router;
