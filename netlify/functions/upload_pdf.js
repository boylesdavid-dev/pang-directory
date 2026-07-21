const https = require('https');
const crypto = require('crypto');

const R2_ACCOUNT_ID = 'aebe1a6e3b694992a6e386c52ca92698';
const R2_ACCESS_KEY = '8013a19081b06927a8223b3e4ebb4938';
const R2_SECRET_KEY = '4a7eae34630f238b7e6db4a161564649f9ac1580f53b5dc3d7804537e4a9cad9';
const R2_BUCKET     = 'paarng-documents';
const R2_PUBLIC_URL = 'https://pub-aebe1a6e3b694992a6e386c52ca92698.r2.dev';
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw1OSynHZ9y_sXRgW8gqEfUhXFFxFazjIFR8q6yXCbhj9XeLfhATQMyvRnc1pAOddXn/exec';

// AWS Signature V4 signing for Cloudflare R2
function sign(key, msg) {
  return crypto.createHmac('sha256', key).update(msg).digest();
}

function getSignatureKey(key, dateStamp, regionName, serviceName) {
  const kDate    = sign('AWS4' + key, dateStamp);
  const kRegion  = sign(kDate, regionName);
  const kService = sign(kRegion, serviceName);
  const kSigning = sign(kService, 'aws4_request');
  return kSigning;
}

async function uploadToR2(fileName, fileBuffer) {
  const endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const now      = new Date();
  const amzDate  = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);

  const contentHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  const canonicalHeaders = `content-type:application/pdf\nhost:${R2_ACCOUNT_ID}.r2.cloudflarestorage.com\nx-amz-content-sha256:${contentHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders    = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `PUT\n/${R2_BUCKET}/${fileName}\n\n${canonicalHeaders}\n${signedHeaders}\n${contentHash}`;

  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign    = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${crypto.createHash('sha256').update(canonicalRequest).digest('hex')}`;

  const signingKey  = getSignatureKey(R2_SECRET_KEY, dateStamp, 'auto', 's3');
  const signature   = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authHeader  = `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return new Promise((resolve, reject) => {
    const url = new URL(`${endpoint}/${R2_BUCKET}/${fileName}`);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': fileBuffer.length,
        'x-amz-date': amzDate,
        'x-amz-content-sha256': contentHash,
        'Authorization': authHeader
      },
      timeout: 30000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          resolve(true);
        } else {
          reject(new Error('R2 upload failed: ' + res.statusCode + ' ' + data));
        }
      });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('Upload timed out')); });
    req.on('error', reject);
    req.write(fileBuffer);
    req.end();
  });
}

async function notifyAppsScript(program, publicUrl) {
  const payload = JSON.stringify({ action: 'pdf', pdfProgram: program, pdfLink: publicUrl });
  return new Promise((resolve) => {
    const makeReq = (url, redirectCount) => {
      if (redirectCount > 5) { resolve(); return; }
      const parsed = new URL(url);
      const req = https.request({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 30000
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          makeReq(res.headers.location, redirectCount + 1);
        } else {
          res.resume();
          resolve();
        }
      });
      req.on('error', () => resolve());
      req.on('timeout', () => { req.destroy(); resolve(); });
      req.write(payload);
      req.end();
    };
    makeReq(APPS_SCRIPT_URL, 0);
  });
}

exports.handler = async function(event, context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Program-Name, X-File-Name',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ status: 'error', message: 'Method not allowed' }) };

  try {
    const program  = event.headers['x-program-name'] || 'unknown';
    const fixedName = program.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '') + '_Resources.pdf';
    const fileBuffer = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'binary');

    if (fileBuffer.length === 0) throw new Error('Empty file received');

    // Upload to R2
    await uploadToR2(fixedName, fileBuffer);

    // Build public URL
    const publicUrl = R2_PUBLIC_URL + '/' + fixedName;

    // Notify Apps Script to update Google Sheet
    await notifyAppsScript(program, publicUrl);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ status: 'success', link: publicUrl })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ status: 'error', message: err.message })
    };
  }
};
