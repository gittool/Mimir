# Testing the Mimir VSCode Extension

## Prerequisites

1. **Mimir Server Running**: Ensure Mimir is running and accessible at `http://localhost:9042`

   ```bash
   npm run start  # From Mimir root
   ```

2. **VSCode**: You need VSCode 1.95.0 or higher (for Chat Participant API support)

## Testing in Development Mode

### Method 1: Press F5 (Recommended)

1. **Open vscode-extension folder in VSCode**:

   ```bash
   code /Users/c815719/src/Mimir/vscode-extension
   ```

2. **Press F5** to launch the Extension Development Host

   - This will open a new VSCode window with the extension loaded
   - You'll see `[Extension Development Host]` in the title bar

3. **Open the Chat Panel** in the Extension Development Host:

   - Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
   - Type "Chat: Focus on Chat View" and select it
   - Or click the Chat icon in the Activity Bar

4. **Start chatting with Mimir**:
   - Type `@mimir` followed by your question
   - Example: `@mimir how does graph-rag work?`

### Method 2: Manual Launch

1. **Open vscode-extension folder in VSCode**
2. **Open Run and Debug panel** (Cmd/Ctrl+Shift+D)
3. **Select "Run Extension"** from the dropdown
4. **Click the green play button**

## Testing Slash Commands (Preambles)

Once the extension is loaded, you can use slash commands to switch chatmodes:

```
@mimir /research what is the best way to implement graph traversal?
@mimir /debug why is my vector search returning no results?
@mimir /architect design a new feature for knowledge graph visualization
```

Available commands will be dynamically loaded from Mimir at startup.

## Configuring the Extension

In the Extension Development Host, go to Settings (Cmd/Ctrl+,) and search for "Mimir":

- **Mimir: API URL**: Mimir server endpoint (default: `http://localhost:9042`)
- **Mimir: Default Preamble**: Default chatmode (default: `mimir-v2`)
- **Mimir: Vector Search Depth**: Graph traversal depth 1-3 (default: 2)
- **Mimir: Vector Search Limit**: Max search results (default: 10)
- **Mimir: Vector Search Min Similarity**: Similarity threshold (default: 0.5)
- **Mimir: Enable Tools**: Enable MCP tools (default: true)
- **Mimir: Max Tool Calls**: Max tool calls per turn (default: 3)
- **Mimir: Custom Preamble**: Use custom preamble content instead of server-side preambles

## Debugging

1. **View Extension Logs**:

   - In the Extension Development Host, open "Output" panel (Cmd/Ctrl+Shift+U)
   - Select "Mimir Chat Assistant" from the dropdown
   - You'll see logs like: `🎭 Preamble: research, Depth: 2`

2. **View Original VSCode Console** (where you pressed F5):

   - Check the "Debug Console" tab for extension activation logs
   - Check the "Terminal" tab for build errors

3. **Common Issues**:
   - **"Cannot connect to Mimir"**: Ensure Mimir is running at `http://localhost:9042`
   - **"No preambles available"**: Check `/api/preambles` endpoint is working
   - **"Extension not activating"**: Check for TypeScript compilation errors

## Building and Packaging

### Development Build

```bash
npm run build:vscode  # From Mimir root
# or
npm run compile       # From vscode-extension folder
```

### Package as .vsix (for distribution)

```bash
cd vscode-extension
npm run package
# Creates mimir-chat-0.1.0.vsix
```

### Install packaged extension

```bash
code --install-extension mimir-chat-0.1.0.vsix
```

## Testing Checklist

- [ ] Extension activates without errors
- [ ] Chat participant `@mimir` appears in chat panel
- [ ] Can send basic message and get response
- [ ] Slash commands (preambles) load dynamically
- [ ] Can switch preambles via slash commands
- [ ] Settings are respected (depth, limit, similarity)
- [ ] Tool calling works (if enabled)
- [ ] Streaming responses display correctly
- [ ] Cancellation works (stop button)
- [ ] Error handling is graceful (server down, invalid response)

## Next Steps

- Test with different preambles (`/research`, `/debug`, `/architect`)
- Experiment with vector search settings
- Try enabling/disabling tools
- Test with custom preamble content
- Monitor Mimir server logs for API calls

## Troubleshooting

### "Mimir server not responding"

```bash
# Check Mimir status
npm run status

# Restart Mimir
npm run restart
```

### "Preambles not loading"

```bash
# Test preambles endpoint directly
curl http://localhost:9042/api/preambles

# Test specific preamble
curl http://localhost:9042/api/preambles/research
```

### "TypeScript errors after changes"

```bash
# Rebuild
npm run build:vscode

# Clean and rebuild
rm -rf vscode-extension/dist
npm run build:vscode
```
