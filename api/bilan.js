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

  // MODE PREMIUM
  const p = `Nutritionniste. ${sex==='f'?'F':'H'} ${age}a ${weight}kg>${goal}kg.
JSON valide court:
{"approche_nom":"approche","approche_pourquoi":"phrase","approche_comment":"phrase","fenetre_if":null,"calories_jour":${tdee-400},"message_bienvenue":"message","actions":[{"titre":"t1","detail":"phrase"},{"titre":"t2","detail":"phrase"},{"titre":"t3","detail":"phrase"},{"titre":"t4","detail":"phrase"},{"titre":"t5","detail":"phrase"}],"conseils_plaisir":[{"titre":"Pizza","conseil":"phrase"},{"titre":"Alcool","conseil":"phrase"},{"titre":"Chocolat","conseil":"phrase"},{"titre":"Restaurant","conseil":"phrase"}],"message_coach_intro":"phrase"}`;

  try {
    const text = await callAI(p, 600, 'anthropic/claude-haiku-4-5-20251001');
    let bilan;
    try {
      bilan = parseJSON(text);
    } catch(parseErr) {
      // Fallback si JSON invalide
      bilan = {
        approche_nom: 'Rééquilibrage alimentaire',
        approche_pourquoi: `Adapté à ton profil de ${age} ans avec un objectif de ${+(weight-goal).toFixed(1)}kg à perdre.`,
        approche_comment: 'Mange équilibré en 3 repas, réduis les sucres rapides et les aliments ultra-transformés.',
        fenetre_if: null,
        calories_jour: tdee - 400,
        message_bienvenue: `Bienvenue dans ton plan personnalisé ! Voici tout ce qu'il te faut pour atteindre ton objectif.`,
        actions: [
          {titre: 'Structurer tes repas', detail: 'Mange à heures fixes pour réguler ta faim et ton métabolisme.'},
          {titre: 'Augmenter les protéines', detail: 'Vise 1,2g de protéines par kg de poids pour préserver ta masse musculaire.'},
          {titre: 'Gérer le stress', detail: 'Le stress chronique augmente le cortisol et favorise le stockage. Intègre 10 min de relaxation par jour.'},
          {titre: 'Améliorer le sommeil', detail: 'Un manque de sommeil augmente la faim de 24%. Vise 7-8h par nuit.'},
          {titre: 'Bouger quotidiennement', detail: 'Commence par 20 min de marche rapide par jour — suffisant pour démarrer.'}
        ],
        conseils_plaisir: [
          {titre: 'Pizza', conseil: 'Une pizza le week-end ne ruine pas tes efforts — compense avec un dîner léger.'},
          {titre: 'Alcool', conseil: 'Préfère un verre de vin sec à la bière — moins de sucres et moins de calories.'},
          {titre: 'Chocolat', conseil: 'Un carré de chocolat noir 70%+ le soir satisfait l\'envie de sucre sans excès.'},
          {titre: 'Restaurant', conseil: 'Choisis une entrée légère, un plat protéiné et évite les sauces crémeuses.'}
        ],
        message_coach_intro: `Bonjour ! Je suis ton coach Equilib. Je suis là pour répondre à toutes tes questions sur ton plan, tes menus ou tes habitudes. Qu'est-ce que tu veux savoir ?`
      };
    }
    return res.status(200).json({ bilan, computed: { imc, tmb, tdee } });
  } catch(e) {
    return res.status(500).json({ error: 'Erreur premium: ' + e.message });
  }
}
