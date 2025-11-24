interface ReportData {
  agent: string;
  benchmark: string;
  model: string;
  result: {
    output: string;
    conversationHistory: Array<{ role: string; content: string }>;
    tokens: { input: number; output: number };
    toolCalls?: number;
    intermediateSteps?: any[];
  };
  scores: {
    categories: Record<string, number>;
    total: number;
    feedback: Record<string, string>;
  };
}

/**
 * Generate a comprehensive validation report for agent execution
 * 
 * Creates a markdown-formatted report containing:
 * - Execution metadata (agent, benchmark, model, date)
 * - Performance metrics (tokens, tool calls)
 * - Scoring breakdown by category with feedback
 * - Complete agent output
 * - Full conversation history
 * 
 * This report is used for:
 * - Agent validation and benchmarking
 * - Performance analysis and optimization
 * - Debugging agent behavior
 * - Documentation and audit trails
 * 
 * @param data - Report data including agent info, execution results, and scores
 * @returns Markdown-formatted report string
 * 
 * @example
 * ```ts
 * const reportData = {
 *   agent: 'worker-a3f2b8c1',
 *   benchmark: 'golang-crypto-task',
 *   model: 'gpt-4.1',
 *   result: {
 *     output: 'Task completed successfully...',
 *     conversationHistory: [
 *       { role: 'user', content: 'Implement RSA encryption' },
 *       { role: 'assistant', content: 'I will implement...' }
 *     ],
 *     tokens: { input: 1500, output: 2000 },
 *     toolCalls: 12
 *   },
 *   scores: {
 *     categories: {
 *       'Correctness': 25,
 *       'Code Quality': 20,
 *       'Documentation': 15
 *     },
 *     total: 85,
 *     feedback: {
 *       'Correctness': 'Implementation is correct and handles edge cases',
 *       'Code Quality': 'Well-structured with good error handling',
 *       'Documentation': 'Clear comments and examples provided'
 *     }
 *   }
 * };
 * 
 * const report = generateReport(reportData);
 * fs.writeFileSync('validation-report.md', report);
 * ```
 */
export function generateReport(data: ReportData): string {
  return `
# Agent Validation Report

**Agent**: ${data.agent}
**Benchmark**: ${data.benchmark}
**Model**: ${data.model}
**Date**: ${new Date().toISOString().split('T')[0]}
**Total Score**: ${data.scores.total}/100

---

## Execution Summary

- **Tool Calls**: ${data.result.toolCalls || 0}
- **Input Tokens**: ${data.result.tokens.input}
- **Output Tokens**: ${data.result.tokens.output}
- **Total Tokens**: ${data.result.tokens.input + data.result.tokens.output}

---

## Scoring Breakdown

${Object.entries(data.scores.categories)
  .map(
    ([category, score]) => `
### ${category}: ${score} points

**Feedback**: ${data.scores.feedback[category]}
`
  )
  .join('\n')}

---

## Agent Output

\`\`\`
${data.result.output}
\`\`\`

---

## Conversation History

${data.result.conversationHistory
  .map(
    (msg) => `
### ${msg.role.toUpperCase()}

\`\`\`
${msg.content}
\`\`\`
`
  )
  .join('\n')}
`.trim();
}

