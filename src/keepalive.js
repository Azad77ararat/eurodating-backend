const https = require('https');

const RENDER_URL = 'eurodating-backend.onrender.com';

setInterval(() => {
  https.get(`https://${RENDER_URL}/`, (res) => {
    console.log(`Keep-alive ping: ${res.statusCode}`);
  }).on('error', (err) => {
    console.log(`Keep-alive error: ${err.message}`);
  });
}, 14 * 60 * 1000); // كل 14 دقيقة

module.exports = {};