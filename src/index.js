import { Router } from 'itty-router';
import { PingOptimizer } from './optimizers/pingOptimizer.js';
import { CacheManager } from './cache/cacheManager.js';
import { AnalyticsEngine } from './analytics/analyticsEngine.js';
import { HealthChecker } from './monitoring/healthChecker.js';
import { LoadBalancer } from './routing/loadBalancer.js';
import { CompressionOptimizer } from './optimizers/compressionOptimizer.js';

// Initialize router
const router = Router();

// Global configuration
const CONFIG = {
  MAX_CACHE_TTL: 86400, // 24 hours
  COMPRESSION_LEVEL: 6,
  ENABLE_HTTP3: true,
  ENABLE_EARLY_HINTS: true,
  MONITORING_INTERVAL: 30000, // 30 seconds
  FAILOVER_TIMEOUT: 5000, // 5 seconds
  ORIGINS: [
    'https://primary-server.example.com',
    'https://secondary-server.example.com',
    'https://tertiary-server.example.com'
  ]
};

// Initialize core components
let pingOptimizer, cacheManager, analyticsEngine, healthChecker, loadBalancer, compressionOptimizer;

// Main request handler
router.all('*', async (request, env, ctx) => {
  const startTime = Date.now();

  try {
    // Initialize components if not already done
    if (!pingOptimizer) {
      await initializeComponents(env, ctx);
    }

    // Extract request information
    const { url, method } = request;
    const requestUrl = new URL(url);
    const clientIP = request.headers.get('CF-Connecting-IP');
    const userAgent = request.headers.get('User-Agent');
    const country = request.cf?.country || 'Unknown';

    // Log incoming request
    console.log(`[${new Date().toISOString()}] ${method} ${requestUrl.pathname} from ${clientIP} (${country})`);

    // Create request context
    const requestContext = {
      clientIP,
      userAgent,
      country,
      edgeColo: request.cf?.colo || 'Unknown',
      requestId: crypto.randomUUID(),
      startTime
    };

    // Check if this is a health check or monitoring request
    if (requestUrl.pathname === '/health') {
      return await handleHealthCheck(env, requestContext);
    }

    if (requestUrl.pathname === '/metrics') {
      return await handleMetrics(env, requestContext);
    }

    if (requestUrl.pathname === '/ping-test') {
      return await handlePingTest(request, env, requestContext);
    }

    // Check cache first for GET requests
    if (method === 'GET') {
      const cachedResponse = await cacheManager.get(url, requestContext);
      if (cachedResponse) {
        await analyticsEngine.recordCacheHit(requestContext);
        return addOptimizationHeaders(cachedResponse, requestContext, true);
      }
    }

    // Get optimal backend server
    const targetOrigin = await loadBalancer.getOptimalOrigin(requestContext);

    // Apply ping optimizations
    const optimizedRequest = await pingOptimizer.optimizeRequest(request, targetOrigin, requestContext);

    // Forward request to backend
    const response = await fetchWithOptimizations(optimizedRequest, targetOrigin, env, requestContext);

    // Cache response if applicable
    if (method === 'GET' && response.ok) {
      ctx.waitUntil(cacheManager.set(url, response.clone(), requestContext));
    }

    // Apply compression if beneficial
    const compressedResponse = await compressionOptimizer.optimize(response, request, requestContext);

    // Add optimization headers and return
    const finalResponse = addOptimizationHeaders(compressedResponse, requestContext, false);

    // Record analytics
    const endTime = Date.now();
    ctx.waitUntil(analyticsEngine.recordRequest({
      ...requestContext,
      endTime,
      duration: endTime - startTime,
      status: finalResponse.status,
      cacheHit: false,
      targetOrigin
    }));

    return finalResponse;

  } catch (error) {
    console.error('Error in main handler:', error);

    // Record error in analytics
    const endTime = Date.now();
    if (typeof requestContext !== 'undefined' && analyticsEngine) {
      ctx.waitUntil(analyticsEngine.recordError({
        requestId: requestContext.requestId || crypto.randomUUID(),
        endTime,
        duration: endTime - startTime,
        error: error.message,
        country: requestContext.country || 'unknown',
        edgeColo: requestContext.edgeColo || 'unknown'
      }));
    }

    return new Response('Internal Server Error', {
      status: 500,
      headers: {
        'X-Error-ID': typeof requestContext !== 'undefined' ? requestContext.requestId : crypto.randomUUID(),
        'X-Ping-Booster': 'error'
      }
    });
  }
});

// Initialize all components
async function initializeComponents(env, ctx) {
  pingOptimizer = new PingOptimizer(CONFIG);
  cacheManager = new CacheManager(env.CACHE_STORE, CONFIG);
  analyticsEngine = new AnalyticsEngine(env.ANALYTICS_STORE, env.METRICS);
  healthChecker = new HealthChecker(CONFIG);
  loadBalancer = new LoadBalancer(CONFIG.ORIGINS, healthChecker);
  compressionOptimizer = new CompressionOptimizer(CONFIG);

  // Start background monitoring
  ctx.waitUntil(startBackgroundMonitoring(env, ctx));
}

// Enhanced fetch with multiple optimization layers
async function fetchWithOptimizations(request, origin, env, context) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.FAILOVER_TIMEOUT);

  try {
    // Apply TCP optimization hints
    const optimizedHeaders = new Headers(request.headers);
    optimizedHeaders.set('Connection', 'keep-alive');
    optimizedHeaders.set('Keep-Alive', 'timeout=30, max=100');

    // Enable HTTP/3 if supported
    if (CONFIG.ENABLE_HTTP3) {
      optimizedHeaders.set('Alt-Svc', 'h3=":443"; ma=86400');
    }

    // Add early hints for critical resources
    if (CONFIG.ENABLE_EARLY_HINTS) {
      optimizedHeaders.set('Link', '</css/critical.css>; rel=preload; as=style, </js/app.js>; rel=preload; as=script');
    }

    const optimizedRequest = new Request(origin + new URL(request.url).pathname + new URL(request.url).search, {
      method: request.method,
      headers: optimizedHeaders,
      body: request.body,
      signal: controller.signal
    });

    const response = await fetch(optimizedRequest, {
      cf: {
        // Enable all Cloudflare optimizations
        polish: 'webp',
        mirage: true,
        minify: {
          javascript: true,
          css: true,
          html: true
        },
        // Enable HTTP/2 and HTTP/3
        http2: true,
        http3: true,
        // Enable early hints
        earlyHints: true,
        // Optimize images
        image: {
          fit: 'scale-down',
          quality: 85,
          format: 'auto'
        }
      }
    });

    clearTimeout(timeoutId);
    return response;

  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      // Try failover origin
      console.log(`Request timeout, attempting failover for ${context.requestId}`);
      const failoverOrigin = await loadBalancer.getFailoverOrigin(origin, context);
      if (failoverOrigin !== origin) {
        return fetchWithOptimizations(request, failoverOrigin, env, context);
      }
    }

    throw error;
  }
}

// Add optimization headers to response
function addOptimizationHeaders(response, context, fromCache) {
  const headers = new Headers(response.headers);

  // Add ping booster headers
  headers.set('X-Ping-Booster', 'enabled');
  headers.set('X-Request-ID', context.requestId);
  headers.set('X-Edge-Colo', context.edgeColo);
  headers.set('X-Cache-Status', fromCache ? 'HIT' : 'MISS');
  headers.set('X-Response-Time', `${Date.now() - context.startTime}ms`);

  // Add performance hints
  headers.set('Server-Timing', `
    edge;dur=${Date.now() - context.startTime},
    cache;desc=${fromCache ? 'hit' : 'miss'}
  `.trim());

  // Enable browser optimizations
  if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  }

  // Add security headers
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

// Health check endpoint
async function handleHealthCheck(_env, context) {
  const healthStatus = await healthChecker.checkAllOrigins();

  return new Response(JSON.stringify({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    requestId: context.requestId,
    edgeColo: context.edgeColo,
    origins: healthStatus,
    version: '1.0.0'
  }), {
    headers: {
      'Content-Type': 'application/json',
      'X-Ping-Booster': 'health'
    }
  });
}

// Metrics endpoint
async function handleMetrics(_env, _context) {
  const metrics = await analyticsEngine.getMetrics();

  return new Response(JSON.stringify(metrics), {
    headers: {
      'Content-Type': 'application/json',
      'X-Ping-Booster': 'metrics'
    }
  });
}

// Ping test endpoint
async function handlePingTest(request, env, context) {
  const startTime = Date.now();
  const testResults = [];

  // Test all configured origins
  for (const origin of CONFIG.ORIGINS) {
    const pingStart = Date.now();
    try {
      const response = await fetch(origin + '/ping', {
        method: 'HEAD',
        signal: AbortSignal.timeout(CONFIG.FAILOVER_TIMEOUT)
      });

      testResults.push({
        origin,
        latency: Date.now() - pingStart,
        status: response.status,
        healthy: response.ok
      });
    } catch (error) {
      testResults.push({
        origin,
        latency: Date.now() - pingStart,
        status: 0,
        healthy: false,
        error: error.message
      });
    }
  }

  const totalTime = Date.now() - startTime;

  return new Response(JSON.stringify({
    testId: context.requestId,
    timestamp: new Date().toISOString(),
    edgeColo: context.edgeColo,
    clientCountry: context.country,
    totalTime,
    results: testResults,
    recommendation: testResults
      .filter(r => r.healthy)
      .sort((a, b) => a.latency - b.latency)[0]
  }), {
    headers: {
      'Content-Type': 'application/json',
      'X-Ping-Booster': 'ping-test'
    }
  });
}

// Background monitoring
async function startBackgroundMonitoring(_env, _ctx) {
  // This would typically be handled by Durable Objects or scheduled events
  console.log('Background monitoring started');
}

// Export the main handler
export default {
  async fetch(request, env, ctx) {
    return router.handle(request, env, ctx);
  }
};
