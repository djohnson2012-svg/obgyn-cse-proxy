const express = require('express');
const cors = require('cors');
const https = require('https');
const app = express();
const PORT = process.env.PORT || 3001;

// Finalized allowlist of approved domains for search filtering
const ALLOWED_DOMAINS = [
  'acog.org',
  'smfm.org', 
  'sgo.org',
  'asrm.org',
  'radiopaedia.org',
  'perinatology.com',
  'cdc.gov',
  'ncbi.nlm.nih.gov',
  'pmc.ncbi.nlm.nih.gov',
  'books.ncbi.nlm.nih.gov',
  'exxcellence.org',
  'obgproject.com',
  'creogsovercoffee.com'
];

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
    
    // Create site restriction for allowed domains
    const siteRestrict = ALLOWED_DOMAINS.map(domain => `site:${domain}`).join(' OR ');
    const fullQuery = `(${siteRestrict}) ${query}`;
    
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(fullQuery)}&start=${start}`;
    
    https.get(url, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (error) {
          reject(new Error('Failed to parse Google CSE response'));
        }
      });
    }).on('error', (error) => {
      reject(error);
    });
  });
}

// Apply API key validation to search endpoint only
app.use('/search', validateApiKey);

// Search endpoint - queries Google CSE with domain filtering
app.get('/search', async (req, res) => {
  const { q, limit = 10, offset = 0 } = req.query;
  
  if (!q) {
    return res.status(400).json({ error: 'Missing required query parameter: q' });
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
      allowedDomains: ALLOWED_DOMAINS,
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
      allowedDomains: ALLOWED_DOMAINS
    });
  }
});

// Health check endpoint (no authentication required)
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    allowedDomains: ALLOWED_DOMAINS,
    apiKeyConfigured: !!process.env.OBGYNRX_PROXY_KEY,
    googleCSEConfigured: !!(process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_CX)
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
  console.log(`Allowed search domains: ${ALLOWED_DOMAINS.join(', ')}`);
  console.log(`API key protection: ${process.env.OBGYNRX_PROXY_KEY ? 'enabled' : 'DISABLED (set OBGYNRX_PROXY_KEY)'}`); 
  console.log(`Google CSE integration: ${(process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_CX) ? 'enabled' : 'DISABLED (set GOOGLE_CSE_API_KEY and GOOGLE_CSE_CX)'}`);  
});
