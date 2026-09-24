const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const { base64Data, mediaType, apiKey } = req.body || {};

    if (!apiKey) {
      res.status(500).json({ error: 'No API key provided. Add your Anthropic key in Settings.' });
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
      { type: 'text', text: 'Parse this restaurant invoice. Return ONLY a JSON object (no markdown) with keys: vendor_name, invoice_number, invoice_date, total_amount, line_items (array of: sku, description, quantity, unit_price, extended_price, unit, is_short, is_credit, inventory_category). TDP lines are discounts — subtract from the item above and do not include as separate line items.' }
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
