const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

function normalizeText(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/[.,!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function localFallback(text, ctx = {}) {
  const t = normalizeText(text);
  const lastQuery = String(ctx.lastQuery || '').trim();

  if (t.includes('lopeta') || t.includes('pysäytä') || t.includes('pysayta') || t.includes('seis')) {
    return {
      intent: 'stop',
      reply: 'Navigointi pysäytetty.',
      query: '',
      nearby: false
    };
  }

  if (t.includes('missä olen') || t.includes('missä mä oon') || t.includes('sijainti')) {
    return {
      intent: 'whereami',
      reply: 'Kerron sijaintisi.',
      query: '',
      nearby: false
    };
  }

  if (t.includes('kuinka pitkä matka') || t.includes('paljonko matkaa') || t.includes('matka')) {
    return {
      intent: 'status',
      reply: 'Katsotaan matka.',
      query: '',
      nearby: false
    };
  }

  if (t.includes('apu') || t.includes('ohje')) {
    return {
      intent: 'help',
      reply: 'Voit sanoa esimerkiksi: vie Kamppiin, vie lähimpään ruokakauppaan, lopeta, missä olen tai kuinka pitkä matka.',
      query: '',
      nearby: false
    };
  }

  const nearbyKeywords = ['lähin', 'lähimpään', 'ruokakauppa', 'kauppa', 'kahvila', 'asema', 'apteekki', 'ravintola', 'pizza'];
  const nearby = nearbyKeywords.some(k => t.includes(k));

  if (nearby) {
    let query = 'kohde';
    if (t.includes('ruokakauppa') || t.includes('kauppa')) query = 'ruokakauppa';
    else if (t.includes('kahvila')) query = 'kahvila';
    else if (t.includes('apteekki')) query = 'apteekki';
    else if (t.includes('asema')) query = 'asema';
    else if (t.includes('ravintola') || t.includes('pizza')) query = 'ravintola';

    return {
      intent: 'navigate',
      reply: `Selvä, etsitään ${query}.`,
      query,
      nearby: true
    };
  }

  const aliasMap = [
    ['kamppi', 'Kamppi Helsinki'],
    ['kampiin', 'Kamppi Helsinki'],
    ['stokka', 'Stockmann Helsinki'],
    ['stokkalle', 'Stockmann Helsinki'],
    ['jumbo', 'Jumbo Vantaa'],
    ['jumbolle', 'Jumbo Vantaa'],
    ['rautatieasema', 'Helsingin päärautatieasema'],
    ['päärautatieasema', 'Helsingin päärautatieasema'],
    ['asema', 'asema']
  ];

  for (const [needle, value] of aliasMap) {
    if (t === needle || t.includes(` ${needle} `) || t.startsWith(needle) || t.endsWith(needle)) {
      return {
        intent: 'navigate',
        reply: `Selvä, etsitään ${value}.`,
        query: value,
        nearby: false
      };
    }
  }

  if (t.startsWith('vie ') || t.startsWith('mene ') || t.startsWith('navigoi ') || t.startsWith('ohjaa ')) {
    const cleaned = t
      .replace(/^(vie|mene|navigoi|ohjaa)\s+/i, '')
      .replace(/^(kohteeseen|paikkaan|osoitteeseen)\s+/i, '')
      .trim();

    const query = cleaned || lastQuery || 'kohde';
    return {
      intent: 'navigate',
      reply: `Selvä, etsitään ${query}.`,
      query,
      nearby: false
    };
  }

  if (t.includes('sinne') || t.includes('samaan paikkaan') || t.includes('sama paikka')) {
    return {
      intent: 'navigate',
      reply: lastQuery ? `Selvä, etsitään sama paikka: ${lastQuery}.` : 'Minne haluat mennä?',
      query: lastQuery,
      nearby: false
    };
  }

  return {
    intent: 'clarify',
    reply: 'En ymmärtänyt täysin. Sano esimerkiksi: vie Kamppiin, vie lähimpään ruokakauppaan, lopeta, missä olen tai kuinka pitkä matka.',
    query: '',
    nearby: false
  };
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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = readBody(req);
  const text = String(body.text || '').trim();
  const currentLocation = body.currentLocation || null;
  const activeTarget = String(body.activeTarget || '').trim();
  const lastQuery = String(body.lastQuery || '').trim();

  if (!text) {
    res.status(400).json({ error: 'Tyhjä teksti' });
    return;
  }

  // Jos Groq-avain puuttuu, käytetään paikallista fallbackia.
  if (!GROQ_API_KEY) {
    const fallback = localFallback(text, { lastQuery, activeTarget, currentLocation });
    res.status(200).json(fallback);
    return;
  }

  const system = `
Olet erittäin hyvä suomenkielinen navigointiassistentti.

Palauta AINA vain yksi JSON-objekti, ei markdownia, ei selityksiä.

Muoto:
{
  "intent": "navigate|stop|whereami|status|help|clarify",
  "reply": "lyhyt luonnollinen suomenkielinen vastaus",
  "query": "hakulauseke tai tyhjä merkkijono",
  "nearby": true|false
}

Säännöt:
- reply aina suomeksi ja lyhyesti.
- Jos käyttäjä sanoo "vie Kamppiin", query = "Kamppi Helsinki", nearby = false, intent = "navigate".
- Jos käyttäjä sanoo "vie lähimpään ruokakauppaan" tai "lähin kahvila", query = "ruokakauppa" tai "kahvila", nearby = true, intent = "navigate".
- Jos käyttäjä sanoo "lopeta", "pysäytä" tai "seis", intent = "stop".
- Jos käyttäjä sanoo "missä olen", intent = "whereami".
- Jos käyttäjä sanoo "kuinka pitkä matka", "matka" tai "paljonko matkaa", intent = "status".
- Jos käyttäjä pyytää apua, intent = "help".
- Jos kohde on epäselvä, intent = "clarify" ja kysy lyhyt tarkennus suomeksi.
- Ymmärrä puhekieli ja kirjoitusvirheet.
- Jos käyttäjä sanoo "sinne" tai "sama paikka", käytä viimeisintä kohdetta jos se on olemassa.
- Älä keksi tarkkoja sijainteja joita et tiedä.
`;

  const user = `
Käyttäjän viesti: "${text}"
Nykyinen sijainti: ${currentLocation ? JSON.stringify(currentLocation) : 'ei tiedossa'}
Aktiivinen kohde: ${activeTarget || 'ei aktiivista kohdetta'}
Viimeisin kohde: ${lastQuery || 'ei viimeistä kohdetta'}
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
        max_tokens: 300
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const fallback = localFallback(text, { lastQuery, activeTarget, currentLocation });
      res.status(response.status).json({
        ...fallback,
        error: data?.error?.message || 'Groq AI -virhe'
      });
      return;
    }

    const content = data?.choices?.[0]?.message?.content || '';
    const parsed = extractJson(content) || localFallback(text, { lastQuery, activeTarget, currentLocation });

    if (!parsed.reply) {
      parsed.reply = localFallback(text, { lastQuery, activeTarget, currentLocation }).reply;
    }
    if (typeof parsed.nearby !== 'boolean') {
      parsed.nearby = false;
    }
    if (!parsed.query) {
      parsed.query = '';
    }

    res.status(200).json(parsed);
  } catch (error) {
    const fallback = localFallback(text, { lastQuery, activeTarget, currentLocation });
    res.status(200).json({
      ...fallback,
      error: error?.message || 'Tuntematon virhe'
    });
  }
};
