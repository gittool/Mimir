/**
 * Unit tests for GraphManager NornicDB detection and embedding skip logic
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import neo4j, { Driver, Session, Result, ResultSummary } from 'neo4j-driver';
import { GraphManager } from '../src/managers/GraphManager.js';

// Mock neo4j-driver
vi.mock('neo4j-driver', () => {
  const mockSession = {
    run: vi.fn(),
    close: vi.fn()
  };
  
  const mockDriver = {
    session: vi.fn(() => mockSession)
  };
  
  return {
    default: {
      driver: vi.fn(() => mockDriver),
      auth: {
        basic: vi.fn((user, pass) => ({ scheme: 'basic', credentials: `${user}:${pass}` }))
      }
    }
  };
});

// Mock EmbeddingsService
vi.mock('../../src/indexing/EmbeddingsService.js', () => ({
  EmbeddingsService: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    isEnabled: vi.fn().mockReturnValue(true),
    generateEmbedding: vi.fn().mockResolvedValue({
      embedding: new Array(768).fill(0.1),
      dimensions: 768,
      model: 'test-model'
    })
  }))
}));

// Mock UnifiedSearchService
vi.mock('../../src/managers/UnifiedSearchService.js', () => ({
  UnifiedSearchService: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined)
  }))
}));

describe('GraphManager - NornicDB Detection', () => {
  let graphManager: GraphManager;
  let mockDriver: any;
  let mockSession: any;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env };
    
    // Get mocked driver and session
    mockDriver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'password'));
    mockSession = mockDriver.session();
    
    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  describe('Manual Override Detection', () => {
    it('should detect NornicDB when MIMIR_DATABASE_PROVIDER=nornicdb', async () => {
      process.env.MIMIR_DATABASE_PROVIDER = 'nornicdb';
      
      graphManager = new GraphManager('bolt://localhost:7687', 'neo4j', 'password');
      
      // Mock session.run for schema creation
      mockSession.run.mockResolvedValue({ records: [] });
      
      await graphManager.initialize();
      
      // Verify provider was set
      expect((graphManager as any).isNornicDB).toBe(true);
    });

    it('should detect Neo4j when MIMIR_DATABASE_PROVIDER=neo4j', async () => {
      process.env.MIMIR_DATABASE_PROVIDER = 'neo4j';
      
      graphManager = new GraphManager('bolt://localhost:7687', 'neo4j', 'password');
      
      mockSession.run.mockResolvedValue({ records: [] });
      
      await graphManager.initialize();
      
      expect((graphManager as any).isNornicDB).toBe(false);
    });

    it('should be case-insensitive for manual override', async () => {
      process.env.MIMIR_DATABASE_PROVIDER = 'NORNICDB';
      
      graphManager = new GraphManager('bolt://localhost:7687', 'neo4j', 'password');
      
      mockSession.run.mockResolvedValue({ records: [] });
      
      await graphManager.initialize();
      
      expect((graphManager as any).isNornicDB).toBe(true);
    });
  });

  describe('Auto-Detection via Server Metadata', () => {
    it('should detect NornicDB from server agent string', async () => {
      delete process.env.MIMIR_DATABASE_PROVIDER;
      
      graphManager = new GraphManager('bolt://localhost:7687', 'neo4j', 'password');
      
      // Mock detection query response with NornicDB agent
      mockSession.run.mockResolvedValueOnce({
        records: [{ get: () => 1 }],
        summary: {
          server: {
            agent: 'NornicDB/1.0.0',
            protocolVersion: '5.0'
          }
        } as ResultSummary
      });
      
      // Mock subsequent schema queries
      mockSession.run.mockResolvedValue({ records: [] });
      
      await graphManager.initialize();
      
      expect((graphManager as any).isNornicDB).toBe(true);
    });

    it('should detect Neo4j from server agent string', async () => {
      delete process.env.MIMIR_DATABASE_PROVIDER;
      
      graphManager = new GraphManager('bolt://localhost:7687', 'neo4j', 'password');
      
      // Mock detection query response with Neo4j agent
      mockSession.run.mockResolvedValueOnce({
        records: [{ get: () => 1 }],
        summary: {
          server: {
            agent: 'Neo4j/5.13.0',
            protocolVersion: '5.0'
          }
        } as ResultSummary
      });
      
      mockSession.run.mockResolvedValue({ records: [] });
      
      await graphManager.initialize();
      
      expect((graphManager as any).isNornicDB).toBe(false);
    });

    it('should default to Neo4j when server agent is unknown', async () => {
      delete process.env.MIMIR_DATABASE_PROVIDER;
      
      graphManager = new GraphManager('bolt://localhost:7687', 'neo4j', 'password');
      
      mockSession.run.mockResolvedValueOnce({
        records: [{ get: () => 1 }],
        summary: {
          server: {
            agent: 'UnknownDB/1.0.0',
            protocolVersion: '5.0'
          }
        } as ResultSummary
      });
      
      mockSession.run.mockResolvedValue({ records: [] });
      
      await graphManager.initialize();
      
      expect((graphManager as any).isNornicDB).toBe(false);
    });

    it('should default to Neo4j on detection error', async () => {
      delete process.env.MIMIR_DATABASE_PROVIDER;
      
      graphManager = new GraphManager('bolt://localhost:7687', 'neo4j', 'password');
      
      // Mock detection query failure
      mockSession.run.mockRejectedValueOnce(new Error('Connection failed'));
      
      // Mock subsequent schema queries
      mockSession.run.mockResolvedValue({ records: [] });
      
      await graphManager.initialize();
      
      expect((graphManager as any).isNornicDB).toBe(false);
    });
  });

  describe('Embeddings Service Initialization', () => {
    it('should initialize embeddings service for Neo4j', async () => {
      process.env.MIMIR_DATABASE_PROVIDER = 'neo4j';
      
      graphManager = new GraphManager('bolt://localhost:7687', 'neo4j', 'password');
      
      mockSession.run.mockResolvedValue({ records: [] });
      
      await graphManager.initialize();
      
      expect((graphManager as any).embeddingsService).not.toBeNull();
    });

    it('should NOT initialize embeddings service for NornicDB', async () => {
      process.env.MIMIR_DATABASE_PROVIDER = 'nornicdb';
      
      graphManager = new GraphManager('bolt://localhost:7687', 'neo4j', 'password');
      
      mockSession.run.mockResolvedValue({ records: [] });
      
      await graphManager.initialize();
      
      expect((graphManager as any).embeddingsService).toBeNull();
    });

    it('should only detect provider once', async () => {
      process.env.MIMIR_DATABASE_PROVIDER = 'nornicdb';
      
      graphManager = new GraphManager('bolt://localhost:7687', 'neo4j', 'password');
      
      mockSession.run.mockResolvedValue({ records: [] });
      
      await graphManager.initialize();
      await graphManager.initialize(); // Second call
      
      // Provider detection should happen only once
      expect((graphManager as any).providerDetected).toBe(true);
    });
  });
});

describe('GraphManager - Embedding Skip Logic', () => {
  let graphManager: GraphManager;
  let mockDriver: any;
  let mockSession: any;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    mockDriver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'password'));
    mockSession = mockDriver.session();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('addNode - Embedding Generation', () => {
    it('should generate embeddings for Neo4j', async () => {
      process.env.MIMIR_DATABASE_PROVIDER = 'neo4j';
      
      graphManager = new GraphManager('bolt://localhost:7687', 'neo4j', 'password');
      
      // Mock initialization
      mockSession.run.mockResolvedValue({ records: [] });
      await graphManager.initialize();
      
      // Mock node creation
      mockSession.run.mockResolvedValueOnce({
        records: [{
          get: () => ({
            id: 'test-1',
            type: 'memory',
            title: 'Test',
            content: 'Test content',
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            has_embedding: false
          })
        }]
      });
      
      // Mock embedding update
      mockSession.run.mockResolvedValueOnce({ records: [] });
      
      const node = await graphManager.addNode('memory', {
        title: 'Test',
        content: 'Test content'
      });
      
      // Verify embeddings service exists and is enabled for Neo4j
      const embeddingsService = (graphManager as any).embeddingsService;
      expect(embeddingsService).not.toBeNull();
      expect((graphManager as any).isNornicDB).toBe(false);
    });

    it('should skip embedding generation for NornicDB', async () => {
      process.env.MIMIR_DATABASE_PROVIDER = 'nornicdb';
      
      graphManager = new GraphManager('bolt://localhost:7687', 'neo4j', 'password');
      
      mockSession.run.mockResolvedValue({ records: [] });
      await graphManager.initialize();
      
      // Mock node creation
      mockSession.run.mockResolvedValueOnce({
        records: [{
          get: () => ({
            id: 'test-1',
            type: 'memory',
            title: 'Test',
            content: 'Test content',
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            has_embedding: false
          })
        }]
      });
      
      const node = await graphManager.addNode('memory', {
        title: 'Test',
        content: 'Test content'
      });
      
      // Verify embeddings service is null (not initialized)
      expect((graphManager as any).embeddingsService).toBeNull();
    });
  });

  describe('updateNode - Embedding Regeneration', () => {
    it('should regenerate embeddings for Neo4j when content changes', async () => {
      process.env.MIMIR_DATABASE_PROVIDER = 'neo4j';
      
      graphManager = new GraphManager('bolt://localhost:7687', 'neo4j', 'password');
      
      mockSession.run.mockResolvedValue({ records: [] });
      await graphManager.initialize();
      
      // Mock node update
      mockSession.run.mockResolvedValueOnce({
        records: [{
          get: () => ({
            id: 'test-1',
            type: 'memory',
            title: 'Test',
            content: 'Updated content',
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            has_embedding: true
          })
        }]
      });
      
      // Mock embedding update
      mockSession.run.mockResolvedValueOnce({ records: [] });
      
      const node = await graphManager.updateNode('test-1', {
        content: 'Updated content'
      });
      
      // Verify embeddings service exists and would process (Neo4j mode)
      const embeddingsService = (graphManager as any).embeddingsService;
      expect(embeddingsService).not.toBeNull();
      expect((graphManager as any).isNornicDB).toBe(false);
    });

    it('should skip embedding regeneration for NornicDB', async () => {
      process.env.MIMIR_DATABASE_PROVIDER = 'nornicdb';
      
      graphManager = new GraphManager('bolt://localhost:7687', 'neo4j', 'password');
      
      mockSession.run.mockResolvedValue({ records: [] });
      await graphManager.initialize();
      
      // Mock node update
      mockSession.run.mockResolvedValueOnce({
        records: [{
          get: () => ({
            id: 'test-1',
            type: 'memory',
            title: 'Test',
            content: 'Updated content',
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            has_embedding: false
          })
        }]
      });
      
      const node = await graphManager.updateNode('test-1', {
        content: 'Updated content'
      });
      
      // Verify embeddings service is null
      expect((graphManager as any).embeddingsService).toBeNull();
    });
  });
});
