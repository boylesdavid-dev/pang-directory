const crypto = require('crypto');

const R2_ACCESS_KEY = '8013a19081b06927a8223b3e4ebb4938';
const R2_SECRET_KEY = '4a7eae34630f238b7e6db4a161564649f9ac1580f53b5dc3d7804537e4a9cad9';
const CUSTOM_DOMAIN = 'https://docs.pachaplains.us';
const CUSTOM_HOST   = 'docs.pachaplains.us';

function hmac(key, data, encoding) {
  return crypto.createHmac('sha256', key).update(data).digest(encoding || 'buffer');
}

function generatePresignedUrl(fileName) {
  const now       = new Date();
  const amzDate   = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);
  const expires   = 300;

  const credentialScope = dateStamp + '/auto/s3/aws4_request';
  const credential      = R2_ACCESS_KEY + '/' + credentialScope;

  const queryString = 
    'X-Amz-Algorithm=AWS4-HMAC-SHA256' +
    '&X-Amz-Credential=' + encodeURIComponent(credential) +
    '&X-Amz-Date=' + amzDate +
    '&X-Amz-Expires=' + expires +
    '&X-Amz-SignedHeaders=content-type%3Bhost';

  const canonicalRequest = [
    'PUT',
    '/' + fileName,
    queryString,
    'content-type:application/pdf\nhost:' + CUSTOM_HOST + '\n',
    'content-type;host',
    'UNSIGNED-PAYLOAD'
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex')
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac('AWS4' + R2_SECRET_KEY, dateStamp), 'auto'), 's3'),
    'aws4_request'
  );
  const signature = hmac(signingKey, stringToSign, 'hex');

  return CUSTOM_DOMAIN + '/' + fileName + '?' + queryString + '&X-Amz-Signature=' + signature;
}

exports.handler = async function(event, context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  if (event.httpMethod === 'GET') return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ status: 'ok' }) };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ status: 'error', message: 'Method not allowed' }) };

  try {
    const { program } = JSON.parse(event.body);
    if (!program) throw new Error('Missing program name');

    const fixedName    = program.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '') + '_Resources.pdf';
    const presignedUrl = generatePresignedUrl(fixedName);
    const publicUrl    = CUSTOM_DOMAIN + '/' + fixedName;

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ status: 'success', presignedUrl: presignedUrl, publicUrl: publicUrl })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ status: 'error', message: err.message })
    };
  }
};
