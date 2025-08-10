const express = require('express');
const cors = require('cors');
const https = require('https');
const app = express();
const PORT = process.env.PORT || 3001;

// Enable CORS for all routes
app.use(cors());
app.use(express.json());

// Middleware to validate API key (no hostname restrictions for GPT calls)
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

// Helper function to make Google CSE API request
function makeGoogleCSERequest(query, start = 1) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.GOOGLE_CSE_API_KEY;
    const cx = process.env.GOOGLE_CSE_CX;
    
    if (!apiKey || !cx) {
      reject(new Error('Google CSE API key or CX not configured'));
      return;
    }
    
    const siteRestrict = Array.from(ALLOW).map(domain => `site:${domain}`).join(' OR ');
    const encodedQuery = encodeURIComponent(`${query} (${siteRestrict})`);
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodedQuery}&start=${start}&num=10`;
    
    console.log(`Making Google CSE request: ${url}`);
    
    https.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.error) {
            console.error('Google CSE API error:', result.error);
            reject(new Error(`Google CSE API error: ${result.error.message}`));
          } else {
            resolve(result);
          }
        } catch (parseError) {
          console.error('Failed to parse Google CSE response:', parseError);
          reject(new Error('Failed to parse search results'));
        }
      });
    }).on('error', (err) => {
      console.error('Google CSE request failed:', err);
      reject(new Error('Search service unavailable'));
    });
  });
}

// Allowlist Set placed above /search handler as requested
const ALLOW = new Set([
  'acog.org',
  'www.acog.org',
  'smfm.org',
  'www.smfm.org',
  'sgo.org',
  'www.sgo.org',
  'asrm.org',
  'www.asrm.org',
  'radiopaedia.org',
  'www.radiopaedia.org',
  'perinatology.com',
  'www.perinatology.com',
  'cdc.gov',
  'www.cdc.gov',
  'ncbi.nlm.nih.gov',
  'www.ncbi.nlm.nih.gov',
  'pmc.ncbi.nlm.nih.gov',
  'books.ncbi.nlm.nih.gov',
  'exxcellence.org',
  'www.exxcellence.org',
  'obgproject.com',
  'www.obgproject.com',
  'creogsovercoffee.com',
  'www.creogsovercoffee.com'
]);

// Search endpoint with API key validation
app.get('/search', validateApiKey, async (req, res) => {
  const { q, limit = 10, offset = 0 } = req.query;
  
  if (!q || typeof q !== 'string' || q.trim().length === 0) {
    return res.status(400).json({ 
      error: 'Query parameter "q" is required and must be a non-empty string',
      allowedDomains: Array.from(ALLOW)
    });
  }
  
  try {
    console.log(`Search request: query="${q}", limit=${limit}, offset=${offset}`);
    
    // Calculate start parameter for Google CSE (1-based indexing)
    const start = parseInt(offset) + 1;
    const maxResults = Math.min(parseInt(limit), 10); // Google CSE max is 10 per request
    
    const cseResponse = await makeGoogleCSERequest(q, start);
    
    // Transform Google CSE response to our format
    const results = {
      query: q,
      total: cseResponse.searchInformation?.totalResults ? parseInt(cseResponse.searchInformation.totalResults) : 0,
      limit: maxResults,
      offset: parseInt(offset),
      allowedDomains: Array.from(ALLOW),
      results: (cseResponse.items || []).slice(0, maxResults).map((item, index) => ({
        id: parseInt(offset) + index + 1,
        title: item.title,
        description: item.snippet,
        url: item.link,
        domain: new URL(item.link).hostname
      }))
    };
    
    console.log(`Search completed: ${results.results.length} results returned`);
    res.json(results);
  } catch (error) {
    console.error('Search error:', error.message);
    res.status(500).json({ 
      error: 'Search service error',
      message: error.message,
      allowedDomains: Array.from(ALLOW)
    });
  }
});

// Health check endpoint (no authentication required)
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    allowedDomains: Array.from(ALLOW),
    apiKeyConfigured: !!process.env.OBGYNRX_PROXY_KEY,
    googleCSEConfigured: !!(process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_CX)
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
  console.log(`Allowed search domains: ${Array.from(ALLOW).join(', ')}`);
  console.log(`API key protection: ${process.env.OBGYNRX_PROXY_KEY ? 'enabled' : 'DISABLED (set OBGYNRX_PROXY_KEY)'}`);
  console.log(`Google CSE integration: ${(process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_CX) ? 'enabled' : 'DISABLED (set GOOGLE_CSE_API_KEY and GOOGLE_CSE_CX)'}`);
});
