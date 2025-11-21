import { Router } from 'express';
import passport from '../config/passport.js';

const router = Router();

// Development: Login with username/password
router.post('/auth/login', (req, res, next) => {
  passport.authenticate('local', (err: any, user: any, info: any) => {
    if (err) {
      return res.status(500).json({ error: 'Authentication error', details: err.message });
    }
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials', message: info?.message || 'Authentication failed' });
    }
    req.logIn(user, (loginErr) => {
      if (loginErr) {
        return res.status(500).json({ error: 'Login error', details: loginErr.message });
      }
      return res.json({ success: true, user: { id: user.id, email: user.email, roles: user.roles || [] } });
    });
  })(req, res, next);
});

// Production: OAuth login
router.get('/auth/oauth/login', 
  passport.authenticate('oauth')
);

router.get('/auth/oauth/callback', 
  passport.authenticate('oauth', { 
    successRedirect: '/',
    failureRedirect: '/login'
  })
);

// Logout (both dev and prod)
router.post('/auth/logout', (req, res) => {
  req.logout(() => {
    res.json({ success: true });
  });
});

// Check auth status
router.get('/auth/status', (req, res) => {
  try {
    // If security is disabled, always return authenticated
    if (process.env.MIMIR_ENABLE_SECURITY !== 'true') {
      return res.json({ 
        authenticated: true,
        user: { id: 'anonymous', email: 'anonymous@localhost', roles: ['admin'] },
        securityDisabled: true
      });
    }
    
    // Security enabled - check actual authentication
    res.json({ 
      authenticated: req.isAuthenticated ? req.isAuthenticated() : false,
      user: req.user || null
    });
  } catch (error) {
    console.error('[Auth] Error in /auth/status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Auth configuration endpoint - tells frontend which login methods are available
router.get('/auth/config', (req, res) => {
  console.log('[Auth] /auth/config endpoint hit');
  try {
  const config: any = {
    devLoginEnabled: false,
    oauthProviders: []
  };

  // Check if dev login is enabled (when dev user credentials are set)
  const hasDevUsers = Object.keys(process.env).some(key => key.startsWith('MIMIR_DEV_USER_'));
  const hasLegacyDevUser = process.env.MIMIR_DEV_USERNAME && process.env.MIMIR_DEV_PASSWORD;
  
  if (hasDevUsers || hasLegacyDevUser) {
    config.devLoginEnabled = true;
  }

  // Check if OAuth is configured
  if (process.env.MIMIR_OAUTH_ISSUER && process.env.MIMIR_OAUTH_CLIENT_ID) {
    config.oauthProviders.push({
      name: 'oauth',
      url: '/auth/oauth/login',
      displayName: process.env.MIMIR_OAUTH_PROVIDER_NAME || 'OAuth 2.0'
    });
  }

  console.log('[Auth] Sending config:', config);
  res.json(config);
  } catch (error) {
    console.error('[Auth] Error in /auth/config:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
