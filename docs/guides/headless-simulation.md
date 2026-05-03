# Simulation headless

Quand vous n'avez besoin que de la **couche de données déterministe** — élévations par tuile, niveau de la mer, masque liquide, voisinage — importez depuis `/sim`. Pas de Three.js, pas de WebGL, pas de DOM.

```ts
import {
  generateHexasphere,
  initBodySimulation,
} from '@cedric-pouilleux/stellexjs/sim'

const { tiles } = generateHexasphere(1, 5) // rayon=1, subdivisions=5
const sim = initBodySimulation(tiles, {
  name:           'Worker-Body-42',
  type:           'planetary',
  surfaceLook:    'terrain',
  radius:          1,
  rotationSpeed:   0.005,
  axialTilt:       0.41,
})

// Tout ce qui suit est sérialisable.
console.log(sim.tileStates.size)
console.log(sim.liquidCoverage)
console.log(sim.hasLiquidSurface)
console.log(sim.seaLevelElevation)
```

## Ce qui est exporté

### Fonctions

| Symbole | Usage |
| ------- | ----- |
| `generateHexasphere(radius, subdivisions)` | Subdivise une icosphère en tuiles hex |
| `initBodySimulation(tiles, config, atmoTiles?)` | Calcule élévations quantifiées, niveau de la mer, couverture liquide |
| `buildNeighborMap(tiles)`            | Graphe d'adjacence 6-way |
| `getNeighbors(tileId, map)`          | Voisins d'une tuile par id |
| `resolveStarData(input)`             | Lookup spectral → `{ tempK, radius, luminosity, color }` |
| `toStarParams(input)`                | Forme minimaliste — `{ radius, tempK }` |
| `hasSurfaceLiquid(config)`           | Predicate liquide en surface (lit `liquidState`) |
| `hasAtmosphere(config)`              | Predicate `atmosphereThickness > 0` |
| `deriveCoreRadiusRatio(f)`           | `gasMassFraction → ratio noyau/visuel` |
| `resolveCoreRadiusRatio(config)`     | Ordre de résolution : explicite → dérivé → défaut |
| `seededPrng(seed)`                   | PRNG FNV-1a + SplitMix32 — scopez vos seeds (`name + ':resources'`) |

### Constantes

| Symbole | Valeur | Usage |
| ------- | ------ | ----- |
| `DEFAULT_TILE_SIZE`     | `0.05`  | Taille de tuile par défaut (drives subdivisions) |
| `REF_STAR_RADIUS`       | `3`     | Rayon visuel de référence (G-type) |
| `REF_STAR_TEMP`         | `5778`  | Température de référence en Kelvin (G-type) |
| `REF_SOLID_DENSITY`     | `5500`  | kg/m³ — référence densité solide (`deriveCoreRadiusRatio`) |
| `REF_GAS_DENSITY`       | `100`   | kg/m³ — référence densité gaz |
| `SPECTRAL_TABLE`        | `Record<SpectralType, …>` | Catalogue O–M : `tempK`, `radius`, `color` |

### Types

| Catégorie | Types |
| --------- | ----- |
| **Taxonomie** | `BodyType` (`'planetary' \| 'star'`), `SurfaceLook` (`'terrain' \| 'bands' \| 'metallic'`), `SpectralType` (`'O' \| 'B' \| … \| 'M'`) |
| **Identity**  | `BodyIdentity`, `PlanetIdentity`, `StarIdentity` |
| **Physics**   | `BodyPhysics`, `BodyPhysicsCore`, `PlanetPhysics`, `StarPhysics`, `StarPhysicsInput`, `ResolvedStarData` |
| **Profils**   | `BodyNoiseProfile`, `PlanetVisualProfile` |
| **Config**    | `BodyConfig` (union discriminée), `PlanetConfig`, `StarConfig` |
| **Visuel**    | `ColorInput` (string \| number), `MetallicBand` |
| **Géométrie** | `Tile`, `Point3D`, `HexasphereData` |
| **Sim**       | `BodySimulation`, `TileState` |

## Pourquoi headless ?

- **Pré-calcul serveur** — générez une fois, mettez en cache, expédiez l'état.
- **Workers** — sortez la sim du thread principal sans bundler Three.js.
- **CLI / outillage** — dump par-tuile en CSV, validation de seeds, batch.
- **Tests** — reproductibilité parfaite, pas de mock GL.

Le frontend reconstruit géométrie et matériaux à partir du **même seed** : seul le `BodyConfig` traverse le réseau.

::: tip Encore plus compact — `BodyDescriptor`
Si votre serveur stocke des millions de planètes (un système solaire par utilisateur), transmettre un `BodyConfig` complet par body devient coûteux. La page [Génération seedée](/guides/seeded-generation) documente un format de stockage à ~80 octets par body — `{ seed, zoneId, genVersion, overrides }` — et la fonction `generateBodyConfig(seed, constraints)` qui reconstruit le `BodyConfig` côté client à partir d'un descriptor minimal.
:::

## Pattern serveur → client

```ts
// Côté serveur (Node.js)
import { initBodySimulation, generateHexasphere } from '@cedric-pouilleux/stellexjs/sim'

const { tiles } = generateHexasphere(1, 6)
const sim       = initBodySimulation(tiles, config)

return { config, snapshot: serializeSim(sim) }

// Côté client (Vue + TresJS)
import { useBody, DEFAULT_TILE_SIZE } from '@cedric-pouilleux/stellexjs'

const body = useBody(config, DEFAULT_TILE_SIZE)
// body.sim a les mêmes valeurs que `snapshot` — déterministe.
```

## Voisinage et BFS

```ts
import { buildNeighborMap, getNeighbors } from '@cedric-pouilleux/stellexjs/sim'

const map = buildNeighborMap(tiles)
const visited = new Set<number>()
const queue   = [startTileId]
while (queue.length) {
  const id = queue.shift()!
  if (visited.has(id)) continue
  visited.add(id)
  for (const n of getNeighbors(id, map)) {
    if (!visited.has(n)) queue.push(n)
  }
}
```

Voir [Voisinage & BFS](/examples/hex-tiles/neighbors) pour un exemple animé.

## Ressources et chimie

La lib **n'a pas** de notion de ressources, ni de chimie. Le seul flag de présence d'un liquide est `BodyPhysics.liquidState` (`'liquid' | 'frozen' | 'none'`) ; l'identité de la substance (eau, méthane, fer fondu…) reste dans votre catalogue. Lancez votre propre stratégie de distribution sur le `sim` retourné (champs `tiles` / `tileStates` / `seaLevelElevation` / `hasLiquidSurface`) et conservez le résultat dans votre domaine — état de jeu, save persistante, store Pinia.

`playground/src/lib/paint/` est une implémentation de référence (placement de minerais, peinture de tuiles, excavation).
