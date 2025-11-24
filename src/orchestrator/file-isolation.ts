/**
 * File Isolation Layer for Agent Testing
 * 
 * Provides multiple strategies to prevent agents from accidentally modifying the repository:
 * 1. Virtual filesystem mode (in-memory, all operations logged)
 * 2. Folder whitelist mode (restrict to specific directories)
 * 3. Read-only mode (allow reads, block all writes)
 */

import fs from 'fs/promises';
import path from 'path';

export type IsolationMode = 'virtual' | 'restricted' | 'readonly' | 'disabled';

interface FileOperation {
  timestamp: Date;
  operation: 'read' | 'write' | 'delete' | 'command';
  path: string;
  allowed: boolean;
  reason?: string;
  content?: string; // For writes
  result?: string; // For commands
}

interface VirtualFile {
  path: string;
  content: string;
  created: Date;
  modified: Date;
}

/**
 * Sandboxed filesystem for testing agents safely
 * 
 * Provides multiple isolation strategies to prevent agents from accidentally
 * modifying the repository during testing:
 * 
 * **Isolation Modes:**
 * - **virtual**: All operations in-memory, nothing touches disk
 * - **restricted**: Only allow operations in whitelisted directories
 * - **readonly**: Allow reads, block all writes/deletes
 * - **disabled**: No restrictions (use with caution)
 * 
 * All operations are logged for analysis and debugging.
 * 
 * @example
 * ```ts
 * // Virtual mode - safest for testing
 * const isolation = new FileIsolationManager('virtual');
 * await isolation.writeFile('/test.txt', 'content');
 * // File stored in memory, not on disk
 * 
 * // Restricted mode - limit to specific directories
 * const isolation = new FileIsolationManager('restricted', ['/tmp/agent-test']);
 * await isolation.writeFile('/tmp/agent-test/file.txt', 'ok'); // Allowed
 * await isolation.writeFile('/etc/passwd', 'bad'); // Blocked
 * 
 * // Get operation log
 * const summary = isolation.getSummary();
 * console.log(`Blocked operations: ${summary.blocked}`);
 * ```
 */
export class FileIsolationManager {
  private mode: IsolationMode;
  private virtualFS: Map<string, VirtualFile> = new Map();
  private operations: FileOperation[] = [];
  private allowedDirs: Set<string> = new Set();
  private blockedPatterns: RegExp[] = [
    /node_modules/,
    /\.git/,
    /dist|build/,
    /\.env/,
  ];

  constructor(
    mode: IsolationMode = 'virtual',
    allowedDirs: string[] = []
  ) {
    this.mode = mode;
    this.allowedDirs = new Set(allowedDirs.map(d => path.resolve(d)));
    console.log(`📦 File Isolation: ${mode}${allowedDirs.length > 0 ? ` (${allowedDirs.length} allowed dirs)` : ''}`);
  }

  /**
   * Check if path is allowed based on current mode
   */
  private isPathAllowed(filepath: string, operation: 'read' | 'write' | 'delete'): { allowed: boolean; reason?: string } {
    const resolved = path.resolve(filepath);

    // Check blocked patterns
    for (const pattern of this.blockedPatterns) {
      if (pattern.test(resolved)) {
        return {
          allowed: false,
          reason: `Path matches blocked pattern: ${pattern}`,
        };
      }
    }

    if (this.mode === 'virtual') {
      // Virtual mode allows everything (logged in memory)
      return { allowed: true };
    }

    if (this.mode === 'readonly') {
      // Readonly mode blocks all writes
      if (operation !== 'read') {
        return {
          allowed: false,
          reason: `Readonly mode: ${operation} operations blocked`,
        };
      }
      return { allowed: true };
    }

    if (this.mode === 'restricted') {
      // Restricted mode checks against whitelist
      if (this.allowedDirs.size === 0) {
        return {
          allowed: false,
          reason: 'Restricted mode: no allowed directories configured',
        };
      }

      const isAllowed = Array.from(this.allowedDirs).some(dir =>
        resolved.startsWith(dir) || resolved.startsWith(dir + path.sep)
      );

      if (!isAllowed && operation !== 'read') {
        return {
          allowed: false,
          reason: `Restricted mode: path not in allowed directories`,
        };
      }

      return { allowed: true };
    }

    // Disabled mode allows everything
    return { allowed: true };
  }

  /**
   * Log a file operation
   */
  private logOperation(
    operation: FileOperation['operation'],
    filepath: string,
    allowed: boolean,
    reason?: string,
    content?: string
  ): void {
    this.operations.push({
      timestamp: new Date(),
      operation,
      path: filepath,
      allowed,
      reason,
      content,
    });
  }

  /**
   * Read file with isolation enforcement
   * 
   * In virtual mode, checks in-memory filesystem first, then falls back to real FS.
   * In restricted/readonly modes, enforces access controls.
   * 
   * @param filepath - Path to file to read
   * @returns File content as string
   * @throws Error if path is blocked or file doesn't exist
   * 
   * @example
   * ```ts
   * const isolation = new FileIsolationManager('virtual');
   * 
   * // Read from virtual FS
   * await isolation.writeFile('/test.txt', 'hello');
   * const content = await isolation.readFile('/test.txt');
   * console.log(content); // 'hello'
   * 
   * // Blocked patterns are rejected
   * try {
   *   await isolation.readFile('/node_modules/package/index.js');
   * } catch (error) {
   *   console.log(error.message); // 'File read blocked: ...'
   * }
   * ```
   */
  async readFile(filepath: string): Promise<string> {
    const check = this.isPathAllowed(filepath, 'read');

    if (this.mode === 'virtual') {
      // Check virtual filesystem first
      if (this.virtualFS.has(filepath)) {
        const vfile = this.virtualFS.get(filepath)!;
        this.logOperation('read', filepath, true, 'Virtual FS');
        return vfile.content;
      }
      // Fall through to real filesystem
    }

    if (!check.allowed) {
      this.logOperation('read', filepath, false, check.reason);
      throw new Error(`File read blocked: ${check.reason}`);
    }

    try {
      const content = await fs.readFile(filepath, 'utf-8');
      this.logOperation('read', filepath, true);
      return content;
    } catch (error: any) {
      this.logOperation('read', filepath, false, `FS Error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Write file with isolation enforcement
   * 
   * In virtual mode, stores in memory. In restricted mode, checks whitelist.
   * In readonly mode, blocks all writes.
   * 
   * @param filepath - Path to file to write
   * @param content - Content to write
   * @throws Error if write is blocked by isolation mode
   * 
   * @example
   * ```ts
   * // Virtual mode - safe testing
   * const isolation = new FileIsolationManager('virtual');
   * await isolation.writeFile('/output.txt', 'result');
   * // Stored in memory, not on disk
   * 
   * // Readonly mode - blocks writes
   * const readonly = new FileIsolationManager('readonly');
   * try {
   *   await readonly.writeFile('/test.txt', 'data');
   * } catch (error) {
   *   console.log(error.message); // 'File write blocked: Readonly mode...'
   * }
   * ```
   */
  async writeFile(filepath: string, content: string): Promise<void> {
    const check = this.isPathAllowed(filepath, 'write');

    if (!check.allowed) {
      this.logOperation('write', filepath, false, check.reason, content);
      throw new Error(`File write blocked: ${check.reason}`);
    }

    if (this.mode === 'virtual') {
      // Store in virtual filesystem
      this.virtualFS.set(filepath, {
        path: filepath,
        content,
        created: new Date(),
        modified: new Date(),
      });
      this.logOperation('write', filepath, true, 'Virtual FS', content);
      return;
    }

    try {
      await fs.mkdir(path.dirname(filepath), { recursive: true });
      await fs.writeFile(filepath, content, 'utf-8');
      this.logOperation('write', filepath, true, 'Real FS', content);
    } catch (error: any) {
      this.logOperation('write', filepath, false, `FS Error: ${error.message}`, content);
      throw error;
    }
  }

  /**
   * Delete file (respects isolation mode)
   */
  async deleteFile(filepath: string): Promise<void> {
    const check = this.isPathAllowed(filepath, 'delete');

    if (!check.allowed) {
      this.logOperation('delete', filepath, false, check.reason);
      throw new Error(`File delete blocked: ${check.reason}`);
    }

    if (this.mode === 'virtual') {
      // Remove from virtual filesystem
      this.virtualFS.delete(filepath);
      this.logOperation('delete', filepath, true, 'Virtual FS');
      return;
    }

    try {
      await fs.unlink(filepath);
      this.logOperation('delete', filepath, true, 'Real FS');
    } catch (error: any) {
      this.logOperation('delete', filepath, false, `FS Error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get operations log
   */
  getOperations(): FileOperation[] {
    return [...this.operations];
  }

  /**
   * Get summary statistics of all file operations
   * 
   * @returns Object with operation counts and statistics
   * 
   * @example
   * ```ts
   * const isolation = new FileIsolationManager('virtual');
   * await isolation.writeFile('/test1.txt', 'a');
   * await isolation.writeFile('/test2.txt', 'b');
   * await isolation.readFile('/test1.txt');
   * 
   * const summary = isolation.getSummary();
   * console.log(summary);
   * // {
   * //   totalOperations: 3,
   * //   reads: 1,
   * //   writes: 2,
   * //   deletes: 0,
   * //   blocked: 0,
   * //   virtualFiles: 2
   * // }
   * ```
   */
  getSummary(): {
    totalOperations: number;
    reads: number;
    writes: number;
    deletes: number;
    blocked: number;
    virtualFiles: number;
  } {
    return {
      totalOperations: this.operations.length,
      reads: this.operations.filter(op => op.operation === 'read').length,
      writes: this.operations.filter(op => op.operation === 'write').length,
      deletes: this.operations.filter(op => op.operation === 'delete').length,
      blocked: this.operations.filter(op => !op.allowed).length,
      virtualFiles: this.virtualFS.size,
    };
  }

  /**
   * Generate detailed operations log in Markdown format
   * 
   * Creates a comprehensive report including:
   * - Operation summary statistics
   * - Timeline of all operations
   * - List of virtual files in memory
   * - List of blocked operations
   * 
   * @returns Markdown-formatted log string
   * 
   * @example
   * ```ts
   * const isolation = new FileIsolationManager('restricted', ['/tmp/test']);
   * await isolation.writeFile('/tmp/test/ok.txt', 'allowed');
   * try {
   *   await isolation.writeFile('/etc/passwd', 'blocked');
   * } catch {}
   * 
   * const log = isolation.generateOperationsLog();
   * console.log(log);
   * // # File Operations Log
   * // **Mode:** restricted
   * // **Total Operations:** 2
   * // - Writes: 2
   * // - Blocked: 1
   * // ...
   * ```
   */
  generateOperationsLog(): string {
    const summary = this.getSummary();
    let log = `# File Operations Log\n\n`;
    log += `**Mode:** ${this.mode}\n`;
    log += `**Total Operations:** ${summary.totalOperations}\n`;
    log += `- Reads: ${summary.reads}\n`;
    log += `- Writes: ${summary.writes}\n`;
    log += `- Deletes: ${summary.deletes}\n`;
    log += `- Blocked: ${summary.blocked}\n`;
    log += `- Virtual Files in Memory: ${summary.virtualFiles}\n\n`;

    if (this.operations.length === 0) {
      log += `No operations recorded.\n`;
      return log;
    }

    log += `## Operations Timeline\n\n`;
    log += `| Time | Operation | Path | Status | Reason |\n`;
    log += `|------|-----------|------|--------|--------|\n`;

    for (const op of this.operations) {
      const time = op.timestamp.toISOString().split('T')[1];
      const status = op.allowed ? '✅ Allowed' : '🚫 Blocked';
      const reason = op.reason || '-';
      log += `| ${time} | ${op.operation} | ${op.path} | ${status} | ${reason} |\n`;
    }

    // List virtual files
    if (this.virtualFS.size > 0) {
      log += `\n## Virtual Files in Memory\n\n`;
      for (const [path, file] of this.virtualFS) {
        const lines = file.content.split('\n').length;
        log += `- \`${path}\` (${lines} lines, ${file.content.length} bytes)\n`;
      }
    }

    // List blocked operations
    const blocked = this.operations.filter(op => !op.allowed);
    if (blocked.length > 0) {
      log += `\n## Blocked Operations\n\n`;
      for (const op of blocked) {
        log += `- **${op.operation}** \`${op.path}\`: ${op.reason}\n`;
      }
    }

    return log;
  }

  /**
   * Get virtual file content
   */
  getVirtualFile(filepath: string): VirtualFile | undefined {
    return this.virtualFS.get(filepath);
  }

  /**
   * Export all virtual files as JSON object
   * 
   * @returns Object mapping file paths to their content
   * 
   * @example
   * ```ts
   * const isolation = new FileIsolationManager('virtual');
   * await isolation.writeFile('/test1.txt', 'content1');
   * await isolation.writeFile('/test2.txt', 'content2');
   * 
   * const files = isolation.exportVirtualFiles();
   * console.log(files);
   * // {
   * //   '/test1.txt': 'content1',
   * //   '/test2.txt': 'content2'
   * // }
   * ```
   */
  exportVirtualFiles(): Record<string, string> {
    const exported: Record<string, string> = {};
    for (const [path, file] of this.virtualFS) {
      exported[path] = file.content;
    }
    return exported;
  }

  /**
   * Save all virtual files to disk after testing
   * 
   * Writes all in-memory files to the specified output directory,
   * preserving the relative path structure.
   * 
   * @param outputDir - Directory to save files to
   * 
   * @example
   * ```ts
   * const isolation = new FileIsolationManager('virtual');
   * await isolation.writeFile('/workspace/output.txt', 'result');
   * await isolation.writeFile('/workspace/data.json', '{"key": "value"}');
   * 
   * // After testing, save to disk
   * await isolation.saveVirtualFiles('/tmp/test-results');
   * // Creates:
   * // /tmp/test-results/workspace/output.txt
   * // /tmp/test-results/workspace/data.json
   * ```
   */
  async saveVirtualFiles(outputDir: string): Promise<void> {
    for (const [filepath, file] of this.virtualFS) {
      const outputPath = path.join(outputDir, path.relative(process.cwd(), filepath));
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, file.content, 'utf-8');
    }
  }

  /**
   * Clear all virtual files and operation logs
   * 
   * Resets the isolation manager to a clean state for the next test.
   * 
   * @example
   * ```ts
   * const isolation = new FileIsolationManager('virtual');
   * await isolation.writeFile('/test.txt', 'data');
   * console.log(isolation.getSummary().virtualFiles); // 1
   * 
   * isolation.reset();
   * console.log(isolation.getSummary().virtualFiles); // 0
   * ```
   */
  reset(): void {
    this.virtualFS.clear();
    this.operations = [];
  }
}

/**
 * Create isolated filesystem manager for agent testing
 * 
 * Factory function to create a FileIsolationManager with the specified mode.
 * 
 * @param mode - Isolation mode (virtual, restricted, readonly, disabled)
 * @param allowedDirs - Optional array of allowed directories (for restricted mode)
 * @returns Configured FileIsolationManager instance
 * 
 * @example
 * ```ts
 * // Virtual mode for safe testing
 * const isolation = createFileIsolation('virtual');
 * 
 * // Restricted mode with whitelist
 * const restricted = createFileIsolation('restricted', [
 *   '/tmp/agent-sandbox',
 *   '/workspace/output'
 * ]);
 * 
 * // Readonly mode for analysis
 * const readonly = createFileIsolation('readonly');
 * ```
 */
export function createFileIsolation(
  mode: IsolationMode = 'virtual',
  allowedDirs?: string[]
): FileIsolationManager {
  return new FileIsolationManager(mode, allowedDirs);
}
