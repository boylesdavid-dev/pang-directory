const { pipeline } = require('stream');
const { promisify } = require('util');

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
    const fileName = event.headers['x-file-name'] || 'document.pdf';
    const fixedName = program.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '') + '_Resources.pdf';

    // Decode the binary body
    const fileBuffer = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'binary');

    // Deploy the file to Netlify via the deploy API
    const NETLIFY_TOKEN = '62i5pBWXR--_IUPLCaa5tqBGJRaezGqFf2mCPTYXgUE';
    const SITE_ID = 'glittering-maamoul-624b51';

    // Get current deploy ID
    const deployRes = await fetch('https://api.netlify.com/api/v1/sites/' + SITE_ID + '.netlify.app/deploys?per_page=1', {
      headers: { 'Authorization': 'Bearer ' + NETLIFY_TOKEN }
    });
    const deploys = await deployRes.json();
    if (!deploys.length) throw new Error('No deploys found');
    const deployId = deploys[0].id;

    // Upload file to deploy
    const uploadRes = await fetch('https://api.netlify.com/api/v1/deploys/' + deployId + '/files/docs/' + fixedName, {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + NETLIFY_TOKEN,
        'Content-Type': 'application/pdf',
        'Content-Length': fileBuffer.length
      },
      body: fileBuffer
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      throw new Error('Upload failed: ' + err);
    }

    const publicUrl = 'https://glittering-maamoul-624b51.netlify.app/docs/' + fixedName;

    // Update Google Sheet via Apps Script
    const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw1OSynHZ9y_sXRgW8gqEfUhXFFxFazjIFR8q6yXCbhj9XeLfhATQMyvRnc1pAOddXn/exec';
    const gsPayload = JSON.stringify({ action: 'pdf', pdfProgram: program, pdfLink: publicUrl });

    await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: gsPayload
    });

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
