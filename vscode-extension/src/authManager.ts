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
      return await response.json() as AuthConfig;
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
   * Get stored authentication state
   */
  async getAuthState(): Promise<AuthState | null> {
    if (this.authState) {
      return this.authState;
    }

    // Try to load from secure storage
    const apiKey = await this.context.secrets.get('mimir.apiKey');
    const username = await this.context.secrets.get('mimir.username');
    const expiresAt = await this.context.secrets.get('mimir.expiresAt');

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
   * Save authentication state to secure storage
   */
  private async saveAuthState(state: AuthState): Promise<void> {
    this.authState = state;
    
    if (state.apiKey) {
      await this.context.secrets.store('mimir.apiKey', state.apiKey);
    }
    if (state.username) {
      await this.context.secrets.store('mimir.username', state.username);
    }
    if (state.expiresAt) {
      await this.context.secrets.store('mimir.expiresAt', state.expiresAt);
    }
  }

  /**
   * Clear authentication state
   */
  async clearAuthState(): Promise<void> {
    this.authState = null;
    await this.context.secrets.delete('mimir.apiKey');
    await this.context.secrets.delete('mimir.username');
    await this.context.secrets.delete('mimir.expiresAt');
  }

  /**
   * Authenticate with the server
   * Handles all three modes automatically
   */
  async authenticate(): Promise<boolean> {
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
   * Dev Auth Mode: Username/Password or API Key
   */
  private async authenticateDev(config: AuthConfig): Promise<boolean> {
    // Check if we already have an API key
    const existingState = await this.getAuthState();
    if (existingState?.apiKey) {
      // Verify API key still works
      if (await this.verifyApiKey(existingState.apiKey)) {
        console.log('[Auth] Using existing API key');
        return true;
      } else {
        // API key invalid, clear it
        await this.clearAuthState();
      }
    }

    // Check extension settings for dev credentials
    const extensionConfig = vscode.workspace.getConfiguration('mimir');
    const devUsername = extensionConfig.get<string>('auth.devUsername');
    const devPassword = extensionConfig.get<string>('auth.devPassword');
    const devApiKey = extensionConfig.get<string>('auth.devApiKey');

    // Option 1: Use pre-configured API key
    if (devApiKey) {
      if (await this.verifyApiKey(devApiKey)) {
        await this.saveAuthState({
          authenticated: true,
          apiKey: devApiKey,
          username: 'dev (API key)'
        });
        vscode.window.showInformationMessage('Mimir: Authenticated with API key');
        return true;
      } else {
        vscode.window.showErrorMessage('Mimir: Configured API key is invalid');
        return false;
      }
    }

    // Option 2: Use pre-configured username/password (auto-login)
    if (devUsername && devPassword) {
      return await this.loginWithCredentials(devUsername, devPassword);
    }

    // Option 3: Prompt user for credentials
    const username = await vscode.window.showInputBox({
      prompt: 'Mimir Username',
      placeHolder: 'Enter your username',
      ignoreFocusOut: true
    });

    if (!username) {
      return false;
    }

    const password = await vscode.window.showInputBox({
      prompt: 'Mimir Password',
      placeHolder: 'Enter your password',
      password: true,
      ignoreFocusOut: true
    });

    if (!password) {
      return false;
    }

    return await this.loginWithCredentials(username, password);
  }

  /**
   * Login with username/password and generate API key
   */
  private async loginWithCredentials(username: string, password: string): Promise<boolean> {
    try {
      // Step 1: Login to get session
      const loginResponse = await fetch(`${this.baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        credentials: 'include'
      });

      if (!loginResponse.ok) {
        const error = await loginResponse.json().catch(() => ({ error: 'Login failed' })) as any;
        vscode.window.showErrorMessage(`Mimir: ${error.error || 'Login failed'}`);
        return false;
      }

      // Extract session cookie
      const setCookie = loginResponse.headers.get('set-cookie');
      
      // Step 2: Generate API key using session
      const keyResponse = await fetch(`${this.baseUrl}/api/keys/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': setCookie || ''
        },
        body: JSON.stringify({
          name: 'VSCode Extension',
          expiresInDays: 90
        })
      });

      if (!keyResponse.ok) {
        vscode.window.showErrorMessage('Mimir: Failed to generate API key');
        return false;
      }

      const keyData = await keyResponse.json() as any;
      
      // Save API key
      await this.saveAuthState({
        authenticated: true,
        apiKey: keyData.apiKey,
        username,
        expiresAt: keyData.expiresAt
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
    // Check if we already have an API key
    const existingState = await this.getAuthState();
    if (existingState?.apiKey) {
      if (await this.verifyApiKey(existingState.apiKey)) {
        console.log('[Auth] Using existing OAuth API key');
        return true;
      } else {
        await this.clearAuthState();
      }
    }

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
   */
  async getAuthHeaders(): Promise<Record<string, string>> {
    const state = await this.getAuthState();
    
    if (state?.apiKey) {
      return { 'X-API-Key': state.apiKey };
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
