const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const body = req.body || {};
    const base64Data = body.base64Data;
    const mediaType = body.mediaType;
    // The Anthropic key lives in Vercel's environment variables (ANTHROPIC_API_KEY).
    // A key sent from the browser is only used as a fallback if that variable is not set.
    const apiKey = process.env.ANTHROPIC_API_KEY || body.apiKey;

    // Only signed-in users may use the scanner, because every scan spends Anthropic credit.
    const sbUrl = process.env.SUPABASE_URL;
    const sbKey = process.env.SUPABASE_ANON_KEY;
    if (sbUrl && sbKey) {
      const token = ((req.headers && req.headers.authorization) || '').replace(/^Bearer\s+/i, '');
      let signedIn = false;
      if (token) {
        try {
          const who = await fetch(sbUrl.replace(/\/+$/, '') + '/auth/v1/user', {
            headers: { apikey: sbKey, Authorization: 'Bearer ' + token }
          });
          signedIn = who.status === 200;
        } catch (e) { signedIn = false; }
      }
      if (!signedIn) {
        res.status(401).json({ error: 'Please sign in again, then retry the scan.' });
        return;
      }
    }

    if (!apiKey) {
      res.status(500).json({ error: 'No Anthropic key found. Add ANTHROPIC_API_KEY in your Vercel project settings.' });
      return;
    }
    if (!base64Data) {
      res.status(400).json({ error: 'Missing base64Data' });
      return;
    }

    const isPdf = mediaType === 'application/pdf';
    const messageContent = [
      isPdf
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } }
        : { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: base64Data } },
      { type: 'text', text: 'Parse this restaurant invoice. Return ONLY a JSON object (no markdown) with keys: vendor_name, invoice_number, invoice_date, total_amount, line_items (array of: sku, description, quantity, unit_price, extended_price, unit, is_short, is_credit, inventory_category, weight_kg, price_per_kg). TDP lines are discounts — subtract from the item above and do not include as separate line items. For items sold by weight (meat, cheese, produce): if the invoice shows the weight or a price per kg or per lb, set weight_kg to the weight in kilograms and price_per_kg to the net price per kg after any discount (convert lb to kg), and use the whole-item total as unit_price. If the invoice shows no weight, set both to null.' }
    ];

    const bodyStr = JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      messages: [{ role: 'user', content: messageContent }]
    });

    const result = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(bodyStr)
        }
      };
      const r = https.request(options, (response) => {
        let data = '';
        response.on('data', c => data += c);
        response.on('end', () => resolve({ status: response.statusCode, body: data }));
      });
      r.on('error', reject);
      r.setTimeout(55000, () => { r.destroy(); reject(new Error('Timeout after 55s')); });
      r.write(bodyStr);
      r.end();
    });

    const claudeData = JSON.parse(result.body);
    if (claudeData.error) {
      res.status(500).json({ error: claudeData.error.message });
      return;
    }
    if (!claudeData.content || !claudeData.content[0]) {
      res.status(500).json({ error: 'No response from Claude' });
      return;
    }

    let text = claudeData.content[0].text;
    text = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const s = text.indexOf('{');
    const e = text.lastIndexOf('}');
    if (s === -1 || e === -1) {
      res.status(500).json({ error: 'No JSON in response', text: text.slice(0, 200) });
      return;
    }

    const parsed = JSON.parse(text.slice(s, e + 1));
    res.status(200).json(parsed);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
