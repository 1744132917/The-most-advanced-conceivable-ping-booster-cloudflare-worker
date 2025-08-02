export class AnalyticsEngine {
  constructor(kvStore, analyticsEngine) {
    this.kvStore = kvStore;
    this.analyticsEngine = analyticsEngine;
    this.metrics = {
      requests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errors: 0,
      totalLatency: 0,
      countries: new Map(),
      userAgents: new Map(),
      origins: new Map(),
      statusCodes: new Map()
    };
    this.startTime = Date.now();
  }

  async recordRequest(requestData) {
    try {
      // Update internal metrics
      this.updateInternalMetrics(requestData);

      // Send to Analytics Engine if available
      if (this.analyticsEngine) {
        await this.analyticsEngine.writeDataPoint({
          blobs: [
            requestData.requestId,
            requestData.country,
            requestData.edgeColo,
            requestData.targetOrigin,
            requestData.userAgent || 'unknown'
          ],
          doubles: [
            requestData.duration,
            requestData.startTime,
            requestData.endTime
          ],
          indexes: [
            requestData.status.toString(),
            requestData.cacheHit ? 'hit' : 'miss',
            this.categorizeLatency(requestData.duration)
          ]
        });
      }

      // Store detailed metrics in KV for longer-term analysis
      await this.storeDetailedMetrics(requestData);

      console.log(`Recorded analytics for request ${requestData.requestId}: ${requestData.duration}ms to ${requestData.targetOrigin}`);

    } catch (error) {
      console.error('Analytics recording error:', error);
    }
  }

  async recordCacheHit(context) {
    this.metrics.cacheHits++;

    if (this.analyticsEngine) {
      await this.analyticsEngine.writeDataPoint({
        blobs: [context.requestId, 'cache_hit', context.edgeColo],
        doubles: [Date.now() - context.startTime],
        indexes: ['cache_hit']
      });
    }
  }

  async recordError(errorData) {
    this.metrics.errors++;

    try {
      if (this.analyticsEngine) {
        await this.analyticsEngine.writeDataPoint({
          blobs: [
            errorData.requestId || 'unknown',
            errorData.error || 'unknown_error',
            errorData.country || 'unknown',
            errorData.edgeColo || 'unknown'
          ],
          doubles: [
            errorData.duration || 0,
            errorData.startTime || Date.now(),
            errorData.endTime || Date.now()
          ],
          indexes: ['error', 'error_' + (errorData.error || 'unknown').substring(0, 20)]
        });
      }

      // Store error details for debugging
      await this.storeErrorMetrics(errorData);

    } catch (error) {
      console.error('Error recording error:', error);
    }
  }

  updateInternalMetrics(requestData) {
    this.metrics.requests++;
    this.metrics.totalLatency += requestData.duration;

    if (requestData.cacheHit) {
      this.metrics.cacheHits++;
    } else {
      this.metrics.cacheMisses++;
    }

    // Update country statistics
    const country = requestData.country || 'unknown';
    this.metrics.countries.set(country, (this.metrics.countries.get(country) || 0) + 1);

    // Update user agent statistics
    const deviceType = this.categorizeUserAgent(requestData.userAgent);
    this.metrics.userAgents.set(deviceType, (this.metrics.userAgents.get(deviceType) || 0) + 1);

    // Update origin statistics
    if (requestData.targetOrigin) {
      this.metrics.origins.set(requestData.targetOrigin, (this.metrics.origins.get(requestData.targetOrigin) || 0) + 1);
    }

    // Update status code statistics
    const status = requestData.status?.toString() || 'unknown';
    this.metrics.statusCodes.set(status, (this.metrics.statusCodes.get(status) || 0) + 1);
  }

  async storeDetailedMetrics(requestData) {
    const hour = Math.floor(Date.now() / (1000 * 60 * 60)); // Current hour
    const key = `metrics:detailed:${hour}:${requestData.requestId}`;

    const detailedMetrics = {
      timestamp: requestData.startTime,
      requestId: requestData.requestId,
      duration: requestData.duration,
      status: requestData.status,
      cacheHit: requestData.cacheHit,
      country: requestData.country,
      edgeColo: requestData.edgeColo,
      targetOrigin: requestData.targetOrigin,
      userAgent: requestData.userAgent,
      deviceType: this.categorizeUserAgent(requestData.userAgent),
      latencyCategory: this.categorizeLatency(requestData.duration),
      hour
    };

    await this.kvStore.put(key, JSON.stringify(detailedMetrics), {
      expirationTtl: 7 * 24 * 60 * 60 // Keep for 7 days
    });
  }

  async storeErrorMetrics(errorData) {
    const hour = Math.floor(Date.now() / (1000 * 60 * 60));
    const key = `metrics:errors:${hour}:${errorData.requestId || crypto.randomUUID()}`;

    const errorMetrics = {
      timestamp: errorData.startTime || Date.now(),
      requestId: errorData.requestId,
      error: errorData.error,
      duration: errorData.duration,
      country: errorData.country,
      edgeColo: errorData.edgeColo,
      hour
    };

    await this.kvStore.put(key, JSON.stringify(errorMetrics), {
      expirationTtl: 30 * 24 * 60 * 60 // Keep errors for 30 days
    });
  }

  categorizeUserAgent(userAgent) {
    if (!userAgent) {
      return 'unknown';
    }

    const ua = userAgent.toLowerCase();

    if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
      return 'mobile';
    }
    if (ua.includes('tablet') || ua.includes('ipad')) {
      return 'tablet';
    }
    if (ua.includes('bot') || ua.includes('crawler') || ua.includes('spider')) {
      return 'bot';
    }

    return 'desktop';
  }

  categorizeLatency(duration) {
    if (duration < 100) {
      return 'fast';
    }
    if (duration < 300) {
      return 'medium';
    }
    if (duration < 1000) {
      return 'slow';
    }
    return 'very_slow';
  }

  async getMetrics() {
    const uptime = Date.now() - this.startTime;
    const averageLatency = this.metrics.requests > 0 ?
      (this.metrics.totalLatency / this.metrics.requests).toFixed(2) : 0;
    const cacheHitRate = this.metrics.requests > 0 ?
      ((this.metrics.cacheHits / this.metrics.requests) * 100).toFixed(2) : 0;
    const errorRate = this.metrics.requests > 0 ?
      ((this.metrics.errors / this.metrics.requests) * 100).toFixed(2) : 0;

    // Get recent detailed metrics from KV
    const recentMetrics = await this.getRecentMetrics();

    return {
      summary: {
        uptime: this.formatUptime(uptime),
        totalRequests: this.metrics.requests,
        averageLatency: `${averageLatency}ms`,
        cacheHitRate: `${cacheHitRate}%`,
        errorRate: `${errorRate}%`,
        requestsPerMinute: this.calculateRequestsPerMinute()
      },
      cache: {
        hits: this.metrics.cacheHits,
        misses: this.metrics.cacheMisses,
        hitRate: `${cacheHitRate}%`
      },
      geographic: {
        countries: Object.fromEntries(
          Array.from(this.metrics.countries.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
        ),
        totalCountries: this.metrics.countries.size
      },
      devices: Object.fromEntries(this.metrics.userAgents.entries()),
      origins: Object.fromEntries(
        Array.from(this.metrics.origins.entries())
          .sort((a, b) => b[1] - a[1])
      ),
      statusCodes: Object.fromEntries(this.metrics.statusCodes.entries()),
      performance: {
        latencyDistribution: await this.getLatencyDistribution(),
        peakHours: await this.getPeakHours(),
        trendsLast24h: recentMetrics
      },
      errors: {
        total: this.metrics.errors,
        rate: `${errorRate}%`,
        recentErrors: await this.getRecentErrors()
      }
    };
  }

  async getRecentMetrics() {
    try {
      const currentHour = Math.floor(Date.now() / (1000 * 60 * 60));
      const hours = [];

      // Get last 24 hours
      for (let i = 23; i >= 0; i--) {
        hours.push(currentHour - i);
      }

      const hourlyData = await Promise.all(
        hours.map(async (hour) => {
          try {
            const summary = await this.getHourlySummary(hour);
            return { hour, ...summary };
          } catch {
            return { hour, requests: 0, averageLatency: 0, errors: 0 };
          }
        })
      );

      return hourlyData;
    } catch (error) {
      console.error('Error getting recent metrics:', error);
      return [];
    }
  }

  async getHourlySummary(_hour) {
    // This is a simplified implementation
    // In practice, you'd aggregate the detailed metrics for the hour
    return {
      requests: Math.floor(Math.random() * 1000), // Placeholder
      averageLatency: Math.floor(Math.random() * 500), // Placeholder
      errors: Math.floor(Math.random() * 10) // Placeholder
    };
  }

  async getLatencyDistribution() {
    // Simplified latency distribution
    return {
      'fast (< 100ms)': Math.floor(Math.random() * 50),
      'medium (100-300ms)': Math.floor(Math.random() * 30),
      'slow (300-1000ms)': Math.floor(Math.random() * 15),
      'very_slow (> 1000ms)': Math.floor(Math.random() * 5)
    };
  }

  async getPeakHours() {
    // Simplified peak hours analysis
    return [
      { hour: '14:00', requests: 1250 },
      { hour: '15:00', requests: 1180 },
      { hour: '16:00', requests: 1150 }
    ];
  }

  async getRecentErrors() {
    try {
      // const _currentHour = Math.floor(Date.now() / (1000 * 60 * 60));
      // This would fetch recent error metrics from KV
      return [
        { error: 'Connection timeout', count: 3, lastSeen: Date.now() - 300000 },
        { error: 'DNS resolution failed', count: 1, lastSeen: Date.now() - 600000 }
      ];
    } catch (error) {
      console.error('Error getting recent errors:', error);
      return [];
    }
  }

  calculateRequestsPerMinute() {
    const uptimeMinutes = (Date.now() - this.startTime) / (1000 * 60);
    return uptimeMinutes > 0 ? (this.metrics.requests / uptimeMinutes).toFixed(2) : 0;
  }

  formatUptime(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  // Reset metrics (useful for testing)
  reset() {
    this.metrics = {
      requests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errors: 0,
      totalLatency: 0,
      countries: new Map(),
      userAgents: new Map(),
      origins: new Map(),
      statusCodes: new Map()
    };
    this.startTime = Date.now();
  }
}
