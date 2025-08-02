# Example Configuration for Advanced Ping Booster Cloudflare Worker

## 1. Update wrangler.toml with your specific settings

```toml
name = "my-ping-booster"
main = "src/index.js"
compatibility_date = "2024-01-01"

# Update these with your actual KV namespace IDs
[[kv_namespaces]]
binding = "CACHE_STORE"
id = "your-cache-namespace-id"

[[kv_namespaces]]
binding = "ANALYTICS_STORE"
id = "your-analytics-namespace-id"

# Update origins with your actual backend servers
[vars]
ORIGINS = '["https://your-primary-server.com", "https://your-secondary-server.com"]'
MAX_CACHE_TTL = "86400"
COMPRESSION_LEVEL = "6"
ENABLE_HTTP3 = "true"
ENABLE_EARLY_HINTS = "true"
MONITORING_INTERVAL = "30000"
FAILOVER_TIMEOUT = "5000"
```

## 2. Update src/index.js CONFIG section

```javascript
const CONFIG = {
  MAX_CACHE_TTL: parseInt(env.MAX_CACHE_TTL) || 86400,
  COMPRESSION_LEVEL: parseInt(env.COMPRESSION_LEVEL) || 6,
  ENABLE_HTTP3: env.ENABLE_HTTP3 === 'true',
  ENABLE_EARLY_HINTS: env.ENABLE_EARLY_HINTS === 'true',
  MONITORING_INTERVAL: parseInt(env.MONITORING_INTERVAL) || 30000,
  FAILOVER_TIMEOUT: parseInt(env.FAILOVER_TIMEOUT) || 5000,
  ORIGINS: JSON.parse(env.ORIGINS || '["https://httpbin.org"]')
};
```

## 3. Deployment Steps

```bash
# Install dependencies
npm install

# Test locally
npm run dev

# Deploy to staging
npm run deploy:staging

# Deploy to production
npm run deploy:production
```

## 4. Testing Your Deployment

```bash
# Health check
curl https://your-worker.your-subdomain.workers.dev/health

# Performance metrics
curl https://your-worker.your-subdomain.workers.dev/metrics

# Ping test
curl https://your-worker.your-subdomain.workers.dev/ping-test
```

## 5. Monitoring Endpoints

- `/health` - Real-time health status of all origins
- `/metrics` - Comprehensive performance analytics
- `/ping-test` - Latency testing and routing recommendations

## 6. Load Balancing Configuration

The worker supports 6 load balancing algorithms:
- `health_score` (default) - Routes based on comprehensive health metrics
- `round_robin` - Simple rotation through healthy origins
- `least_connections` - Routes to origin with fewest connections
- `weighted_round_robin` - Probability-based with configurable weights
- `latency_based` - Routes to lowest latency origin
- `geographic` - Routes based on edge location proximity

## 7. Cache Configuration

The intelligent cache supports:
- Geographic distribution
- Device-specific caching
- Content-type aware TTL
- Stale-while-revalidate
- Compression ratio tracking

## 8. Security Features

Automatically includes:
- Security headers (X-Content-Type-Options, X-Frame-Options)
- SSL/TLS certificate validation
- Request sanitization
- DDoS protection through rate limiting

## 9. Performance Optimizations

Network Level:
- TCP Fast Open and window scaling
- DNS over HTTPS and prefetching
- HTTP/2 and HTTP/3 support
- Connection pooling optimization

Application Level:
- Dynamic compression with format selection
- Early hints for critical resources
- Header optimization and compression
- Protocol-specific optimizations

## 10. Analytics and Monitoring

Tracks:
- Request count and rates
- Latency percentiles (P50, P95, P99)
- Cache hit/miss ratios
- Geographic distribution
- Error rates and types
- Origin health scores

The worker provides enterprise-grade ping optimization with comprehensive monitoring and analytics capabilities.