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
      model: 'anthropic/claude-sonnet-4-5',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim();
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
      const systemPrompt = `Tu es le coach bienveillant d'Equilib. Réponds en français, de façon courte et pratique.`;
      const reply = await callAI(systemPrompt + '\n\n' + messages.map(m => m.role + ': ' + m.content).join('\n'), 400);
      return res.status(200).json({ reply });
    } catch(e) {
      return res.status(500).json({ error: 'Erreur coach' });
    }
  }

  // VALIDATION
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
    const prompt = `Expert nutrition bienveillant. Parle en "tu". Diagnostic SANS solutions.
Profil: ${age}ans ${sex==='f'?'F':'M'} ${height}cm ${weight}kg objectif${goal}kg IMC${imc} TMB${tmb} TDEE${tdee} stress:${profil.stress||'mod'} activité:${profil.activite||'sed'}.
JSON brut uniquement: {"imc_label":"Poids normal","imc_badge_color":"vert","score_facilite":7,"score_alimentation":6,"score_lifestyle":5,"score_motivation":8,"score_facilite_comment":"phrase courte","score_alimentation_comment":"phrase courte","score_lifestyle_comment":"phrase courte","score_motivation_comment":"phrase courte","hero_subtitle":"phrase accrocheuse","diagnostic":"3 phrases personnalisées","temps_realiste":"4-6 mois","calories_conseillees":1500,"imc_interpretation":"2 phrases","tmb_interpretation":"2 phrases","tdee_interpretation":"2 phrases","deficit_interpretation":"2 phrases","bloqueurs":[{"niveau":"critique","titre":"nom du bloqueur","explication":"2 phrases"},{"niveau":"modéré","titre":"nom","explication":"2 phrases"},{"niveau":"faible","titre":"nom","explication":"2 phrases"}],"teaser_premium":"phrase engageante","message_fin":"message court"}`;

    try {
      const text = await callAI(prompt, 1200);
      const bilan = JSON.parse(text);
      return res.status(200).json({ bilan, computed: { imc, tmb, tdee } });
    } catch(e) {
      return res.status(500).json({ error: 'Erreur bilan gratuit: ' + e.message });
    }
  }

  // MODE PREMIUM — prompt court pour éviter le timeout
  const prompt = `Expert nutrition. Parle en "tu". Plan COMPLET mais CONCIS.
Profil: ${age}ans ${sex==='f'?'F':'M'} ${height}cm ${weight}kg objectif${goal}kg stress:${profil.stress||'mod'} activité:${profil.activite||'sed'}.
JSON brut uniquement (pas de markdown):
{"approche_nom":"Rééquilibrage alimentaire","approche_pourquoi":"2 phrases pourquoi c'est adapté","approche_comment":"2 phrases comment faire","fenetre_if":null,"calories_jour":1600,"message_bienvenue":"message chaleureux court","actions":[{"titre":"titre action 1","detail":"2 phrases concrètes"},{"titre":"titre action 2","detail":"2 phrases"},{"titre":"titre action 3","detail":"2 phrases"},{"titre":"titre action 4","detail":"2 phrases"},{"titre":"titre action 5","detail":"2 phrases"}],"menus":[{"semaine":1,"objectif":"objectif semaine 1","jours":[{"jour":"Lundi","repas":"Yaourt · Salade poulet · Poisson légumes"},{"jour":"Mardi","repas":"Flocons avoine · Wrap thon · Omelette"},{"jour":"Mercredi","repas":"Fruit · Riz poulet · Soupe lentilles"},{"jour":"Jeudi","repas":"Pain complet · Salade niçoise · Steak"},{"jour":"Vendredi","repas":"Smoothie · Pâtes complètes · Cabillaud"},{"jour":"Week-end","repas":"Repas libres avec modération"}]},{"semaine":2,"objectif":"objectif semaine 2","jours":[{"jour":"Lundi","repas":"repas adapté"},{"jour":"Mardi","repas":"repas adapté"},{"jour":"Mercredi","repas":"repas adapté"},{"jour":"Jeudi","repas":"repas adapté"},{"jour":"Vendredi","repas":"repas adapté"},{"jour":"Week-end","repas":"conseil plaisir"}]},{"semaine":3,"objectif":"objectif semaine 3","jours":[{"jour":"Lundi","repas":"repas"},{"jour":"Mardi","repas":"repas"},{"jour":"Mercredi","repas":"repas"},{"jour":"Jeudi","repas":"repas"},{"jour":"Vendredi","repas":"repas"},{"jour":"Week-end","repas":"conseil"}]},{"semaine":4,"objectif":"objectif semaine 4","jours":[{"jour":"Lundi","repas":"repas"},{"jour":"Mardi","repas":"repas"},{"jour":"Mercredi","repas":"repas"},{"jour":"Jeudi","repas":"repas"},{"jour":"Vendredi","repas":"repas"},{"jour":"Week-end","repas":"conseil"}]}],"conseils_plaisir":[{"titre":"Pizza","conseil":"1 phrase"},{"titre":"Alcool","conseil":"1 phrase"},{"titre":"Chocolat","conseil":"1 phrase"},{"titre":"Restaurant","conseil":"1 phrase"}],"message_coach_intro":"message coach personnalisé"}`;

  try {
    const text = await callAI(prompt, 2000);
    const bilan = JSON.parse(text);
    return res.status(200).json({ bilan, computed: { imc, tmb, tdee } });
  } catch(e) {
    return res.status(500).json({ error: 'Erreur plan premium: ' + e.message });
  }
}
