# Windsurf Custom Prompts

Custom system prompts for Windsurf IDE (stored in `.agents/` directory).

## Current Configuration

- **Active Prompt**: `claudette-mimir-v3.yaml`
- **Version**: v7.3.0 (Memory-Native Agent - Mimir Edition)
- **Source**: Based on `/docs/agents/claudette-mimir-v3.md`

## Usage

The active prompt is configured in `/windsurf.yaml`:

```yaml
chatOptions:
  systemPromptFile: ./.agents/claudette-mimir-v3.yaml
```

## To Activate

1. **Reload Windsurf**: Restart the IDE or reload the agent
2. **Verify**: Run a test query like "What's your system message?"
3. **Confirm**: You should see Claudette's memory-native behavior with Mimir integration

## Key Features

- **Memory-First Approach**: Uses `discover()` before external searches
- **Continuous Execution**: Doesn't stop mid-task or ask permission
- **Graph-RAG Integration**: Leverages Mimir's knowledge graph
- **Autonomous Operation**: Acts immediately without waiting for approval

## Switching Prompts

To use a different prompt:

1. Create a new `.yaml` file in `.agents/` directory
2. Update the `systemPromptFile` path in `/windsurf.yaml`
3. Reload Windsurf

## Related Documentation

- Source prompt: `/docs/agents/claudette-mimir-v3.md`
- Installation guide: https://gist.github.com/orneryd/334e1d59b6abaf289d06eeda62690cdb
