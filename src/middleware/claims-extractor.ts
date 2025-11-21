/**
 * Extract claims from user object using dot notation path
 * Supports nested paths like "custom.roles" or "app_metadata.permissions"
 * 
 * @param user - User object from Passport (typically contains JWT claims)
 * @param claimPath - Dot-separated path to claims (e.g., "roles", "groups", "custom.permissions")
 * @returns Array of claim values (roles/groups)
 */
export function extractClaims(user: any, claimPath: string): string[] {
  if (!user) {
    return [];
  }

  // Support nested paths like "custom.roles" or "groups"
  const parts = claimPath.split('.');
  let value = user;
  
  for (const part of parts) {
    value = value?.[part];
    if (value === undefined || value === null) {
      return [];
    }
  }
  
  // Handle array or single value
  if (Array.isArray(value)) {
    return value.filter(v => typeof v === 'string');
  }
  
  if (typeof value === 'string') {
    return [value];
  }
  
  return [];
}

/**
 * Extract roles from user and add default role if none found
 * 
 * @param user - User object from Passport
 * @param claimPath - Path to roles in user object
 * @param defaultRole - Default role to assign if no roles found
 * @returns Array of roles (including default if applicable)
 */
export function extractRolesWithDefault(
  user: any,
  claimPath: string,
  defaultRole?: string
): string[] {
  const roles = extractClaims(user, claimPath);
  
  if (roles.length === 0 && defaultRole) {
    return [defaultRole];
  }
  
  return roles;
}


