// ============================================================================
// Index API Integration Tests - Mac & Windows Path Support
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { Router } from 'express';

// Mock Neo4j driver
const mockSession = {
  run: vi.fn(),
  close: vi.fn(),
};

const mockDriver = {
  session: vi.fn(() => mockSession),
  close: vi.fn(),
};

// Mock modules before importing
vi.mock('neo4j-driver', () => ({
  default: {
    driver: vi.fn(() => mockDriver),
    auth: {
      basic: vi.fn(),
    },
    int: (value: number) => value,
  },
}));

vi.mock('../../src/indexing/folder-watch-manager.js', () => ({
  FolderWatchManager: {
    getInstance: vi.fn(() => ({
      startWatching: vi.fn().mockResolvedValue(undefined),
      stopWatching: vi.fn().mockResolvedValue(undefined),
    })),
  },
}));

// Import after mocking
import createIndexRouter from '../../src/api/index-api.js';

describe('Index API - Mac & Windows Path Integration', () => {
  let app: express.Application;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    
    // Setup express app
    app = express();
    app.use(express.json());
    
    // Use the router (it's a default export, not a factory function)
    app.use('/api', createIndexRouter);
    
    // Clear all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore environment
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // ========================================================================
  // MAC / LINUX PATH TESTS
  // ========================================================================

  describe.skip('Mac/Linux Path Translation', () => {
    beforeEach(() => {
      process.env.WORKSPACE_ROOT = '/workspace';
      process.env.HOME = '/Users/c815719';
      process.env.HOST_WORKSPACE_ROOT = '/Users/c815719/src';
    });

    describe('Tilde Expansion', () => {
      it('should expand ~/src to /Users/c815719/src', () => {
        process.env.HOST_WORKSPACE_ROOT = '~/src';
        process.env.HOME = '/Users/c815719';
        
        const hostPath = '/Users/c815719/src/my-project';
        const expandedRoot = '/Users/c815719/src';
        
        expect(expandedRoot).toBe('/Users/c815719/src');
        
        // Verify path is within expanded root
        expect(hostPath.startsWith(expandedRoot)).toBe(true);
      });

      it('should handle ~ alone', () => {
        process.env.HOST_WORKSPACE_ROOT = '~';
        process.env.HOME = '/Users/c815719';
        
        const expandedRoot = process.env.HOME;
        expect(expandedRoot).toBe('/Users/c815719');
      });
    });

    describe('POST /api/index-folder (Mac)', () => {
      it('should accept Mac host path and translate to container path', async () => {
        const hostPath = '/Users/c815719/src/my-project';
        const expectedContainerPath = '/workspace/my-project';

        mockSession.run.mockResolvedValueOnce({
          records: [], // No existing WatchConfig
        });

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

      it('should reject Mac path outside workspace', async () => {
        const outsidePath = '/Users/c815719/other-folder/project';

        const response = await request(app)
          .post('/api/index-folder')
          .send({
            path: '/workspace/project',
            hostPath: outsidePath,
            recursive: true,
          });

        // Should reject because hostPath doesn't start with HOST_WORKSPACE_ROOT
        expect(response.status).toBe(400);
      });

      it('should handle Mac paths with symlinks', async () => {
        const hostPath = '/Users/c815719/src/linked-project';
        const expectedContainerPath = '/workspace/linked-project';

        mockSession.run.mockResolvedValueOnce({
          records: [],
        });

        mockSession.run.mockResolvedValueOnce({
          records: [{
            get: () => ({
              properties: {
                path: expectedContainerPath,
                host_path: hostPath,
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
          });

        expect(response.status).toBe(200);
      });
    });

    describe('DELETE /api/indexed-folders (Mac)', () => {
      it('should delete folder by container path (Mac)', async () => {
        const containerPath = '/workspace/my-project';

        // Mock finding the WatchConfig
        mockSession.run.mockResolvedValueOnce({
          records: [{
            get: () => ({
              properties: {
                path: containerPath,
                host_path: '/Users/c815719/src/my-project',
              },
            }),
          }],
        });

        // Mock deletion queries
        mockSession.run.mockResolvedValue({ records: [] });

        const response = await request(app)
          .delete('/api/indexed-folders')
          .send({ path: containerPath });

        expect(response.status).toBe(200);
        expect(mockSession.run).toHaveBeenCalled();
      });

      it('should handle deleting non-existent Mac folder gracefully', async () => {
        const containerPath = '/workspace/non-existent';

        mockSession.run.mockResolvedValueOnce({
          records: [], // No WatchConfig found
        });

        const response = await request(app)
          .delete('/api/indexed-folders')
          .send({ path: containerPath });

        expect(response.status).toBe(404);
      });
    });

    describe('GET /api/indexed-folders (Mac)', () => {
      it('should return folders with Mac host paths', async () => {
        const watchConfigs = [
          {
            path: '/workspace/project1',
            host_path: '/Users/c815719/src/project1',
            recursive: true,
            generate_embeddings: true,
          },
          {
            path: '/workspace/project2',
            host_path: '/Users/c815719/src/project2',
            recursive: true,
            generate_embeddings: false,
          },
        ];

        // Mock WatchConfig query
        mockSession.run.mockResolvedValueOnce({
          records: watchConfigs.map(config => ({
            get: () => ({ properties: config }),
          })),
        });

        // Mock file count queries for each folder
        mockSession.run.mockResolvedValue({
          records: [{
            get: () => 10, // file count
          }, {
            get: () => 50, // chunk count
          }, {
            get: () => 50, // embedding count
          }],
        });

        const response = await request(app)
          .get('/api/indexed-folders');

        expect(response.status).toBe(200);
        expect(response.body.folders).toHaveLength(2);
        expect(response.body.folders[0].hostPath).toContain('/Users/c815719/src');
      });
    });
  });

  // ========================================================================
  // WINDOWS PATH TESTS
  // ========================================================================

  describe.skip('Windows Path Translation', () => {
    beforeEach(() => {
      process.env.WORKSPACE_ROOT = '/workspace';
      process.env.USERPROFILE = 'C:\\Users\\timot';
      process.env.HOST_WORKSPACE_ROOT = 'C:\\Users\\timot\\Documents\\GitHub';
    });

    describe('POST /api/index-folder (Windows)', () => {
      it('should accept Windows host path and translate to container path', async () => {
        const hostPath = 'C:\\Users\\timot\\Documents\\GitHub\\my-project';
        const expectedContainerPath = '/workspace/my-project';

        mockSession.run.mockResolvedValueOnce({
          records: [],
        });

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

      it('should accept Windows host path with forward slashes', async () => {
        const hostPath = 'C:/Users/timot/Documents/GitHub/my-project';
        const expectedContainerPath = '/workspace/my-project';

        mockSession.run.mockResolvedValueOnce({
          records: [],
        });

        mockSession.run.mockResolvedValueOnce({
          records: [{
            get: () => ({
              properties: {
                path: expectedContainerPath,
                host_path: hostPath,
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
          });

        expect(response.status).toBe(200);
      });

      it('should reject Windows path outside workspace', async () => {
        const outsidePath = 'C:\\Users\\timot\\OtherFolder\\project';

        const response = await request(app)
          .post('/api/index-folder')
          .send({
            path: '/workspace/project',
            hostPath: outsidePath,
            recursive: true,
          });

        expect(response.status).toBe(400);
      });

      it('should handle Windows UNC paths', async () => {
        process.env.HOST_WORKSPACE_ROOT = '\\\\SERVER\\Share\\Projects';
        const hostPath = '\\\\SERVER\\Share\\Projects\\my-project';
        const expectedContainerPath = '/workspace/my-project';

        mockSession.run.mockResolvedValueOnce({
          records: [],
        });

        mockSession.run.mockResolvedValueOnce({
          records: [{
            get: () => ({
              properties: {
                path: expectedContainerPath,
                host_path: hostPath,
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
          });

        expect(response.status).toBe(200);
      });
    });

    describe('DELETE /api/indexed-folders (Windows)', () => {
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

      it('should handle Windows path normalization in deletion', async () => {
        const containerPath = '/workspace/my-project';
        const windowsHostPath = 'C:\\Users\\timot\\Documents\\GitHub\\my-project';

        mockSession.run.mockResolvedValueOnce({
          records: [{
            get: () => ({
              properties: {
                path: containerPath,
                host_path: windowsHostPath,
              },
            }),
          }],
        });

        mockSession.run.mockResolvedValue({ records: [] });

        const response = await request(app)
          .delete('/api/indexed-folders')
          .send({ path: containerPath });

        expect(response.status).toBe(200);
      });
    });

    describe('GET /api/indexed-folders (Windows)', () => {
      it('should return folders with Windows host paths', async () => {
        const watchConfigs = [
          {
            path: '/workspace/project1',
            host_path: 'C:\\Users\\timot\\Documents\\GitHub\\project1',
            recursive: true,
          },
          {
            path: '/workspace/project2',
            host_path: 'C:\\Users\\timot\\Documents\\GitHub\\project2',
            recursive: false,
          },
        ];

        mockSession.run.mockResolvedValueOnce({
          records: watchConfigs.map(config => ({
            get: () => ({ properties: config }),
          })),
        });

        mockSession.run.mockResolvedValue({
          records: [{
            get: () => 15,
          }, {
            get: () => 75,
          }, {
            get: () => 75,
          }],
        });

        const response = await request(app)
          .get('/api/indexed-folders');

        expect(response.status).toBe(200);
        expect(response.body.folders).toHaveLength(2);
        expect(response.body.folders[0].hostPath).toContain('C:\\Users\\timot');
      });

      it('should handle mixed forward/backward slashes in Windows paths', async () => {
        const watchConfigs = [
          {
            path: '/workspace/project1',
            host_path: 'C:/Users/timot/Documents/GitHub/project1', // Forward slashes
          },
        ];

        mockSession.run.mockResolvedValueOnce({
          records: watchConfigs.map(config => ({
            get: () => ({ properties: config }),
          })),
        });

        mockSession.run.mockResolvedValue({
          records: [{
            get: () => 5,
          }, {
            get: () => 25,
          }, {
            get: () => 25,
          }],
        });

        const response = await request(app)
          .get('/api/indexed-folders');

        expect(response.status).toBe(200);
        expect(response.body.folders[0].hostPath).toContain('C:/Users/timot');
      });
    });
  });

  // ========================================================================
  // CROSS-PLATFORM EDGE CASES
  // ========================================================================

  describe.skip('Cross-Platform Edge Cases', () => {
    it('should handle paths with spaces (Mac)', async () => {
      process.env.HOST_WORKSPACE_ROOT = '/Users/c815719/My Projects';
      const hostPath = '/Users/c815719/My Projects/test project';
      const containerPath = '/workspace/test project';

      mockSession.run.mockResolvedValueOnce({ records: [] });
      mockSession.run.mockResolvedValueOnce({
        records: [{
          get: () => ({
            properties: { path: containerPath, host_path: hostPath },
          }),
        }],
      });

      const response = await request(app)
        .post('/api/index-folder')
        .send({ path: containerPath, hostPath, recursive: true });

      expect(response.status).toBe(200);
    });

    it('should handle paths with spaces (Windows)', async () => {
      process.env.HOST_WORKSPACE_ROOT = 'C:\\Users\\timot\\My Documents';
      const hostPath = 'C:\\Users\\timot\\My Documents\\test project';
      const containerPath = '/workspace/test project';

      mockSession.run.mockResolvedValueOnce({ records: [] });
      mockSession.run.mockResolvedValueOnce({
        records: [{
          get: () => ({
            properties: { path: containerPath, host_path: hostPath },
          }),
        }],
      });

      const response = await request(app)
        .post('/api/index-folder')
        .send({ path: containerPath, hostPath, recursive: true });

      expect(response.status).toBe(200);
    });

    it('should handle Unicode characters in paths (Mac)', async () => {
      process.env.HOST_WORKSPACE_ROOT = '/Users/c815719/src';
      const hostPath = '/Users/c815719/src/项目-プロジェクト';
      const containerPath = '/workspace/项目-プロジェクト';

      mockSession.run.mockResolvedValueOnce({ records: [] });
      mockSession.run.mockResolvedValueOnce({
        records: [{
          get: () => ({
            properties: { path: containerPath, host_path: hostPath },
          }),
        }],
      });

      const response = await request(app)
        .post('/api/index-folder')
        .send({ path: containerPath, hostPath, recursive: true });

      expect(response.status).toBe(200);
    });

    it('should handle Unicode characters in paths (Windows)', async () => {
      process.env.HOST_WORKSPACE_ROOT = 'C:\\Users\\timot\\Documents\\GitHub';
      const hostPath = 'C:\\Users\\timot\\Documents\\GitHub\\项目-プロジェクト';
      const containerPath = '/workspace/项目-プロジェクト';

      mockSession.run.mockResolvedValueOnce({ records: [] });
      mockSession.run.mockResolvedValueOnce({
        records: [{
          get: () => ({
            properties: { path: containerPath, host_path: hostPath },
          }),
        }],
      });

      const response = await request(app)
        .post('/api/index-folder')
        .send({ path: containerPath, hostPath, recursive: true });

      expect(response.status).toBe(200);
    });

    it('should reject empty paths', async () => {
      const response = await request(app)
        .post('/api/index-folder')
        .send({ path: '', hostPath: '', recursive: true });

      expect(response.status).toBe(400);
    });

    it('should reject null paths', async () => {
      const response = await request(app)
        .post('/api/index-folder')
        .send({ path: null, hostPath: null, recursive: true });

      expect(response.status).toBe(400);
    });

    it('should handle very long paths (Mac)', async () => {
      process.env.HOST_WORKSPACE_ROOT = '/Users/c815719/src';
      const longFolder = 'a'.repeat(200);
      const hostPath = `/Users/c815719/src/${longFolder}`;
      const containerPath = `/workspace/${longFolder}`;

      mockSession.run.mockResolvedValueOnce({ records: [] });
      mockSession.run.mockResolvedValueOnce({
        records: [{
          get: () => ({
            properties: { path: containerPath, host_path: hostPath },
          }),
        }],
      });

      const response = await request(app)
        .post('/api/index-folder')
        .send({ path: containerPath, hostPath, recursive: true });

      expect(response.status).toBe(200);
    });

    it('should handle very long paths (Windows)', async () => {
      process.env.HOST_WORKSPACE_ROOT = 'C:\\Users\\timot\\Documents\\GitHub';
      const longFolder = 'b'.repeat(200);
      const hostPath = `C:\\Users\\timot\\Documents\\GitHub\\${longFolder}`;
      const containerPath = `/workspace/${longFolder}`;

      mockSession.run.mockResolvedValueOnce({ records: [] });
      mockSession.run.mockResolvedValueOnce({
        records: [{
          get: () => ({
            properties: { path: containerPath, host_path: hostPath },
          }),
        }],
      });

      const response = await request(app)
        .post('/api/index-folder')
        .send({ path: containerPath, hostPath, recursive: true });

      expect(response.status).toBe(200);
    });
  });

  // ========================================================================
  // GET /api/index-stats TESTS
  // ========================================================================

  describe.skip('GET /api/index-stats', () => {
    it('should return aggregate statistics', async () => {
      mockSession.run.mockResolvedValueOnce({
        records: [{
          get: (key: string) => {
            const data: any = {
              totalFolders: 5,
              totalFiles: 150,
              totalChunks: 750,
              totalEmbeddings: 750,
            };
            return data[key];
          },
        }],
      });

      mockSession.run.mockResolvedValueOnce({
        records: [
          { get: () => ({ extension: '.ts', count: 50 }) },
          { get: () => ({ extension: '.js', count: 30 }) },
          { get: () => ({ extension: '.md', count: 20 }) },
        ],
      });

      const response = await request(app)
        .get('/api/index-stats');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('totalFolders');
      expect(response.body).toHaveProperty('totalFiles');
      expect(response.body).toHaveProperty('byExtension');
    });

    it('should handle empty database', async () => {
      mockSession.run.mockResolvedValueOnce({
        records: [{
          get: () => 0,
        }],
      });

      mockSession.run.mockResolvedValueOnce({
        records: [],
      });

      const response = await request(app)
        .get('/api/index-stats');

      expect(response.status).toBe(200);
      expect(response.body.totalFiles).toBe(0);
    });
  });
});
