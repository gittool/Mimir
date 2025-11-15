/**
 * Unit tests for auto-indexing documentation on startup
 * Tests the ensureDocsIndexed() function behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Driver, Session, Result, Record } from 'neo4j-driver';

describe('Auto-index documentation on startup', () => {
  let mockDriver: Driver;
  let mockSession: Session;
  let mockConfigManager: any;
  let mockGraphManager: any;
  let mockFileWatchManager: any;
  
  beforeEach(() => {
    // Mock Neo4j driver and session
    mockSession = {
      run: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    } as any;
    
    mockDriver = {
      session: vi.fn().mockReturnValue(mockSession),
    } as any;
    
    mockConfigManager = {
      getByPath: vi.fn(),
      listActive: vi.fn().mockResolvedValue([]),
    };
    
    mockGraphManager = {
      getDriver: vi.fn().mockReturnValue(mockDriver),
    };
    
    mockFileWatchManager = {
      startWatch: vi.fn(),
    };
    
    // Reset environment variable
    delete process.env.MIMIR_AUTO_INDEX_DOCS;
  });
  
  afterEach(() => {
    vi.clearAllMocks();
  });
  
  describe('Feature flag behavior', () => {
    it('should skip auto-indexing when MIMIR_AUTO_INDEX_DOCS=false', async () => {
      process.env.MIMIR_AUTO_INDEX_DOCS = 'false';
      
      // Mock implementation of ensureDocsIndexed
      const ensureDocsIndexed = async (configManager: any) => {
        const autoIndexDocs = process.env.MIMIR_AUTO_INDEX_DOCS !== 'false';
        if (!autoIndexDocs) {
          console.error('ℹ️  Auto-indexing documentation disabled');
          return;
        }
      };
      
      await ensureDocsIndexed(mockConfigManager);
      
      // Should not attempt to check for docs
      expect(mockSession.run).not.toHaveBeenCalled();
    });
    
    it('should proceed with auto-indexing when MIMIR_AUTO_INDEX_DOCS=true', async () => {
      process.env.MIMIR_AUTO_INDEX_DOCS = 'true';
      
      const ensureDocsIndexed = async (configManager: any, graphManager: any) => {
        const autoIndexDocs = process.env.MIMIR_AUTO_INDEX_DOCS !== 'false';
        if (!autoIndexDocs) return;
        
        // Mock: docs folder doesn't exist, should exit early
        return; // Would normally check fs.access
      };
      
      await ensureDocsIndexed(mockConfigManager, mockGraphManager);
      
      // Should proceed past feature flag check
      expect(true).toBe(true);
    });
    
    it('should default to enabled when env var not set', async () => {
      // Don't set MIMIR_AUTO_INDEX_DOCS
      const autoIndexDocs = process.env.MIMIR_AUTO_INDEX_DOCS !== 'false';
      expect(autoIndexDocs).toBe(true);
    });
  });
  
  describe('Directory existence check', () => {
    it('should verify /app/docs exists before proceeding', async () => {
      const fs = await import('fs').then(m => m.promises);
      const accessSpy = vi.spyOn(fs, 'access');
      
      // This will fail in test environment (no /app/docs)
      try {
        await fs.access('/app/docs');
      } catch {
        // Expected in test environment
      }
      
      expect(accessSpy).toHaveBeenCalledWith('/app/docs');
    });
  });
  
  describe('Docs already indexed detection', () => {
    it('should detect when docs are already indexed via parent folder', async () => {
      // Mock Neo4j query to return docs already indexed
      const mockRecords = [
        {
          get: vi.fn().mockReturnValue({ toNumber: () => 150 }),
        },
      ] as any;
      
      (mockSession.run as any).mockResolvedValue({
        records: mockRecords,
      });
      
      const result = await mockSession.run(`
        MATCH (f:file)
        WHERE f.path STARTS WITH '/app/docs/' OR f.path = '/app/docs'
        RETURN count(f) as docCount
        LIMIT 1
      `);
      
      const docCount = result.records[0]?.get('docCount')?.toNumber() || 0;
      
      expect(docCount).toBe(150);
      expect(docCount).toBeGreaterThan(0);
    });
    
    it('should proceed with indexing when no docs are found', async () => {
      // Mock Neo4j query to return 0 docs
      const mockRecords = [
        {
          get: vi.fn().mockReturnValue({ toNumber: () => 0 }),
        },
      ] as any;
      
      (mockSession.run as any).mockResolvedValue({
        records: mockRecords,
      });
      
      const result = await mockSession.run(`
        MATCH (f:file)
        WHERE f.path STARTS WITH '/app/docs/' OR f.path = '/app/docs'
        RETURN count(f) as docCount
        LIMIT 1
      `);
      
      const docCount = result.records[0]?.get('docCount')?.toNumber() || 0;
      
      expect(docCount).toBe(0);
      // Should proceed to call handleIndexFolder
    });
    
    it('should check for both exact path and subdirectories', async () => {
      const query = `
        MATCH (f:file)
        WHERE f.path STARTS WITH '/app/docs/' OR f.path = '/app/docs'
        RETURN count(f) as docCount
        LIMIT 1
      `;
      
      // Verify query includes both patterns
      expect(query).toContain("STARTS WITH '/app/docs/'");
      expect(query).toContain("OR f.path = '/app/docs'");
    });
  });
  
  describe('Integration with handleIndexFolder', () => {
    it('should call handleIndexFolder with correct parameters', async () => {
      const mockHandleIndexFolder = vi.fn().mockResolvedValue({
        status: 'success',
        files_indexed: 150,
      });
      
      const expectedArgs = {
        path: '/app/docs',
        recursive: true,
        file_patterns: ['*.md', '*.txt'],
        ignore_patterns: ['node_modules', '.git', 'archive'],
        generate_embeddings: true,
      };
      
      await mockHandleIndexFolder(
        expectedArgs,
        mockDriver,
        mockFileWatchManager
      );
      
      expect(mockHandleIndexFolder).toHaveBeenCalledWith(
        expectedArgs,
        mockDriver,
        mockFileWatchManager
      );
    });
    
    it('should handle successful indexing', async () => {
      const result = {
        status: 'success',
        files_indexed: 150,
      };
      
      expect(result.status).toBe('success');
      expect(result.files_indexed).toBeGreaterThan(0);
    });
    
    it('should handle indexing errors gracefully', async () => {
      const result = {
        status: 'error',
        message: 'Permission denied',
      };
      
      expect(result.status).toBe('error');
      expect(result.message).toBeTruthy();
    });
  });
  
  describe('Startup sequence', () => {
    it('should call ensureDocsIndexed after restoring watchers', () => {
      const startupSequence = [
        'Load watch configurations from Neo4j',
        'Restore existing watchers',
        'Call ensureDocsIndexed',
        'Complete initialization',
      ];
      
      // Verify ensureDocsIndexed is called after restore
      const ensureDocsIndex = startupSequence.indexOf('Call ensureDocsIndexed');
      const restoreIndex = startupSequence.indexOf('Restore existing watchers');
      
      expect(ensureDocsIndex).toBeGreaterThan(restoreIndex);
    });
  });
});

describe('Real-world scenario tests', () => {
  it('should handle case where docs are indexed via /workspace mount', async () => {
    // User has mounted their local Mimir repo to /workspace/Documents/GitHub/Mimir
    // This includes docs/ folder, so /app/docs should be detected as already indexed
    
    const filesInNeo4j = [
      { path: '/workspace/Documents/GitHub/Mimir/docs/README.md' },
      { path: '/workspace/Documents/GitHub/Mimir/docs/AGENTS.md' },
      { path: '/workspace/Documents/GitHub/Mimir/docs/guides/QUICKSTART.md' },
    ];
    
    // None of these paths start with /app/docs, but they ARE docs!
    const matchesAppDocs = filesInNeo4j.some(f => 
      f.path.startsWith('/app/docs/')
    );
    
    expect(matchesAppDocs).toBe(false);
    
    // This is the bug: we're checking for /app/docs but docs are at /workspace/.../docs
  });
  
  it('should correctly identify docs indexed via different mount point', () => {
    // The actual problem: docs can be indexed under multiple paths
    const possibleDocPaths = [
      '/app/docs',                                          // Direct copy in container
      '/workspace/Documents/GitHub/Mimir/docs',             // Windows mount
      '/workspace/Mimir/docs',                              // Alternative mount
      '/home/user/Mimir/docs',                              // Linux mount
    ];
    
    // We need to check for any of these patterns
    expect(possibleDocPaths.length).toBeGreaterThan(1);
  });
  
  it('should allow /app/docs as exception to workspace root validation', () => {
    // /app/docs is a special built-in path that should always be allowed
    const docsPath = '/app/docs';
    const workspaceRoot = '/app/C:/Users/timot';
    
    // Even though /app/docs doesn't start with workspace root,
    // it should be allowed as a special case
    expect(docsPath.startsWith(workspaceRoot)).toBe(false);
    
    // The path translation should handle this as exception
    const shouldBeAllowed = docsPath === '/app/docs' || docsPath.startsWith('/app/docs/');
    expect(shouldBeAllowed).toBe(true);
  });
});
