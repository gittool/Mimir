# Changelog

## [0.1.0] - 2025-11-19

### Added
- **Model Selection Support**: Accept `model` parameter in chat requests (OpenAI-compatible)
  - Configure via `mimir.model` setting (default: `gpt-4.1`)
  - Supports any model available in Mimir: GPT-4, Claude, Llama, etc.
  - Model is preserved across conversation (unless explicitly changed)

### Fixed
- **Chat History Handling**: Proper context preservation across conversation
  - System message (preamble) is only added once per conversation
  - Follow-up messages reuse the original preamble automatically
  - Slash commands can override preamble mid-conversation
  - No more duplicate system messages
- **Tool Parameters**: All tool configurations preserved across messages
  - Vector search depth/limit/similarity persist throughout conversation
  - Tool enable/disable settings maintained per chat thread

### Improved
- **Chat Continuity**: Better conversation flow
  - Starting with `/research` keeps research mode for all follow-ups
  - Model selection persists (from settings)
  - All configurations apply to entire conversation unless changed

## Usage Examples

### Basic Chat
```
@mimir how does graph-rag work?
```
Uses: default preamble (`mimir-v2`) + default model (`gpt-4.1`)

### With Slash Command
```
@mimir /research what are Neo4j best practices?
```
Uses: `research` preamble + default model + higher search depth

### Follow-up Messages
```
@mimir /debug why is my API failing?
@mimir can you check the logs?
```
Both use: `debug` preamble (preserves from first message) + same model

### Change Model Mid-Conversation
Update `mimir.model` in settings to switch models (takes effect next message)

## Configuration Reference

| Setting | Default | Description |
|---------|---------|-------------|
| `mimir.model` | `gpt-4.1` | LLM model to use |
| `mimir.defaultPreamble` | `mimir-v2` | Default chatmode |
| `mimir.vectorSearch.depth` | `1` | Graph traversal depth (1-3) |
| `mimir.enableTools` | `true` | Enable MCP tools |
| `mimir.maxToolCalls` | `3` | Max tool calls per response |

