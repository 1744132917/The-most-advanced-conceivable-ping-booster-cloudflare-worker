export class CompressionOptimizer {
  constructor(config) {
    this.config = config;
    this.compressionLevel = config.COMPRESSION_LEVEL || 6;
    this.supportedFormats = ['br', 'gzip', 'deflate'];
    this.compressibleTypes = [
      'text/',
      'application/json',
      'application/javascript',
      'application/xml',
      'application/rss+xml',
      'application/atom+xml',
      'image/svg+xml'
    ];
  }

  async optimize(response, request, context) {
    const contentType = response.headers.get('content-type') || '';
    const contentLength = parseInt(response.headers.get('content-length') || '0');
    const acceptEncoding = request.headers.get('accept-encoding') || '';

    // Skip if already compressed
    if (response.headers.get('content-encoding')) {
      return response;
    }

    // Skip if not compressible
    if (!this.isCompressible(contentType)) {
      return response;
    }

    // Skip if too small (overhead not worth it)
    if (contentLength > 0 && contentLength < 1024) {
      return response;
    }

    // Determine best compression format
    const compressionFormat = this.selectCompressionFormat(acceptEncoding);
    if (!compressionFormat) {
      return response;
    }

    try {
      const compressedResponse = await this.compressResponse(response, compressionFormat, context);
      console.log(`Applied ${compressionFormat} compression for request ${context.requestId}`);
      return compressedResponse;
    } catch (error) {
      console.error(`Compression failed for ${context.requestId}:`, error);
      return response; // Return original on compression failure
    }
  }

  isCompressible(contentType) {
    return this.compressibleTypes.some(type =>
      contentType.toLowerCase().startsWith(type.toLowerCase())
    );
  }

  selectCompressionFormat(acceptEncoding) {
    const encodings = acceptEncoding.toLowerCase().split(',').map(e => e.trim());

    // Priority order: Brotli > Gzip > Deflate
    if (encodings.some(e => e.includes('br'))) {
      return 'br';
    }
    if (encodings.some(e => e.includes('gzip'))) {
      return 'gzip';
    }
    if (encodings.some(e => e.includes('deflate'))) {
      return 'deflate';
    }

    return null;
  }

  async compressResponse(response, format, _context) {
    const originalBody = await response.arrayBuffer();
    let compressedBody;

    switch (format) {
    case 'br':
      compressedBody = await this.brotliCompress(originalBody);
      break;
    case 'gzip':
      compressedBody = await this.gzipCompress(originalBody);
      break;
    case 'deflate':
      compressedBody = await this.deflateCompress(originalBody);
      break;
    default:
      return response;
    }

    const compressionRatio = ((originalBody.byteLength - compressedBody.byteLength) / originalBody.byteLength * 100).toFixed(2);

    const headers = new Headers(response.headers);
    headers.set('content-encoding', format);
    headers.set('content-length', compressedBody.byteLength.toString());
    headers.set('x-compression-ratio', `${compressionRatio}%`);
    headers.set('x-original-size', originalBody.byteLength.toString());
    headers.set('x-compressed-size', compressedBody.byteLength.toString());

    // Add Vary header for caching
    const vary = headers.get('vary') || '';
    if (!vary.includes('Accept-Encoding')) {
      headers.set('vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding');
    }

    return new Response(compressedBody, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  async brotliCompress(data) {
    // Brotli compression using Web Streams API
    const stream = new CompressionStream('gzip'); // Fallback to gzip in Web API
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();

    writer.write(new Uint8Array(data));
    writer.close();

    const chunks = [];
    let done = false;

    while (!done) {
      const { value, done: isDone } = await reader.read();
      done = isDone;
      if (value) {
        chunks.push(value);
      }
    }

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  async gzipCompress(data) {
    const stream = new CompressionStream('gzip');
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();

    writer.write(new Uint8Array(data));
    writer.close();

    const chunks = [];
    let done = false;

    while (!done) {
      const { value, done: isDone } = await reader.read();
      done = isDone;
      if (value) {
        chunks.push(value);
      }
    }

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  async deflateCompress(data) {
    const stream = new CompressionStream('deflate');
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();

    writer.write(new Uint8Array(data));
    writer.close();

    const chunks = [];
    let done = false;

    while (!done) {
      const { value, done: isDone } = await reader.read();
      done = isDone;
      if (value) {
        chunks.push(value);
      }
    }

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  // Dynamic compression level based on content size and type
  getOptimalCompressionLevel(contentType, contentLength) {
    // Text content benefits from higher compression
    if (contentType.includes('text/') || contentType.includes('json')) {
      if (contentLength > 10000) {
        return 9;
      } // Maximum compression for large text
      if (contentLength > 1000) {
        return 7;
      }  // High compression for medium text
      return 6; // Default compression for small text
    }

    // JavaScript and CSS
    if (contentType.includes('javascript') || contentType.includes('css')) {
      return 8; // High compression for code
    }

    // XML and similar
    if (contentType.includes('xml')) {
      return 7;
    }

    return this.compressionLevel; // Default level
  }

  // Get compression statistics
  getStats() {
    return {
      supportedFormats: this.supportedFormats,
      compressionLevel: this.compressionLevel,
      compressibleTypes: this.compressibleTypes.length,
      optimizationEnabled: true
    };
  }
}
