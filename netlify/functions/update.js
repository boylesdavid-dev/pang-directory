const https = require('https');

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw1OSynHZ9y_sXRgW8gqEfUhXFFxFazjIFR8q6yXCbhj9XeLfhATQMyvRnc1pAOddXn/exec';

function makeRequest(url, postData, redirectCount) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 10) { reject(new Error('Too many redirects')); return; }

    const parsedUrl = new URL(url);
    const isPost = postData && redirectCount === 0;

    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: isPost ? 'POST' : 'GET',
      headers: isPost ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      } : { 'Content-Type': 'application/json' },
      timeout: 55000
    };

    const req = https.request(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let location = res.headers.location;
        if (!location.startsWith('http')) location = 'https://' + parsedUrl.hostname + location;
        resolve(makeRequest(location, null, redirectCount + 1));
        return;
      }

      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          if (data.includes('Moved') || data.includes('redirect')) {
            const match = data.match(/HREF="([^"]+)"/i);
            if (match) { resolve(makeRequest(match[1], null, redirectCount + 1)); return; }
          }
          reject(new Error('Invalid response: ' + data.substring(0, 300)));
        }
      });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error', (err) => { reject(new Error('Request error: ' + err.message)); });
    if (isPost) req.write(postData);
    req.end();
  });
}

exports.handler = async function(event, context) {
  context.callbackWaitsForEmptyEventLoop = false;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  if (event.httpMethod === 'GET') return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ status: 'ok', message: 'PA NG Directory Update Function is running' }) };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ status: 'error', message: 'Method not allowed' }) };

  try {
    // Check payload size — base64 PDFs can be large
    const body = event.body;
    const parsed = JSON.parse(body);

    // For PDF uploads, warn if too large (Netlify limit is 6MB)
    if (parsed.action === 'pdf' && parsed.pdfBase64) {
      const sizeKB = Buffer.byteLength(parsed.pdfBase64, 'base64') / 1024;
      if (sizeKB > 4000) {
        return {
          statusCode: 413,
          headers: corsHeaders,
          body: JSON.stringify({ status: 'error', message: 'PDF is too large. Please use a file under 4MB.' })
        };
      }
    }

    const result = await makeRequest(APPS_SCRIPT_URL, body, 0);
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(result) };
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ status: 'error', message: err.message }) };
  }
};
