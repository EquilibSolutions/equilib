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

  // MODE GRATUIT
  if (mode !== 'premium' && mode !== 'premium-menus') {
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

  // MODE PREMIUM-MENUS — génère uniquement les menus 4 semaines
  if (mode === 'premium-menus') {
    const approche = body.approche || 'rééquilibrage alimentaire';
    const prompt = `Nutritionniste expert. Crée 4 semaines de menus complets et variés pour ${sex==='f'?'une femme':'un homme'} de ${age} ans, ${weight}kg, objectif ${goal}kg, activité ${profil.activite||'sed'}, stress ${profil.stress||'mod'}. Approche : ${approche}. Calories cibles : ${tdee-400} kcal/jour.

Réponds UNIQUEMENT avec du JSON brut (pas de markdown) :
{"menus":[{"semaine":1,"objectif":"<objectif semaine 1>","jours":[{"jour":"Lundi","repas":"<petit-déj · déjeuner · dîner>"},{"jour":"Mardi","repas":"<repas>"},{"jour":"Mercredi","repas":"<repas>"},{"jour":"Jeudi","repas":"<repas>"},{"jour":"Vendredi","repas":"<repas>"},{"jour":"Week-end","repas":"<conseil et repas libre>"}]},{"semaine":2,"objectif":"<objectif>","jours":[{"jour":"Lundi","repas":"<repas>"},{"jour":"Mardi","repas":"<repas>"},{"jour":"Mercredi","repas":"<repas>"},{"jour":"Jeudi","repas":"<repas>"},{"jour":"Vendredi","repas":"<repas>"},{"jour":"Week-end","repas":"<conseil>"}]},{"semaine":3,"objectif":"<objectif>","jours":[{"jour":"Lundi","repas":"<repas>"},{"jour":"Mardi","repas":"<repas>"},{"jour":"Mercredi","repas":"<repas>"},{"jour":"Jeudi","repas":"<repas>"},{"jour":"Vendredi","repas":"<repas>"},{"jour":"Week-end","repas":"<conseil>"}]},{"semaine":4,"objectif":"<objectif>","jours":[{"jour":"Lundi","repas":"<repas>"},{"jour":"Mardi","repas":"<repas>"},{"jour":"Mercredi","repas":"<repas>"},{"jour":"Jeudi","repas":"<repas>"},{"jour":"Vendredi","repas":"<repas>"},{"jour":"Week-end","repas":"<conseil>"}]}]}`;

    try {
      const text = await callAI(prompt, 2000, 'anthropic/claude-haiku-4-5-20251001');
      const data = parseJSON(text);
      return res.status(200).json(data);
    } catch(e) {
      return res.status(500).json({ error: 'Erreur menus: ' + e.message });
    }
  }

  // MODE PREMIUM — approche + actions + conseils (sans menus)
  const prompt = `Tu es un expert en nutrition et perte de poids bienveillant. Tu parles en "tu".

Profil :
- ${sex === 'f' ? 'Femme' : 'Homme'} de ${age} ans | ${height}cm | ${weight}kg | Objectif : ${goal}kg
- Stress : ${profil.stress||'mod'} | Activité : ${profil.activite||'sed'}
- Habitudes : ${(profil.alim||[]).join(', ')||'non précisé'}
- Obstacles : ${(profil.obstacles||[]).join(', ')||'non précisé'}
- Approche souhaitée : ${profil.approche||'à déterminer'}
- Calories cibles : ${tdee-400} kcal/jour

Réponds UNIQUEMENT avec du JSON brut (pas de markdown) :
{"approche_nom":"<nom précis de l'approche>","approche_pourquoi":"<2-3 phrases expliquant pourquoi cette approche est idéale>","approche_comment":"<2-3 phrases expliquant comment l'appliquer concrètement>","fenetre_if":"<ex: 12h-20h | null si pas jeûne>","calories_jour":<nombre>,"message_bienvenue":"<message chaleureux et personnalisé>","actions":[{"titre":"<titre>","detail":"<2 phrases concrètes>"},{"titre":"<titre>","detail":"<2 phrases>"},{"titre":"<titre>","detail":"<2 phrases>"},{"titre":"<titre>","detail":"<2 phrases>"},{"titre":"<titre>","detail":"<2 phrases>"}],"conseils_plaisir":[{"titre":"<titre>","conseil":"<1 phrase concrète>"},{"titre":"<titre>","conseil":"<1 phrase>"},{"titre":"<titre>","conseil":"<1 phrase>"},{"titre":"<titre>","conseil":"<1 phrase>"}],"message_coach_intro":"<message coach personnalisé et chaleureux>"}`;

  try {
    const text = await callAI(prompt, 1200, 'anthropic/claude-haiku-4-5-20251001');
    const bilan = parseJSON(text);
    return res.status(200).json({ bilan, computed: { imc, tmb, tdee } });
  } catch(e) {
    return res.status(500).json({ error: 'Erreur premium: ' + e.message });
  }
}
