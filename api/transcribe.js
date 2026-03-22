const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_STT_MODEL = process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo';

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!GROQ_API_KEY) {
    res.status(500).json({ error: 'GROQ_API_KEY puuttuu' });
    return;
  }

  const body = readBody(req);
  const audioBase64 = String(body.audioBase64 || '').trim();
  const mimeType = String(body.mimeType || 'audio/webm').trim();

  if (!audioBase64) {
    res.status(400).json({ error: 'Äänitiedosto puuttuu' });
    return;
  }

  try {
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const blob = new Blob([audioBuffer], { type: mimeType });

    const form = new FormData();
    form.append('file', blob, mimeType.includes('mp4') ? 'speech.m4a' : 'speech.webm');
    form.append('model', GROQ_STT_MODEL);
    form.append('language', 'fi');
    form.append('response_format', 'json');
    form.append('temperature', '0');

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: form
    });

    const data = await response.json();

    if (!response.ok) {
      res.status(response.status).json({
        error: data?.error?.message || 'Transkriptio epäonnistui'
      });
      return;
    }

    res.status(200).json({
      text: data.text || ''
    });
  } catch (error) {
    res.status(500).json({
      error: error?.message || 'Tuntematon virhe'
    });
  }
};
