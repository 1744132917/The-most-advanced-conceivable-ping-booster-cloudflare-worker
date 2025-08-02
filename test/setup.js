// Setup file for vitest tests
import { vi } from 'vitest';

// Mock global fetch if not available
global.fetch = vi.fn();

// Mock Request and Response if not available
global.Request = class Request {
  constructor(url, options = {}) {
    this.url = url;
    this.method = options.method || 'GET';
    this.headers = new Headers(options.headers || {});
    this.body = options.body || null;
  }
};

global.Response = class Response {
  constructor(body, options = {}) {
    this.body = body;
    this.status = options.status || 200;
    this.statusText = options.statusText || 'OK';
    this.headers = new Headers(options.headers || {});
    this.ok = this.status >= 200 && this.status < 300;
  }

  clone() {
    return new Response(this.body, {
      status: this.status,
      statusText: this.statusText,
      headers: this.headers
    });
  }

  async arrayBuffer() {
    return new ArrayBuffer(0);
  }

  async json() {
    return JSON.parse(this.body || '{}');
  }

  async text() {
    return this.body || '';
  }
};

global.Headers = class Headers extends Map {
  constructor(init) {
    super();
    if (init) {
      if (init instanceof Headers) {
        for (const [key, value] of init.entries()) {
          this.set(key, value);
        }
      } else if (Array.isArray(init)) {
        for (const [key, value] of init) {
          this.set(key, value);
        }
      } else if (typeof init === 'object') {
        for (const [key, value] of Object.entries(init)) {
          this.set(key, value);
        }
      }
    }
  }

  get(name) {
    return super.get(name.toLowerCase());
  }

  set(name, value) {
    return super.set(name.toLowerCase(), value);
  }

  has(name) {
    return super.has(name.toLowerCase());
  }

  delete(name) {
    return super.delete(name.toLowerCase());
  }

  entries() {
    return super.entries();
  }
};

// Mock URL if not available
if (typeof global.URL === 'undefined') {
  global.URL = class URL {
    constructor(url, base) {
      // Simple URL parsing for tests
      this.href = url;
      try {
        const parts = url.split('://');
        this.protocol = parts[0] + ':';
        const remaining = parts[1] || '';
        const hostPath = remaining.split('/');
        this.hostname = hostPath[0];
        this.pathname = '/' + hostPath.slice(1).join('/');
        this.search = '';
        this.hash = '';
        this.port = '';
      } catch (e) {
        this.protocol = 'https:';
        this.hostname = 'example.com';
        this.pathname = '/';
        this.search = '';
        this.hash = '';
        this.port = '';
      }
    }
  };
}

// Mock crypto if not available
if (!global.crypto) {
  global.crypto = {
    randomUUID: () => 'test-uuid-' + Math.random().toString(36).substr(2, 9)
  };
} else if (!global.crypto.randomUUID) {
  global.crypto.randomUUID = () => 'test-uuid-' + Math.random().toString(36).substr(2, 9);
}