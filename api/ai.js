export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const text = String(body?.text || '').trim();

    if (!text) {
      return Response.json(
        {
          intent: 'clarify',
          query: '',
          nearby: false,
          reply: 'Sano minne haluat mennä.'
        },
        { status: 400 }
      );
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return Response.json(
        {
          intent: 'clarify',
          query: '',
          nearby: false,
          reply: 'AI-avain puuttuu.'
        },
        { status: 500 }
      );
    }

    const systemPrompt = `
Olet suomalainen navigaatio-AI.

Palauta AINA vain yksi JSON-objekti tässä muodossa:
{
  "intent": "navigate|stop|whereami|status|help|clarify",
  "query": "hakusana tai tyhjä merkkijono",
  "nearby": true/false,
  "reply": "lyhyt suomenkielinen vastaus"
}

Säännöt:
- reply aina lyhyt ja suomeksi.
- Jos käyttäjä sanoo "lopeta", "pysäytä" tai "seis" => intent = "stop"
- Jos käyttäjä sanoo "missä olen" => intent = "whereami"
- Jos käyttäjä sanoo "kuinka pitkä matka" tai "paljonko matkaa" => intent = "status"
- Jos käyttäjä pyytää ohjeita => intent = "help"
- Jos käyttäjä sanoo "lähin", "lähellä", "täällä", "tässä", "jossain tässä" => nearby = true
- "kauppa" => query = "supermarket"
- "ruokakauppa" => query = "supermarket"
- "kahvila" => query = "cafe"
- "ravintola" tai "pizza" => query = "restaurant"
- "apteekki" => query = "pharmacy"
- Jos käyttäjä sanoo tarkan paikan, nearby = false
- Jos kohde on epäselvä, intent = "clarify"
- Älä lisää markdownia, älä selitä, älä käytä backtickejä.
`;

    const userPrompt = `Käyttäjän viesti: "${text}"`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'llama3-70b-8192',
        temperature: 0.2,
        max_tokens: 220,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return Response.json(
        {
          intent: 'clarify',
          query: '',
          nearby: false,
          reply: 'AI ei vastannut oikein.'
        },
        { status: response.status }
      );
    }

    const content = String(data?.choices?.[0]?.message?.content || '').trim();

    const parsed = extractJsonObject(content);

    if (!parsed) {
      return Response.json({
        intent: 'clarify',
        query: '',
        nearby: false,
        reply: 'En ymmärtänyt täysin. Sano esimerkiksi: vie Kamppiin, vie lähimpään ruokakauppaan, lopeta, missä olen tai kuinka pitkä matka.'
      });
    }

    const intent = normalizeIntent(parsed.intent);
    const query = String(parsed.query || '').trim();
    const nearby = Boolean(parsed.nearby);
    const reply = String(parsed.reply || '').trim() || fallbackReply(intent);

    return Response.json({
      intent,
      query,
      nearby,
      reply
    });
  } catch (error) {
    return Response.json(
      {
        intent: 'clarify',
        query: '',
        nearby: false,
        reply: 'Tapahtui virhe.'
      },
      { status: 500 }
    );
  }
}

function normalizeIntent(intent) {
  const value = String(intent || '').trim().toLowerCase();
  if (['navigate', 'stop', 'whereami', 'status', 'help', 'clarify'].includes(value)) {
    return value;
  }
  return 'clarify';
}

function fallbackReply(intent) {
  switch (intent) {
    case 'stop':
      return 'Navigointi pysäytetty.';
    case 'whereami':
      return 'Kerron sijaintisi.';
    case 'status':
      return 'Tarkistan matkan.';
    case 'help':
      return 'Voit sanoa esimerkiksi: vie Kamppiin, vie lähimpään ruokakauppaan, lopeta, missä olen tai kuinka pitkä matka.';
    case 'navigate':
      return 'Selvä, etsitään paikka.';
    default:
      return 'Minne haluat mennä?';
  }
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const cleaned = raw
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();

  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;

  const candidate = cleaned.slice(first, last + 1);

  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}
