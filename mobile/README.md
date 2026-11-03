# CoverCut — montage vidéo mobile

Application de montage vidéo pour téléphone (Android et iPhone), pensée pour aller vite :
montages simples, covers de guitare, vidéos pour les réseaux. Pas de filtres à gogo, juste les bases bien faites.

C'est une **PWA** (application web installable) : elle s'ouvre dans le navigateur du téléphone, s'ajoute
à l'écran d'accueil comme une vraie appli, fonctionne hors ligne, et **tout reste sur le téléphone**
(aucun envoi de fichier vers un serveur). Le décodage et l'encodage passent par **WebCodecs**, donc par
l'encodeur matériel du téléphone : l'export est rapide et ne vide pas la batterie.

## Fonctionnalités

| | |
|---|---|
| **Import** | plusieurs vidéos d'un coup (MP4, MOV, WebM, MKV…), vidéos portrait d'iPhone/Android gérées |
| **Timeline** | tête de lecture fixe, glisser pour naviguer, pincer pour zoomer, miniatures et formes d'onde |
| **Montage** | diviser, rogner début/fin aux poignées, dupliquer, réordonner, supprimer, annuler/rétablir |
| **Couleur** (par clip) | exposition, luminosité, contraste, hautes lumières, ombres, saturation, vibrance, température, teinte, netteté, vignettage, avec « appliquer à tous » |
| **Recadrage** | formats 16:9, 9:16, 1:1, 4:5, 4:3, 3:4, 21:9 ; glisser/pincer sur l'aperçu, remplir/ajuster, rotation 90°, miroir (pratique pour les vidéos selfie) |
| **Audio** | bandes son (MP3, WAV, M4A, FLAC, OGG… ou le son d'une autre vidéo), volume jusqu'à 200 %, fondus, couper le son de la caméra |
| **Synchro auto** | cale la prise studio de ta cover sur le son capté par la caméra (intercorrélation des attaques, précision ~1 ms), puis réglage fin ±10/100 ms |
| **Fondus** | fondu au noir (image + son) au début et à la fin |
| **Export** | MP4 H.264 (ou HEVC si le téléphone le gère) + AAC, de 480p à 4K, 24/25/30/50/60 i/s, 4 niveaux de qualité, estimation de la taille, partage direct vers la galerie ou les applis |
| **Projets** | sauvegarde automatique sur le téléphone (IndexedDB), liste des projets |

L'aperçu et l'export utilisent le même shader WebGL : ce que tu vois est ce que tu exportes.
Le délai d'encodage AAC (~21 ms) est mesuré puis compensé, pour que le son reste calé sur l'image.

## Installer sur le téléphone

L'appli doit être servie en **HTTPS** (exigence des navigateurs pour WebCodecs et l'installation).

### Option 1 — GitHub Pages (recommandé, gratuit)

1. Dans le dépôt GitHub : **Settings → Pages → Build and deployment → Source : GitHub Actions**.
2. Fusionne cette branche dans `main` (ou lance le workflow « Déployer l'appli mobile » à la main
   depuis l'onglet **Actions**).
3. L'appli est en ligne sur `https://<ton-pseudo>.github.io/youtubecut/`.
4. Sur le téléphone, ouvre l'adresse puis :
   - **Android (Chrome)** : menu ⋮ → *Installer l'application* / *Ajouter à l'écran d'accueil*.
   - **iPhone (Safari)** : bouton Partager → *Sur l'écran d'accueil*.

### Option 2 — en local, pour tester sur ordinateur

```bash
cd mobile
python3 -m http.server 8000
# puis ouvre http://localhost:8000 dans Chrome
```

(`localhost` est considéré comme sécurisé ; depuis le téléphone il faut passer par HTTPS.)

## Navigateurs

- **Android** : Chrome ou Edge récent — support complet, encodage matériel H.264/HEVC.
- **iPhone / iPad** : Safari 17 ou plus récent (iOS 17+). Si l'encodeur AAC natif manque, un encodeur
  AAC de secours (WebAssembly) est chargé automatiquement.
- **Ordinateur** : Chrome, Edge ou Safari récents (pratique pour tester ; raccourcis : espace, S pour
  diviser, ←/→ image par image, Ctrl+Z / Ctrl+Maj+Z, Suppr).

## Conseils pour une cover de guitare

1. Filme-toi (le téléphone capte le son de la pièce) et enregistre ta prise propre à côté (DAW, interface…).
2. *Nouveau projet* → choisis la vidéo.
3. *Bande son* → choisis le fichier audio studio : la fenêtre de synchro s'ouvre → **Synchro auto**.
4. Coche **Couper le son de la caméra**, écoute, ajuste ±10 ms si besoin.
5. *Recadrer* pour passer en 9:16 ou 1:1, *Couleur* pour corriger l'image, *Fondus* pour finir propre.
6. *Exporter* → 1080p, Standard ou Haute → *Partager / Enregistrer*.

## Organisation du code

```
mobile/
├── index.html, css/app.css     interface (écran d'accueil + éditeur)
├── manifest.webmanifest, sw.js  installation + mode hors ligne
├── js/main.js       contrôleur : projets, outils, import, export, annuler/rétablir
├── js/project.js    modèle : clips, pistes audio, recadrage, utilitaires de temps
├── js/player.js     aperçu : <video> natifs + Web Audio, horloge audio maître
├── js/timeline.js   timeline tactile (canvas)
├── js/renderer.js   shader WebGL : recadrage, rotation, miroir, réglages couleur
├── js/exporter.js   export : décodage WebCodecs → WebGL → encodage → MP4, mixage audio
├── js/sync.js       synchro automatique (FFT, intercorrélation)
├── js/media.js      analyse des fichiers, miniatures, formes d'onde
├── js/store.js      sauvegarde locale (IndexedDB)
└── vendor/          Mediabunny 1.61.6 (MPL-2.0) + encodeur AAC de secours
```

Aucune étape de build : ce sont des modules JavaScript natifs.

## Limites connues

- Pas de texte/titres, transitions entre clips, ni vitesse variable (volontairement simple pour l'instant).
- L'aperçu dépend du lecteur vidéo du navigateur : un codec que le téléphone ne sait pas lire
  (ex. ProRes) ne pourra pas être importé.
- Pendant l'export, garde l'appli au premier plan (l'écran reste allumé automatiquement quand c'est possible).
