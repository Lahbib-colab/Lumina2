# Créer votre proxy personnel sur Cloudflare (gratuit)

Le proxy lit les pages et les couvertures à la place du navigateur. Il est à vous : pas de service partagé qui tombe en panne.
Limites du plan gratuit : 100 000 requêtes par jour (largement suffisant).

## 1. Créer le Worker
1. Connectez-vous sur dash.cloudflare.com.
2. Menu de gauche : **Workers & Pages** (ou *Compute > Workers*), puis **Create** (ou *Create application*) > **Create Worker**.
3. Nom : `lumina-proxy`, puis **Deploy**.
4. **Edit code** : sélectionnez tout le code d'exemple, supprimez-le, collez **tout** le contenu du fichier `cloudflare-worker.js`, puis **Deploy**.
5. Copiez l'adresse du Worker, du type `https://lumina-proxy.VOTRE-NOM.workers.dev`.

L'adresse de votre site (`https://lahbib-colab.github.io`) est déjà autorisée dans le code, ligne `ORIGINES_AUTORISEES`.
Si votre site change d'adresse, modifiez cette ligne.

## 2. Ajouter une clé (conseillé)
Sans clé, seul votre site peut utiliser le proxy, mais une adresse peut être imitée. Avec une clé, personne d'autre ne peut s'en servir.
1. Dans le Worker : **Settings > Variables and Secrets > Add**.
2. Type : *Secret*. Nom : `CLE`. Valeur : un mot de passe long (16 caractères ou plus). **Deploy**.

## 3. Brancher LUMINA
1. Ouvrez LUMINA, icône serveur (en haut).
2. **Mon proxy personnel** : collez l'adresse du Worker. **Clé** : celle de l'étape 2.
3. **Tester les proxys**, puis **Enregistrer**.

LUMINA essaie votre proxy en premier, puis le proxy public si la case est cochée.

## Ce que le proxy fait et ne fait pas
- Il transmet des pages et des images (jusqu'à 3 Mo et 8 Mo). Il refuse les vidéos, les adresses locales et privées.
- Il transmet la page d'origine (Referer) quand LUMINA lit une iframe.
- Il ne contourne pas les protections anti-robots d'un site : si un site bloque les serveurs, il peut aussi bloquer ce proxy.
