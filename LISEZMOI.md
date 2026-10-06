# LUMINA : fichiers à déposer sur GitHub Pages

## Contenu (tout est à déposer à la RACINE du dépôt, côte à côte)
| Fichier | Rôle |
|---|---|
| `index.html` | La plateforme LUMINA (intro, catalogue, lecteur, hors-ligne) |
| `extraire-film.js` | Extraction du titre, de l'affiche et du flux .m3u8 depuis l'adresse d'une page (via proxy) |
| `exemple-extraction.html` | Page de démonstration du module d'extraction |
| `sw.js`, `manifest.webmanifest`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | Application installable et ouverture hors connexion |

## Mise en ligne
1. Dézippez ce dossier sur votre appareil.
2. GitHub > votre dépôt > **Add file > Upload files** : glissez **tous** les fichiers (pas le dossier), puis **Commit changes**.
   Si un ancien `index.html` existe, il est remplacé.
3. **Settings > Pages** : Source = *Deploy from a branch*, Branch = `main`, dossier `/ (root)`, puis **Save**.
4. Après une minute environ, l'adresse `https://VOTRE-NOM.github.io/VOTRE-DEPOT/` affiche LUMINA.

## iPhone
Safari > Partager > **Sur l'écran d'accueil**. Si LUMINA était déjà installée, supprimez l'ancienne icône puis réinstallez-la.

## Sans serveur : ce qui marche
- Catalogue, recherche, Ma liste, reprise de lecture, intro à chaque ouverture, ouverture hors connexion.
- Coller l'adresse d'une page de film : titre, couverture, descriptif et flux .m3u8 sont lus via le proxy public
  api.allorigins.win (désactivable : icône serveur > case « proxy public »).
- Ajouter une vidéo avec un lien .m3u8 ou .mp4 direct.

## Quand le lien ne s'extrait pas depuis l'adresse de la page
Certaines pages ne révèlent le flux .m3u8 qu'une fois la lecture lancée dans le navigateur.
Dans LUMINA : **+ > « Le lien ne marche pas ? Capturer depuis la page ouverte »** installe un favori « Capturer vers LUMINA ».
Ouvrez ensuite la page de la vidéo dans le même navigateur, lancez la lecture, appuyez sur le favori : LUMINA s'ouvre avec le
flux, le titre et l'affiche déjà remplis. (À utiliser pour une vidéo qui vous appartient.)

## Une vidéo qui se trouve sur l'appareil
**+ > Importer un fichier vidéo de cet appareil** (MP4, MOV, WebM) : elle est stockée dans l'application et se lit sans connexion.
Sur iPhone, ajoutez LUMINA à l'écran d'accueil : sinon Safari peut vider le stockage d'un site peu utilisé.

## Ce qui demande un serveur LUMINA (facultatif)
La lecture directe ou la conversion en MP4 de sources qui bloquent les navigateurs (CORS).
Hébergez le serveur (archive `lumina-offline.zip`, guide `DEPLOY.md`) en **https**, puis saisissez son adresse et son jeton
dans l'icône serveur de LUMINA.

N'utilisez LUMINA qu'avec des vidéos dont vous détenez les droits ou la licence.
