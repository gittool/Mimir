import { describe, it, expect } from 'vitest';
import { generateContentHash, generateChunkId, generateFileId } from './FileIndexer.js';

describe('generateContentHash', () => {
  it('should generate a 16-character hex hash', () => {
    const hash = generateContentHash('test content');
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });

  it('should generate deterministic hashes for same content', () => {
    const hash1 = generateContentHash('test content');
    const hash2 = generateContentHash('test content');
    expect(hash1).toBe(hash2);
  });

  it('should generate different hashes for different content', () => {
    const hash1 = generateContentHash('content A');
    const hash2 = generateContentHash('content B');
    expect(hash1).not.toBe(hash2);
  });

  it('should prepend prefix when provided', () => {
    const hash = generateContentHash('test', 'prefix');
    expect(hash).toMatch(/^prefix-[a-f0-9]{16}$/);
  });

  it('should not add prefix separator when prefix is empty', () => {
    const hash = generateContentHash('test', '');
    expect(hash).toHaveLength(16);
    expect(hash).not.toContain('-');
  });

  it('should handle empty content', () => {
    const hash = generateContentHash('');
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });

  it('should handle unicode content', () => {
    const hash = generateContentHash('日本語テスト 🚀');
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });

  it('should handle very long content', () => {
    const longContent = 'a'.repeat(100000);
    const hash = generateContentHash(longContent);
    expect(hash).toHaveLength(16);
  });
});

describe('generateChunkId', () => {
  it('should generate a properly formatted chunk ID', () => {
    const id = generateChunkId('/path/to/file.md', 0, 'chunk text');
    expect(id).toMatch(/^chunk-[a-f0-9]+-0-[a-f0-9]+$/);
  });

  it('should include chunk index in the ID', () => {
    const id0 = generateChunkId('/path/to/file.md', 0, 'same text');
    const id5 = generateChunkId('/path/to/file.md', 5, 'same text');
    
    expect(id0).toContain('-0-');
    expect(id5).toContain('-5-');
  });

  it('should generate different IDs for different file paths', () => {
    const id1 = generateChunkId('/path/a.md', 0, 'same text');
    const id2 = generateChunkId('/path/b.md', 0, 'same text');
    expect(id1).not.toBe(id2);
  });

  it('should generate different IDs for different chunk content', () => {
    const id1 = generateChunkId('/path/file.md', 0, 'text A');
    const id2 = generateChunkId('/path/file.md', 0, 'text B');
    expect(id1).not.toBe(id2);
  });

  it('should generate same ID for identical inputs', () => {
    const id1 = generateChunkId('/path/file.md', 3, 'chunk content');
    const id2 = generateChunkId('/path/file.md', 3, 'chunk content');
    expect(id1).toBe(id2);
  });

  it('should handle special characters in file path', () => {
    const id = generateChunkId('/path/with spaces/and-dashes/file.md', 0, 'text');
    expect(id).toMatch(/^chunk-[a-f0-9]+-0-[a-f0-9]+$/);
  });

  it('should handle empty chunk text', () => {
    const id = generateChunkId('/path/file.md', 0, '');
    expect(id).toMatch(/^chunk-[a-f0-9]+-0-[a-f0-9]+$/);
  });

  it('should handle large chunk index', () => {
    const id = generateChunkId('/path/file.md', 99999, 'text');
    expect(id).toContain('-99999-');
  });
});

describe('generateFileId', () => {
  it('should generate a properly formatted file ID', () => {
    const id = generateFileId('/path/to/file.md');
    expect(id).toMatch(/^file-[a-f0-9]{16}$/);
  });

  it('should generate deterministic IDs for same path', () => {
    const id1 = generateFileId('/path/to/file.md');
    const id2 = generateFileId('/path/to/file.md');
    expect(id1).toBe(id2);
  });

  it('should generate different IDs for different paths', () => {
    const id1 = generateFileId('/path/a.md');
    const id2 = generateFileId('/path/b.md');
    expect(id1).not.toBe(id2);
  });

  it('should handle relative paths', () => {
    const id = generateFileId('relative/path/file.md');
    expect(id).toMatch(/^file-[a-f0-9]{16}$/);
  });

  it('should handle Windows-style paths', () => {
    const id = generateFileId('C:\\Users\\test\\file.md');
    expect(id).toMatch(/^file-[a-f0-9]{16}$/);
  });

  it('should treat different path formats as different', () => {
    const id1 = generateFileId('/path/file.md');
    const id2 = generateFileId('/path/file.md/');
    expect(id1).not.toBe(id2);
  });
});

describe('ID Generation - Idempotency', () => {
  it('should allow re-indexing same file without conflicts', () => {
    // Simulate re-indexing the same file
    const filePath = '/project/src/index.ts';
    const chunkTexts = [
      'function main() {',
      '  console.log("hello");',
      '}',
    ];

    // First indexing
    const firstIndexIds = chunkTexts.map((text, i) => 
      generateChunkId(filePath, i, text)
    );

    // Second indexing (same content)
    const secondIndexIds = chunkTexts.map((text, i) => 
      generateChunkId(filePath, i, text)
    );

    // IDs should be identical
    expect(firstIndexIds).toEqual(secondIndexIds);
  });

  it('should detect content changes on re-index', () => {
    const filePath = '/project/src/index.ts';
    
    // Original content
    const originalId = generateChunkId(filePath, 0, 'original content');
    
    // Modified content
    const modifiedId = generateChunkId(filePath, 0, 'modified content');
    
    // IDs should differ
    expect(originalId).not.toBe(modifiedId);
  });

  it('should preserve file identity across re-indexes', () => {
    const filePath = '/project/README.md';
    
    const id1 = generateFileId(filePath);
    const id2 = generateFileId(filePath);
    const id3 = generateFileId(filePath);
    
    expect(id1).toBe(id2);
    expect(id2).toBe(id3);
  });
});

describe('ID Generation - Edge Cases', () => {
  it('should handle very long file paths', () => {
    const longPath = '/'.repeat(50) + 'a'.repeat(200) + '/file.md';
    const id = generateFileId(longPath);
    expect(id).toMatch(/^file-[a-f0-9]{16}$/);
  });

  it('should handle file paths with unusual characters', () => {
    const paths = [
      '/path/with spaces/file.md',
      '/path/with-dashes/file.md',
      '/path/with_underscores/file.md',
      '/path/with.dots/file.md',
      '/path/with@symbol/file.md',
      '/path/with#hash/file.md',
    ];

    for (const path of paths) {
      const id = generateFileId(path);
      expect(id).toMatch(/^file-[a-f0-9]{16}$/);
    }
  });

  it('should handle chunk text with newlines and special characters', () => {
    const chunkText = `
      function test() {
        return "Hello\nWorld";
      }
    `;
    const id = generateChunkId('/file.ts', 0, chunkText);
    expect(id).toMatch(/^chunk-[a-f0-9]+-0-[a-f0-9]+$/);
  });
});
