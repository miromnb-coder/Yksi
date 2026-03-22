const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

function extractJson(text) {
  if (!text) return null;
  const cleaned = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  try {
    return JSON.parse(cleaned.slice(first, last + 1));
  } catch {
    return null;
  }
}

function fallback() {
  return {
    intent: 'clarify',
    reply: 'En ymmärtänyt täysin. Sano esimerkiksi: vie Kamppiin, vie lähimpään ruokakauppaan, lopeta, missä olen tai kuinka pitkä matka.',
    destination_query: '',
    search_mode: 'exact',
    should_start_navigation: false,
    should_stop_navigation: false
  };
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
  const text = String(body.text || '').trim();
  const currentLocation = body.currentLocation || null;
  const activeTarget = body.activeTarget || null;

  if (!text) {
    res.status(400).json({ error: 'Tyhjä teksti' });
    return;
  }

  const system = `
Olet suomenkielinen navigointi- ja ääniavustaja.
Palauta AINA vain yksi JSON-objekti, ei markdownia, ei selityksiä.

Muoto:
{
  "intent": "navigate|stop|whereami|status|help|clarify",
  "reply": "lyhyt luonnollinen suomenkielinen vastaus",
  "destination_query": "hakulauseke tai tyhjä merkkijono",
  "search_mode": "exact|nearby",
  "should_start_navigation": true,
  "should_stop_navigation": false
}

Säännöt:
- reply aina suomeksi ja lyhyesti.
- Jos käyttäjä sanoo "vie Kamppiin", destination_query = "Kamppi Helsinki", search_mode = "exact", intent = "navigate".
- Jos käyttäjä sanoo "vie lähimpään ruokakauppaan" tai "lähin kahvila", destination_query = "ruokakauppa" tai "kahvila", search_mode = "nearby", intent = "navigate".
- Jos käyttäjä sanoo "lopeta", "pysäytä" tai "seis", intent = "stop" ja should_stop_navigation = true.
- Jos käyttäjä sanoo "missä olen", intent = "whereami".
- Jos käyttäjä sanoo "kuinka pitkä matka", "matka" tai "paljonko matkaa", intent = "status".
- Jos käyttäjä pyytää apua, intent = "help".
- Jos kohde on epäselvä, intent = "clarify" ja kysy lyhyt tarkennus suomeksi.
- Älä keksi tarkkoja sijainteja, joita et tiedä.
- Käytä nykyistä sijaintia ja aktiivista kohdetta vain kontekstina.
`;

  const user = `
Käyttäjän viesti: "${text}"
Nykyinen sijainti: ${currentLocation ? JSON.stringify(currentLocation) : 'ei tiedossa'}
Aktiivinen kohde: ${activeTarget ? String(activeTarget) : 'ei aktiivista kohdetta'}
`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        temperature: 0.2,
        max_tokens: 350
      })
    });

    const data = await response.json();

    if (!response.ok) {
      res.status(response.status).json({
        error: data?.error?.message || 'Groq AI -virhe'
      });
      return;
    }

    const content = data?.choices?.[0]?.message?.content || '';
    const parsed = extractJson(content) || fallback();

    if (!parsed.reply) parsed.reply = fallback().reply;
    if (typeof parsed.should_start_navigation !== 'boolean') parsed.should_start_navigation = parsed.intent === 'navigate';
    if (typeof parsed.should_stop_navigation !== 'boolean') parsed.should_stop_navigation = parsed.intent === 'stop';
    if (!parsed.search_mode) parsed.search_mode = 'exact';
    if (!parsed.destination_query) parsed.destination_query = '';

    res.status(200).json(parsed);
  } catch (error) {
    res.status(500).json({
      error: error?.message || 'Tuntematon virhe'
    });
  }
};
