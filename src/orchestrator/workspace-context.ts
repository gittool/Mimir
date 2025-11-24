import { AsyncLocalStorage } from 'async_hooks';
import path from 'path';
import os from 'os';
import { getHostWorkspaceRoot } from '../utils/path-utils.js';

/**
 * Workspace context for tool execution
 * 
 * This allows us to pass workspace-specific information (like working directory)
 * to tools without modifying their signatures or using global variables.
 * 
 * Uses AsyncLocalStorage for thread-safe context propagation through async calls.
 */
interface WorkspaceContext {
  workingDirectory: string;
  sessionId?: string;
  metadata?: Record<string, any>;
}

// AsyncLocalStorage ensures context is isolated per request
const workspaceStorage = new AsyncLocalStorage<WorkspaceContext>();

/**
 * Translate host filesystem path to container filesystem path
 * 
 * When running in Docker, VSCode sends paths from the host filesystem
 * (e.g., /Users/john/src/project), but tools need container paths
 * (e.g., /workspace/project). This function performs the translation.
 * 
 * The translation uses environment variables:
 * - HOST_WORKSPACE_ROOT: Root directory on host (e.g., /Users/john/src)
 * - WORKSPACE_ROOT: Mounted directory in container (e.g., /workspace)
 * 
 * If the path is not under HOST_WORKSPACE_ROOT, it's returned as-is
 * with a warning (may indicate an unmounted path).
 * 
 * @param hostPath - Path from host filesystem (typically from VSCode)
 * @returns Translated path for container filesystem, or original if not under mounted root
 * 
 * @example
 * ```ts
 * // Environment: HOST_WORKSPACE_ROOT=/Users/john/src, WORKSPACE_ROOT=/workspace
 * 
 * translatePathToContainer('/Users/john/src/project/file.ts');
 * // Returns: '/workspace/project/file.ts'
 * 
 * translatePathToContainer('/Users/john/src');
 * // Returns: '/workspace'
 * 
 * translatePathToContainer('/tmp/other');
 * // Returns: '/tmp/other' (with warning - not under mounted root)
 * ```
 */
function translatePathToContainer(hostPath: string): string {
  // Get environment variables for path mapping
  const hostWorkspaceRoot = getHostWorkspaceRoot();
  const containerWorkspaceRoot = process.env.WORKSPACE_ROOT || '';
  
  // Normalize paths for comparison
  const normalizedHostPath = path.resolve(hostPath);
  const normalizedHostRoot = hostWorkspaceRoot;
  
  // Check if hostPath is under the mounted host root
  if (normalizedHostPath.startsWith(normalizedHostRoot)) {
    // Calculate relative path from host root
    const relativePath = path.relative(normalizedHostRoot, normalizedHostPath);
    
    // Join with container root
    const containerPath = path.posix.join(containerWorkspaceRoot, relativePath);
    
    console.log(`📁 Path translation: ${hostPath} → ${containerPath}`);
    console.log(`   Host root: ${hostWorkspaceRoot} → Container root: ${containerWorkspaceRoot}`);
    
    return containerPath;
  }
  
  // Path is not under mounted root - might already be a container path or standalone
  // If we're in Docker (WORKSPACE_ROOT is set), warn about unmounted path
  if (process.env.WORKSPACE_ROOT && !hostPath.startsWith('/workspace')) {
    console.warn(`⚠️  Path ${hostPath} is not under HOST_WORKSPACE_ROOT (${hostWorkspaceRoot})`);
    console.warn(`   This path may not be accessible in the container!`);
  }
  
  return hostPath;
}

/**
 * Run a function with workspace context using AsyncLocalStorage
 * 
 * Establishes a workspace context for the duration of the function execution.
 * The context is automatically propagated through all async calls without
 * needing to pass it explicitly as a parameter.
 * 
 * This is particularly useful for:
 * - Setting working directory for tool execution
 * - Tracking session IDs across async operations
 * - Passing metadata without polluting function signatures
 * 
 * When running in Docker, automatically translates host paths to container paths.
 * 
 * @param context - Workspace context with working directory and optional metadata
 * @param fn - Function to execute with the context
 * @returns Promise resolving to the function's return value
 * 
 * @example
 * ```ts
 * // Basic usage with working directory
 * await runWithWorkspaceContext(
 *   { workingDirectory: '/Users/john/src/project' },
 *   async () => {
 *     const cwd = getWorkingDirectory();
 *     console.log(cwd); // '/workspace/project' (if in Docker)
 *     await agent.execute('Create README.md');
 *   }
 * );
 * 
 * // With session tracking
 * await runWithWorkspaceContext(
 *   {
 *     workingDirectory: '/workspace/project',
 *     sessionId: 'session-123',
 *     metadata: { userId: 'user-456' }
 *   },
 *   async () => {
 *     const ctx = getWorkspaceContext();
 *     console.log(ctx.sessionId); // 'session-123'
 *   }
 * );
 * 
 * // Nested contexts (inner context takes precedence)
 * await runWithWorkspaceContext(
 *   { workingDirectory: '/workspace/outer' },
 *   async () => {
 *     await runWithWorkspaceContext(
 *       { workingDirectory: '/workspace/inner' },
 *       async () => {
 *         console.log(getWorkingDirectory()); // '/workspace/inner'
 *       }
 *     );
 *   }
 * );
 * ```
 */
export function runWithWorkspaceContext<T>(
  context: WorkspaceContext,
  fn: () => T | Promise<T>
): Promise<T> {
  // Translate working directory if in Docker
  const translatedContext: WorkspaceContext = {
    ...context,
    workingDirectory: translatePathToContainer(context.workingDirectory),
  };
  
  return workspaceStorage.run(translatedContext, () => Promise.resolve(fn()));
}

/**
 * Get current workspace context from AsyncLocalStorage
 * 
 * Retrieves the workspace context established by runWithWorkspaceContext.
 * Returns undefined if no context is currently active.
 * 
 * This is useful for tools that need to access workspace metadata
 * without having it passed explicitly as parameters.
 * 
 * @returns Current workspace context, or undefined if not in a context
 * 
 * @example
 * ```ts
 * const context = getWorkspaceContext();
 * if (context) {
 *   console.log('Working in:', context.workingDirectory);
 *   console.log('Session:', context.sessionId);
 * } else {
 *   console.log('No workspace context active');
 * }
 * ```
 */
export function getWorkspaceContext(): WorkspaceContext | undefined {
  return workspaceStorage.getStore();
}

/**
 * Get working directory for tool execution
 * 
 * Returns the working directory from the current workspace context,
 * or falls back to process.cwd() if no context is active.
 * 
 * When running in Docker, paths are automatically translated to
 * container paths by runWithWorkspaceContext.
 * 
 * @returns Working directory path (container path if in Docker)
 * 
 * @example
 * ```ts
 * // Inside a workspace context
 * await runWithWorkspaceContext(
 *   { workingDirectory: '/workspace/project' },
 *   async () => {
 *     const cwd = getWorkingDirectory();
 *     console.log(cwd); // '/workspace/project'
 *   }
 * );
 * 
 * // Outside a workspace context
 * const cwd = getWorkingDirectory();
 * console.log(cwd); // process.cwd()
 * ```
 */
export function getWorkingDirectory(): string {
  const context = getWorkspaceContext();
  return context?.workingDirectory || process.cwd();
}

/**
 * Check if currently running within a workspace context
 * 
 * @returns true if inside a runWithWorkspaceContext call, false otherwise
 * 
 * @example
 * ```ts
 * if (hasWorkspaceContext()) {
 *   console.log('Using workspace:', getWorkingDirectory());
 * } else {
 *   console.log('No workspace context - using cwd');
 * }
 * ```
 */
export function hasWorkspaceContext(): boolean {
  return workspaceStorage.getStore() !== undefined;
}

/**
 * Check if the application is running inside a Docker container
 * 
 * Detects Docker environment by checking for WORKSPACE_ROOT environment variable,
 * which is set in the Docker container configuration.
 * 
 * @returns true if running in Docker, false if running locally
 * 
 * @example
 * ```ts
 * if (isRunningInDocker()) {
 *   console.log('Running in container');
 *   console.log('Container workspace:', process.env.WORKSPACE_ROOT);
 * } else {
 *   console.log('Running locally');
 * }
 * ```
 */
export function isRunningInDocker(): boolean {
  return process.env.WORKSPACE_ROOT !== undefined;
}
