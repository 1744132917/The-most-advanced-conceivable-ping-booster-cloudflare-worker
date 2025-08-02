export class CacheManager {
  constructor(kvStore, config) {
    this.kvStore = kvStore;
    this.config = config;
    this.maxTTL = config.MAX_CACHE_TTL || 86400;
    this.cacheStrategies = {
      'text/html': { ttl: 3600, vary: ['Accept-Encoding', 'User-Agent'] },
      'text/css': { ttl: 86400, vary: ['Accept-Encoding'] },
      'application/javascript': { ttl: 86400, vary: ['Accept-Encoding'] },
      'application/json': { ttl: 1800, vary: ['Accept-Encoding'] },
      'image/': { ttl: 604800, vary: ['Accept'] }, // 7 days for images
      'font/': { ttl: 2592000, vary: [] }, // 30 days for fonts
      'default': { ttl: 3600, vary: ['Accept-Encoding'] }
    };
  }

  async get(url, context) {
    try {
      const cacheKey = this.generateCacheKey(url, context);
      const cachedData = await this.kvStore.get(cacheKey, 'json');

      if (!cachedData) {
        return null;
      }

      // Check if cache entry is expired
      if (Date.now() > cachedData.expiresAt) {
        // Asynchronously delete expired entry
        this.kvStore.delete(cacheKey);
        return null;
      }

      // Check if we should serve stale content
      const isStale = Date.now() > cachedData.freshUntil;
      if (isStale && cachedData.staleWhileRevalidate) {
        // Serve stale content but trigger background revalidation
        console.log(`Serving stale content for ${cacheKey}, triggering revalidation`);
        // In a real implementation, you'd trigger a background revalidation here
      }

      // Reconstruct response from cached data
      const response = new Response(cachedData.body, {
        status: cachedData.status,
        statusText: cachedData.statusText,
        headers: new Headers(cachedData.headers)
      });

      // Add cache metadata headers
      const headers = new Headers(response.headers);
      headers.set('X-Cache-Status', 'HIT');
      headers.set('X-Cache-Key', cacheKey);
      headers.set('X-Cache-Age', Math.floor((Date.now() - cachedData.cachedAt) / 1000).toString());
      headers.set('X-Cache-TTL', Math.floor((cachedData.expiresAt - Date.now()) / 1000).toString());

      if (isStale) {
        headers.set('X-Cache-Stale', 'true');
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });

    } catch (error) {
      console.error(`Cache get error for ${url}:`, error);
      return null;
    }
  }

  async set(url, response, context) {
    try {
      const contentType = response.headers.get('content-type') || 'default';
      const cacheStrategy = this.getCacheStrategy(contentType);

      // Don't cache if not cacheable
      if (!this.isCacheable(response, cacheStrategy)) {
        return false;
      }

      const cacheKey = this.generateCacheKey(url, context);
      const body = await response.arrayBuffer();
      const now = Date.now();

      // Calculate cache timing
      const ttl = this.calculateTTL(response, cacheStrategy);
      const expiresAt = now + (ttl * 1000);
      const maxAge = this.extractMaxAge(response) || ttl;
      const freshUntil = now + (maxAge * 1000);
      const staleWhileRevalidate = this.extractStaleWhileRevalidate(response);

      const cacheData = {
        url,
        body: Array.from(new Uint8Array(body)),
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        contentType,
        cachedAt: now,
        expiresAt,
        freshUntil,
        staleWhileRevalidate,
        cacheStrategy,
        context: {
          edgeColo: context.edgeColo,
          country: context.country,
          requestId: context.requestId
        }
      };

      // Store in KV with expiration
      await this.kvStore.put(cacheKey, JSON.stringify(cacheData), {
        expirationTtl: Math.min(ttl, this.maxTTL)
      });

      console.log(`Cached ${url} with key ${cacheKey} for ${ttl}s`);
      return true;

    } catch (error) {
      console.error(`Cache set error for ${url}:`, error);
      return false;
    }
  }

  generateCacheKey(url, context) {
    const urlObj = new URL(url);

    // Base key from normalized URL
    const baseKey = `${urlObj.pathname}${urlObj.search}`;

    // Add vary factors
    const varyFactors = [];

    // Include edge colo for geographic caching
    varyFactors.push(`colo:${context.edgeColo}`);

    // Include country for localized content
    varyFactors.push(`country:${context.country}`);

    // Include user agent category for device-specific caching
    const deviceType = this.categorizeUserAgent(context.userAgent);
    varyFactors.push(`device:${deviceType}`);

    // Combine factors
    const varyString = varyFactors.join('|');
    const hash = this.simpleHash(varyString);

    return `cache:${hash}:${encodeURIComponent(baseKey)}`;
  }

  getCacheStrategy(contentType) {
    // Find matching strategy
    for (const [type, strategy] of Object.entries(this.cacheStrategies)) {
      if (contentType.startsWith(type)) {
        return strategy;
      }
    }
    return this.cacheStrategies.default;
  }

  isCacheable(response, _strategy) {
    // Don't cache error responses
    if (!response.ok && response.status !== 404) {
      return false;
    }

    // Don't cache if explicitly marked as non-cacheable
    const cacheControl = response.headers.get('cache-control') || '';
    if (cacheControl.includes('no-cache') || cacheControl.includes('no-store')) {
      return false;
    }

    // Don't cache authenticated requests
    if (response.headers.get('authorization') || response.headers.get('set-cookie')) {
      return false;
    }

    // Check content length (don't cache very large responses)
    const contentLength = parseInt(response.headers.get('content-length') || '0');
    if (contentLength > 10 * 1024 * 1024) { // 10MB limit
      return false;
    }

    return true;
  }

  calculateTTL(response, strategy) {
    // Check for explicit cache-control max-age
    const cacheControl = response.headers.get('cache-control') || '';
    const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
    if (maxAgeMatch) {
      return Math.min(parseInt(maxAgeMatch[1]), this.maxTTL);
    }

    // Check for Expires header
    const expires = response.headers.get('expires');
    if (expires) {
      const expiresTime = new Date(expires).getTime();
      const ttl = Math.floor((expiresTime - Date.now()) / 1000);
      if (ttl > 0) {
        return Math.min(ttl, this.maxTTL);
      }
    }

    // Use strategy default
    return Math.min(strategy.ttl, this.maxTTL);
  }

  extractMaxAge(response) {
    const cacheControl = response.headers.get('cache-control') || '';
    const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
    return maxAgeMatch ? parseInt(maxAgeMatch[1]) : null;
  }

  extractStaleWhileRevalidate(response) {
    const cacheControl = response.headers.get('cache-control') || '';
    const staleMatch = cacheControl.match(/stale-while-revalidate=(\d+)/);
    return staleMatch ? parseInt(staleMatch[1]) : 0;
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

  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  // Purge cache entries
  async purge(pattern) {
    // This would require additional KV operations to list and delete
    // In a real implementation, you might maintain an index of cache keys
    console.log(`Cache purge requested for pattern: ${pattern}`);
  }

  // Get cache statistics
  async getStats() {
    try {
      // This is a simplified stats implementation
      // In reality, you'd track these metrics separately
      return {
        strategies: Object.keys(this.cacheStrategies).length,
        maxTTL: this.maxTTL,
        features: [
          'Geographic caching',
          'Device-specific caching',
          'Stale-while-revalidate',
          'Content-type optimization',
          'Cache purging'
        ]
      };
    } catch (error) {
      console.error('Error getting cache stats:', error);
      return { error: error.message };
    }
  }
}
