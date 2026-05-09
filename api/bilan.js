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

async function callAI(prompt, maxTokens) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://equilib.vercel.app',
      'X-Title': 'Equilib'
    },
    body: JSON.stringify({
      model: 'anthropic/claude-haiku-4-5-20251001',
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
      const reply = await callAI('Coach nutrition Equilib. Réponds en français, court et pratique.\n\n' + conv, 300);
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
  if (mode !== 'premium') {
    const prompt = `Expert nutrition. "tu". Diagnostic sans solutions. Profil: ${age}ans ${sex==='f'?'F':'M'} ${height}cm ${weight}kg obj:${goal}kg IMC:${imc} TMB:${tmb} TDEE:${tdee} stress:${profil.stress||'mod'} act:${profil.activite||'sed'}.
JSON uniquement: {"imc_label":"Poids normal","imc_badge_color":"vert","score_facilite":7,"score_alimentation":6,"score_lifestyle":5,"score_motivation":8,"score_facilite_comment":"phrase","score_alimentation_comment":"phrase","score_lifestyle_comment":"phrase","score_motivation_comment":"phrase","hero_subtitle":"phrase","diagnostic":"2 phrases","temps_realiste":"4-6 mois","calories_conseillees":1500,"imc_interpretation":"1 phrase","tmb_interpretation":"1 phrase","tdee_interpretation":"1 phrase","deficit_interpretation":"1 phrase","bloqueurs":[{"niveau":"critique","titre":"bloqueur","explication":"2 phrases"},{"niveau":"modéré","titre":"bloqueur","explication":"2 phrases"},{"niveau":"faible","titre":"bloqueur","explication":"1 phrase"}],"teaser_premium":"phrase","message_fin":"phrase"}`;

    try {
      const text = await callAI(prompt, 900);
      const bilan = parseJSON(text);
      return res.status(200).json({ bilan, computed: { imc, tmb, tdee } });
    } catch(e) {
      return res.status(500).json({ error: 'Erreur bilan: ' + e.message });
    }
  }

  // MODE PREMIUM
  const prompt = `Expert nutrition. "tu". Plan complet pour ${sex==='f'?'femme':'homme'} ${age}ans ${weight}kg obj:${goal}kg act:${profil.activite||'sed'} stress:${profil.stress||'mod'}.
JSON uniquement sans markdown:
{"approche_nom":"Rééquilibrage alimentaire","approche_pourquoi":"2 phrases","approche_comment":"2 phrases","fenetre_if":null,"calories_jour":${tdee-500},"message_bienvenue":"message court","actions":[{"titre":"titre","detail":"2 phrases"},{"titre":"titre","detail":"2 phrases"},{"titre":"titre","detail":"2 phrases"},{"titre":"titre","detail":"2 phrases"},{"titre":"titre","detail":"2 phrases"}],"menus":[{"semaine":1,"objectif":"obj s1","jours":[{"jour":"Lundi","repas":"Yaourt · Salade · Poisson"},{"jour":"Mardi","repas":"Flocons · Wrap · Omelette"},{"jour":"Mercredi","repas":"Fruit · Riz · Soupe"},{"jour":"Jeudi","repas":"Toast · Salade · Steak"},{"jour":"Vendredi","repas":"Smoothie · Pâtes · Cabillaud"},{"jour":"Week-end","repas":"Repas libres"}]},{"semaine":2,"objectif":"obj s2","jours":[{"jour":"Lundi","repas":"repas"},{"jour":"Mardi","repas":"repas"},{"jour":"Mercredi","repas":"repas"},{"jour":"Jeudi","repas":"repas"},{"jour":"Vendredi","repas":"repas"},{"jour":"Week-end","repas":"conseil"}]},{"semaine":3,"objectif":"obj s3","jours":[{"jour":"Lundi","repas":"repas"},{"jour":"Mardi","repas":"repas"},{"jour":"Mercredi","repas":"repas"},{"jour":"Jeudi","repas":"repas"},{"jour":"Vendredi","repas":"repas"},{"jour":"Week-end","repas":"conseil"}]},{"semaine":4,"objectif":"obj s4","jours":[{"jour":"Lundi","repas":"repas"},{"jour":"Mardi","repas":"repas"},{"jour":"Mercredi","repas":"repas"},{"jour":"Jeudi","repas":"repas"},{"jour":"Vendredi","repas":"repas"},{"jour":"Week-end","repas":"conseil"}]}],"conseils_plaisir":[{"titre":"Pizza","conseil":"phrase"},{"titre":"Alcool","conseil":"phrase"},{"titre":"Chocolat","conseil":"phrase"},{"titre":"Restaurant","conseil":"phrase"}],"message_coach_intro":"message coach"}`;

  try {
    const text = await callAI(prompt, 2500);
    const bilan = parseJSON(text);
    return res.status(200).json({ bilan, computed: { imc, tmb, tdee } });
  } catch(e) {
    return res.status(500).json({ error: 'Erreur premium: ' + e.message });
  }
}
