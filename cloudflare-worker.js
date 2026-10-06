/**
 * LUMINA : proxy personnel pour Cloudflare Workers
 * ---------------------------------------------------------------------------
 * Lit la page d'une adresse (ou une image de couverture) à la place du navigateur,
 * pour contourner le blocage CORS. Utilisation :
 *     https://VOTRE-PROXY.workers.dev/?url=<adresse encodée>[&referer=<page d'origine>][&key=<clé>]
 *
 * RÉGLAGES (dans le Worker : Settings > Variables and Secrets)
 *   CLE   (secret, conseillé) : mot de passe du proxy. Sans lui, seules les adresses de
 *         ORIGINES_AUTORISEES ci-dessous peuvent s'en servir.
 *
 * SÉCURITÉ
 *   - Lecture seule (GET), uniquement des pages et des images : pas de vidéo ni de gros fichiers.
 *   - Adresses locales ou privées refusées. Taille limitée. Délai limité.
 * ---------------------------------------------------------------------------
 */

// Adresses du site LUMINA autorisées à utiliser ce proxy (sans le dossier : seulement https://nom.github.io).
const ORIGINES_AUTORISEES = ['https://lahbib-colab.github.io'];

const DELAI_MS = 15000;            // attente maximale de la page visée
const MAX_TEXTE = 3 * 1024 * 1024; // 3 Mo pour une page
const MAX_IMAGE = 8 * 1024 * 1024; // 8 Mo pour une image
const USER_AGENT = 'Mozilla/5.0 (compatible; LuminaProxy/1.0)';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origine = request.headers.get('Origin') || '';
    const origineListee = ORIGINES_AUTORISEES.includes(origine);
    const cleValide = !!env.CLE && egalConstant(url.searchParams.get('key') || '', env.CLE);
    // Si une clé est définie, elle est obligatoire. Sinon, seule une origine listée est acceptée.
    const autorise = env.CLE ? cleValide : origineListee;
    // Les erreurs doivent rester lisibles par LUMINA : on répond avec les en-têtes CORS à une origine connue.
    const cors = origineListee || cleValide ? entetesCors(origine) : {};

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400' } });
    }
    if (request.method !== 'GET') return json(405, { error: 'Méthode non autorisée.' }, cors);

    // Page d'accueil : sert au bouton « Tester » de LUMINA.
    if (!url.searchParams.has('url')) {
      return json(200, { ok: true, service: 'LUMINA proxy', cle: !!env.CLE }, cors);
    }
    if (!autorise) {
      return env.CLE
        ? json(401, { error: 'Clé invalide ou absente.' }, cors)
        : json(403, { error: 'Origine non autorisée : ajoutez votre site à ORIGINES_AUTORISEES.' }, cors);
    }

    const cible = cibleValide(url.searchParams.get('url'), url.hostname, env);
    if (!cible) return json(400, { error: 'Adresse refusée (http ou https public attendu).' }, cors);

    const entetes = new Headers({
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/*;q=0.8,*/*;q=0.5',
      'Accept-Language': 'fr,en;q=0.8',
    });
    const referer = url.searchParams.get('referer');
    if (referer && /^https?:\/\//i.test(referer)) entetes.set('Referer', referer);

    let reponse;
    try {
      reponse = await fetch(cible.href, { headers: entetes, redirect: 'follow', signal: AbortSignal.timeout(DELAI_MS) });
    } catch (e) {
      const delai = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
      return json(delai ? 504 : 502, { error: delai ? 'La page ne répond pas (délai dépassé).' : 'Page injoignable.' }, cors);
    }

    const typeComplet = reponse.headers.get('Content-Type') || '';
    const type = typeComplet.split(';')[0].trim().toLowerCase();
    const estImage = /^image\/(jpeg|png|webp|gif|avif)$/.test(type);
    const estTexte = type === '' || /^text\//.test(type) || /json|xml|javascript|mpegurl/.test(type);
    if (!estImage && !estTexte) return json(415, { error: 'Type de contenu refusé : ce proxy ne transmet que des pages et des images.' }, cors);

    const corps = await lireAvecLimite(reponse, estImage ? MAX_IMAGE : MAX_TEXTE);
    if (!corps) return json(413, { error: 'Contenu trop volumineux.' }, cors);

    return new Response(corps, {
      status: reponse.status,
      headers: { 'Content-Type': typeComplet || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...cors },
    });
  },
};

/* ------------------------------------------------------------------------ */

function entetesCors(origine) {
  return { 'Access-Control-Allow-Origin': origine || '*', Vary: 'Origin' };
}

function json(statut, objet, cors) {
  return new Response(JSON.stringify(objet), { status: statut, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors } });
}

/** Comparaison sans fuite d'information sur le temps de calcul. */
function egalConstant(a, b) {
  if (a.length !== b.length) return false;
  let ecart = 0;
  for (let i = 0; i < a.length; i++) ecart |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return ecart === 0;
}

/** Adresse visée : http(s) seulement, jamais le proxy lui-même ni un réseau privé. */
function cibleValide(brut, hoteProxy, env) {
  let u;
  try { u = new URL(brut); } catch (e) { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const h = u.hostname.toLowerCase();
  if (h === hoteProxy.toLowerCase()) return null;
  if (env.AUTORISER_LOCAL === '1') return u; // réservé aux essais automatiques
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.includes(':')) return null; // « : » = IPv6 littérale
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (m) {
    const [a, b] = [+m[1], +m[2]];
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return null;
  }
  return u;
}

/** Lit la réponse en s'arrêtant au-delà de la limite (renvoie null si trop grosse). */
async function lireAvecLimite(reponse, max) {
  if (!reponse.body) return new Uint8Array(0);
  const lecteur = reponse.body.getReader();
  const morceaux = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { try { await lecteur.cancel(); } catch (e) { /* ignoré */ } return null; }
    morceaux.push(value);
  }
  const sortie = new Uint8Array(total);
  let pos = 0;
  for (const m of morceaux) { sortie.set(m, pos); pos += m.byteLength; }
  return sortie;
}
