const rateLimitMap = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > 3600000) { rateLimitMap.set(ip, { count: 1, start: now }); return true; }
  if (entry.count >= 50) return false;
  entry.count++;
  rateLimitMap.set(ip, entry);
  return true;
}

function parseJSON(text) {
  const clean = text.replace(/```json|```/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : clean);
}

async function callAI(prompt, maxTokens, model) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://equilib.vercel.app',
      'X-Title': 'Equilib'
    },
    body: JSON.stringify({
      model: model || 'anthropic/claude-sonnet-4-5',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || '').trim();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Trop de requêtes. Réessaie dans une heure.' });

  const body = req.body || {};
  const mode = body.mode || 'gratuit';

  // MODE CHAT
  if (mode === 'chat') {
    const messages = body.messages || [];
    if (!messages.length) return res.status(400).json({ error: 'Messages manquants' });
    try {
      const conv = messages.slice(-4).map(m => m.role + ': ' + m.content).join('\n');
      const reply = await callAI('Coach nutrition Equilib. Réponds en français, court et pratique.\n\n' + conv, 400, 'anthropic/claude-haiku-4-5-20251001');
      return res.status(200).json({ reply });
    } catch(e) {
      return res.status(500).json({ error: 'Erreur coach' });
    }
  }

  const profil = body.profil || {};
  const { age, sex, height, weight, goal } = profil;
  if (!age || !sex || !height || !weight || !goal) return res.status(400).json({ error: 'Profil incomplet' });

  const imc = +(weight / (height/100)**2).toFixed(1);
  const tmb = sex === 'f'
    ? Math.round(10*weight + 6.25*height - 5*age - 161)
    : Math.round(10*weight + 6.25*height - 5*age + 5);
  const actFactors = { sed:1.2, leger:1.375, mod:1.55, actif:1.725 };
  const tdee = Math.round(tmb * (actFactors[profil.activite] || 1.375));

  // MODE GRATUIT — Sonnet pour qualité maximale
  if (mode !== 'premium') {
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
{"imc_label":"<Insuffisance pondérale|Poids normal|Surpoids|Obésité modérée>","imc_badge_color":"<vert|orange|rouge>","score_facilite":<1-10>,"score_alimentation":<1-10>,"score_lifestyle":<1-10>,"score_motivation":<1-10>,"score_facilite_comment":"<1 phrase>","score_alimentation_comment":"<1 phrase>","score_lifestyle_comment":"<1 phrase>","score_motivation_comment":"<1 phrase>","hero_subtitle":"<1 phrase accrocheuse>","diagnostic":"<3-4 phrases bienveillantes et très personnalisées>","temps_realiste":"<ex: 4-6 mois>","calories_conseillees":<nombre>,"imc_interpretation":"<2 phrases>","tmb_interpretation":"<2 phrases>","tdee_interpretation":"<2 phrases>","deficit_interpretation":"<2 phrases>","bloqueurs":[{"niveau":"critique|modéré|faible","titre":"...","explication":"<2-3 phrases>"},{"niveau":"critique|modéré|faible","titre":"...","explication":"<2-3 phrases>"},{"niveau":"critique|modéré|faible","titre":"...","explication":"<2-3 phrases>"}],"teaser_premium":"<phrase engageante et personnalisée>","message_fin":"<message court et sincère>"}`;

    try {
      const text = await callAI(prompt, 1600);
      const bilan = parseJSON(text);
      return res.status(200).json({ bilan, computed: { imc, tmb, tdee } });
    } catch(e) {
      return res.status(500).json({ error: 'Erreur bilan: ' + e.message });
    }
  }

  // MODE PREMIUM — Haiku pour rapidité, menus générés côté client
  const prompt = `Nutritionniste bienveillant. Parle en "tu".
Profil: ${sex==='f'?'Femme':'Homme'} ${age}ans ${weight}kg objectif ${goal}kg stress:${profil.stress||'mod'} activité:${profil.activite||'sed'}.
Réponds UNIQUEMENT en JSON brut sans markdown:
{"approche_nom":"nom de l'approche recommandée","approche_pourquoi":"1 phrase expliquant pourquoi","approche_comment":"1 phrase expliquant comment","fenetre_if":null,"calories_jour":${tdee-400},"message_bienvenue":"message chaleureux personnalisé","actions":[{"titre":"titre action 1","detail":"1 phrase concrète"},{"titre":"titre action 2","detail":"1 phrase"},{"titre":"titre action 3","detail":"1 phrase"},{"titre":"titre action 4","detail":"1 phrase"},{"titre":"titre action 5","detail":"1 phrase"}],"conseils_plaisir":[{"titre":"Pizza","conseil":"1 phrase"},{"titre":"Alcool","conseil":"1 phrase"},{"titre":"Chocolat","conseil":"1 phrase"},{"titre":"Restaurant","conseil":"1 phrase"}],"message_coach_intro":"1 phrase de bienvenue du coach"}`;

  try {
    const text = await callAI(prompt, 800, 'anthropic/claude-haiku-4-5-20251001');
    const bilan = parseJSON(text);
    return res.status(200).json({ bilan, computed: { imc, tmb, tdee } });
  } catch(e) {
    return res.status(500).json({ error: 'Erreur premium: ' + e.message });
  }
}
