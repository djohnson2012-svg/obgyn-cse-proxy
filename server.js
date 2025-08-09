const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3001;

// Allowed hostnames for the proxy
const ALLOWED_HOSTNAMES = [
  'localhost',
  '127.0.0.1',
  'obgyn-app.com',
  'staging.obgyn-app.com'
];

// Enable CORS for all routes
app.use(cors());

// Middleware to check hostname allowlist
function validateHostname(req, res, next) {
  const hostname = req.hostname || req.get('host')?.split(':')[0];
  
  if (!ALLOWED_HOSTNAMES.includes(hostname)) {
    console.warn(`Blocked request from unauthorized hostname: ${hostname}`);
    return res.status(403).json({ error: 'Forbidden: Hostname not allowed' });
  }
  
  next();
}

// Middleware to check API key header
function validateApiKey(req, res, next) {
  const apiKey = req.get('X-OBGYNRX-KEY');
  const expectedKey = process.env.OBGYNRX_PROXY_KEY;
  
  if (!expectedKey) {
    console.error('OBGYNRX_PROXY_KEY environment variable not set');
    return res.status(500).json({ error: 'Server configuration error' });
  }
  
  if (!apiKey) {
    console.warn('Missing X-OBGYNRX-KEY header');
    return res.status(401).json({ error: 'Unauthorized: Missing API key header' });
  }
  
  if (apiKey !== expectedKey) {
    console.warn('Invalid X-OBGYNRX-KEY header provided');
    return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
  }
  
  next();
}

// Apply security middleware to all routes except health check
app.use('/api', validateHostname, validateApiKey);
app.use('/search', validateHostname, validateApiKey);

// Proxy middleware configuration
const proxyOptions = {
  target: process.env.TARGET_URL || 'https://api.example.com',
  changeOrigin: true,
  pathRewrite: {
    '^/api': '', // Remove /api prefix when forwarding
  },
  onError: (err, req, res) => {
    console.error('Proxy error:', err);
    res.status(500).send('Proxy error occurred');
  },
  onProxyReq: (proxyReq, req, res) => {
    console.log(`Proxying request: ${req.method} ${req.url}`);
  },
};

// Apply proxy middleware to /api routes
app.use('/api', createProxyMiddleware(proxyOptions));

// Search endpoint implementation
app.get('/search', (req, res) => {
  const { q, limit = 10, offset = 0 } = req.query;
  
  if (!q) {
    return res.status(400).json({ error: 'Missing required query parameter: q' });
  }
  
  // Mock search implementation - replace with actual search logic
  const mockResults = {
    query: q,
    total: 42,
    limit: parseInt(limit),
    offset: parseInt(offset),
    results: [
      {
        id: 1,
        title: `Search result for "${q}"`,
        description: 'This is a mock search result for demonstration purposes.',
        url: 'https://example.com/result/1'
      },
      {
        id: 2,
        title: `Another result for "${q}"`,
        description: 'This is another mock search result.',
        url: 'https://example.com/result/2'
      }
    ]
  };
  
  console.log(`Search request: query="${q}", limit=${limit}, offset=${offset}`);
  res.json(mockResults);
});

// Health check endpoint (no authentication required)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
  console.log(`Proxying requests to: ${proxyOptions.target}`);
  console.log(`Allowed hostnames: ${ALLOWED_HOSTNAMES.join(', ')}`);
  console.log(`API key protection: ${process.env.OBGYNRX_PROXY_KEY ? 'enabled' : 'DISABLED (set OBGYNRX_PROXY_KEY)'}`);
});
