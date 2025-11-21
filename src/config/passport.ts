// Load environment variables first
import dotenv from 'dotenv';
dotenv.config();

import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as OAuth2Strategy } from 'passport-oauth2';

// Development: Local username/password (configurable via env vars)
// Supports multiple dev users with different roles for RBAC testing
// Format: MIMIR_DEV_USER_<NAME>=username:password:role1,role2,role3
if (process.env.MIMIR_ENABLE_SECURITY === 'true') {
  
  // Parse all MIMIR_DEV_USER_* environment variables
  const devUsers: Array<{ username: string; password: string; roles: string[]; id: string }> = [];
  
  Object.keys(process.env).forEach(key => {
    if (key.startsWith('MIMIR_DEV_USER_')) {
      const value = process.env[key];
      if (value) {
        const [username, password, rolesStr] = value.split(':');
        if (username && password) {
          const roles = rolesStr ? rolesStr.split(',').map(r => r.trim()) : ['viewer'];
          const userId = key.replace('MIMIR_DEV_USER_', '').toLowerCase();
          devUsers.push({ username, password, roles, id: userId });
          console.log(`[Auth] Dev user registered: ${username} with roles [${roles.join(', ')}]`);
        }
      }
    }
  });
  
  // Fallback: If no MIMIR_DEV_USER_* vars, check legacy MIMIR_DEV_USERNAME/PASSWORD
  if (devUsers.length === 0 && process.env.MIMIR_DEV_USERNAME && process.env.MIMIR_DEV_PASSWORD) {
    devUsers.push({
      username: process.env.MIMIR_DEV_USERNAME,
      password: process.env.MIMIR_DEV_PASSWORD,
      roles: ['admin'],
      id: 'legacy-admin'
    });
    console.log(`[Auth] Legacy dev user registered: ${process.env.MIMIR_DEV_USERNAME} with roles [admin]`);
  }
  
  if (devUsers.length > 0) {
    passport.use(new LocalStrategy((username, password, done) => {
      // Find matching dev user
      const user = devUsers.find(u => u.username === username && u.password === password);
      if (user) {
        return done(null, { 
          id: user.id, 
          email: `${username}@localhost`,
          roles: user.roles,
          username: user.username
        });
      }
      return done(null, false, { message: 'Invalid credentials' });
    }));
  }
}

// Production: OAuth
if (process.env.MIMIR_ENABLE_SECURITY === 'true' && 
    process.env.MIMIR_AUTH_PROVIDER) {
  
  console.log(`[Auth] OAuth enabled with provider: ${process.env.MIMIR_AUTH_PROVIDER}`);
  
  passport.use('oauth', new OAuth2Strategy({
    authorizationURL: `${process.env.MIMIR_OAUTH_ISSUER}/oauth2/v1/authorize`,
    tokenURL: `${process.env.MIMIR_OAUTH_ISSUER}/oauth2/v1/token`,
    clientID: process.env.MIMIR_OAUTH_CLIENT_ID!,
    clientSecret: process.env.MIMIR_OAUTH_CLIENT_SECRET!,
    callbackURL: process.env.MIMIR_OAUTH_CALLBACK_URL!,
  }, async (accessToken: string, refreshToken: string, profile: any, done: any) => {
    // User authenticated via OAuth
    // Extract roles/groups from profile (IdP-specific)
    const roles = profile.roles || profile.groups || [];
    
    return done(null, { 
      id: profile.id, 
      email: profile.email,
      roles: Array.isArray(roles) ? roles : [roles],
      // Preserve original profile for custom claim extraction
      ...profile
    });
  }));
}

// Serialize user to session
passport.serializeUser((user: any, done) => done(null, user));
passport.deserializeUser((user: any, done) => done(null, user));

export default passport;
