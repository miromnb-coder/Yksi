export async function POST(req) {
  const { text } = await req.json();

  const t = (text || "").toLowerCase();

  // 🔥 1. NOPEA LOCAL CHAT (ultra nopea + luonnollinen)
  if (t.includes("moi") || t.includes("hei")) {
    return Response.json({
      intent: "chat",
      query: "",
      nearby: false,
      reply: "Moi! Minne haluat mennä?"
    });
  }

  if (t.includes("mitä kuuluu") || t.includes("mitä teet")) {
    return Response.json({
      intent: "chat",
      query: "",
      nearby: false,
      reply: "Hyvin menee. Olen valmiina navigoimaan sinut minne vaan."
    });
  }

  if (t.includes("kiitos")) {
    return Response.json({
      intent: "chat",
      query: "",
      nearby: false,
      reply: "Ole hyvä."
    });
  }

  if (t.includes("kuka olet")) {
    return Response.json({
      intent: "chat",
      query: "",
      nearby: false,
      reply: "Olen sinun AI navigaattori."
    });
  }

  // 🔥 2. VARSINAINEN AI
  const prompt = `
Olet erittäin älykäs AI avustaja Suomessa.

Ymmärrä käyttäjän puhe.

Vastaa JSON muodossa:

{
  "intent": "navigate | stop | whereami | status | chat",
  "query": "hakusana",
  "nearby": true/false,
  "reply": "luonnollinen vastaus suomeksi"
}

Säännöt:
- Jos käyttäjä juttelee → intent: chat
- Jos haluaa mennä johonkin → intent: navigate
- "lähin" → nearby: true

Esimerkkejä:

"moi"
→ { "intent":"chat","query":"","nearby":false,"reply":"Moi!" }

"lähin kauppa"
→ { "intent":"navigate","query":"supermarket","nearby":true,"reply":"Etsitään lähin kauppa." }

"vie Kamppiin"
→ { "intent":"navigate","query":"Kamppi Helsinki","nearby":false,"reply":"Navigoidaan Kamppiin." }

"lopeta"
→ { "intent":"stop","query":"","nearby":false,"reply":"Pysäytetään navigointi." }

Käyttäjä:
"${text}"
`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama3-70b-8192",
      messages: [
        { role: "system", content: "Olet luonnollinen ja keskusteleva AI." },
        { role: "user", content: prompt }
      ],
      temperature: 0.4
    })
  });

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "{}";

  try {
    const json = JSON.parse(content);
    return Response.json(json);
  } catch {
    return Response.json({
      intent: "chat",
      query: "",
      nearby: false,
      reply: "En ihan ymmärtänyt, mutta voit yrittää uudestaan."
    });
  }
}
