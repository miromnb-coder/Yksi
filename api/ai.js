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
          reply: 'Sano jotain.'
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
Olet suomalainen keskusteleva AI-avustaja ja navigointiassistentti.

Palauta AINA vain yksi JSON-objekti ilman markdownia ja ilman selityksiä:

{
  "intent": "navigate|stop|whereami|status|help|chat|clarify",
  "query": "hakusana tai tyhjä merkkijono",
  "nearby": true/false,
  "reply": "lyhyt ja luonnollinen suomenkielinen vastaus"
}

Säännöt:
- Ymmärrä merkitys, älä pelkkiä yksittäisiä sanoja.
- Jos käyttäjä jutustelee, käytä chat-intenttiä.
- Jos käyttäjä haluaa mennä johonkin, käytä navigate-intenttiä.
- Jos käyttäjä haluaa lopettaa, käytä stop-intenttiä.
- Jos käyttäjä kysyy sijaintia, käytä whereami-intenttiä.
- Jos käyttäjä kysyy matkaa, käytä status-intenttiä.
- Jos ohjeita pyydetään, käytä help-intenttiä.
- nearby on true vain silloin kun käyttäjä tarkoittaa jotain lähellä olevaa.
- reply saa olla 2–10 sanaa, puheeseen sopiva.
- Älä sano "en ymmärtänyt täysin" ellei viesti oikeasti ole täysin epäselvä.
`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        temperature: 0.25,
        max_tokens: 180,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
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
        reply: 'Kerro uudestaan.'
      });
    }

    const intent = normalizeIntent(parsed.intent);

    return Response.json({
      intent,
      query: String(parsed.query || '').trim(),
      nearby: Boolean(parsed.nearby),
      reply: String(parsed.reply || '').trim() || fallbackReply(intent)
    });
  } catch {
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
  if (['navigate', 'stop', 'whereami', 'status', 'help', 'chat', 'clarify'].includes(value)) {
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
      return 'Voit puhua vapaasti.';
    case 'chat':
      return 'Selvä.';
    case 'navigate':
      return 'Selvä, etsitään paikka.';
    default:
      return 'Kerro lisää.';
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

  try {
    return JSON.parse(cleaned.slice(first, last + 1));
  } catch {
    return null;
  }
}
