/**
 * extraire-film.js
 * ---------------------------------------------------------------------------
 * Extrait automatiquement, à partir de l'URL d'une page de film :
 *   - le titre  (balise <title>, entités HTML décodées)
 *   - l'affiche (.film-detail-poster ou équivalent, URL rendue absolue)
 *   - le flux vidéo : lien .m3u8 direct, sinon .m3u8 trouvé dans une iframe,
 *                     sinon le lien de l'iframe en dernier recours
 *
 * Fonctionne dans le navigateur, sans dépendance. Le HTML est téléchargé via un proxy CORS
 * (api.allorigins.win par défaut), puis analysé avec DOMParser.
 *
 * Utilisation :
 *   const film = await extraireFilm('https://exemple.com/film/mon-film');
 *   // { titre, affiche, flux, typeFlux, iframe, urlPage, avertissements }
 *
 * typeFlux vaut :
 *   'm3u8'         lien .m3u8 trouvé directement dans la page
 *   'm3u8-iframe'  lien .m3u8 trouvé dans le contenu d'une iframe
 *   'iframe'       aucun .m3u8 : adresse de l'iframe (dernier recours)
 *   null           aucun flux trouvé (le titre et l'affiche sont quand même renvoyés)
 *
 * Erreurs : ErreurExtraction avec code 'URL_INVALIDE' ou 'PAGE_INACCESSIBLE'.
 *
 * Limites à connaître :
 *   - Un proxy CORS public est un service tiers : il peut être lent, limité, ou refuser certains sites,
 *     et il voit les adresses que vous demandez. Pour un usage durable, utilisez votre propre proxy
 *     (voir `proxies` dans les options).
 *   - Le proxy ne sert qu'à lire le HTML. Lire ensuite la vidéo (.m3u8) dépend de la source elle-même.
 *   - Seul le code HTML reçu est analysé : un lien fabriqué par JavaScript après le chargement
 *     de la page n'est pas visible.
 *   - Les iframes ne sont suivies que sur un niveau.
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  /* ===================================================================== */
  /* Configuration                                                         */
  /* ===================================================================== */

  /** Options par défaut, remplaçables à chaque appel : extraireFilm(url, { delaiMs: 8000 }). */
  const OPTIONS = {
    /** Délai maximal par requête, en millisecondes. */
    delaiMs: 15000,
    /** Essayer d'abord sans proxy (marche seulement si le site autorise le CORS). */
    essayerDirectement: false,
    /** Nombre maximal d'iframes examinées. */
    maxIframes: 3,
    /**
     * Proxys essayés dans l'ordre, jusqu'au premier qui répond.
     * `url(u)` construit l'adresse du proxy ; `json: true` si la réponse est enveloppée dans { contents }.
     */
    proxies: [
      { nom: 'allorigins (raw)', url: (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u) },
      { nom: 'allorigins (get)', url: (u) => 'https://api.allorigins.win/get?url=' + encodeURIComponent(u), json: true },
    ],
  };

  /** Sélecteurs de l'affiche, du plus précis au plus général. */
  const SELECTEURS_AFFICHE = [
    '.film-detail-poster img',
    '.film-poster img',
    '.movie-poster img',
    '.poster img',
    '[class*="poster" i] img',
    'img[class*="poster" i]',
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
    'video[poster]',
    'img[itemprop="image"]',
  ];

  /** Un .m3u8 absolu ou sans protocole (//cdn.exemple.com/…), avec sa chaîne de requête éventuelle. */
  const RE_M3U8_ABSOLU = /(?:https?:)?\/\/[^"'\s<>\\)]+?\.m3u8(?:\?[^"'\s<>\\)]*)?/i;
  /** Un .m3u8 relatif, écrit entre guillemets ou parenthèses : "/flux/film.m3u8". */
  const RE_M3U8_RELATIF = /["'(]((?!https?:|\/\/)[^"'\s<>()]+?\.m3u8(?:\?[^"'\s<>()]*)?)["')]/i;

  /* ===================================================================== */
  /* Erreur dédiée                                                         */
  /* ===================================================================== */

  class ErreurExtraction extends Error {
    /** @param {string} message  @param {'URL_INVALIDE'|'PAGE_INACCESSIBLE'} code */
    constructor(message, code) {
      super(message);
      this.name = 'ErreurExtraction';
      this.code = code;
    }
  }

  /* ===================================================================== */
  /* Utilitaires                                                           */
  /* ===================================================================== */

  /**
   * Rend une adresse absolue (http/https uniquement) à partir d'une adresse relative.
   * Renvoie null si la valeur est vide, invalide, ou d'un autre type (javascript:, data:, …).
   * @param {string|null|undefined} valeur
   * @param {string} base  adresse de référence
   * @returns {string|null}
   */
  function absolue(valeur, base) {
    if (!valeur) return null;
    try {
      const u = new URL(String(valeur).trim(), base);
      return /^https?:$/.test(u.protocol) ? u.href : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Décode les entités HTML (&eacute;, &amp;, &#039;…), y compris quand elles sont encodées deux fois.
   * Le décodage passe par un document inerte : aucun script n'est exécuté, rien n'est chargé.
   * @param {string} texte
   * @returns {string}
   */
  function decoderEntites(texte) {
    let t = String(texte == null ? '' : texte);
    for (let i = 0; i < 2 && /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]+);/i.test(t); i++) {
      t = new DOMParser().parseFromString(t, 'text/html').documentElement.textContent;
    }
    return t.replace(/\s+/g, ' ').trim();
  }

  /** Remet le texte d'une page dans un état où les adresses échappées du JavaScript sont lisibles. */
  function normaliser(texte) {
    return String(texte)
      .replace(/\\u0026/gi, '&')
      .replace(/\\u002F/gi, '/')
      .replace(/\\\//g, '/')
      .replace(/&amp;/g, '&');
  }

  /** Lance une requête avec un délai maximal. */
  async function fetchAvecDelai(url, delaiMs) {
    const controle = new AbortController();
    const minuteur = setTimeout(() => controle.abort(), delaiMs);
    try {
      return await fetch(url, { signal: controle.signal, credentials: 'omit' });
    } finally {
      clearTimeout(minuteur);
    }
  }

  /* ===================================================================== */
  /* Téléchargement du HTML (direct, puis proxys CORS)                     */
  /* ===================================================================== */

  /**
   * Télécharge le code HTML d'une adresse externe.
   * @param {string} url
   * @param {typeof OPTIONS} opts
   * @returns {Promise<string>}
   * @throws {ErreurExtraction} PAGE_INACCESSIBLE si tous les essais échouent
   */
  async function recupererHtml(url, opts) {
    const essais = [];
    if (opts.essayerDirectement) essais.push({ nom: 'accès direct', construire: (u) => u, json: false });
    for (const p of opts.proxies) essais.push({ nom: p.nom, construire: p.url, json: !!p.json });

    const echecs = [];
    for (const essai of essais) {
      try {
        const reponse = await fetchAvecDelai(essai.construire(url), opts.delaiMs);
        if (!reponse.ok) throw new Error('HTTP ' + reponse.status);
        let texte = await reponse.text();
        if (essai.json) {
          const enveloppe = JSON.parse(texte);
          if (typeof enveloppe.contents !== 'string') throw new Error('réponse vide');
          texte = enveloppe.contents;
        }
        if (texte.trim().length < 20) throw new Error('page vide');
        return texte;
      } catch (e) {
        echecs.push(essai.nom + ' : ' + (e.name === 'AbortError' ? 'délai dépassé' : e.message));
      }
    }
    throw new ErreurExtraction('Impossible de télécharger la page (' + echecs.join(' ; ') + ').', 'PAGE_INACCESSIBLE');
  }

  /* ===================================================================== */
  /* Extraction à partir du DOM                                            */
  /* ===================================================================== */

  /** Titre : balise <title>, sinon og:title. Entités décodées. */
  function lireTitre(doc) {
    const brut = (doc.querySelector('title') || {}).textContent
      || (doc.querySelector('meta[property="og:title"]') || { getAttribute: () => '' }).getAttribute('content');
    return decoderEntites(brut);
  }

  /** Premier élément d'un attribut srcset (« image.jpg 1x, image2.jpg 2x » -> « image.jpg »). */
  const premierSrcset = (srcset) => (srcset ? srcset.split(',')[0].trim().split(/\s+/)[0] : '');

  /**
   * Affiche : premier sélecteur qui donne une image valide, avec gestion du chargement différé
   * (data-src, srcset) et conversion en adresse absolue.
   */
  function lireAffiche(doc, base) {
    for (const sel of SELECTEURS_AFFICHE) {
      for (const el of doc.querySelectorAll(sel)) {
        const candidats = el.tagName === 'META' ? [el.getAttribute('content')]
          : el.tagName === 'VIDEO' ? [el.getAttribute('poster')]
          : [el.getAttribute('src'), el.getAttribute('data-src'), el.getAttribute('data-lazy-src'),
             el.getAttribute('data-original'), premierSrcset(el.getAttribute('srcset'))];
        for (const c of candidats) {
          const url = absolue(c, base);
          if (url) return url;
        }
      }
    }
    return null;
  }

  /**
   * Cherche un lien .m3u8 : d'abord dans les éléments HTML (<source>, <video>, <a>),
   * puis dans tout le texte (scripts, JSON, attributs).
   * @returns {string|null} adresse absolue
   */
  function trouverM3u8(doc, html, base) {
    for (const el of doc.querySelectorAll('source[src], video[src], a[href], [data-src], [data-url]')) {
      for (const attr of ['src', 'href', 'data-src', 'data-url']) {
        const v = el.getAttribute(attr);
        if (v && /\.m3u8(\?|#|$)/i.test(v)) {
          const url = absolue(normaliser(v), base);
          if (url) return url;
        }
      }
    }
    const texte = normaliser(html);
    const absoluTrouve = RE_M3U8_ABSOLU.exec(texte);
    if (absoluTrouve) {
      const url = absolue(absoluTrouve[0].startsWith('//') ? 'https:' + absoluTrouve[0] : absoluTrouve[0], base);
      if (url) return url;
    }
    const relatif = RE_M3U8_RELATIF.exec(texte);
    return relatif ? absolue(relatif[1], base) : null;
  }

  /** Adresses absolues des iframes de la page (sans doublon, hors about:blank). */
  function listerIframes(doc, base, max) {
    const urls = [];
    for (const f of doc.querySelectorAll('iframe')) {
      const url = absolue(f.getAttribute('src') || f.getAttribute('data-src'), base);
      if (url && !urls.includes(url)) urls.push(url);
      if (urls.length >= max) break;
    }
    return urls;
  }

  /* ===================================================================== */
  /* Fonction principale                                                   */
  /* ===================================================================== */

  /**
   * Extrait titre, affiche et flux vidéo d'une page de film.
   *
   * @param {string} urlPage  adresse de la page du film (http ou https)
   * @param {Partial<typeof OPTIONS>} [options]
   * @returns {Promise<{
   *   titre: string,
   *   affiche: string|null,
   *   flux: string|null,
   *   typeFlux: 'm3u8'|'m3u8-iframe'|'iframe'|null,
   *   iframe: string|null,
   *   urlPage: string,
   *   avertissements: string[]
   * }>}
   * @throws {ErreurExtraction}
   */
  async function extraireFilm(urlPage, options) {
    const opts = Object.assign({}, OPTIONS, options);
    const page = absolue(String(urlPage || '').trim(), undefined);
    if (!page) throw new ErreurExtraction('Adresse invalide : une URL http ou https complète est attendue.', 'URL_INVALIDE');

    const html = await recupererHtml(page, opts);
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // Les chemins relatifs se résolvent par rapport à <base href> s'il existe, sinon à l'adresse de la page.
    const base = absolue((doc.querySelector('base[href]') || { getAttribute: () => null }).getAttribute('href'), page) || page;

    const resultat = {
      titre: lireTitre(doc),
      affiche: lireAffiche(doc, base),
      flux: null,
      typeFlux: null,
      iframe: null,
      urlPage: page,
      avertissements: [],
    };

    // 1) .m3u8 directement dans la page
    const direct = trouverM3u8(doc, html, base);
    if (direct) {
      resultat.flux = direct;
      resultat.typeFlux = 'm3u8';
      return resultat;
    }

    // 2) sinon : on charge chaque iframe (un niveau) pour y chercher un .m3u8
    const iframes = listerIframes(doc, base, opts.maxIframes);
    for (const urlIframe of iframes) {
      try {
        const htmlIframe = await recupererHtml(urlIframe, opts);
        const docIframe = new DOMParser().parseFromString(htmlIframe, 'text/html');
        const baseIframe = absolue((docIframe.querySelector('base[href]') || { getAttribute: () => null }).getAttribute('href'), urlIframe) || urlIframe;
        const m3u8 = trouverM3u8(docIframe, htmlIframe, baseIframe);
        if (m3u8) {
          resultat.flux = m3u8;
          resultat.typeFlux = 'm3u8-iframe';
          resultat.iframe = urlIframe;
          return resultat;
        }
      } catch (e) {
        resultat.avertissements.push('Iframe illisible (' + urlIframe + ') : ' + e.message);
      }
    }

    // 3) dernier recours : l'adresse de la première iframe
    if (iframes.length) {
      resultat.flux = iframes[0];
      resultat.typeFlux = 'iframe';
      resultat.iframe = iframes[0];
      resultat.avertissements.push("Aucun .m3u8 trouvé : l'adresse de l'iframe est renvoyée à la place.");
    } else {
      resultat.avertissements.push('Aucun lien vidéo (.m3u8 ou iframe) trouvé dans la page.');
    }
    return resultat;
  }

  /* ===================================================================== */
  /* Export                                                                */
  /* ===================================================================== */
  global.extraireFilm = extraireFilm;
  global.ErreurExtraction = ErreurExtraction;
  /** Télécharge le HTML d'une adresse via les proxys (utilisé aussi par LUMINA). Lève ErreurExtraction PAGE_INACCESSIBLE. */
  global.recupererHtmlProxy = (url, options) => recupererHtml(url, Object.assign({}, OPTIONS, options, { essayerDirectement: false }));
  global.extraireFilmOptions = OPTIONS; // modifiable : extraireFilmOptions.proxies = [ … ]
})(typeof window !== 'undefined' ? window : globalThis);
