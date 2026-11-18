# Paris Master

Application web (PWA) pour apprendre la topographie de Paris : grands axes, places, ponts, quais,
monuments et arrondissements, par la carte et le jeu.

## Lancer

- **Windows** : double-cliquer sur `lancer.bat`, puis ouvrir <http://127.0.0.1:8765/>.
- Ou : `python -m http.server 8765 --bind 127.0.0.1` à la racine du projet.

Aucune dépendance à installer : JavaScript en modules ES natifs, Leaflet embarqué dans `vendor/`.

### Sur iPhone

L'installation sur l'écran d'accueil avec fonctionnement hors connexion exige une adresse **HTTPS**.
Le plus simple est d'héberger le dossier tel quel sur un hébergement statique (GitHub Pages,
Netlify, Cloudflare Pages…), puis, dans Safari : Partager → « Sur l'écran d'accueil ».
Sur le réseau local (`python -m http.server 8765` puis `http://<IP-du-PC>:8765` sur l'iPhone),
l'application fonctionne mais sans le mode hors connexion.

## Contenu

| Écran | Rôle |
|---|---|
| Accueil | Grade, XP, défi du jour, objectif quotidien, série, révisions dues, prochaine action (palier en cours), carte de progression |
| Carte | Plan détaillé (OpenFreeMap, noms en français). Apprentissage (noms) / mémorisation (sans noms). **3D** : relief, survol 360°, **orientation** (rotation, nord, à plat, boussole du téléphone). Commissariats en bleu police, portes en noir, photos des monuments au survol, « quelle est cette rue ? » au toucher |
| Niveaux | 11 niveaux : le squelette de Paris (3 anneaux de boulevards, grande croisée, grandes places), le centre, 8 arrondissements, les 33 portes du périphérique |
| Apprendre | **Par paliers de 5** : fiches (avec photo pour les grands lieux), axes tracés de bout en bout avec leurs croisements dans l'ordre ; un contrôle réussi à 80 % ouvre le palier suivant ; l'examen du niveau (85 %) s'ouvre quand tous les paliers sont validés |
| Jouer | Défi du jour, Révisions, Grands axes (dans l'ordre, entre les deux, quel anneau), Les portes (quelle porte vient après), Quiz, Retrouve la rue, Identifie la voie, Chrono, Monuments, Parcours, Examens. Les jeux portent sur les éléments déjà découverts |
| Stats | Réussite, temps de réponse, maîtrise, XP sur 14 jours, par arrondissement, points faibles, historique des erreurs |
| Profil | Prénom, réglages de carte (arrêts de bus, commissariats, géolocalisation), rythme (objectif, nouveautés par jour), sons, mode libre, sauvegarde, **réinitialiser le jeu** |

Ludique : sons synthétisés et vibrations (désactivables), « +XP » flottant, séries 🔥, indices (50/50 ou
arrondissement surligné, XP divisée par deux ; pas d'indice en examen, chrono, défi et contrôle de palier),
étoiles, célébrations (grade, palier, niveau, badge, record).

Répétition espacée : une réponse juste sur un élément dû allonge l'intervalle (1 j, 3 j, puis × facilité) ;
une erreur le remet en apprentissage (retour sous 5 min) et mémorise la confusion. « Maîtrisé » = intervalle
≥ 7 jours, « ancré » = ≥ 21 jours. Plafond de nouveautés par jour (10 par défaut) pour éviter la surcharge.

## Données : d'où vient chaque information

Aucune coordonnée n'est saisie à la main. `tools/build_data.py` produit `data/paris.json` et
`data/context.json` à partir de :

- **Ville de Paris – Arrondissements** : limites administratives officielles ;
- **Ville de Paris – Voie** (filaire de voirie) : tracé de chaque voie ;
- **Ville de Paris – Dénominations des emprises des voies actuelles** : arrondissements officiels,
  quartiers, tenants et aboutissants, longueur, origine du nom ;
- **OpenStreetMap** (Nominatim, Overpass) : monuments, gares, parcs, canaux, surfaces d'eau,
  échangeurs du périphérique (portes), sites de la police nationale (`data/police.json`) ;
- **Wikidata / Wikimedia Commons** : photo principale des grands lieux (`data/photos/`), avec auteur et licence.

Les portes sont vérifiées une à une (place officielle, échangeur OSM ou objet OSM du même nom, à moins de
800 m des boulevards des Maréchaux) ; leur ordre autour de Paris est calculé. Les commissariats proviennent
d'OpenStreetMap (le seul jeu officiel trouvé date de 2018) : données communautaires, à vérifier.

Sont **calculés** à partir des tracés : orientation générale, connexions entre voies et places
(contact à moins de 15 m), repères à proximité (moins de 400 m), arrondissements des lieux.
Pour les voies, l'arrondissement officiel fait foi ; le script le recoupe avec la géométrie et signale
tout écart dans `tools/validation_report.md`.

### Ajouter une rue, une place, un monument ou un niveau

1. Modifier `tools/catalog.json` (voie : son nom suffit, ajouter `official` si le nom officiel diffère ;
   lieu : `category` et `q`, la requête OpenStreetMap ; `osm` pour forcer un objet précis).
2. `python tools/build_data.py` (ajouter `--refresh` pour retélécharger les sources).
3. Lire `tools/validation_report.md` : erreurs = élément exclu, avertissements = à vérifier.
4. Incrémenter `VERSION` dans `sw.js` pour que les appareils installés reçoivent la mise à jour.

## Vérifications

Avec le serveur lancé :

- `python tools/logic_check.py` — répétition espacée, seuil d'examen, déblocage, géométrie,
  validité de toutes les questions générées ;
- `python tools/e2e_check.py [--shots DOSSIER]` — parcourt tous les écrans et joue tous les modes
  en 375, 390, 414, 768 et 1440 px ; signale erreurs console et débordements horizontaux.

## Architecture

```
index.html, sw.js, manifest.webmanifest
css/app.css
data/paris.json        éléments, niveaux, arrondissements (généré)
data/context.json      fond local : toutes les voies (avec noms, pour « quelle est cette rue ? ») et l'eau (généré)
js/data.js             chargement, catégories, articles (« du », « au »…)
js/geo.js              distances en mètres, point dans arrondissement, score de précision
js/store.js            progression, répétition espacée, XP, grades, badges, examens
js/questions.js        générateurs de questions et définition des modes
js/session.js          moteur de séance commun à tous les modes
js/map.js              carte Leaflet (tuiles OSM en apprentissage, fond vectoriel sinon)
js/fiche.js            fiche pédagogique
js/views/*.js          écrans (settings.js = page Profil)
tools/                 catalogue, génération des données, tests
```

Fond de carte : tuiles vectorielles [OpenFreeMap](https://openfreemap.org) (style Liberty, gratuit, sans clé),
rendues par MapLibre GL (`vendor/maplibre/`) dans Leaflet. Sans WebGL : tuiles OpenStreetMap.
Sans réseau : fond vectoriel local (`data/context.json`, toutes les voies officielles et la Seine).
Les tuiles déjà vues sont gardées en cache pour le hors connexion.
