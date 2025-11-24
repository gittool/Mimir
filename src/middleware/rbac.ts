import { Request, Response, NextFunction } from 'express';
import { getRBACConfig } from '../config/rbac-config.js';
import { extractRolesWithDefault } from './claims-extractor.js';

/**
 * Get all permissions for a user based on their roles
 * 
 * Extracts user roles from the configured claim path and aggregates
 * all permissions from the RBAC configuration. Supports default role
 * fallback if no roles are found.
 * 
 * @param user - User object from authentication (req.user)
 * 
 * @returns Set of permission strings (e.g., 'nodes:read', 'search:execute')
 * 
 * @example
 * // Get permissions for authenticated user
 * const permissions = getUserPermissions(req.user);
 * console.log('User has', permissions.size, 'permissions');
 * 
 * @example
 * // Check specific permission
 * const permissions = getUserPermissions(req.user);
 * if (permissions.has('nodes:write')) {
 *   console.log('User can write nodes');
 * }
 * 
 * @example
 * // List all user permissions
 * const permissions = getUserPermissions(req.user);
 * permissions.forEach(perm => console.log('  -', perm));
 */
export function getUserPermissions(user: any): Set<string> {
  const permissions = new Set<string>();
  
  if (!user) {
    return permissions;
  }
  
  const config = getRBACConfig();
  
  // Extract roles using configurable claim path with default role fallback
  const roles = extractRolesWithDefault(
    user, 
    config.claimPath || 'roles',
    config.defaultRole
  );
  
  if (!roles || !Array.isArray(roles) || roles.length === 0) {
    return permissions;
  }
  
  for (const role of roles) {
    const roleConfig = config.roleMappings[role];
    if (roleConfig && roleConfig.permissions) {
      for (const permission of roleConfig.permissions) {
        permissions.add(permission);
      }
    }
  }
  
  return permissions;
}

/**
 * Check if user has a specific permission
 * 
 * Supports wildcard matching for flexible permission checks:
 * - `*` matches all permissions (admin)
 * - `nodes:*` matches all node permissions (`nodes:read`, `nodes:write`, etc.)
 * - Exact match: `nodes:read` only matches `nodes:read`
 * 
 * @param userPermissions - Set of user's permissions from getUserPermissions()
 * @param requiredPermission - Permission to check (e.g., 'nodes:write')
 * 
 * @returns true if user has the permission, false otherwise
 * 
 * @example
 * // Check specific permission
 * const permissions = getUserPermissions(req.user);
 * if (hasPermission(permissions, 'nodes:delete')) {
 *   // User can delete nodes
 *   await deleteNode(nodeId);
 * }
 * 
 * @example
 * // Admin check (wildcard '*')
 * const permissions = getUserPermissions(req.user);
 * if (hasPermission(permissions, 'admin:panel')) {
 *   // Will pass if user has '*' permission
 *   console.log('User is admin');
 * }
 * 
 * @example
 * // Namespace wildcard check
 * const permissions = new Set(['nodes:*']);
 * console.log(hasPermission(permissions, 'nodes:read'));   // true
 * console.log(hasPermission(permissions, 'nodes:write'));  // true
 * console.log(hasPermission(permissions, 'search:execute')); // false
 */
export function hasPermission(userPermissions: Set<string>, requiredPermission: string): boolean {
  // Check for exact match
  if (userPermissions.has(requiredPermission)) {
    return true;
  }
  
  // Check for wildcard '*' (admin)
  if (userPermissions.has('*')) {
    return true;
  }
  
  // Check for namespace wildcards (e.g., 'nodes:*' matches 'nodes:read')
  const [namespace] = requiredPermission.split(':');
  if (namespace && userPermissions.has(`${namespace}:*`)) {
    return true;
  }
  
  return false;
}

/**
 * Express middleware to require a specific permission
 * 
 * Checks if the authenticated user has the required permission.
 * Returns 401 if not authenticated, 403 if permission denied.
 * Automatically skipped if RBAC is disabled via env var.
 * 
 * @param permission - Required permission string (e.g., 'nodes:write')
 * 
 * @returns Express middleware function
 * 
 * @example
 * // Protect single endpoint
 * router.post('/api/nodes',
 *   requirePermission('nodes:write'),
 *   async (req, res) => {
 *     // Only users with 'nodes:write' can access
 *     const node = await createNode(req.body);
 *     res.json(node);
 *   }
 * );
 * 
 * @example
 * // Protect multiple endpoints
 * router.delete('/api/nodes/:id',
 *   requirePermission('nodes:delete'),
 *   deleteNodeHandler
 * );
 * 
 * router.get('/api/admin/stats',
 *   requirePermission('admin:stats'),
 *   getStatsHandler
 * );
 * 
 * @example
 * // Chain with other middleware
 * router.put('/api/nodes/:id',
 *   authenticate,
 *   requirePermission('nodes:write'),
 *   validateNodeData,
 *   updateNodeHandler
 * );
 */
export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip if RBAC is disabled
    if (process.env.MIMIR_ENABLE_RBAC !== 'true') {
      return next();
    }
    
    // Check if user is authenticated
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Authentication required'
      });
    }
    
    // Get user permissions
    const userPermissions = getUserPermissions(req.user);
    
    // Check if user has required permission
    if (hasPermission(userPermissions, permission)) {
      return next();
    }
    
    // Permission denied
    return res.status(403).json({
      error: 'Forbidden',
      message: `Permission denied: ${permission} required`,
      userRoles: (req.user as any).roles || []
    });
  };
}

/**
 * Middleware to require ANY of the specified permissions
 * Usage: app.get('/api/data', requireAnyPermission(['nodes:read', 'files:read']), handler)
 */
export function requireAnyPermission(permissions: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip if RBAC is disabled
    if (process.env.MIMIR_ENABLE_RBAC !== 'true') {
      return next();
    }
    
    // Check if user is authenticated
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Authentication required'
      });
    }
    
    // Get user permissions
    const userPermissions = getUserPermissions(req.user);
    
    // Check if user has any of the required permissions
    for (const permission of permissions) {
      if (hasPermission(userPermissions, permission)) {
        return next();
      }
    }
    
    // Permission denied
    return res.status(403).json({
      error: 'Forbidden',
      message: `Permission denied: One of [${permissions.join(', ')}] required`,
      userRoles: (req.user as any).roles || []
    });
  };
}

/**
 * Middleware to require ALL of the specified permissions
 * Usage: app.post('/api/admin', requireAllPermissions(['admin:read', 'admin:write']), handler)
 */
export function requireAllPermissions(permissions: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip if RBAC is disabled
    if (process.env.MIMIR_ENABLE_RBAC !== 'true') {
      return next();
    }
    
    // Check if user is authenticated
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Authentication required'
      });
    }
    
    // Get user permissions
    const userPermissions = getUserPermissions(req.user);
    
    // Check if user has all required permissions
    for (const permission of permissions) {
      if (!hasPermission(userPermissions, permission)) {
        return res.status(403).json({
          error: 'Forbidden',
          message: `Permission denied: All of [${permissions.join(', ')}] required`,
          userRoles: (req.user as any).roles || [],
          missingPermission: permission
        });
      }
    }
    
    return next();
  };
}
