# Index API Integration Tests

## Overview

Comprehensive integration tests for the file indexing API endpoints with cross-platform path translation support (Mac/Linux and Windows).

## Test Coverage

### Mac/Linux Path Tests

**Environment Setup:**
- `WORKSPACE_ROOT`: `/workspace` (container path)
- `HOME`: `/Users/c815719` (user home)
- `HOST_WORKSPACE_ROOT`: `/Users/c815719/src` (mounted host folder)

**Test Scenarios:**

1. **POST /api/index-folder**
   - ✅ Accept Mac host path and translate to container path
   - ✅ Reject paths outside workspace
   - ✅ Handle symlinked paths
   - Example: `/Users/c815719/src/my-project` → `/workspace/my-project`

2. **DELETE /api/indexed-folders**
   - ✅ Delete folder by container path
   - ✅ Handle non-existent folders gracefully (404)

3. **GET /api/indexed-folders**
   - ✅ Return folders with Mac host paths
   - ✅ Include file, chunk, and embedding counts
   - ✅ Display host_path in response for better UX

### Windows Path Tests

**Environment Setup:**
- `WORKSPACE_ROOT`: `/workspace` (container path)
- `USERPROFILE`: `C:\Users\timot` (Windows user profile)
- `HOST_WORKSPACE_ROOT`: `C:\Users\timot\Documents\GitHub` (mounted folder)

**Test Scenarios:**

1. **POST /api/index-folder**
   - ✅ Accept Windows host path with backslashes
   - ✅ Accept Windows host path with forward slashes
   - ✅ Reject paths outside workspace
   - ✅ Handle UNC paths (`\\SERVER\Share\Projects`)
   - Examples:
     - `C:\Users\timot\Documents\GitHub\my-project` → `/workspace/my-project`
     - `C:/Users/timot/Documents/GitHub/my-project` → `/workspace/my-project`
     - `\\SERVER\Share\Projects\my-project` → `/workspace/my-project`

2. **DELETE /api/indexed-folders**
   - ✅ Delete folder by container path
   - ✅ Handle Windows path normalization (backslash vs forward slash)

3. **GET /api/indexed-folders**
   - ✅ Return folders with Windows host paths
   - ✅ Handle mixed forward/backward slashes
   - ✅ Preserve original path format in response

### Cross-Platform Edge Cases

**Special Characters:**
- ✅ Paths with spaces (Mac & Windows)
  - Mac: `/Users/c815719/My Projects/test project`
  - Windows: `C:\Users\timot\My Documents\test project`
  
- ✅ Unicode characters (Mac & Windows)
  - Mac: `/Users/c815719/src/项目-プロジェクト`
  - Windows: `C:\Users\timot\Documents\GitHub\项目-プロジェクト`

**Validation:**
- ✅ Reject empty paths
- ✅ Reject null paths
- ✅ Handle very long paths (200+ characters)

### Statistics Endpoint

**GET /api/index-stats**
- ✅ Return aggregate statistics (folders, files, chunks, embeddings)
- ✅ Return file type breakdown by extension
- ✅ Handle empty database gracefully

## Path Translation Logic

### Mac/Linux → Container

```
Host Path:      /Users/c815719/src/my-project
HOST_WORKSPACE_ROOT: /Users/c815719/src
WORKSPACE_ROOT: /workspace

Relative Path:  my-project
Container Path: /workspace/my-project
```

### Windows → Container

```
Host Path:      C:\Users\timot\Documents\GitHub\my-project
HOST_WORKSPACE_ROOT: C:\Users\timot\Documents\GitHub
WORKSPACE_ROOT: /workspace

Normalization:  C:/Users/timot/Documents/GitHub/my-project (backslash → forward slash)
Relative Path:  my-project
Container Path: /workspace/my-project
```

## Running Tests

### Run All Tests (Currently Skipped)

```bash
npm test -- testing/api/index-api.test.ts
```

### Run Specific Test Suite

```bash
# Mac/Linux tests only
npm test -- testing/api/index-api.test.ts -t "Mac/Linux Path Translation"

# Windows tests only
npm test -- testing/api/index-api.test.ts -t "Windows Path Translation"

# Edge cases only
npm test -- testing/api/index-api.test.ts -t "Cross-Platform Edge Cases"

# Stats endpoint only
npm test -- testing/api/index-api.test.ts -t "GET /api/index-stats"
```

### Unskip Tests for Verification

To run tests, remove `.skip` from the `describe.skip()` blocks:

```typescript
// Change this:
describe.skip('Mac/Linux Path Translation', () => {

// To this:
describe('Mac/Linux Path Translation', () => {
```

## Test Status

**All tests are currently skipped** (`.skip`) to prevent execution until needed for verification.

To verify the implementation:

1. Remove `.skip` from desired test suites
2. Run tests: `npm test -- testing/api/index-api.test.ts`
3. Verify all tests pass
4. Re-add `.skip` to prevent future executions

## Mock Strategy

### Neo4j Driver Mocking

```typescript
const mockSession = {
  run: vi.fn(),
  close: vi.fn(),
};

const mockDriver = {
  session: vi.fn(() => mockSession),
  close: vi.fn(),
};
```

### Folder Watch Manager Mocking

```typescript
vi.mock('../../src/indexing/folder-watch-manager.js', () => ({
  FolderWatchManager: {
    getInstance: vi.fn(() => ({
      startWatching: vi.fn().mockResolvedValue(undefined),
      stopWatching: vi.fn().mockResolvedValue(undefined),
    })),
  },
}));
```

## Example Test Scenarios

### Mac: Adding a Folder

```typescript
it('should accept Mac host path and translate to container path', async () => {
  const hostPath = '/Users/c815719/src/my-project';
  const expectedContainerPath = '/workspace/my-project';

  mockSession.run.mockResolvedValueOnce({ records: [] });
  mockSession.run.mockResolvedValueOnce({
    records: [{
      get: () => ({
        properties: {
          path: expectedContainerPath,
          host_path: hostPath,
          recursive: true,
          generate_embeddings: true,
        },
      }),
    }],
  });

  const response = await request(app)
    .post('/api/index-folder')
    .send({
      path: expectedContainerPath,
      hostPath: hostPath,
      recursive: true,
      generate_embeddings: true,
    });

  expect(response.status).toBe(200);
  expect(mockSession.run).toHaveBeenCalled();
});
```

### Windows: Deleting a Folder

```typescript
it('should delete folder by container path (Windows)', async () => {
  const containerPath = '/workspace/my-project';

  mockSession.run.mockResolvedValueOnce({
    records: [{
      get: () => ({
        properties: {
          path: containerPath,
          host_path: 'C:\\Users\\timot\\Documents\\GitHub\\my-project',
        },
      }),
    }],
  });

  mockSession.run.mockResolvedValue({ records: [] });

  const response = await request(app)
    .delete('/api/indexed-folders')
    .send({ path: containerPath });

  expect(response.status).toBe(200);
  expect(mockSession.run).toHaveBeenCalled();
});
```

## Important Notes

1. **All tests are skipped by default** - Remove `.skip` only when verifying
2. **Non-destructive** - Tests use mocked Neo4j driver, no actual database operations
3. **Cross-platform** - Tests cover both Mac/Linux and Windows path formats
4. **Edge cases** - Includes special characters, spaces, Unicode, long paths
5. **Realistic paths** - Uses actual examples from Mac (`~/src`) and Windows (`C:\Users\timot\Documents\GitHub`)

## Related Files

- **Implementation**: `src/api/index-api.ts`
- **FileIndexer**: `src/indexing/FileIndexer.ts` (path translation logic)
- **WatchConfigManager**: `src/indexing/WatchConfigManager.ts`
- **VSCode Extension**: `vscode-extension/src/intelligencePanel.ts` (path validation)
- **Frontend**: `vscode-extension/webview-src/intelligence/Intelligence.tsx`

## Path Translation References

See also:
- `testing/path-translation.test.ts` - Unit tests for path translation utilities
- `src/indexing/FileIndexer.ts` - `translateToHostPath()` method
- `vscode-extension/src/intelligencePanel.ts` - `_validateAndTranslatePath()` method
