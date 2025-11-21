# Session Configuration

This guide explains how to configure user session behavior in Mimir.

## Session Max Age

Control how long user sessions remain valid using the `MIMIR_SESSION_MAX_AGE_HOURS` environment variable.

### Configuration

```bash
# .env
MIMIR_SESSION_MAX_AGE_HOURS=0  # 0 = never expire
```

### Values

| Value | Duration | Use Case |
|-------|----------|----------|
| `0` | **Never expires** | Development, testing, long-running automation |
| `1` | 1 hour | High-security environments |
| `8` | 8 hours | Standard work day |
| `24` | 24 hours (default) | Balanced security/convenience |
| `168` | 1 week | Low-security internal tools |
| `720` | 30 days | Long-term access |

### Examples

#### Development (Never Expire)

```bash
# .env
MIMIR_ENABLE_SECURITY=true
MIMIR_ENABLE_RBAC=true
MIMIR_SESSION_SECRET=dev-secret-12345
MIMIR_SESSION_MAX_AGE_HOURS=0  # Never expire
```

**Use case**: Local development, testing RBAC without constant re-login

#### Production (24 Hours)

```bash
# .env
MIMIR_ENABLE_SECURITY=true
MIMIR_ENABLE_RBAC=true
MIMIR_SESSION_SECRET=<generate-with-openssl>
MIMIR_SESSION_MAX_AGE_HOURS=24  # 1 day
```

**Use case**: Standard production deployment with daily re-authentication

#### High Security (1 Hour)

```bash
# .env
MIMIR_ENABLE_SECURITY=true
MIMIR_ENABLE_RBAC=true
MIMIR_SESSION_SECRET=<generate-with-openssl>
MIMIR_SESSION_MAX_AGE_HOURS=1  # 1 hour
```

**Use case**: Sensitive data environments (HIPAA, financial, etc.)

## Session Secret

The session secret is used to sign cookies and must be changed in production.

### Generate a Secure Secret

```bash
# Using OpenSSL
openssl rand -base64 32

# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Configuration

```bash
# .env
MIMIR_SESSION_SECRET=<your-generated-secret>
```

**⚠️ IMPORTANT**: Never commit secrets to version control!

## Session Behavior

### Cookie Properties

Sessions are stored in HTTP-only cookies with these properties:

- **httpOnly**: `true` (prevents JavaScript access)
- **secure**: `true` in production (HTTPS only)
- **maxAge**: Configured via `MIMIR_SESSION_MAX_AGE_HOURS`

### Session Expiration

When `maxAge` is set (not 0):
- User must re-login after the configured duration
- Session cookie expires in browser
- Server-side session data is cleared

When `maxAge` is 0 (never expire):
- Session remains valid indefinitely
- Cookie persists until browser closes (session cookie)
- Useful for development and testing

### Session Storage

Currently, sessions are stored in-memory using `express-session`. For production deployments with multiple servers, consider using Redis:

```bash
# Future implementation
MIMIR_SESSION_STORAGE=redis
MIMIR_REDIS_URL=redis://localhost:6379
```

## Troubleshooting

### Session expires too quickly

**Symptom**: Users are logged out unexpectedly

**Solution**: Increase `MIMIR_SESSION_MAX_AGE_HOURS`:
```bash
MIMIR_SESSION_MAX_AGE_HOURS=24  # or higher
```

### Session never expires (unintended)

**Symptom**: Users remain logged in indefinitely in production

**Solution**: Set a specific max age:
```bash
MIMIR_SESSION_MAX_AGE_HOURS=24  # Don't use 0 in production
```

### Session not persisting

**Symptom**: Users are logged out on every request

**Solutions**:
1. Check `MIMIR_SESSION_SECRET` is set
2. Verify cookies are enabled in browser
3. Check server logs for session errors
4. Ensure `MIMIR_ENABLE_SECURITY=true`

### "Session configured to never expire" warning

**Symptom**: Server logs show session never expires

**Solution**: This is expected if `MIMIR_SESSION_MAX_AGE_HOURS=0`. For production, set a specific duration:
```bash
MIMIR_SESSION_MAX_AGE_HOURS=24
```

## Security Recommendations

### Development

✅ **Recommended**:
```bash
MIMIR_SESSION_MAX_AGE_HOURS=0  # Never expire
MIMIR_SESSION_SECRET=dev-secret-12345
```

### Production

✅ **Recommended**:
```bash
MIMIR_SESSION_MAX_AGE_HOURS=24  # 1 day
MIMIR_SESSION_SECRET=<generated-with-openssl>
NODE_ENV=production  # Enables secure cookies
```

❌ **Not Recommended**:
```bash
MIMIR_SESSION_MAX_AGE_HOURS=0  # Never expire in production
MIMIR_SESSION_SECRET=dev-secret-12345  # Weak secret
```

### High Security Environments

For HIPAA, FISMA, or financial applications:

```bash
MIMIR_SESSION_MAX_AGE_HOURS=1  # 1 hour
MIMIR_SESSION_SECRET=<strong-generated-secret>
NODE_ENV=production
```

## See Also

- [Development Authentication](./DEV_AUTHENTICATION.md) - Local dev users
- [Authentication Provider Integration](./AUTHENTICATION_PROVIDER_INTEGRATION.md) - OAuth/OIDC
- [RBAC Configuration](./RBAC_CONFIGURATION.md) - Role-based access control
- [Security Quick Start](./SECURITY_QUICK_START.md) - Complete security setup

