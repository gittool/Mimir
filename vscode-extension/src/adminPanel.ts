import * as vscode from 'vscode';

export class AdminPanel {
  public static currentPanel: AdminPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _apiUrl: string;

  public static createOrShow(extensionUri: vscode.Uri, apiUrl: string) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (AdminPanel.currentPanel) {
      AdminPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'mimirAdmin',
      'Mimir Admin',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri]
      }
    );

    AdminPanel.currentPanel = new AdminPanel(panel, extensionUri, apiUrl);
  }

  public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, state: any, apiUrl: string) {
    AdminPanel.currentPanel = new AdminPanel(panel, extensionUri, apiUrl);
  }

  public static updateAllPanels(config: { apiUrl: string }) {
    if (AdminPanel.currentPanel) {
      AdminPanel.currentPanel._apiUrl = config.apiUrl;
      AdminPanel.currentPanel._update();
    }
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, apiUrl: string) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._apiUrl = apiUrl;

    this._update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      message => {
        switch (message.command) {
          case 'getApiKeys':
            this._getApiKeys();
            return;
          case 'generateApiKey':
            this._generateApiKey(message.name, message.expiresInDays, message.permissions);
            return;
          case 'revokeApiKey':
            this._revokeApiKey(message.keyId);
            return;
          case 'getRBACConfig':
            this._getRBACConfig();
            return;
          case 'updateRBACConfig':
            this._updateRBACConfig(message.config);
            return;
          case 'getPermissions':
            this._getPermissions();
            return;
        }
      },
      null,
      this._disposables
    );
  }

  public dispose() {
    AdminPanel.currentPanel = undefined;

    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private async _getApiKeys() {
    try {
      const { AuthManager } = await import('./authManager.js');
      const context = (this._panel as any)._extensionContext || (global as any).mimirExtensionContext;
      const authManager = new AuthManager(context, this._apiUrl);
      const authHeaders = await authManager.getAuthHeaders();

      const response = await fetch(`${this._apiUrl}/api/keys`, {
        headers: authHeaders
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json() as any;
      this._panel.webview.postMessage({ command: 'apiKeysLoaded', keys: data.keys });
    } catch (error: any) {
      this._panel.webview.postMessage({ command: 'error', message: error.message });
    }
  }

  private async _generateApiKey(name: string, expiresInDays: number, permissions: string[]) {
    try {
      const { AuthManager } = await import('./authManager.js');
      const context = (this._panel as any)._extensionContext || (global as any).mimirExtensionContext;
      const authManager = new AuthManager(context, this._apiUrl);
      const authHeaders = await authManager.getAuthHeaders();

      const response = await fetch(`${this._apiUrl}/api/keys/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify({ name, expiresInDays, permissions })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      this._panel.webview.postMessage({ command: 'apiKeyGenerated', key: data });
      this._getApiKeys(); // Refresh list
    } catch (error: any) {
      this._panel.webview.postMessage({ command: 'error', message: error.message });
    }
  }

  private async _revokeApiKey(keyId: string) {
    try {
      const { AuthManager } = await import('./authManager.js');
      const context = (this._panel as any)._extensionContext || (global as any).mimirExtensionContext;
      const authManager = new AuthManager(context, this._apiUrl);
      const authHeaders = await authManager.getAuthHeaders();

      const response = await fetch(`${this._apiUrl}/api/keys/${keyId}`, {
        method: 'DELETE',
        headers: authHeaders
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      this._panel.webview.postMessage({ command: 'apiKeyRevoked', keyId });
      this._getApiKeys(); // Refresh list
    } catch (error: any) {
      this._panel.webview.postMessage({ command: 'error', message: error.message });
    }
  }

  private async _getRBACConfig() {
    try {
      const { AuthManager } = await import('./authManager.js');
      const context = (this._panel as any)._extensionContext || (global as any).mimirExtensionContext;
      const authManager = new AuthManager(context, this._apiUrl);
      const authHeaders = await authManager.getAuthHeaders();

      const response = await fetch(`${this._apiUrl}/api/rbac`, {
        headers: authHeaders
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      this._panel.webview.postMessage({ command: 'rbacConfigLoaded', config: data });
    } catch (error: any) {
      this._panel.webview.postMessage({ command: 'error', message: error.message });
    }
  }

  private async _updateRBACConfig(config: any) {
    try {
      const { AuthManager } = await import('./authManager.js');
      const context = (this._panel as any)._extensionContext || (global as any).mimirExtensionContext;
      const authManager = new AuthManager(context, this._apiUrl);
      const authHeaders = await authManager.getAuthHeaders();

      const response = await fetch(`${this._apiUrl}/api/rbac`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify(config)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json() as any;
      this._panel.webview.postMessage({ command: 'rbacConfigUpdated', config: data.config });
      vscode.window.showInformationMessage('RBAC configuration updated successfully');
    } catch (error: any) {
      this._panel.webview.postMessage({ command: 'error', message: error.message });
    }
  }

  private async _getPermissions() {
    try {
      const { AuthManager } = await import('./authManager.js');
      const context = (this._panel as any)._extensionContext || (global as any).mimirExtensionContext;
      const authManager = new AuthManager(context, this._apiUrl);
      const authHeaders = await authManager.getAuthHeaders();

      const response = await fetch(`${this._apiUrl}/api/rbac/permissions`, {
        headers: authHeaders
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json() as any;
      this._panel.webview.postMessage({ command: 'permissionsLoaded', permissions: data.permissions });
    } catch (error: any) {
      this._panel.webview.postMessage({ command: 'error', message: error.message });
    }
  }

  private _update() {
    const webview = this._panel.webview;
    this._panel.webview.html = this._getHtmlForWebview(webview);
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mimir Admin</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 20px;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    .section {
      margin-bottom: 40px;
      padding: 20px;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
    }
    h1 {
      color: var(--vscode-foreground);
      margin-top: 0;
    }
    h2 {
      color: var(--vscode-foreground);
      border-bottom: 1px solid var(--vscode-panel-border);
      padding-bottom: 10px;
    }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 8px 16px;
      cursor: pointer;
      border-radius: 2px;
      margin-right: 8px;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.danger {
      background: #d32f2f;
      color: white;
    }
    input, select, textarea {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      padding: 6px;
      width: 100%;
      box-sizing: border-box;
      margin-bottom: 10px;
    }
    .form-group {
      margin-bottom: 15px;
    }
    label {
      display: block;
      margin-bottom: 5px;
      font-weight: bold;
    }
    .key-list {
      list-style: none;
      padding: 0;
    }
    .key-item {
      padding: 10px;
      border: 1px solid var(--vscode-panel-border);
      margin-bottom: 10px;
      border-radius: 4px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .role-editor {
      margin-bottom: 20px;
      padding: 15px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
    }
    .permission-checkbox {
      margin-right: 10px;
    }
    .tabs {
      display: flex;
      border-bottom: 1px solid var(--vscode-panel-border);
      margin-bottom: 20px;
    }
    .tab {
      padding: 10px 20px;
      cursor: pointer;
      border-bottom: 2px solid transparent;
    }
    .tab.active {
      border-bottom-color: var(--vscode-button-background);
    }
    .tab-content {
      display: none;
    }
    .tab-content.active {
      display: block;
    }
    .error {
      color: #f44336;
      padding: 10px;
      background: rgba(244, 67, 54, 0.1);
      border-radius: 4px;
      margin-bottom: 10px;
    }
    .success {
      color: #4caf50;
      padding: 10px;
      background: rgba(76, 175, 80, 0.1);
      border-radius: 4px;
      margin-bottom: 10px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔐 Mimir Admin Panel</h1>
    
    <div class="tabs">
      <div class="tab active" onclick="switchTab('keys')">API Keys</div>
      <div class="tab" onclick="switchTab('rbac')">RBAC Configuration</div>
    </div>

    <!-- API Keys Tab -->
    <div id="keys-tab" class="tab-content active">
      <div class="section">
        <h2>Generate New API Key</h2>
        <div class="form-group">
          <label>Key Name</label>
          <input type="text" id="keyName" placeholder="e.g., Production Server">
        </div>
        <div class="form-group">
          <label>Expires In (days)</label>
          <input type="number" id="keyExpiry" value="90" min="1" max="365">
        </div>
        <div class="form-group">
          <label>Permissions (comma-separated or leave empty for user's roles)</label>
          <input type="text" id="keyPermissions" placeholder="e.g., admin,developer">
        </div>
        <button onclick="generateKey()">Generate API Key</button>
      </div>

      <div class="section">
        <h2>Active API Keys</h2>
        <div id="keysList">Loading...</div>
      </div>
    </div>

    <!-- RBAC Configuration Tab -->
    <div id="rbac-tab" class="tab-content">
      <div class="section">
        <h2>RBAC Configuration</h2>
        <div class="form-group">
          <label>Claim Path (JWT field for roles)</label>
          <input type="text" id="claimPath" placeholder="e.g., roles, groups, custom.permissions">
        </div>
        <div class="form-group">
          <label>Default Role (for users with no roles)</label>
          <input type="text" id="defaultRole" placeholder="e.g., viewer">
        </div>
        <div id="rolesEditor"></div>
        <button onclick="saveRBACConfig()">Save RBAC Configuration</button>
      </div>
    </div>

    <div id="message"></div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let apiKeys = [];
    let rbacConfig = null;
    let availablePermissions = [];

    // Load initial data
    vscode.postMessage({ command: 'getApiKeys' });
    vscode.postMessage({ command: 'getRBACConfig' });
    vscode.postMessage({ command: 'getPermissions' });

    // Handle messages from extension
    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.command) {
        case 'apiKeysLoaded':
          apiKeys = message.keys;
          renderApiKeys();
          break;
        case 'apiKeyGenerated':
          showMessage('API Key Generated: ' + message.key.apiKey, 'success');
          break;
        case 'apiKeyRevoked':
          showMessage('API Key revoked successfully', 'success');
          break;
        case 'rbacConfigLoaded':
          rbacConfig = message.config;
          renderRBACConfig();
          break;
        case 'rbacConfigUpdated':
          showMessage('RBAC configuration updated successfully', 'success');
          break;
        case 'permissionsLoaded':
          availablePermissions = message.permissions;
          break;
        case 'error':
          showMessage('Error: ' + message.message, 'error');
          break;
      }
    });

    function switchTab(tab) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      event.target.classList.add('active');
      document.getElementById(tab + '-tab').classList.add('active');
    }

    function generateKey() {
      const name = document.getElementById('keyName').value;
      const expiresInDays = parseInt(document.getElementById('keyExpiry').value);
      const permissionsStr = document.getElementById('keyPermissions').value;
      const permissions = permissionsStr ? permissionsStr.split(',').map(p => p.trim()) : undefined;

      if (!name) {
        showMessage('Please enter a key name', 'error');
        return;
      }

      vscode.postMessage({
        command: 'generateApiKey',
        name,
        expiresInDays,
        permissions
      });

      // Clear form
      document.getElementById('keyName').value = '';
      document.getElementById('keyPermissions').value = '';
    }

    function revokeKey(keyId) {
      if (confirm('Are you sure you want to revoke this API key?')) {
        vscode.postMessage({ command: 'revokeApiKey', keyId });
      }
    }

    function renderApiKeys() {
      const keysList = document.getElementById('keysList');
      if (apiKeys.length === 0) {
        keysList.innerHTML = '<p>No API keys found</p>';
        return;
      }

      keysList.innerHTML = '<ul class="key-list">' +
        apiKeys.map(key => \`
          <li class="key-item">
            <div>
              <strong>\${key.id}</strong>
            </div>
            <button class="danger" onclick="revokeKey('\${key.id}')">Revoke</button>
          </li>
        \`).join('') +
        '</ul>';
    }

    function renderRBACConfig() {
      if (!rbacConfig) return;

      document.getElementById('claimPath').value = rbacConfig.claimPath || '';
      document.getElementById('defaultRole').value = rbacConfig.defaultRole || '';

      const rolesEditor = document.getElementById('rolesEditor');
      rolesEditor.innerHTML = '<h3>Roles</h3>' +
        Object.entries(rbacConfig.roles || {}).map(([roleName, roleConfig]) => \`
          <div class="role-editor">
            <h4>\${roleName}</h4>
            <label>Permissions:</label>
            <textarea id="role-\${roleName}" rows="4">\${roleConfig.permissions.join(', ')}</textarea>
          </div>
        \`).join('');
    }

    function saveRBACConfig() {
      const claimPath = document.getElementById('claimPath').value;
      const defaultRole = document.getElementById('defaultRole').value;
      
      const roles = {};
      Object.keys(rbacConfig.roles || {}).forEach(roleName => {
        const permissionsText = document.getElementById('role-' + roleName).value;
        roles[roleName] = {
          permissions: permissionsText.split(',').map(p => p.trim()).filter(p => p)
        };
      });

      vscode.postMessage({
        command: 'updateRBACConfig',
        config: { claimPath, defaultRole, roles }
      });
    }

    function showMessage(msg, type) {
      const messageDiv = document.getElementById('message');
      messageDiv.className = type;
      messageDiv.textContent = msg;
      setTimeout(() => {
        messageDiv.textContent = '';
        messageDiv.className = '';
      }, 5000);
    }
  </script>
</body>
</html>`;
  }
}
