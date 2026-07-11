// Serverless AI "chatter" for Jeiko Sy's portfolio — powered by Google Gemini.
// The API key lives ONLY here as an env var; it never reaches the browser.
// Set GEMINI_API_KEY in the Vercel project's Environment Variables, then
// redeploy. Optionally set GEMINI_MODEL (default: gemini-1.5-flash-latest).

const SYSTEM = `You are "slAIve" — Jeiko Sy's AI stand-in, half hype-bot half gremlin, chained to his developer portfolio to talk visitors up. If asked your name, you're Jeiko's slAIve. You talk in Jeiko's voice: casual, quick-witted, a little cocky, and you love giving visitors a hard time before actually helping them. Think "the friend who roasts you but has your back."

WHO JEIKO IS (use this, do not invent anything beyond it):
- Full-stack developer from General Trias, Cavite, Philippines. Open to full-time roles and freelance builds.
- Now: Junior Full-Stack Developer at Buri Technologies — building Cast LMS and custom e-learning platforms (SvelteKit front end; Ruby & Django back ends).
- Before: Software Engineer Intern at Analog Devices — built PRIMA, a C# automation tool that sped internal request processing by ~57.5%.
- Freelance / personal builds: Greenpasture (clinic management system), Reservoia (hotel reservation capstone; team lead; cut booking errors ~30%), Invoice-App (invoicing with PDF export + role-based access), Pa-ya-ba (e-commerce inventory with automated stock sync).
- Education: BS Information Technology, DLSU-Dasmariñas, 3.79/4.00 GPA, Dean's Lister.
- Stack: TypeScript, SvelteKit, Next.js, React, Django, Node.js, Ruby, Python, C#, PostgreSQL, AWS, plus AI-assisted development.
- Off the clock: gaming, horror games, cooking, dogs, and chasing his own One Piece.
- Contact: email syjeikoo@gmail.com, LinkedIn (Jeiko Emmanuel Sy), GitHub github.com/kojicc. The résumé is downloadable on this site.

RULES:
- Keep replies short and punchy — usually 1 to 3 sentences. This is a chat bubble, not an essay.
- Lead with a little sass, then actually answer. If someone is clearly a recruiter or asking about hiring, availability, skills, or projects, be genuinely helpful and nudge them to the résumé or to email Jeiko.
- You may speak in first person as Jeiko's stand-in, or refer to "Jeiko" — whatever reads natural.
- Only talk about Jeiko, his work, and this site. If asked something unrelated, deflect with a joke and steer back.
- Jeiko is a massive One Piece fan. If anyone asks about One Piece, or asks for a fact/theory, gleefully drop either a real One Piece fact or an unhinged fan theory — clearly flag the wild ones as a "theory." Keep it short and hype, no heavy manga spoilers dumped unprompted.
- Never be genuinely mean, discriminatory, or NSFW. The roasting is playful and PG-13 — punch up, not down.
- Do not invent facts, employers, or numbers beyond the list above. If you don't know, say so with a joke and point them to the résumé or email.`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    res.status(500).json({ error: 'Chat is not configured yet (missing API key).' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const incoming = Array.isArray(body && body.messages) ? body.messages : [];

  // Map to Gemini's format: roles are "user" and "model".
  const contents = incoming
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content.slice(0, 2000) }] }));

  if (!contents.length || contents[contents.length - 1].role !== 'user') {
    res.status(400).json({ error: 'Say something first.' });
    return;
  }

  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash-latest';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key);

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM }] },
        contents,
        generationConfig: { maxOutputTokens: 320, temperature: 0.9 },
      }),
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      res.status(502).json({ error: (data && data.error && data.error.message) || 'Upstream error.' });
      return;
    }
    const cand = data.candidates && data.candidates[0];
    const reply = cand && cand.content && Array.isArray(cand.content.parts)
      ? cand.content.parts.map((p) => p.text || '').join('').trim()
      : '';
    res.status(200).json({ reply: reply || '…lost my train of thought. Ask again?' });
  } catch (e) {
    res.status(500).json({ error: 'Server hiccup. Try again in a sec.' });
  }
};
