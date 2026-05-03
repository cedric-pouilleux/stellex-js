# Concepts fondamentaux

Cette page condense les invariants à connaître **avant** de toucher à un composant ou un shader.

## 1. La séparation `sim` / `core` / `vue`

```
sim/         ← logique pure : hex, FBM, élévations, niveau de la mer
   ↓
core/        ← Three.js : matériaux, builders mesh, raycast, palettes
   ↓
index.ts/    ← Vue + TresJS : composants <Body>, <BodyRings>, <BodyController>…
```

Chaque couche dépend uniquement de la précédente. Concrètement :

- Vous pouvez générer un `BodySimulation` côté serveur, sérialiser les tuiles en JSON, les renvoyer au client, et **rebuild la même planète** en réinjectant le même `BodyConfig` (le seed est suffisant).
- `core` est utilisable sans Vue (Pixi, R3F, vanilla Three.js).
- La racine est strictement additive : tout ce qui est dans `core` est aussi exporté à la racine.

## 2. `BodyConfig` est une union discriminée `PlanetConfig | StarConfig`

[`BodyConfig`](/api/sim/type-aliases/BodyConfig) n'est pas une interface plate : c'est une **union discriminée** sur le champ `type` (`'planetary'` / `'star'`). Le type-checker rejette à la compilation toute combinaison invalide — assigner `metallicBands` sur un corps `type: 'star'` ou `spectralType` sur un `type: 'planetary'` est interdit, plus de champ « silencieusement ignoré ».

Chaque branche est composée de profils orthogonaux pour que les consommateurs puissent typer contre le slice minimal dont ils ont besoin :

| Sous-profil | Contenu | Branche |
| ----------- | ------- | ------- |
| `PlanetIdentity` | `type: 'planetary'`, `name`, `surfaceLook?` | planète |
| `StarIdentity`   | `type: 'star'`, `name`, `spectralType` (**requis**) | étoile |
| `BodyPhysicsCore` | `radius`, `rotationSpeed`, `axialTilt`, `mass?`, `coreRadiusRatio?` | partagé |
| `PlanetPhysics`   | + atmosphère (`atmosphereThickness`, `atmosphereOpacity`), liquide (`liquidState`, `liquidCoverage`), `gasMassFraction` | planète |
| `StarPhysics`     | rien de plus que `BodyPhysicsCore` | étoile |
| `BodyNoiseProfile` | `noiseScale`, `noiseOctaves`, `noisePersistence`, `noiseRidge`, … | partagé |
| `PlanetVisualProfile` | `liquidColor`, `bandColors`, `terrainColorLow/High`, `metallicBands`, `hasRings` | planète |

Pattern caller :

```ts
import type { BodyConfig, PlanetConfig, StarConfig } from '@cedric-pouilleux/stellexjs/sim'

// Construction d'une planète — `surfaceLook` est accepté, `spectralType` rejeté
const planet: PlanetConfig = {
  type: 'planetary',
  surfaceLook: 'metallic',
  name: 'Vulcan',
  radius: 1, rotationSpeed: 0, axialTilt: 0.15,
  metallicBands: [...]
}

// Construction d'une étoile — `spectralType` requis, `surfaceLook` rejeté
const star: StarConfig = {
  type: 'star',
  spectralType: 'G',
  name: 'Sol',
  radius: 3, rotationSpeed: 0.01, axialTilt: 0,
}

// Lecture sur l'union — narrow d'abord
function inspect(config: BodyConfig) {
  if (config.type === 'star') {
    console.log(config.spectralType)   // ✅ étoile
  } else {
    console.log(config.surfaceLook)    // ✅ planète
  }
}
```

Les fonctions de signature étroite (`resolveStarData`, `buildStarPalette`, fonctions internes de stratégie planet/star…) typent leur paramètre contre le profil minimal qu'elles consomment, pas contre `BodyConfig` entier.

## 3. Le seed est entièrement déterminé par `name`

Toutes les sources d'aléatoire (FBM, distribution des cratères, variation des anneaux, distribution des bandes gaz) passent par un PRNG seedé à partir du **nom** du corps. Conséquence :

- Deux corps avec le même `name` produisent **exactement** les mêmes tuiles, le même niveau de la mer, les mêmes anneaux.
- Vous pouvez encoder un état complet dans une URL en sérialisant uniquement le `BodyConfig` — le rendu est rejouable.
- **Aucun appel à `Math.random()` nu** dans la lib. Si vous étendez le code (resources, factions, …), importez `seededPrng` depuis l'entry `sim` et scopez vos seeds : `seededPrng(name + ':resources')`.

::: tip Pour aller plus loin — génération seedée par contraintes
Si votre projet doit générer un univers procédural complet (système solaire par utilisateur, secteurs publics, mondes scriptés) à partir d'enveloppes gameplay (zones orbitales, ranges autorisés, features probabilistes), voir [Génération seedée](/guides/seeded-generation). L'API `generateBodyConfig(seed, constraints)` étend le contrat de déterminisme du `name` au `BodyConfig` lui-même, avec un format de stockage compact (~80 octets/body) et la stabilité PRNG nécessaire au tuning game design en prod.
:::

## 4. Le pipeline de rendu

Pour un corps non-stellaire, `useBody(config, tileSize)` enchaîne :

1. **Subdivision** — `generateHexasphere(radius, subdivisions)` → tuiles 3D.
2. **Simulation** — `initBodySimulation(tiles, config)` → élévations quantifiées, niveau de la mer, couverture liquide.
3. **Palette** — `choosePalette(config)` route vers le bon générateur (`generateTerrainPalette`, `buildGasPalette`, `buildMetallicPalette`, `buildStarPalette`).
4. **Mesh sol** — `buildLayeredInteractiveMesh` (rocheuse/métallique en mode hex) ou `BodyMaterial` sur sphère lisse (gaz/étoile, ou rocheuse en mode shader).
5. **Couches additionnelles** — anneaux, coquille liquide hexagonale, atmo / aura, overlays de tuiles sont **opt-in** via `<BodyRings>`, `buildAtmoShell`, `buildLiquidShell`.

Le tout retourne un [`Body`](/api/core/type-aliases/Body) — une **union discriminée** `PlanetBody | StarBody` :

- `body.kind === 'planet'` (rocheuses, gazeuses, métalliques) — porte `liquid`, `view`, `atmoShell` et la version étendue de `tiles` avec les mutations sol-côté (`tiles.sol.updateTileSolHeight`, `tiles.sol.applyOverlay`, `tiles.paintAtmoShell`, …).
- `body.kind === 'star'` — porte uniquement les primitives communes (`group`, `sim`, `palette`, `interactive`, `hover`, `tiles` minimal). Les namespaces planet-only sont **absents** sur le type, le compilateur les rejette si on les touche sans narrowing.

Pattern caller :

```ts
const body = useBody(config, DEFAULT_TILE_SIZE)
if (body.kind === 'planet') {
  body.liquid.setSeaLevel(1.0)
  body.view.set('atmosphere')
}
```

### Les trois vues d'une planète

`body.view.set(view)` sur les `PlanetBody` accepte trois modes mutuellement exclusifs ([`InteractiveView`](/api/core/type-aliases/InteractiveView)). Chacun pilote en parallèle la visibilité du sol hex, du board atmo, de la smooth sphere et du halo atmo procédural :

| `view` | Sol hex (relief) | Board atmo (cliquable) | Smooth sphere | Halo atmo (`atmoShell`) | Quand l'utiliser |
| ------ | ---------------- | ---------------------- | ------------- | ----------------------- | ---------------- |
| `'surface'`    | **visible** (flat lighting + relief) | masqué | masqué (sauf gas giant : backdrop dimmé en `BackSide`) | mode halo discret au rim | gameplay terrain (mining, building, sélection) |
| `'atmosphere'` | masqué | **visible** (flat lighting) | masqué | masqué | gameplay atmo (couches polluées, météo, zones contestées) |
| `'shader'`     | masqué | masqué | **visible** (procédural complet) | **visible** plein (`FrontSide`, bands + clouds + tile paint) | overview / vue système / thumbnail (un seul corps en plan large) |

::: tip Quand basculer
- **`'surface'` ↔ `'atmosphere'`** : sur action joueur (toggle de couche dans le HUD) — les deux conservent l'éclairage flat pour la lisibilité gameplay.
- **`'shader'`** : par défaut sur une vue système (multi-corps loin), puis bascule vers `'surface'` au focus / zoom in. Le shader procédural est plus joli mais flat-lighting absent — ne convient pas au gameplay actif.
:::

::: warning Les étoiles ignorent `surface` / `atmosphere`
`StarBody` n'a pas de namespace `view` — les étoiles tournent en permanence sur le pipeline shader (granulation, pulsation, corona). Toute tentative d'accès est rejetée par TS sans narrowing.
:::

## 5. Les responsabilités du *caller*

La lib s'arrête volontairement avant trois préoccupations :

- **L'orbite** — pas de mécanique orbitale interne. Vous écrivez la position du `body.group` chaque frame.
- **La présence des couches optionnelles** — anneaux, atmo opaque, halo, sphère liquide ne sont jamais générés implicitement. Vous activez chaque couche via les flags du `BodyConfig` (`hasRings`, `liquidState`, `atmosphereThickness`…) ou en montant directement `<BodyRings>`.
- **La chimie et les phases** — `liquidState` est le seul flag de présence ; `liquidColor`, `bandColors`, `metallicBands`, `lavaColor` doivent être fournis par votre catalogue. La lib ne dérive jamais une couleur depuis un nom de substance ni une phase depuis une température. Le `playground/src/lib/` est une implémentation de référence.

Cette discipline garde la lib **agnostique du jeu** : un simulateur de système solaire éducatif et un Stellaris-like consomment la même API sans qu'elle prenne parti.

## 6. Le système de tuiles

Les élévations sont **quantifiées en bandes entières** :

- `elevation ∈ [0, N-1]` où `N = resolveTerrainLevelCount(radius, coreRatio)`.
- `seaLevelElevation` est une bande, pas un float.
- `resolveTileLevel(seaLevel, elevation)` retourne un index **signé relatif** à la mer : `0` = waterline, `-1` = un cran sous l'eau, `+1` = un cran au-dessus.

C'est cette quantification qui permet de raycaster une tuile et de connaître son altitude **sans** échantillonner le bruit.

`N` est borné par [`MIN_TERRAIN_LEVEL_COUNT`](/api/core/variables/MIN_TERRAIN_LEVEL_COUNT) (`= 4`) — même un corps minuscule ou une coquille très fine garde au moins 4 bandes utilisables, ce qui empêche les staircases dégénérées (1-2 paliers donnent des planètes "binaires" sans lisibilité).

### Quantification équi-fréquence

La sim utilise un ranking : les `n` tuiles sont triées par valeur de bruit, puis découpées en `N` paquets de taille égale. **Chaque bande reçoit ~le même nombre de tuiles**, indépendamment de la forme du bruit.

Conséquences pratiques :

- L'histogramme d'élévations est **plat par construction** — un déséquilibre signale une bande dégénérée (paliers très épars), pas un bruit mal réglé.
- `noisePower` (le reshape exponentiel du bruit) **n'a aucun effet** sur les bandes hex — c'est une transformation monotone, et le ranking est invariant. Cf. [`BodyNoiseProfile.noisePower`](/api/sim/interfaces/BodyNoiseProfile). Son seul effet observable est sur les *readers de bruit brut* (le shader de la smooth sphere quand il calcule un masque océan).
- `liquidCoverage` est résolu vers une bande exacte par cette même mécanique : on prend le seuil de bruit qui sépare les `coverage × 100 %` premières tuiles des autres. C'est pourquoi `0.5` produit toujours **exactement** la moitié des tuiles immergées (à un demi-bande près).

### `reliefFlatness` — aplatir sans perdre de bandes

[`BodyNoiseProfile.reliefFlatness`](/api/sim/interfaces/BodyNoiseProfile) (∈ `[0, 1]`) post-processe le ranking pour **contracter** les bandes basses vers le sommet — utile pour rendre une planète plate sans réduire le nombre de bandes (l'excavation peut toujours descendre jusqu'au noyau). À `1`, toutes les tuiles atterrissent sur la bande `N-1` (planète parfaitement lisse).

## 7. Étoiles vs planètes

Le pipeline étoile (`useStar`) est **structurellement différent** du pipeline planétaire — le compilateur le marque via la branche `kind: 'star'` du union `Body`. Tableau récapitulatif :

| Trait | `PlanetBody` | `StarBody` |
| ----- | ------------ | ---------- |
| `kind` | `'planet'` | `'star'` |
| `liquid` namespace | présent | **absent** |
| `view` namespace (`'surface' \| 'atmosphere' \| 'shader'`) | présent | **absent** |
| `atmoShell` | `AtmoShellHandle \| null` | **absent** |
| `tiles.atmo` (atmosphère cliquable) | `BoardTiles \| null` | **absent** |
| `tiles.updateTileSolHeight` | présent | **absent** |
| `surfaceLook` config | requis (default `'terrain'`) | ignoré |
| `spectralType` config | rejeté (TS) | requis |
| `tick(dt)` avance | rotation propre + uniforms atmo | convection + corona + pulsation |
| `canHaveRings` | `true` | `false` |
| `flatSurface` | `false` | `true` (granulation = shader effect, pas relief) |
| Tile-reference radius | `radius × (1 - atmoThickness)` | `STAR_TILE_REF[spectralType]` |

Pourquoi le tile-ref change : sur une étoile, le rayon visible varie énormément entre une naine M (`~1`) et une géante O (`~5`). Indexer la subdivision sur le `radius` exact donnerait des tuiles minuscules sur les O et grosses sur les M. La table interne `STAR_TILE_REF` fournit un rayon de référence par classe spectrale qui stabilise le tile count.

## 8. Trois invariants qui surprennent

Trois choix discrets dans la lib peuvent étonner si on ne les a pas en tête :

### a. `MIN_SOL_BAND_FRACTION` (5 %)

[`resolveCoreRadiusRatio`](/api/sim/functions/resolveCoreRadiusRatio) garantit `coreRadiusRatio + atmosphereThickness ≤ 1 − 0.05`. Si vous demandez `coreRadiusRatio: 0.6` avec `atmosphereThickness: 0.5` (= 110 %), la lib **réduit silencieusement** `coreRadiusRatio` à `0.45` pour préserver 5 % de sol. C'est ce qui empêche la coquille `[core | sol | atmo]` de devenir dégénérée.

### b. Tile-ref ≠ silhouette sur planètes à atmo épaisse

Pour les planètes, `solRefRadius = radius × (1 - atmosphereThickness)`. Une planète à `radius = 1` et `atmosphereThickness = 0.6` a un tile-ref de `0.4` — le sol et l'atmo gardent le même footprint apparent par tuile (sinon le sol aurait des tuiles ridiculement petites par rapport à la couche atmo). Cf. [Performance](/guides/performance) pour les implications sur le tile count.

### c. Séquence PRNG stable

`generateBodyVariation` tire **toujours les mêmes échantillons dans le même ordre**, même quand `hasRings: false` (la lib génère la `RingVariation` puis la jette). Toggler `hasRings` ne décale donc pas le reste de l'apparence. Cf. [Variation visuelle](/guides/variation#garantie-de-stabilit%C3%A9-de-la-s%C3%A9quence-prng).

## 9. Cycle de vie des handles

```ts
const body = useBody(config, DEFAULT_TILE_SIZE)
scene.add(body.group)

// chaque frame :
body.tick(dt)              // avance la rotation + uniforms shader

// au démontage :
body.dispose()             // libère GPU, materials, geometries
```

Oublier `dispose()` lors d'un swap de scène (HMR, route Vue, etc.) **fuit** des buffers GPU. Avec `<Body>`, le démontage du composant appelle `dispose()` automatiquement.
