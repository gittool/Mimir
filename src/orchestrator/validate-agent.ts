import { CopilotAgentClient } from './llm-client.js';
import { evaluateAgent } from './evaluators/index.js';
import { generateReport } from './report-generator.js';
import fs from 'fs/promises';
import path from 'path';
import { fetchAvailableModels } from './types.js';

interface BenchmarkTask {
  name: string;
  description: string;
  task: string;
  rubric: {
    categories: Array<{
      name: string;
      maxPoints: number;
      criteria: string[];
    }>;
  };
}

/**
 * Validate an agent against a benchmark task
 * 
 * Executes a comprehensive validation workflow:
 * 1. Loads benchmark task with rubric
 * 2. Initializes agent with specified model
 * 3. Executes benchmark task
 * 4. Evaluates output against rubric
 * 5. Generates detailed reports (JSON + Markdown)
 * 
 * The validation process measures agent performance across multiple
 * categories defined in the benchmark rubric.
 * 
 * @param agentPath - Path to agent preamble file (.md)
 * @param benchmarkPath - Path to benchmark task file (.json)
 * @param outputDir - Directory to save validation reports
 * @param model - LLM model to use for agent execution
 * @returns Promise that resolves when validation is complete
 * 
 * @example
 * ```ts
 * // Validate a worker agent
 * await validateAgent(
 *   'generated-agents/worker-a3f2b8c1.md',
 *   'benchmarks/golang-crypto.json',
 *   'validation-results',
 *   'gpt-4.1'
 * );
 * // Output:
 * // 🔍 Validating agent: generated-agents/worker-a3f2b8c1.md
 * // 📋 Benchmark: benchmarks/golang-crypto.json
 * // 🤖 Using model: gpt-4.1
 * // ⚙️  Executing benchmark task...
 * // ✅ Task completed - Tool calls: 12, Tokens: 3500
 * // 📊 Evaluating output against rubric...
 * // 📈 Total score: 85/100
 * // 📄 Report saved to: validation-results/2025-11-24_worker-a3f2b8c1.md
 * 
 * // Benchmark JSON format:
 * // {
 * //   "name": "Golang Cryptography Task",
 * //   "description": "Implement RSA encryption",
 * //   "task": "Create a Go program that...",
 * //   "rubric": {
 * //     "categories": [
 * //       {
 * //         "name": "Correctness",
 * //         "maxPoints": 30,
 * //         "criteria": ["Implements RSA correctly", "Handles edge cases"]
 * //       },
 * //       {
 * //         "name": "Code Quality",
 * //         "maxPoints": 25,
 * //         "criteria": ["Well-structured", "Good error handling"]
 * //       }
 * //     ]
 * //   }
 * // }
 * ```
 */
async function validateAgent(
  agentPath: string,
  benchmarkPath: string,
  outputDir: string,
  model: string
): Promise<void> {
  console.log(`\n🔍 Validating agent: ${agentPath}`);
  console.log(`📋 Benchmark: ${benchmarkPath}\n`);

  // 1. Load benchmark
  const benchmark: BenchmarkTask = JSON.parse(
    await fs.readFile(benchmarkPath, 'utf-8')
  );

  // 2. Initialize agent with GitHub Copilot
  console.log(`🤖 Using model: ${model}\n`);
  
  const client = new CopilotAgentClient({
    preamblePath: agentPath,
    model: model,
    temperature: 0.0,
    maxTokens: 8000,
  });

  await client.loadPreamble(agentPath);

  // 3. Execute benchmark task
  console.log('⚙️  Executing benchmark task...');
  console.log(`📝 Task: ${benchmark.task.substring(0, 100)}...\n`);
  
  const result = await client.execute(benchmark.task);
  console.log(`✅ Task completed - Tool calls: ${result.toolCalls}, Tokens: ${result.tokens.input + result.tokens.output}\n`);
  
  // If no tool calls were made, show a warning
  if (result.toolCalls === 0) {
    console.warn('⚠️  WARNING: Agent made 0 tool calls! Agent may not be using tools properly.\n');
  }

  // 4. Evaluate output
  console.log('📊 Evaluating output against rubric...');
  const scores = await evaluateAgent(result.output, benchmark.rubric);
  console.log(`📈 Total score: ${scores.total}/100\n`);

  // 5. Generate report
  const timestamp = new Date().toISOString().split('T')[0];
  const agentName = path.basename(agentPath, '.md');
  const outputPath = path.join(outputDir, `${timestamp}_${agentName}`);

  await fs.mkdir(outputDir, { recursive: true });

  // Save raw output
  await fs.writeFile(
    `${outputPath}.json`,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        agent: agentPath,
        benchmark: benchmarkPath,
        model,
        result,
        scores,
      },
      null,
      2
    )
  );

  // Save readable report
  const report = generateReport({
    agent: agentName,
    benchmark: benchmark.name,
    model,
    result,
    scores,
  });

  await fs.writeFile(`${outputPath}.md`, report);

  console.log(`📄 Report saved to: ${outputPath}.md`);
  console.log(`📊 Tool calls made: ${result.toolCalls || 0}`);
}

/**
 * List available models dynamically from the configured endpoint
 */
async function listModels(): Promise<void> {
  console.log('\n📋 Fetching Available Models...\n');
  
  // Get API URL from env var (use MIMIR_LLM_API if set, otherwise MIMIR_SERVER_URL + /v1)
  const apiUrl = process.env.MIMIR_LLM_API || `${process.env.MIMIR_SERVER_URL || 'http://localhost:9042'}/v1`;
  console.log(`   Checking: ${apiUrl}/models`);
  console.log(`   Timeout: 5 seconds\n`);
  
  try {
    const models = await fetchAvailableModels(apiUrl);
    
    if (models.length === 0) {
      console.error('⚠️  No models found or connection failed.');
      console.error(`   API URL: ${apiUrl}`);
      console.error('\n💡 Troubleshooting:');
      console.error('   1. Check if your LLM provider is running:');
      console.error(`      curl ${apiUrl}/models`);
      console.error('   2. Verify MIMIR_LLM_API environment variable');
      console.error('   3. Check network connectivity\n');
      process.exit(1);
    }
    
    console.log(`✅ Found ${models.length} models from ${apiUrl}:\n`);
    
    // Group by owner/provider for cleaner display
    const byOwner = models.reduce((acc, m) => {
      const owner = m.owned_by || 'unknown';
      if (!acc[owner]) acc[owner] = [];
      acc[owner].push(m.id);
      return acc;
    }, {} as Record<string, string[]>);
    
    for (const [owner, modelIds] of Object.entries(byOwner)) {
      console.log(`${owner.toUpperCase()}:`);
      modelIds.forEach(id => {
        console.log(`  - ${id}`);
      });
      console.log();
    }
    
    const defaultModel = process.env.MIMIR_DEFAULT_MODEL || 'gpt-4.1';
    console.log(`💡 Current default: ${defaultModel}`);
    console.log(`   Set via: export MIMIR_DEFAULT_MODEL=<model-name>\n`);
  } catch (error) {
    console.error('❌ Failed to fetch models:', error);
    console.error(`\n💡 Ensure your LLM provider is running at: ${apiUrl}`);
    console.error('   Check logs above for details\n');
    process.exit(1);
  }
}

// CLI usage
const args = process.argv.slice(2);

if (args.includes('--list-models') || args.includes('-l')) {
  await listModels();
  process.exit(0);
}

const [agentPath, benchmarkPath, model] = args;

if (!agentPath || !benchmarkPath) {
  console.error('Usage: npm run validate <agent.md> <benchmark.json> [model]');
  console.error('       npm run validate --list-models  (show available models)');
  console.error('\nSet model: export MIMIR_DEFAULT_MODEL=<model-name>');
  process.exit(1);
}

validateAgent(
  agentPath,
  benchmarkPath,
  'validation-output',
  model || process.env.MIMIR_DEFAULT_MODEL || 'gpt-4.1'
).catch(console.error);

