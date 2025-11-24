/**
 * Extract claims from user object using dot notation path
 * 
 * Supports nested paths and handles various claim formats from different
 * identity providers. Automatically converts non-string values and extracts
 * from common object patterns.
 * 
 * **Supported Formats**:
 * - Arrays of strings: `["admin", "user"]`
 * - Single string: `"admin"`
 * - Numbers/booleans: Converted to strings with warning
 * - Objects: Extracts `name`, `value`, or `id` fields
 * 
 * **Nested Paths**: Use dot notation for nested claims:
 * - `"roles"` → `user.roles`
 * - `"custom.roles"` → `user.custom.roles`
 * - `"app_metadata.permissions"` → `user.app_metadata.permissions`
 * 
 * @param user - User object from Passport (typically contains JWT claims)
 * @param claimPath - Dot-separated path to claims
 * 
 * @returns Array of claim values as strings
 * 
 * @example
 * // Simple array of roles
 * const user = { roles: ['admin', 'editor'] };
 * const claims = extractClaims(user, 'roles');
 * console.log(claims); // ['admin', 'editor']
 * 
 * @example
 * // Nested path
 * const user = { custom: { permissions: ['read', 'write'] } };
 * const claims = extractClaims(user, 'custom.permissions');
 * console.log(claims); // ['read', 'write']
 * 
 * @example
 * // Object array with name field
 * const user = {
 *   groups: [
 *     { name: 'developers', id: 123 },
 *     { name: 'admins', id: 456 }
 *   ]
 * };
 * const claims = extractClaims(user, 'groups');
 * console.log(claims); // ['developers', 'admins']
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
    const claims: string[] = [];
    
    for (const [i, item] of value.entries()) {
      // Accept strings directly
      if (typeof item === 'string') {
        claims.push(item);
        continue;
      }
      
      // Convert numbers to strings (some IdPs send role IDs as numbers)
      if (typeof item === 'number') {
        console.warn(`[Claims] Converting numeric claim to string: ${item} (at ${claimPath}[${i}])`);
        claims.push(String(item));
        continue;
      }
      
      // Convert booleans to strings (rare but possible)
      if (typeof item === 'boolean') {
        console.warn(`[Claims] Converting boolean claim to string: ${item} (at ${claimPath}[${i}])`);
        claims.push(String(item));
        continue;
      }
      
      // Handle objects - try to extract a string representation
      if (typeof item === 'object' && item !== null) {
        // Check for common object patterns
        if ('name' in item && typeof item.name === 'string') {
          console.warn(`[Claims] Extracting 'name' field from object claim: ${item.name} (at ${claimPath}[${i}])`);
          claims.push(item.name);
          continue;
        }
        
        if ('value' in item && typeof item.value === 'string') {
          console.warn(`[Claims] Extracting 'value' field from object claim: ${item.value} (at ${claimPath}[${i}])`);
          claims.push(item.value);
          continue;
        }
        
        if ('id' in item && typeof item.id === 'string') {
          console.warn(`[Claims] Extracting 'id' field from object claim: ${item.id} (at ${claimPath}[${i}])`);
          claims.push(item.id);
          continue;
        }
        
        // Last resort: JSON stringify (not ideal but better than silently dropping)
        console.error(`[Claims] Unable to extract string from object claim, using JSON representation (at ${claimPath}[${i}]):`, item);
        claims.push(JSON.stringify(item));
        continue;
      }
      
      // Unsupported type - log error and skip
      console.error(`[Claims] Unsupported claim type '${typeof item}' at ${claimPath}[${i}], value:`, item);
      console.error(`[Claims] This claim will be IGNORED. User may lack expected permissions.`);
    }
    
    if (claims.length < value.length) {
      console.warn(`[Claims] Extracted ${claims.length} of ${value.length} claims from ${claimPath}`);
      console.warn(`[Claims] ${value.length - claims.length} claims were dropped due to unsupported types`);
    }
    
    return claims;
  }
  
  // Handle single value
  if (typeof value === 'string') {
    return [value];
  }
  
  // Convert single number to string
  if (typeof value === 'number') {
    console.warn(`[Claims] Converting single numeric claim to string: ${value} (at ${claimPath})`);
    return [String(value)];
  }
  
  // Convert single boolean to string
  if (typeof value === 'boolean') {
    console.warn(`[Claims] Converting single boolean claim to string: ${value} (at ${claimPath})`);
    return [String(value)];
  }
  
  // Handle single object
  // Note: typeof null === 'object' in JavaScript, so we need the null check for type narrowing
  if (typeof value === 'object' && value !== null) {
    // Check for common object patterns
    if ('name' in value && typeof value.name === 'string') {
      console.warn(`[Claims] Extracting 'name' field from single object claim: ${value.name} (at ${claimPath})`);
      return [value.name];
    }
    
    if ('value' in value && typeof value.value === 'string') {
      console.warn(`[Claims] Extracting 'value' field from single object claim: ${value.value} (at ${claimPath})`);
      return [value.value];
    }
    
    if ('id' in value && typeof value.id === 'string') {
      console.warn(`[Claims] Extracting 'id' field from single object claim: ${value.id} (at ${claimPath})`);
      return [value.id];
    }
    
    // Last resort: JSON stringify
    console.error(`[Claims] Unable to extract string from single object claim, using JSON representation (at ${claimPath}):`, value);
    return [JSON.stringify(value)];
  }
  
  // Unsupported type
  console.error(`[Claims] Unsupported claim type '${typeof value}' at ${claimPath}, value:`, value);
  console.error(`[Claims] No claims extracted. User may lack expected permissions.`);
  return [];
}

/**
 * Extract roles from user and add default role if none found
 * 
 * Convenience wrapper around extractClaims() that provides a fallback
 * default role when no roles are found in the user object. Useful for
 * ensuring all users have at least one role for RBAC.
 * 
 * @param user - User object from Passport
 * @param claimPath - Path to roles in user object (dot notation)
 * @param defaultRole - Default role to assign if no roles found
 * 
 * @returns Array of roles (includes default if no roles extracted)
 * 
 * @example
 * // User with roles
 * const user = { roles: ['admin'] };
 * const roles = extractRolesWithDefault(user, 'roles', 'viewer');
 * console.log(roles); // ['admin']
 * 
 * @example
 * // User without roles - gets default
 * const user = { email: 'user@example.com' };
 * const roles = extractRolesWithDefault(user, 'roles', 'viewer');
 * console.log(roles); // ['viewer']
 * 
 * @example
 * // No default role specified
 * const user = {};
 * const roles = extractRolesWithDefault(user, 'roles');
 * console.log(roles); // []
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


