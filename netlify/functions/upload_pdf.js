const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const R2_ACCOUNT_ID = 'aebe1a6e3b694992a6e386c52ca92698';
const R2_ACCESS_KEY = '8013a19081b06927a8223b3e4ebb4938';
const R2_SECRET_KEY = '4a7eae34630f238b7e6db4a161564649f9ac1580f53b5dc3d7804537e4a9cad9';
const R2_BUCKET     = 'paarng-documents';
const R2_PUBLIC_URL = 'https://pub-aebe1a6e3b694992a6e386c52ca92698.r2.dev';

const S3 = new S3Client({
  region: 'auto',
  endpoint: 'https://' + R2_ACCOUNT_ID + '.r2.cloudflarestorage.com',
  credentials: {
    accessKeyId: R2_ACCESS_KEY,
    secretAccessKey: R2_SECRET_KEY
  },
  forcePathStyle: true
});

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

    const fixedName = program.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '') + '_Resources.pdf';

    const command = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: fixedName,
      ContentType: 'application/pdf'
    });

    const presignedUrl = await getSignedUrl(S3, command, { expiresIn: 300 });
    const publicUrl    = R2_PUBLIC_URL + '/' + fixedName;

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
