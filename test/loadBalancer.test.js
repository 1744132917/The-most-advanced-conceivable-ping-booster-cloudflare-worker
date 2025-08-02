import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LoadBalancer } from '../src/routing/loadBalancer.js';

// Mock HealthChecker
class MockHealthChecker {
  constructor() {
    this.healthyOrigins = new Set();
  }

  isOriginHealthy(origin) {
    return this.healthyOrigins.has(origin);
  }

  getOriginsByHealth() {
    return Array.from(this.healthyOrigins).map(origin => ({
      origin,
      healthScore: 85,
      status: 'good'
    }));
  }

  setHealthy(origin, healthy = true) {
    if (healthy) {
      this.healthyOrigins.add(origin);
    } else {
      this.healthyOrigins.delete(origin);
    }
  }
}

describe('LoadBalancer', () => {
  let loadBalancer;
  let mockHealthChecker;
  let mockOrigins;

  beforeEach(() => {
    mockOrigins = [
      'https://origin1.example.com',
      'https://origin2.example.com',
      'https://origin3.example.com'
    ];
    mockHealthChecker = new MockHealthChecker();
    loadBalancer = new LoadBalancer(mockOrigins, mockHealthChecker);

    // Set all origins as healthy by default
    mockOrigins.forEach(origin => mockHealthChecker.setHealthy(origin));
  });

  describe('getOptimalOrigin', () => {
    it('should return a healthy origin', async () => {
      const context = {
        edgeColo: 'LAX',
        country: 'US',
        userAgent: 'Mozilla/5.0'
      };

      const origin = await loadBalancer.getOptimalOrigin(context);
      expect(mockOrigins).toContain(origin);
    });

    it('should fallback to first origin when no origins are healthy', async () => {
      // Make all origins unhealthy
      mockOrigins.forEach(origin => mockHealthChecker.setHealthy(origin, false));

      const context = { edgeColo: 'LAX', country: 'US' };
      const origin = await loadBalancer.getOptimalOrigin(context);
      
      expect(origin).toBe(mockOrigins[0]);
    });
  });

  describe('roundRobin', () => {
    it('should rotate through origins', () => {
      const origins = mockOrigins.slice(0, 2); // Use first 2 origins
      
      const first = loadBalancer.roundRobin(origins);
      const second = loadBalancer.roundRobin(origins);
      const third = loadBalancer.roundRobin(origins);
      
      expect(first).toBe(origins[0]);
      expect(second).toBe(origins[1]);
      expect(third).toBe(origins[0]); // Should wrap around
    });
  });

  describe('leastConnections', () => {
    it('should select origin with fewest connections', () => {
      const origins = mockOrigins.slice(0, 2);
      
      // Manually set connection counts
      loadBalancer.connectionCounts.set(origins[0], 5);
      loadBalancer.connectionCounts.set(origins[1], 2);
      
      const selected = loadBalancer.leastConnections(origins);
      expect(selected).toBe(origins[1]); // Should pick the one with 2 connections
    });
  });

  describe('geographic', () => {
    it('should prefer geographic mapping when available', () => {
      const context = { edgeColo: 'LAX', country: 'US' };
      
      // Add geographic mapping
      loadBalancer.addGeographicMapping('LAX', mockOrigins[1]);
      
      const selected = loadBalancer.geographic(mockOrigins, context);
      expect(selected).toBe(mockOrigins[1]);
    });
  });

  describe('getFailoverOrigin', () => {
    it('should return alternative origin when one fails', async () => {
      const failedOrigin = mockOrigins[0];
      const context = { edgeColo: 'LAX', country: 'US' };
      
      const failoverOrigin = await loadBalancer.getFailoverOrigin(failedOrigin, context);
      
      expect(failoverOrigin).not.toBe(failedOrigin);
      expect(mockOrigins).toContain(failoverOrigin);
    });
  });

  describe('recordLatency', () => {
    it('should record and calculate average latency', () => {
      const origin = mockOrigins[0];
      
      loadBalancer.recordLatency(origin, 100);
      loadBalancer.recordLatency(origin, 200);
      loadBalancer.recordLatency(origin, 300);
      
      const avgLatency = loadBalancer.getAverageLatency(origin);
      expect(avgLatency).toBe(200); // (100 + 200 + 300) / 3
    });
  });

  describe('setAlgorithm', () => {
    it('should change load balancing algorithm', () => {
      loadBalancer.setAlgorithm('round_robin');
      expect(loadBalancer.currentAlgorithm).toBe('round_robin');
    });

    it('should throw error for invalid algorithm', () => {
      expect(() => {
        loadBalancer.setAlgorithm('invalid_algorithm');
      }).toThrow('Invalid algorithm');
    });
  });

  describe('getStats', () => {
    it('should return comprehensive statistics', () => {
      const stats = loadBalancer.getStats();
      
      expect(stats).toHaveProperty('algorithm');
      expect(stats).toHaveProperty('origins');
      expect(stats).toHaveProperty('healthyOrigins');
      expect(stats).toHaveProperty('totalConnections');
      expect(stats).toHaveProperty('averageLatencies');
      expect(stats).toHaveProperty('weights');
      expect(stats).toHaveProperty('connectionCounts');
      
      expect(stats.origins).toBe(mockOrigins.length);
      expect(stats.healthyOrigins).toBe(mockOrigins.length);
    });
  });
});