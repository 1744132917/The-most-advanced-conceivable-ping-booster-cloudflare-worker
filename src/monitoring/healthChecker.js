export class HealthChecker {
  constructor(config) {
    this.config = config;
    this.healthCache = new Map();
    this.checkInterval = config.MONITORING_INTERVAL || 30000;
    this.timeout = config.FAILOVER_TIMEOUT || 5000;
    this.healthThresholds = {
      responseTime: 2000, // ms
      successRate: 0.95, // 95%
      errorThreshold: 0.1 // 10%
    };
    this.metrics = new Map();
  }

  async checkAllOrigins() {
    const results = new Map();
    const checkPromises = this.config.ORIGINS?.map(async (origin) => {
      const health = await this.checkOriginHealth(origin);
      results.set(origin, health);
      return { origin, health };
    }) || [];

    await Promise.allSettled(checkPromises);
    return Object.fromEntries(results);
  }

  async checkOriginHealth(origin) {
    const cacheKey = `health:${origin}`;
    const cached = this.healthCache.get(cacheKey);

    // Return cached result if recent
    if (cached && Date.now() - cached.timestamp < this.checkInterval / 2) {
      return cached.health;
    }

    const startTime = Date.now();
    const health = {
      healthy: false,
      responseTime: null,
      status: null,
      error: null,
      timestamp: startTime,
      checks: {
        connectivity: false,
        responseTime: false,
        statusCode: false,
        ssl: false
      }
    };

    try {
      // Perform multiple health checks
      const results = await Promise.allSettled([
        this.checkConnectivity(origin),
        this.checkResponseTime(origin),
        this.checkStatusCode(origin),
        this.checkSSL(origin)
      ]);

      // Process results
      health.checks.connectivity = results[0].status === 'fulfilled' && results[0].value;
      health.checks.responseTime = results[1].status === 'fulfilled' && results[1].value;
      health.checks.statusCode = results[2].status === 'fulfilled' && results[2].value;
      health.checks.ssl = results[3].status === 'fulfilled' && results[3].value;

      // Calculate overall health
      const passedChecks = Object.values(health.checks).filter(Boolean).length;
      health.healthy = passedChecks >= 3; // At least 3 out of 4 checks must pass

      // Get detailed metrics if available
      const metrics = this.getOriginMetrics(origin);
      if (metrics) {
        health.successRate = metrics.successRate;
        health.averageResponseTime = metrics.averageResponseTime;
        health.errorRate = metrics.errorRate;
        health.lastError = metrics.lastError;
      }

      console.log(`Health check for ${origin}: ${health.healthy ? 'HEALTHY' : 'UNHEALTHY'} (${passedChecks}/4 checks passed)`);

    } catch (error) {
      health.error = error.message;
      console.error(`Health check failed for ${origin}:`, error);
    }

    health.responseTime = Date.now() - startTime;

    // Cache the result
    this.healthCache.set(cacheKey, { health, timestamp: Date.now() });

    // Update metrics
    this.updateOriginMetrics(origin, health);

    return health;
  }

  async checkConnectivity(origin) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(origin + '/health', {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'User-Agent': 'PingBooster-HealthChecker/1.0'
        }
      });

      clearTimeout(timeoutId);
      return response.status < 500; // Accept any non-server error status
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Connection timeout');
      }
      throw error;
    }
  }

  async checkResponseTime(origin) {
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      await fetch(origin + '/ping', {
        method: 'HEAD',
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;
      return responseTime <= this.healthThresholds.responseTime;
    } catch (error) {
      return false;
    }
  }

  async checkStatusCode(origin) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(origin + '/status', {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      return response.ok; // Status 200-299
    } catch (error) {
      return false;
    }
  }

  async checkSSL(origin) {
    try {
      const url = new URL(origin);

      // Only check SSL for HTTPS origins
      if (url.protocol !== 'https:') {
        return true; // Skip SSL check for HTTP
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(origin, {
        method: 'HEAD',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // If we get here without SSL errors, certificate is valid
      return true;
    } catch (error) {
      // SSL-related errors typically throw during the request
      return false;
    }
  }

  updateOriginMetrics(origin, health) {
    if (!this.metrics.has(origin)) {
      this.metrics.set(origin, {
        totalChecks: 0,
        successfulChecks: 0,
        totalResponseTime: 0,
        errors: [],
        lastCheck: null,
        lastSuccess: null,
        lastError: null
      });
    }

    const metrics = this.metrics.get(origin);
    metrics.totalChecks++;
    metrics.lastCheck = Date.now();

    if (health.healthy) {
      metrics.successfulChecks++;
      metrics.lastSuccess = Date.now();
    } else {
      metrics.lastError = health.error || 'Health check failed';

      // Keep last 10 errors
      metrics.errors.push({
        timestamp: Date.now(),
        error: health.error,
        checks: health.checks
      });

      if (metrics.errors.length > 10) {
        metrics.errors = metrics.errors.slice(-10);
      }
    }

    if (health.responseTime) {
      metrics.totalResponseTime += health.responseTime;
    }

    // Calculate derived metrics
    metrics.successRate = metrics.successfulChecks / metrics.totalChecks;
    metrics.averageResponseTime = metrics.totalResponseTime / metrics.totalChecks;
    metrics.errorRate = 1 - metrics.successRate;

    this.metrics.set(origin, metrics);
  }

  getOriginMetrics(origin) {
    return this.metrics.get(origin) || null;
  }

  getAllMetrics() {
    const allMetrics = {};

    this.metrics.forEach((metrics, origin) => {
      allMetrics[origin] = {
        ...metrics,
        healthScore: this.calculateHealthScore(metrics),
        status: this.getOriginStatus(metrics)
      };
    });

    return allMetrics;
  }

  calculateHealthScore(metrics) {
    if (metrics.totalChecks === 0) {
      return 0;
    }

    const successWeight = 0.4;
    const responseTimeWeight = 0.3;
    const recentHealthWeight = 0.3;

    // Success rate score (0-100)
    const successScore = metrics.successRate * 100;

    // Response time score (0-100, inverted - lower is better)
    const avgResponseTime = metrics.averageResponseTime || 0;
    const responseScore = Math.max(0, 100 - (avgResponseTime / this.healthThresholds.responseTime) * 100);

    // Recent health score (based on last 5 checks)
    const recentErrors = metrics.errors.filter(e =>
      Date.now() - e.timestamp < this.checkInterval * 5
    ).length;
    const recentScore = Math.max(0, 100 - (recentErrors * 20));

    const healthScore = (
      successScore * successWeight +
      responseScore * responseTimeWeight +
      recentScore * recentHealthWeight
    );

    return Math.round(healthScore);
  }

  getOriginStatus(metrics) {
    const healthScore = this.calculateHealthScore(metrics);

    if (healthScore >= 90) {
      return 'excellent';
    }
    if (healthScore >= 75) {
      return 'good';
    }
    if (healthScore >= 50) {
      return 'fair';
    }
    if (healthScore >= 25) {
      return 'poor';
    }
    return 'critical';
  }

  // Get the healthiest origin
  getHealthiestOrigin() {
    let bestOrigin = null;
    let bestScore = -1;

    this.metrics.forEach((metrics, origin) => {
      const score = this.calculateHealthScore(metrics);
      if (score > bestScore) {
        bestScore = score;
        bestOrigin = origin;
      }
    });

    return bestOrigin;
  }

  // Get origins sorted by health
  getOriginsByHealth() {
    const origins = Array.from(this.metrics.entries()).map(([origin, metrics]) => ({
      origin,
      healthScore: this.calculateHealthScore(metrics),
      status: this.getOriginStatus(metrics),
      metrics
    }));

    return origins.sort((a, b) => b.healthScore - a.healthScore);
  }

  // Check if origin is healthy enough for traffic
  isOriginHealthy(origin) {
    const health = this.healthCache.get(`health:${origin}`);
    if (!health) {
      return false;
    }

    // Check if health data is recent
    if (Date.now() - health.timestamp > this.checkInterval * 2) {
      return false;
    }

    return health.health.healthy;
  }

  // Get summary statistics
  getSummary() {
    const totalOrigins = this.config.ORIGINS?.length || 0;
    const healthyOrigins = this.config.ORIGINS?.filter(origin =>
      this.isOriginHealthy(origin)
    ).length || 0;

    const allMetrics = this.getAllMetrics();
    const avgHealthScore = Object.values(allMetrics).reduce((sum, metrics) =>
      sum + metrics.healthScore, 0
    ) / Object.keys(allMetrics).length || 0;

    return {
      totalOrigins,
      healthyOrigins,
      unhealthyOrigins: totalOrigins - healthyOrigins,
      healthyPercentage: totalOrigins > 0 ? (healthyOrigins / totalOrigins * 100).toFixed(1) : 0,
      averageHealthScore: Math.round(avgHealthScore),
      lastCheckTime: Math.max(...Array.from(this.healthCache.values()).map(h => h.timestamp)) || null,
      nextCheckIn: this.checkInterval - (Date.now() % this.checkInterval)
    };
  }

  // Clean up old cache entries
  cleanup() {
    const now = Date.now();
    const maxAge = this.checkInterval * 5; // Keep cache for 5 intervals

    this.healthCache.forEach((cached, key) => {
      if (now - cached.timestamp > maxAge) {
        this.healthCache.delete(key);
      }
    });

    // Also clean old error records from metrics
    this.metrics.forEach((metrics, origin) => {
      metrics.errors = metrics.errors.filter(error =>
        now - error.timestamp < 24 * 60 * 60 * 1000 // Keep errors for 24 hours
      );
    });
  }
}
