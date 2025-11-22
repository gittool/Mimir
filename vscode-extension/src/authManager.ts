import * as vscode from 'vscode';

/**
 * Authentication Manager for Mimir VSCode Extension
 * 
 * Supports three modes:
 * 1. No Auth Mode (MIMIR_ENABLE_SECURITY=false)
 * 2. Dev Auth Mode (local username/password or API key)
 * 3. OAuth Mode (browser-based login, then API key)
 */

export interface AuthConfig {
  enabled: boolean;
  devMode: boolean;
  devUsername?: string;
  devPassword?: string;
  oauthEnabled: boolean;
}

export interface AuthState {
  authenticated: boolean;
  apiKey?: string;
  username?: string;
  expiresAt?: string;
}

export class AuthManager {
  private context: vscode.ExtensionContext;
  private baseUrl: string;
  private authState: AuthState | null = null;

  constructor(context: vscode.ExtensionContext, baseUrl: string) {
    this.context = context;
    this.baseUrl = baseUrl;
  }

  /**
   * Update base URL when configuration changes
   */
  updateBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl;
  }

  /**
   * Check authentication status from server
   */
  async checkAuthStatus(): Promise<AuthConfig> {
    try {
      const response = await fetch(`${this.baseUrl}/auth/config`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const serverConfig: any = await response.json();
      
      // Map server response to our AuthConfig interface
      // Server returns: {devLoginEnabled: boolean, oauthProviders: array}
      // We need: {enabled: boolean, devMode: boolean, oauthEnabled: boolean}
      const enabled = serverConfig.devLoginEnabled || (serverConfig.oauthProviders && serverConfig.oauthProviders.length > 0);
      const devMode = serverConfig.devLoginEnabled || false;
      const oauthEnabled = serverConfig.oauthProviders && serverConfig.oauthProviders.length > 0;
      
      return {
        enabled,
        devMode,
        oauthEnabled
      };
    } catch (error) {
      console.error('[Auth] Failed to check auth status:', error);
      // Default to no auth if server unreachable
      return {
        enabled: false,
        devMode: false,
        oauthEnabled: false
      };
    }
  }

  /**
   * Get stored authentication state from configuration
   */
  async getAuthState(): Promise<AuthState | null> {
    if (this.authState) {
      return this.authState;
    }

    // Load from configuration
    const config = vscode.workspace.getConfiguration('mimir');
    const apiKey = config.get<string>('auth.apiKey');
    const username = config.get<string>('auth.username');
    const expiresAt = config.get<string>('auth.expiresAt');

    if (apiKey) {
      this.authState = {
        authenticated: true,
        apiKey,
        username,
        expiresAt
      };
      return this.authState;
    }

    return null;
  }

  /**
   * Save authentication state to configuration
   */
  private async saveAuthState(state: AuthState): Promise<void> {
    this.authState = state;
    
    const config = vscode.workspace.getConfiguration('mimir');
    
    if (state.apiKey) {
      await config.update('auth.apiKey', state.apiKey, vscode.ConfigurationTarget.Global);
    }
    if (state.username) {
      await config.update('auth.username', state.username, vscode.ConfigurationTarget.Global);
    }
    if (state.expiresAt) {
      await config.update('auth.expiresAt', state.expiresAt, vscode.ConfigurationTarget.Global);
    }
  }

  /**
   * Clear authentication state from configuration
   */
  async clearAuthState(): Promise<void> {
    this.authState = null;
    
    const config = vscode.workspace.getConfiguration('mimir');
    await config.update('auth.apiKey', undefined, vscode.ConfigurationTarget.Global);
    await config.update('auth.username', undefined, vscode.ConfigurationTarget.Global);
    await config.update('auth.expiresAt', undefined, vscode.ConfigurationTarget.Global);
  }

  /**
   * Authenticate with the server
   * Handles all three modes automatically
   * Reuses existing valid tokens instead of creating new ones
   */
  async authenticate(): Promise<boolean> {
    // First, check if we already have a valid cached token
    const existingState = await this.getAuthState();
    if (existingState?.authenticated && existingState.apiKey) {
      // Check if token is expired
      if (existingState.expiresAt) {
        const expiresAt = new Date(existingState.expiresAt);
        if (expiresAt > new Date()) {
          console.log('[Auth] Using cached valid token');
          return true;
        }
        console.log('[Auth] Cached token expired, getting new one');
      } else {
        // No expiration, token is valid indefinitely
        console.log('[Auth] Using cached token (no expiration)');
        return true;
      }
    }

    const config = await this.checkAuthStatus();

    // Mode 1: No Auth
    if (!config.enabled) {
      console.log('[Auth] Security disabled, no authentication required');
      this.authState = { authenticated: true };
      return true;
    }

    // Mode 2: Dev Auth Mode
    if (config.devMode) {
      return await this.authenticateDev(config);
    }

    // Mode 3: OAuth Mode
    if (config.oauthEnabled) {
      return await this.authenticateOAuth();
    }

    vscode.window.showErrorMessage('Mimir: Unknown authentication configuration');
    return false;
  }

  /**
   * Dev Auth Mode: Username/Password from configuration
   */
  private async authenticateDev(config: AuthConfig): Promise<boolean> {
    // Get credentials from VSCode configuration
    const workspaceConfig = vscode.workspace.getConfiguration('mimir');
    const username = workspaceConfig.get<string>('auth.username');
    const password = workspaceConfig.get<string>('auth.password');

    if (!username || !password) {
      vscode.window.showErrorMessage(
        'Mimir: Please configure mimir.auth.username and mimir.auth.password in settings',
        'Open Settings'
      ).then(selection => {
        if (selection === 'Open Settings') {
          vscode.commands.executeCommand('workbench.action.openSettings', 'mimir.auth');
        }
      });
      return false;
    }

    return await this.loginWithCredentials(username, password);
  }

  /**
   * Login with username/password using OAuth 2.0 token endpoint (RFC 6749)
   */
  private async loginWithCredentials(username: string, password: string): Promise<boolean> {
    try {
      // Use OAuth 2.0 RFC 6749 compliant /auth/token endpoint
      // grant_type=password (Resource Owner Password Credentials)
      const response = await fetch(`${this.baseUrl}/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'password',
          username,
          password
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'invalid_grant' })) as any;
        const errorMsg = error.error_description || error.error || 'Login failed';
        vscode.window.showErrorMessage(`Mimir: ${errorMsg}`);
        return false;
      }

      const data = await response.json() as any;
      
      // Calculate expiration date from expires_in (seconds)
      const expiresAt = data.expires_in 
        ? new Date(Date.now() + data.expires_in * 1000).toISOString()
        : undefined;
      
      // Save access token as API key
      await this.saveAuthState({
        authenticated: true,
        apiKey: data.access_token,
        username,
        expiresAt
      });

      vscode.window.showInformationMessage(`Mimir: Authenticated as ${username}`);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Mimir: Authentication failed - ${errorMessage}`);
      return false;
    }
  }

  /**
   * OAuth Mode: Browser-based login, then API key
   */
  private async authenticateOAuth(): Promise<boolean> {
    // No auto-login - always require fresh OAuth flow
    
    // Open browser for OAuth login
    const authUrl = `${this.baseUrl}/auth/oauth`;
    const opened = await vscode.env.openExternal(vscode.Uri.parse(authUrl));
    
    if (!opened) {
      vscode.window.showErrorMessage('Mimir: Failed to open browser for authentication');
      return false;
    }

    // Wait for user to complete OAuth flow
    const result = await vscode.window.showInformationMessage(
      'Complete the login in your browser, then click Continue',
      'Continue',
      'Cancel'
    );

    if (result !== 'Continue') {
      return false;
    }

    // Prompt for API key (user must generate it from Portal after OAuth)
    const apiKey = await vscode.window.showInputBox({
      prompt: 'Paste your API key from Mimir Portal',
      placeHolder: 'mimir_...',
      ignoreFocusOut: true,
      password: true
    });

    if (!apiKey) {
      return false;
    }

    // Verify API key
    if (await this.verifyApiKey(apiKey)) {
      await this.saveAuthState({
        authenticated: true,
        apiKey,
        username: 'OAuth user'
      });
      vscode.window.showInformationMessage('Mimir: Authenticated successfully');
      return true;
    } else {
      vscode.window.showErrorMessage('Mimir: Invalid API key');
      return false;
    }
  }

  /**
   * Verify API key works
   */
  private async verifyApiKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/nodes?limit=1`, {
        headers: { 'X-API-Key': apiKey }
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get authentication headers for API requests
   * Returns OAuth 2.0 RFC 6750 compliant Authorization: Bearer header
   */
  async getAuthHeaders(): Promise<Record<string, string>> {
    const state = await this.getAuthState();
    
    if (state?.apiKey) {
      // OAuth 2.0 RFC 6750 compliant header
      return { 'Authorization': `Bearer ${state.apiKey}` };
    }
    
    return {};
  }

  /**
   * Logout and clear authentication
   */
  async logout(): Promise<void> {
    await this.clearAuthState();
    vscode.window.showInformationMessage('Mimir: Logged out successfully');
  }
}
