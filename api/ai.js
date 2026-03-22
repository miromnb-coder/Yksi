export async function POST(req) {
  const { text } = await req.json();

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama3-70b-8192",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `
Olet erittäin älykäs suomalainen AI-avustaja, joka ymmärtää luonnollista puhetta.

Älä käytä sääntölistoja. Ymmärrä merkitys.

Vastaa aina JSON muodossa:

{
  "intent": "navigate | stop | whereami | status | chat",
  "query": "paikka tai asia",
  "nearby": true/false,
  "reply": "luonnollinen vastaus suomeksi"
}

Säännöt:
- Jos käyttäjä haluaa mennä johonkin → intent = navigate
- Jos puhuu yleisesti → intent = chat
- Jos sanoo “lopeta” → stop
- Jos kysyy sijaintia → whereami
- Jos kysyy matkaa → status

Nearby:
- true jos käyttäjä tarkoittaa “lähellä”, “tässä”, “jossain lähellä”
- muuten false

TÄRKEÄÄ:
- Ymmärrä merkitys, älä etsi tiettyjä sanoja
- Sama asia voi tulla monella tavalla
- Vastaa luonnollisesti kuten ihminen
`
        },
        {
          role: "user",
          content: text
        }
      ]
    })
  });

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "{}";

  try {
    return Response.json(JSON.parse(content));
  } catch {
    return Response.json({
      intent: "chat",
      query: "",
      nearby: false,
      reply: "En ymmärtänyt täysin, voitko sanoa uudelleen?"
    });
  }
}
