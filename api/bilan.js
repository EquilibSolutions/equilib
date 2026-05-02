const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const rateLimitMap = new Map();
const RATE_LIMIT = 5;
const RATE_WINDOW = 60*60*1000;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_WINDOW) { rateLimitMap.set(ip, { count: 1, start: now }); return true; }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  rateLimitMap.set(ip, entry);
  return true;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Trop de requêtes. Réessaie dans une heure.' });

  const { profil } = req.body || {};
  if (!profil || typeof profil !== 'object') return res.status(400).json({ error: 'Données manquantes' });

  const { age, sex, height, weight, goal } = profil;
  if (!age || !sex || !height || !weight || !goal) return res.status(400).json({ error: 'Profil incomplet' });
  if (age < 18 || age > 90 || height < 140 || height > 210 || weight < 40 || weight > 300) return res.status(400).json({ error: 'Valeurs hors limites' });

  const imc = +(weight / (height / 100) ** 2).toFixed(1);
  const tmb = sex === 'f' ? Math.round(10*weight + 6.25*height - 5*age - 161) : Math.round(10*weight + 6.25*height - 5*age + 5);
  const actFactors = { sed:1.2, leger:1.375, mod:1.55, actif:1.725 };
  const tdee = Math.round(tmb * (actFactors[profil.activite] || 1.375));

  const prompt = `Tu es un expert en nutrition et perte de poids bienveillant. Tu parles en "tu", de façon humaine et directe. Pas de solutions dans le gratuit — seulement le diagnostic.

Profil :
- Âge : ${age} ans | Sexe : ${sex === 'f' ? 'Femme' : sex === 'm' ? 'Homme' : 'Autre'}
- Taille : ${height} cm | Poids : ${weight} kg | Objectif : ${goal} kg | À perdre : ${+(weight-goal).toFixed(1)} kg
- IMC : ${imc} | TMB : ${tmb} kcal | TDEE : ${tdee} kcal
- Approche souhaitée : ${profil.approche || 'non précisé'}
- Activité : ${profil.activite || 'sed'} | Stress : ${profil.stress || 'mod'} | Sommeil : ${profil.sleep || '7h'}
- Habitudes : ${(profil.alim || []).join(', ') || 'aucune'}
- Obstacles : ${(profil.obstacles || []).join(', ') || 'non précisé'}

Réponds UNIQUEMENT avec du JSON brut (pas de markdown, pas de backticks) :
{"imc_label":"<Insuffisance pondérale|Poids normal|Surpoids|Obésité modérée>","imc_badge_color":"<vert|orange|rouge>","score_facilite":<1-10>,"score_alimentation":<1-10>,"score_lifestyle":<1-10>,"score_motivation":<1-10>,"score_facilite_comment":"<1 phrase>","score_alimentation_comment":"<1 phrase>","score_lifestyle_comment":"<1 phrase>","score_motivation_comment":"<1 phrase>","hero_subtitle":"<1 phrase accrocheuse>","diagnostic":"<3-4 phrases bienveillantes et très personnalisées>","temps_realiste":"<ex: 4-6 mois>","calories_conseillees":<nombre>,"imc_interpretation":"<2 phrases>","tmb_interpretation":"<2 phrases>","tdee_interpretation":"<2 phrases>","deficit_interpretation":"<2 phrases>","bloqueurs":[{"niveau":"critique|modéré|faible","titre":"...","explication":"<2-3 phrases>"},{"niveau":"critique|modéré|faible","titre":"...","explication":"<2-3 phrases>"},{"niveau":"critique|modéré|faible","titre":"...","explication":"<2-3 phrases>"}],"teaser_premium":"<phrase engageante>","message_fin":"<message court>"}`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://equilib.vercel.app',
        'X-Title': 'Equilib'
      },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4-5',
        max_tokens: 1600,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('OpenRouter error:', err);
      return res.status(502).json({ error: 'Erreur IA, réessaie.' });
    }

    const data = await response.json();
    const text = (data.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim();
    const bilan = JSON.parse(text);
    return res.status(200).json({ bilan, computed: { imc, tmb, tdee } });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'Erreur interne.' });
  }
}
