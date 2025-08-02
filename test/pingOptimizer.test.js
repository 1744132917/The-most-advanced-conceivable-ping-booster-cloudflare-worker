import { describe, it, expect, beforeEach } from 'vitest';
import { PingOptimizer } from '../src/optimizers/pingOptimizer.js';

describe('PingOptimizer', () => {
  let pingOptimizer;
  let mockConfig;

  beforeEach(() => {
    mockConfig = {
      MAX_CACHE_TTL: 86400,
      COMPRESSION_LEVEL: 6,
      ENABLE_HTTP3: true,
      ENABLE_EARLY_HINTS: true
    };
    pingOptimizer = new PingOptimizer(mockConfig);
  });

  describe('optimizeRequest', () => {
    it('should optimize request headers for better performance', async () => {
      const mockRequest = new Request('https://example.com/test', {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (very long user agent string here that should be compressed)'
        }
      });

      const context = {
        requestId: 'test-123',
        clientIP: '192.168.1.1',
        country: 'US',
        edgeColo: 'LAX'
      };

      const optimizedRequest = await pingOptimizer.optimizeRequest(
        mockRequest, 
        'https://target.example.com', 
        context
      );

      expect(optimizedRequest).toBeInstanceOf(Request);
      expect(optimizedRequest.headers.get('Connection')).toBe('keep-alive');
      expect(optimizedRequest.headers.get('Keep-Alive')).toBe('timeout=30, max=100');
      expect(optimizedRequest.headers.get('X-DNS-Prefetch-Control')).toBe('on');
    });
  });

  describe('applyTCPOptimizations', () => {
    it('should set TCP optimization headers', () => {
      const headers = new Headers();
      const context = { requestId: 'test-123' };

      pingOptimizer.applyTCPOptimizations(headers, context);

      expect(headers.get('TCP-Fast-Open')).toBe('1');
      expect(headers.get('TCP-Window-Scale')).toBe('14');
      expect(headers.get('TCP-Timestamps')).toBe('1');
      expect(headers.get('TCP-InitCwnd')).toBe('32');
      expect(headers.get('TCP-SACK')).toBe('1');
    });
  });

  describe('compressUserAgent', () => {
    it('should compress verbose user agent strings', () => {
      const verboseUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
      const compressed = pingOptimizer.compressUserAgent(verboseUA);
      
      expect(compressed.length).toBeLessThan(verboseUA.length);
      expect(compressed).not.toContain('Mozilla/');
      expect(compressed).not.toContain('(KHTML, like Gecko)');
    });
  });

  describe('getStats', () => {
    it('should return optimization statistics', () => {
      const stats = pingOptimizer.getStats();

      expect(stats).toHaveProperty('totalConnections');
      expect(stats).toHaveProperty('activeOrigins');
      expect(stats).toHaveProperty('strategies');
      expect(stats).toHaveProperty('connectionPools');
      expect(Array.isArray(stats.strategies)).toBe(true);
    });
  });
});