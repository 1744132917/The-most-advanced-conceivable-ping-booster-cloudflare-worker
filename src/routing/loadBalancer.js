export class LoadBalancer {
  constructor(origins, healthChecker) {
    this.origins = origins || [];
    this.healthChecker = healthChecker;
    this.algorithms = {
      ROUND_ROBIN: 'round_robin',
      LEAST_CONNECTIONS: 'least_connections',
      WEIGHTED_ROUND_ROBIN: 'weighted_round_robin',
      LATENCY_BASED: 'latency_based',
      GEOGRAPHIC: 'geographic',
      HEALTH_SCORE: 'health_score'
    };

    this.currentAlgorithm = this.algorithms.HEALTH_SCORE;
    this.roundRobinIndex = 0;
    this.connectionCounts = new Map();
    this.latencyHistory = new Map();
    this.weights = new Map();
    this.geographicMapping = new Map();

    // Initialize default weights
    this.initializeWeights();
    this.initializeGeographicMapping();
  }

  initializeWeights() {
    this.origins.forEach((origin, _index) => {
      this.weights.set(origin, 1); // Default equal weights
      this.connectionCounts.set(origin, 0);
    });
  }

  initializeGeographicMapping() {
    // Map edge colos to preferred origins
    // This is a simplified example - in practice, you'd have more sophisticated mapping
    this.geographicMapping.set('LAX', this.origins[0]); // Los Angeles -> Primary
    this.geographicMapping.set('DFW', this.origins[1]); // Dallas -> Secondary
    this.geographicMapping.set('JFK', this.origins[0]); // New York -> Primary
    this.geographicMapping.set('LHR', this.origins[2]); // London -> Tertiary
    this.geographicMapping.set('NRT', this.origins[1]); // Tokyo -> Secondary
  }

  async getOptimalOrigin(context) {
    // Get healthy origins first
    const healthyOrigins = await this.getHealthyOrigins();

    if (healthyOrigins.length === 0) {
      console.warn('No healthy origins available, using fallback');
      return this.origins[0]; // Fallback to first origin
    }

    if (healthyOrigins.length === 1) {
      return healthyOrigins[0];
    }

    // Select based on current algorithm
    switch (this.currentAlgorithm) {
    case this.algorithms.ROUND_ROBIN:
      return this.roundRobin(healthyOrigins);

    case this.algorithms.LEAST_CONNECTIONS:
      return this.leastConnections(healthyOrigins);

    case this.algorithms.WEIGHTED_ROUND_ROBIN:
      return this.weightedRoundRobin(healthyOrigins);

    case this.algorithms.LATENCY_BASED:
      return await this.latencyBased(healthyOrigins, context);

    case this.algorithms.GEOGRAPHIC:
      return this.geographic(healthyOrigins, context);

    case this.algorithms.HEALTH_SCORE:
      return await this.healthScoreBased(healthyOrigins);

    default:
      return this.roundRobin(healthyOrigins);
    }
  }

  async getHealthyOrigins() {
    const healthyOrigins = [];

    for (const origin of this.origins) {
      if (this.healthChecker.isOriginHealthy(origin)) {
        healthyOrigins.push(origin);
      }
    }

    return healthyOrigins;
  }

  roundRobin(origins) {
    const origin = origins[this.roundRobinIndex % origins.length];
    this.roundRobinIndex++;

    console.log(`Round robin selected: ${origin} (index: ${this.roundRobinIndex - 1})`);
    return origin;
  }

  leastConnections(origins) {
    let selectedOrigin = origins[0];
    let minConnections = this.connectionCounts.get(selectedOrigin) || 0;

    for (const origin of origins) {
      const connections = this.connectionCounts.get(origin) || 0;
      if (connections < minConnections) {
        minConnections = connections;
        selectedOrigin = origin;
      }
    }

    // Increment connection count
    this.connectionCounts.set(selectedOrigin, minConnections + 1);

    console.log(`Least connections selected: ${selectedOrigin} (${minConnections + 1} connections)`);
    return selectedOrigin;
  }

  weightedRoundRobin(origins) {
    // Calculate total weight for available origins
    const totalWeight = origins.reduce((sum, origin) =>
      sum + (this.weights.get(origin) || 1), 0
    );

    // Generate random number
    const random = Math.random() * totalWeight;
    let currentWeight = 0;

    for (const origin of origins) {
      currentWeight += this.weights.get(origin) || 1;
      if (random <= currentWeight) {
        console.log(`Weighted round robin selected: ${origin} (weight: ${this.weights.get(origin)})`);
        return origin;
      }
    }

    // Fallback
    return origins[0];
  }

  async latencyBased(_origins, _context) {
    let bestOrigin = origins[0];
    let bestLatency = Infinity;

    for (const origin of origins) {
      const avgLatency = this.getAverageLatency(origin);
      if (avgLatency < bestLatency) {
        bestLatency = avgLatency;
        bestOrigin = origin;
      }
    }

    console.log(`Latency-based selected: ${bestOrigin} (avg: ${bestLatency}ms)`);
    return bestOrigin;
  }

  geographic(origins, context) {
    const edgeColo = context.edgeColo;
    const preferredOrigin = this.geographicMapping.get(edgeColo);

    if (preferredOrigin && origins.includes(preferredOrigin)) {
      console.log(`Geographic routing selected: ${preferredOrigin} for ${edgeColo}`);
      return preferredOrigin;
    }

    // Fallback to closest origin based on simple heuristics
    const fallback = this.selectClosestOrigin(origins, context);
    console.log(`Geographic fallback selected: ${fallback} for ${edgeColo}`);
    return fallback;
  }

  async healthScoreBased(origins) {
    const originsByHealth = this.healthChecker.getOriginsByHealth()
      .filter(item => origins.includes(item.origin));

    if (originsByHealth.length === 0) {
      return origins[0];
    }

    // Select based on health score with some randomization to avoid thundering herd
    const bestHealthScore = originsByHealth[0].healthScore;
    const topOrigins = originsByHealth.filter(item =>
      item.healthScore >= bestHealthScore * 0.9 // Within 90% of best score
    );

    const selectedOrigin = topOrigins[Math.floor(Math.random() * topOrigins.length)].origin;
    console.log(`Health score based selected: ${selectedOrigin} (score: ${bestHealthScore})`);
    return selectedOrigin;
  }

  selectClosestOrigin(_origins, _context) {
    // Simple geographic proximity heuristics
    const country = context.country?.toLowerCase() || '';
    const continent = this.getContinent(country);

    // Basic continent-to-origin mapping
    const continentMapping = {
      'north_america': this.origins[0],
      'europe': this.origins[2],
      'asia': this.origins[1],
      'default': this.origins[0]
    };

    const preferredOrigin = continentMapping[continent] || continentMapping.default;

    if (origins.includes(preferredOrigin)) {
      return preferredOrigin;
    }

    return origins[0]; // Ultimate fallback
  }

  getContinent(country) {
    const continentMap = {
      'us': 'north_america', 'ca': 'north_america', 'mx': 'north_america',
      'gb': 'europe', 'de': 'europe', 'fr': 'europe', 'it': 'europe', 'es': 'europe',
      'jp': 'asia', 'cn': 'asia', 'kr': 'asia', 'in': 'asia', 'sg': 'asia'
    };

    return continentMap[country] || 'default';
  }

  async getFailoverOrigin(failedOrigin, context) {
    // Get alternative origins (excluding the failed one)
    const alternativeOrigins = this.origins.filter(origin => origin !== failedOrigin);
    const healthyAlternatives = alternativeOrigins.filter(origin =>
      this.healthChecker.isOriginHealthy(origin)
    );

    if (healthyAlternatives.length === 0) {
      console.warn(`No healthy failover origins available for ${failedOrigin}`);
      return alternativeOrigins[0] || failedOrigin; // Last resort
    }

    // Use the same algorithm for failover selection
    const originalAlgorithm = this.currentAlgorithm;
    const failoverOrigin = await this.getOptimalOrigin({
      ...context,
      isFailover: true
    });

    console.log(`Failover from ${failedOrigin} to ${failoverOrigin}`);
    return failoverOrigin;
  }

  recordLatency(origin, latency) {
    if (!this.latencyHistory.has(origin)) {
      this.latencyHistory.set(origin, []);
    }

    const history = this.latencyHistory.get(origin);
    history.push({ latency, timestamp: Date.now() });

    // Keep only last 100 measurements
    if (history.length > 100) {
      history.splice(0, history.length - 100);
    }

    this.latencyHistory.set(origin, history);
  }

  getAverageLatency(origin) {
    const history = this.latencyHistory.get(origin) || [];
    if (history.length === 0) {
      return 1000;
    } // Default high latency for unknown origins

    // Calculate average from recent measurements (last 10 minutes)
    const cutoff = Date.now() - 10 * 60 * 1000;
    const recentMeasurements = history.filter(m => m.timestamp > cutoff);

    if (recentMeasurements.length === 0) {
      return 1000;
    }

    const average = recentMeasurements.reduce((sum, m) => sum + m.latency, 0) / recentMeasurements.length;
    return Math.round(average);
  }

  releaseConnection(origin) {
    const current = this.connectionCounts.get(origin) || 0;
    this.connectionCounts.set(origin, Math.max(0, current - 1));
  }

  setAlgorithm(algorithm) {
    if (Object.values(this.algorithms).includes(algorithm)) {
      this.currentAlgorithm = algorithm;
      console.log(`Load balancing algorithm changed to: ${algorithm}`);
    } else {
      throw new Error(`Invalid algorithm: ${algorithm}`);
    }
  }

  setWeight(origin, weight) {
    if (this.origins.includes(origin) && weight > 0) {
      this.weights.set(origin, weight);
      console.log(`Weight for ${origin} set to ${weight}`);
    } else {
      throw new Error(`Invalid origin or weight: ${origin}, ${weight}`);
    }
  }

  addGeographicMapping(edgeColo, origin) {
    if (this.origins.includes(origin)) {
      this.geographicMapping.set(edgeColo, origin);
      console.log(`Geographic mapping added: ${edgeColo} -> ${origin}`);
    } else {
      throw new Error(`Invalid origin: ${origin}`);
    }
  }

  getStats() {
    const stats = {
      algorithm: this.currentAlgorithm,
      origins: this.origins.length,
      healthyOrigins: 0,
      totalConnections: 0,
      averageLatencies: {},
      weights: Object.fromEntries(this.weights),
      connectionCounts: Object.fromEntries(this.connectionCounts),
      geographicMappings: Object.fromEntries(this.geographicMapping)
    };

    // Calculate healthy origins and total connections
    this.origins.forEach(origin => {
      if (this.healthChecker.isOriginHealthy(origin)) {
        stats.healthyOrigins++;
      }

      const connections = this.connectionCounts.get(origin) || 0;
      stats.totalConnections += connections;

      stats.averageLatencies[origin] = this.getAverageLatency(origin);
    });

    return stats;
  }

  // Get load balancer recommendations
  getRecommendations() {
    const recommendations = [];
    const stats = this.getStats();

    // Check for uneven load distribution
    if (stats.totalConnections > 0) {
      const avgConnections = stats.totalConnections / this.origins.length;
      const unbalanced = Object.entries(stats.connectionCounts).filter(([origin, connections]) =>
        Math.abs(connections - avgConnections) > avgConnections * 0.5
      );

      if (unbalanced.length > 0) {
        recommendations.push({
          type: 'load_imbalance',
          message: 'Consider adjusting weights or algorithm to improve load distribution',
          details: unbalanced
        });
      }
    }

    // Check for high latency origins
    const highLatencyOrigins = Object.entries(stats.averageLatencies).filter(([origin, latency]) =>
      latency > 1000
    );

    if (highLatencyOrigins.length > 0) {
      recommendations.push({
        type: 'high_latency',
        message: 'Some origins have high latency, consider reducing their weights',
        details: highLatencyOrigins
      });
    }

    // Check health status
    if (stats.healthyOrigins < this.origins.length) {
      recommendations.push({
        type: 'unhealthy_origins',
        message: `${this.origins.length - stats.healthyOrigins} origins are unhealthy`,
        details: { healthy: stats.healthyOrigins, total: this.origins.length }
      });
    }

    return recommendations;
  }
}
