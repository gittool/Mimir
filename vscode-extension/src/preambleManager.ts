import type { Preamble } from './types';

/**
 * Manages preamble fetching, caching, and lifecycle
 */
export class PreambleManager {
  private cache: Map<string, string> = new Map();
  private availablePreambles: Preamble[] = [];
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Update base URL if Mimir server location changes
   */
  updateBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl;
    // Clear cache when URL changes as preambles might be different
    this.cache.clear();
  }

  /**
   * Fetch list of available preambles from Mimir
   */
  async loadAvailablePreambles(): Promise<Preamble[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/preambles`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as { preambles?: Preamble[] };
      this.availablePreambles = data.preambles || [];
      
      console.log(`✅ Loaded ${this.availablePreambles.length} preambles from Mimir`);
      return this.availablePreambles;
    } catch (error) {
      console.error('Failed to load available preambles:', error);
      return [];
    }
  }

  /**
   * Get list of currently loaded preambles
   */
  getAvailablePreambles(): Preamble[] {
    return this.availablePreambles;
  }

  /**
   * Fetch preamble content by name (with caching)
   */
  async fetchPreambleContent(preambleName: string): Promise<string> {
    // Check cache first
    const cached = this.cache.get(preambleName);
    if (cached) {
      console.log(`📦 Using cached preamble: ${preambleName}`);
      return cached;
    }

    try {
      console.log(`🌐 Fetching preamble from server: ${preambleName}`);
      const response = await fetch(`${this.baseUrl}/api/preambles/${preambleName}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const content = await response.text();
      
      // Cache for future use
      this.cache.set(preambleName, content);
      console.log(`✅ Fetched and cached preamble: ${preambleName} (${content.length} chars)`);
      
      return content;
    } catch (error) {
      console.error(`Failed to fetch preamble '${preambleName}':`, error);
      throw new Error(`Could not load preamble '${preambleName}'. Is Mimir server running at ${this.baseUrl}?`);
    }
  }

  /**
   * Clear preamble cache (useful after configuration changes)
   */
  clearCache(): void {
    this.cache.clear();
    console.log('🗑️  Cleared preamble cache');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}
