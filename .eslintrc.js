module.exports = {
  env: {
    browser: true,
    es2022: true,
    node: true,
    worker: true
  },
  extends: [
    'eslint:recommended'
  ],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module'
  },
  rules: {
    'no-console': 'off', // Allow console for logging in worker
    'no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }],
    'prefer-const': 'error',
    'no-var': 'error',
    'eqeqeq': ['error', 'always'],
    'curly': ['error', 'all'],
    'brace-style': ['error', '1tbs'],
    'indent': ['error', 2],
    'quotes': ['error', 'single'],
    'semi': ['error', 'always'],
    'comma-dangle': ['error', 'never'],
    'no-trailing-spaces': 'error',
    'eol-last': 'error'
  },
  globals: {
    'crypto': 'readonly',
    'AbortController': 'readonly',
    'AbortSignal': 'readonly',
    'Request': 'readonly',
    'Response': 'readonly',
    'Headers': 'readonly',
    'URL': 'readonly',
    'URLSearchParams': 'readonly',
    'CompressionStream': 'readonly',
    'DecompressionStream': 'readonly'
  }
};