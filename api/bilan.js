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

async function callAI(messages, maxTokens) {
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
      messages
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
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Trop de requêtes.' });

  const body = req.body || {};
  const mode = body.mode || 'gratuit';

  // ============ MODE CHAT ============
  if (mode === 'chat') {
    const messages = body.messages || [];
    if (!messages.length) return res.status(400).json({ error: 'Messages manquants' });
    try {
      const reply = await callAI(messages, 500);
      return res.status(200).json({ reply });
    } catch(e) {
      return res.status(500).json({ error: 'Erreur coach IA' });
    }
  }

  // ============ VALIDATION PROFIL ============
  const profil = body.profil || {};
  const { age, sex, height, weight, goal } = profil;
  if (!age || !sex || !height || !weight || !goal) return res.status(400).json({ error: 'Profil incomplet' });

  const imc = +(weight / (height/100)**2).toFixed(1);
  const tmb = sex === 'f'
    ? Math.round(10*weight + 6.25*height - 5*age - 161)
    : Math.round(10*weight + 6.25*height - 5*age + 5);
  const actFactors = { sed:1.2, leger:1.375, mod:1.55, actif:1.725 };
  const tdee = Math.round(tmb * (actFactors[profil.activite] || 1.375));

  // ============ MODE GRATUIT ============
  if (mode === 'gratuit' || mode !== 'premium') {
    const prompt = `Tu es un expert en nutrition bienveillant. Tu parles en "tu". Pas de solutions — seulement le diagnostic.

Profil : ${age} ans, ${sex==='f'?'Femme':'Homme'}, ${height}cm, ${weight}kg, objectif ${goal}kg, IMC ${imc}, TMB ${tmb}kcal, TDEE ${tdee}kcal, stress ${profil.stress||'mod'}, activité ${profil.activite||'sed'}.

Réponds UNIQUEMENT en JSON brut :
{"imc_label":"Poids normal","imc_badge_color":"vert","score_facilite":7,"score_alimentation":6,"score_lifestyle":5,"score_motivation":8,"score_facilite_comment":"<1 phrase>","score_alimentation_comment":"<1 phrase>","score_lifestyle_comment":"<1 phrase>","score_motivation_comment":"<1 phrase>","hero_subtitle":"<1 phrase accrocheuse>","diagnostic":"<3-4 phrases personnalisées>","temps_realiste":"4-6 mois","calories_conseillees":1500,"imc_interpretation":"<2 phrases>","tmb_interpretation":"<2 phrases>","tdee_interpretation":"<2 phrases>","deficit_interpretation":"<2 phrases>","bloqueurs":[{"niveau":"critique","titre":"...","explication":"<2-3 phrases>"},{"niveau":"modéré","titre":"...","explication":"<2-3 phrases>"},{"niveau":"faible","titre":"...","explication":"<2-3 phrases>"}],"teaser_premium":"<phrase engageante>","message_fin":"<message court>"}`;

    try {
      const text = await callAI([{ role: 'user', content: prompt }], 1600);
      const bilan = JSON.parse(text);
      return res.status(200).json({ bilan, computed: { imc, tmb, tdee } });
    } catch(e) {
      console.error('Erreur gratuit:', e.message);
      return res.status(500).json({ error: 'Erreur génération bilan' });
    }
  }

  // ============ MODE PREMIUM ============
  const prompt = `Tu es un expert en nutrition et perte de poids. Génère un plan COMPLET. Tu parles en "tu", bienveillant et humain.

Profil : ${age} ans, ${sex==='f'?'Femme':'Homme'}, ${height}cm, ${weight}kg, objectif ${goal}kg, IMC ${imc}, TMB ${tmb}kcal, TDEE ${tdee}kcal, stress ${profil.stress||'mod'}, activité ${profil.activite||'sed'}.

Réponds UNIQUEMENT en JSON brut sans markdown :
{"approche_nom":"<Jeûne intermittent 16:8|Rééquilibrage alimentaire|Déficit calorique progressif>","approche_pourquoi":"<2 phrases>","approche_comment":"<2 phrases>","fenetre_if":"<12h-20h ou null>","calories_jour":1600,"message_bienvenue":"<message chaleureux>","actions":[{"titre":"Action 1","detail":"<2 phrases>"},{"titre":"Action 2","detail":"<2 phrases>"},{"titre":"Action 3","detail":"<2 phrases>"},{"titre":"Action 4","detail":"<2 phrases>"},{"titre":"Action 5","detail":"<2 phrases>"}],"menus":[{"semaine":1,"objectif":"<objectif>","jours":[{"jour":"Lundi","repas":"Yaourt nature · Salade poulet · Saumon légumes"},{"jour":"Mardi","repas":"Flocons avoine · Wrap thon · Omelette légumes"},{"jour":"Mercredi","repas":"Fruit · Riz poulet · Soupe lentilles"},{"jour":"Jeudi","repas":"Pain complet · Salade niçoise · Steak haricots"},{"jour":"Vendredi","repas":"Smoothie · Pâtes complètes · Poisson vapeur"},{"jour":"Week-end","repas":"Repas libres avec modération"}]},{"semaine":2,"objectif":"<objectif>","jours":[{"jour":"Lundi","repas":"<repas>"},{"jour":"Mardi","repas":"<repas>"},{"jour":"Mercredi","repas":"<repas>"},{"jour":"Jeudi","repas":"<repas>"},{"jour":"Vendredi","repas":"<repas>"},{"jour":"Week-end","repas":"<conseil>"}]},{"semaine":3,"objectif":"<objectif>","jours":[{"jour":"Lundi","repas":"<repas>"},{"jour":"Mardi","repas":"<repas>"},{"jour":"Mercredi","repas":"<repas>"},{"jour":"Jeudi","repas":"<repas>"},{"jour":"Vendredi","repas":"<repas>"},{"jour":"Week-end","repas":"<conseil>"}]},{"semaine":4,"objectif":"<objectif>","jours":[{"jour":"Lundi","repas":"<repas>"},{"jour":"Mardi","repas":"<repas>"},{"jour":"Mercredi","repas":"<repas>"},{"jour":"Jeudi","repas":"<repas>"},{"jour":"Vendredi","repas":"<repas>"},{"jour":"Week-end","repas":"<conseil>"}]}],"conseils_plaisir":[{"titre":"Pizza du vendredi","conseil":"<1 phrase>"},{"titre":"Alcool occasionnel","conseil":"<1 phrase>"},{"titre":"Chocolat","conseil":"<1 phrase>"},{"titre":"Restaurant","conseil":"<1 phrase>"}],"message_coach_intro":"<message coach personnalisé>"}`;

  try {
    const text = await callAI([{ role: 'user', content: prompt }], 3000);
    const bilan = JSON.parse(text);
    return res.status(200).json({ bilan, computed: { imc, tmb, tdee } });
  } catch(e) {
    console.error('Erreur premium:', e.message, 'Text reçu:', e.text);
    return res.status(500).json({ error: 'Erreur génération plan premium' });
  }
}
