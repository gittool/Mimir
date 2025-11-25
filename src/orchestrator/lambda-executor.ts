/**
 * @fileoverview Lambda Executor - Executes transformer Lambda scripts
 * 
 * Supports TypeScript/JavaScript and Python scripts for data transformation
 * between agent tasks in the workflow.
 * 
 * Features:
 * - TypeScript compilation and validation
 * - Sandboxed execution with fetch support
 * - Default export convention for transform functions
 * - Python execution via subprocess
 * - Unified input contract for N parallel agents
 * 
 * @module orchestrator/lambda-executor
 * @since 1.1.0
 */

import { spawn, ChildProcess } from 'child_process';
import * as vm from 'vm';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import * as ts from 'typescript';
import { type CancellationToken } from './cancellation.js';

// ============================================================================
// Lambda Input/Output Contract
// ============================================================================

/**
 * QC verification result from an agent task
 */
export interface QCVerificationResult {
  passed: boolean;
  score: number;
  feedback: string;
  issues: string[];
  requiredFixes: string[];
}

/**
 * Result from a single upstream task (agent or transformer)
 */
export interface TaskResult {
  /** Unique task identifier */
  taskId: string;
  /** Human-readable task title */
  taskTitle: string;
  /** Type of task */
  taskType: 'agent' | 'transformer';
  /** Task execution status */
  status: 'success' | 'failure';
  /** Duration in milliseconds */
  duration: number;
  
  // Agent-specific fields
  /** Worker agent output (for agent tasks) */
  workerOutput?: string;
  /** QC verification result (for agent tasks) */
  qcResult?: QCVerificationResult;
  /** Agent role description (for agent tasks) */
  agentRole?: string;
  
  // Transformer-specific fields
  /** Transformer output (for transformer tasks) */
  transformerOutput?: string;
  /** Lambda name that was executed (for transformer tasks) */
  lambdaName?: string;
}

/**
 * Metadata about the Lambda execution context
 */
export interface LambdaMeta {
  /** Current transformer task ID */
  transformerId: string;
  /** Name of this Lambda */
  lambdaName: string;
  /** Number of upstream dependencies */
  dependencyCount: number;
  /** Execution ID for the workflow */
  executionId: string;
}

/**
 * Unified Lambda input contract
 * 
 * This is the ONLY input type Lambdas receive. It provides:
 * - Structured access to ALL dependency outputs
 * - Both worker output AND QC feedback for each agent task
 * - Consistent API whether 1 task or N parallel tasks
 * - No conditional logic needed in Lambda code
 * 
 * @example
 * ```typescript
 * function transform(input: LambdaInput): string {
 *   // Process all upstream task outputs
 *   const summaries = input.tasks.map(task => {
 *     if (task.taskType === 'agent') {
 *       return `${task.taskTitle}: ${task.workerOutput?.substring(0, 100)}...`;
 *     } else {
 *       return `${task.lambdaName}: ${task.transformerOutput?.substring(0, 100)}...`;
 *     }
 *   });
 *   
 *   return summaries.join('\n\n');
 * }
 * ```
 */
export interface LambdaInput {
  /** Array of results from all upstream dependencies */
  tasks: TaskResult[];
  /** Metadata about this Lambda execution */
  meta: LambdaMeta;
}

/**
 * Result from Lambda execution
 */
export interface LambdaResult {
  success: boolean;
  output: string;
  error?: string;
  duration: number;
}

/**
 * Result from Lambda compilation/validation
 */
export interface LambdaValidationResult {
  valid: boolean;
  compiledCode?: string;
  errors?: string[];
}

// ============================================================================
// DEPRECATED - Old context interface (kept for backward compatibility)
// ============================================================================

/**
 * @deprecated Use LambdaInput instead. This interface is kept for backward
 * compatibility but will be removed in a future version.
 */
export interface LambdaContext {
  /** @deprecated Use input.tasks instead */
  workerOutputs: string[];
  /** @deprecated Use input.tasks[].qcResult instead */
  previousContext: string;
  /** @deprecated Use input.meta.transformerId instead */
  previousTaskId: string;
  /** @deprecated Check input.tasks[].taskType instead */
  previousWasLambda: boolean;
}

// ============================================================================
// TypeScript Compilation
// ============================================================================

/**
 * Compile TypeScript to JavaScript
 */
function compileTypeScript(script: string): { success: boolean; code?: string; error?: string } {
  try {
    const result = ts.transpileModule(script, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        strict: false,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        noImplicitAny: false,
      },
      reportDiagnostics: true,
    });

    if (result.diagnostics && result.diagnostics.length > 0) {
      const errors = result.diagnostics.map(d => 
        typeof d.messageText === 'string' 
          ? d.messageText 
          : d.messageText.messageText
      );
      const hasErrors = result.diagnostics.some(d => d.category === ts.DiagnosticCategory.Error);
      if (hasErrors) {
        return { success: false, error: errors.join('\n') };
      }
    }

    return { success: true, code: result.outputText };
  } catch (error: any) {
    return { success: false, error: error.message || String(error) };
  }
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a Lambda script and check for transform function
 */
export function validateLambdaScript(
  script: string,
  language: 'typescript' | 'javascript' | 'python'
): LambdaValidationResult {
  const errors: string[] = [];

  if (language === 'python') {
    if (!script.includes('def transform(')) {
      errors.push('Python script must define: def transform(input):');
    }
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  }

  let codeToValidate = script;

  if (language === 'typescript') {
    const compileResult = compileTypeScript(script);
    if (!compileResult.success) {
      return { valid: false, errors: [compileResult.error || 'TypeScript compilation failed'] };
    }
    codeToValidate = compileResult.code!;
  }

  const hasDefaultExport = /export\s+default/.test(script) || 
                           /module\.exports\s*=/.test(codeToValidate) ||
                           /exports\.default\s*=/.test(codeToValidate);
  const hasTransformFunction = /function\s+transform\s*\(/.test(script) ||
                               /const\s+transform\s*=/.test(script) ||
                               /let\s+transform\s*=/.test(script) ||
                               /var\s+transform\s*=/.test(script);

  if (!hasDefaultExport && !hasTransformFunction) {
    errors.push('Lambda script must export a default function or define a transform function');
  }

  try {
    new vm.Script(codeToValidate, { filename: 'lambda-validation.js' });
  } catch (parseError: any) {
    errors.push(`Syntax error: ${parseError.message}`);
  }

  return {
    valid: errors.length === 0,
    compiledCode: codeToValidate,
    errors: errors.length > 0 ? errors : undefined,
  };
}

// ============================================================================
// JavaScript/TypeScript Execution
// ============================================================================

/**
 * Execute a TypeScript/JavaScript Lambda script with the new unified input
 */
async function executeJSLambda(
  script: string,
  language: 'typescript' | 'javascript',
  input: LambdaInput,
  cancellationToken?: CancellationToken
): Promise<LambdaResult> {
  const startTime = Date.now();
  
  try {
    // Check for cancellation
    cancellationToken?.throwIfCancelled();
    
    // Compile TypeScript if needed
    let jsCode = script;
    if (language === 'typescript') {
      const compileResult = compileTypeScript(script);
      if (!compileResult.success) {
        return {
          success: false,
          output: '',
          error: `TypeScript compilation failed: ${compileResult.error}`,
          duration: Date.now() - startTime,
        };
      }
      jsCode = compileResult.code!;
    }

    // Create sandbox with allowed globals
    const sandbox: any = {
      console: {
        log: (...args: any[]) => console.log('[Lambda]', ...args),
        error: (...args: any[]) => console.error('[Lambda Error]', ...args),
        warn: (...args: any[]) => console.warn('[Lambda Warn]', ...args),
        info: (...args: any[]) => console.info('[Lambda Info]', ...args),
      },
      JSON,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Date,
      Math,
      RegExp,
      Error,
      Map,
      Set,
      Promise,
      Buffer,
      fetch: globalThis.fetch,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
      // The unified input object
      __input: input,
      // Module support
      module: { exports: {} },
      exports: {},
      // Output placeholders
      __result: undefined as any,
      __error: undefined as any,
    };

    // Wrap script to handle different export conventions
    const wrappedScript = `
      (async function() {
        try {
          ${jsCode}
          
          // Find the transform function
          let transformFn = null;
          
          if (typeof module.exports === 'function') {
            transformFn = module.exports;
          } else if (typeof module.exports.default === 'function') {
            transformFn = module.exports.default;
          } else if (typeof exports.default === 'function') {
            transformFn = exports.default;
          } else if (typeof transform === 'function') {
            transformFn = transform;
          } else if (typeof module.exports.transform === 'function') {
            transformFn = module.exports.transform;
          }
          
          if (!transformFn) {
            throw new Error('Lambda must export a default function or define transform(input)');
          }
          
          // Execute with the unified input
          const result = await transformFn(__input);
          __result = result;
        } catch (err) {
          __error = err.message || String(err);
        }
      })();
    `;

    // Run in VM sandbox
    const vmScript = new vm.Script(wrappedScript, { filename: 'lambda.js' });
    const vmContext = vm.createContext(sandbox);
    
    await vmScript.runInContext(vmContext, { timeout: 30000 });
    await new Promise(resolve => setTimeout(resolve, 100));

    // Check for cancellation after execution
    cancellationToken?.throwIfCancelled();

    if (sandbox.__error) {
      return {
        success: false,
        output: '',
        error: sandbox.__error,
        duration: Date.now() - startTime,
      };
    }

    let output = sandbox.__result;
    if (output === undefined || output === null) {
      output = '';
    } else if (typeof output !== 'string') {
      output = JSON.stringify(output, null, 2);
    }

    return {
      success: true,
      output,
      duration: Date.now() - startTime,
    };
  } catch (error: any) {
    return {
      success: false,
      output: '',
      error: error.message || String(error),
      duration: Date.now() - startTime,
    };
  }
}

// ============================================================================
// Python Execution
// ============================================================================

/**
 * Execute a Python Lambda script with the new unified input
 */
async function executePythonLambda(
  script: string,
  input: LambdaInput,
  cancellationToken?: CancellationToken
): Promise<LambdaResult> {
  const startTime = Date.now();
  
  try {
    cancellationToken?.throwIfCancelled();
    
    const tmpDir = os.tmpdir();
    const scriptPath = path.join(tmpDir, `lambda_${Date.now()}.py`);
    
    // Wrap with unified input handling
    const wrappedScript = `
import sys
import json
import urllib.request
import urllib.error

def fetch(url, method='GET', headers=None, body=None):
    """Simple fetch implementation for Python Lambdas"""
    req_headers = headers or {}
    data = body.encode('utf-8') if body else None
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return {
                'ok': response.status < 400,
                'status': response.status,
                'text': response.read().decode('utf-8'),
            }
    except urllib.error.URLError as e:
        return {'ok': False, 'status': 0, 'error': str(e)}

# Parse unified input from stdin
input_data = json.loads(sys.stdin.read())

# Convert to object-like access
class DictToObject:
    def __init__(self, d):
        for k, v in d.items():
            if isinstance(v, dict):
                setattr(self, k, DictToObject(v))
            elif isinstance(v, list):
                setattr(self, k, [DictToObject(i) if isinstance(i, dict) else i for i in v])
            else:
                setattr(self, k, v)

# Create input object
input = DictToObject(input_data)

${script}

# Call transform with the unified input object
if 'transform' in dir():
    result = transform(input)
else:
    raise Exception('Lambda must define: def transform(input):')

# Output result
if isinstance(result, str):
    print(result)
else:
    print(json.dumps(result, indent=2, default=str))
`;

    await fs.writeFile(scriptPath, wrappedScript, 'utf8');

    return new Promise((resolve) => {
      const python: ChildProcess = spawn('python3', [scriptPath], {
        timeout: 30000,
      });

      let stdout = '';
      let stderr = '';

      // Register cancellation callback to kill subprocess
      const unsubscribe = cancellationToken?.onCancel(() => {
        python.kill('SIGTERM');
      });

      python.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      python.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      // Send input via stdin
      const inputJson = JSON.stringify(input);
      python.stdin?.write(inputJson);
      python.stdin?.end();

      python.on('close', async (code) => {
        unsubscribe?.();
        try { await fs.unlink(scriptPath); } catch { /* ignore */ }

        if (code === 0) {
          resolve({
            success: true,
            output: stdout.trim(),
            duration: Date.now() - startTime,
          });
        } else {
          resolve({
            success: false,
            output: '',
            error: stderr || `Python exited with code ${code}`,
            duration: Date.now() - startTime,
          });
        }
      });

      python.on('error', async (err) => {
        unsubscribe?.();
        try { await fs.unlink(scriptPath); } catch { /* ignore */ }

        resolve({
          success: false,
          output: '',
          error: `Failed to execute Python: ${err.message}`,
          duration: Date.now() - startTime,
        });
      });
    });
  } catch (error: any) {
    return {
      success: false,
      output: '',
      error: error.message || String(error),
      duration: Date.now() - startTime,
    };
  }
}

// ============================================================================
// Main Execution Entry Point
// ============================================================================

/**
 * Execute a Lambda script with the unified input contract
 */
export async function executeLambda(
  script: string,
  language: 'typescript' | 'javascript' | 'python',
  input: LambdaInput,
  cancellationToken?: CancellationToken
): Promise<LambdaResult> {
  console.log(`\n🔮 Executing Lambda (${language})...`);
  console.log(`   Input tasks: ${input.tasks.length}`);
  console.log(`   Lambda: ${input.meta.lambdaName}`);
  
  if (input.tasks.length > 0) {
    console.log(`   Task summaries:`);
    input.tasks.forEach((task, i) => {
      const preview = task.taskType === 'agent' 
        ? task.workerOutput?.substring(0, 50) 
        : task.transformerOutput?.substring(0, 50);
      console.log(`     ${i + 1}. ${task.taskTitle} (${task.taskType}): ${preview}...`);
    });
  }

  if (language === 'python') {
    return executePythonLambda(script, input, cancellationToken);
  } else {
    return executeJSLambda(script, language, input, cancellationToken);
  }
}

/**
 * Create a pass-through Lambda result (for transformers without scripts)
 */
export function createPassThroughResult(input: LambdaInput): LambdaResult {
  console.log(`\n🔮 Pass-through transformer (no Lambda assigned)`);
  
  // Concatenate all outputs
  const outputs = input.tasks.map(task => {
    if (task.taskType === 'agent') {
      return task.workerOutput || '';
    } else {
      return task.transformerOutput || '';
    }
  });
  
  const output = outputs.filter(o => o).join('\n\n---\n\n');
    
  return {
    success: true,
    output,
    duration: 0,
  };
}

// ============================================================================
// Helper to build LambdaInput from task outputs
// ============================================================================

/**
 * Build a LambdaInput from the task outputs registry
 */
export function buildLambdaInput(
  transformerId: string,
  transformerTitle: string,
  lambdaName: string,
  executionId: string,
  dependencies: string[],
  taskOutputsRegistry: Map<string, any>
): LambdaInput {
  const tasks: TaskResult[] = [];
  
  for (const depId of dependencies) {
    const depOutput = taskOutputsRegistry.get(depId);
    if (depOutput) {
      tasks.push({
        taskId: depId,
        taskTitle: depOutput.taskTitle || depId,
        taskType: depOutput.lambdaName ? 'transformer' : 'agent',
        status: 'success',
        duration: depOutput.duration || 0,
        // Agent fields
        workerOutput: depOutput.workerOutputs?.[0],
        qcResult: depOutput.qcResult,
        agentRole: depOutput.agentRole,
        // Transformer fields
        transformerOutput: depOutput.lambdaName ? depOutput.workerOutputs?.[0] : undefined,
        lambdaName: depOutput.lambdaName,
      });
    }
  }
  
  return {
    tasks,
    meta: {
      transformerId,
      lambdaName: lambdaName || transformerTitle,
      dependencyCount: dependencies.length,
      executionId,
    },
  };
}
