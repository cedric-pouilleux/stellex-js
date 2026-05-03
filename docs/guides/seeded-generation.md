# Génération seedée par contraintes

Cette page documente l'API qui transforme une **graine** + une **enveloppe de contraintes** en un `BodyConfig` complet, déterministe et reproductible. C'est l'infrastructure recommandée pour tout jeu qui doit générer des planètes server-side, les persister sous forme compacte, puis les reconstruire à l'identique côté client.

::: tip Quand utiliser cette API
Si votre projet doit :

- générer un univers procédural (système solaire par utilisateur, secteurs publics, mondes scriptés),
- persister chaque body sous forme minimale (~80 octets sur le fil),
- reproduire la planète à l'identique côté front sans transmettre la config complète,
- accepter du tuning game design (rebalance des ranges) sans casser les planètes existantes,

alors la chaîne `BodyDescriptor → generateBodyConfig → BodyConfig` est faite pour ça. Sinon, l'usage direct de `BodyConfig` ([Anatomie d'un BodyConfig](/guides/body-config-anatomy)) reste la voie la plus simple.
:::

## 1. Le modèle à trois couches

L'identité d'un body se décompose en trois couches **séparées et orthogonales** :

```
┌─ contraintes ──────┐    ┌─ seed ──┐    ┌─ overrides ─┐
│ enveloppe imposée  │ +  │ string  │ +  │ patch sparse │
│ par le gameplay    │    │ stable  │    │ joueur       │
│ (zone orbitale)    │    │         │    │              │
└────────────────────┘    └─────────┘    └──────────────┘
              │                │                │
              ▼                ▼                ▼
       hydrateBodyConfig(descriptor) → BodyConfig prêt à rendre
```

| Couche | Origine | Mutabilité | Exemple |
| ------ | ------- | ---------- | ------- |
| **Contraintes** | Décidées par le game design (zone orbitale, archétype) | Constantes du build, partagées server/front | « zone habitable : atmosphère possible 85 %, eau possible 60 % » |
| **Seed** | Dérivée de l'identité du body (`${systemId}:orbit-${idx}`) | Stable et persistée | `"sys-7f3a2b8e:orbit-3"` |
| **Overrides** | Mutations gameplay (terraformation, mining, renommage) | Mutables, persistées server-side, validées | `{ atmosphereDelta: 0.1, displayName: "Sanctuary" }` |

Chacune répond à une question différente :

- **Contraintes** → *« Qu'est-ce qui est possible pour cette zone ? »* (boundaries gameplay)
- **Seed** → *« Quelles valeurs concrètes a tirées le PRNG dans ces possibles ? »* (identité reproductible)
- **Overrides** → *« Comment l'état de jeu a fait évoluer ce body depuis sa création ? »* (mutations cumulatives)

::: warning Distinguer ces couches dans votre tête
L'erreur classique est de confondre « génération reproductible » et « état de jeu reproductible ». La seed reproduit le body **à sa naissance**. L'état de jeu (qui exploite, quelles tuiles ont été creusées, quelle terraformation est en cours) est mutable et persisté en delta — il ne fait pas partie du contrat de génération.
:::

## 2. Le modèle `FeatureGate`

Une contrainte de feature optionnelle (atmosphère, océan, anneaux) n'est ni un boolean ni un range : c'est une union discriminée à trois modes.

```ts
import type { FeatureGate } from '@cedric-pouilleux/stellexjs/sim'

type FeatureGate =
  | { mode: 'forbidden' }
  | { mode: 'required'; range: NumericRange }
  | { mode: 'allowed';  probability: number; range: NumericRange }
```

| Mode | Comportement | Cas d'usage |
| ---- | ------------ | ----------- |
| `forbidden` | Feature jamais générée. La range associée est ignorée à l'arrivée. | Étoile sans atmosphère, gazeuse sans océan |
| `required` | Feature toujours présente, valeur tirée dans `range`. | Géante gazeuse avec atmosphère **garantie** |
| `allowed`  | Le PRNG roule un dé biaisé par `probability`. Si conservé, valeur tirée dans `range` ; sinon traité comme absent. | Atmosphère « possible mais pas acquise » dans la zone habitable |

### Probabilité = ressenti littéral

`probability: 0.85` signifie **littéralement** : 85 % des bodies de cette zone auront cette feature, sur un grand nombre de seeds. Pas une distribution autour de 85 %. Game designers à briefer pour éviter les attentes erronées.

### Clamping défensif

Une `probability` hors de `[0, 1]` est clampée silencieusement. C'est volontaire : un game designer qui rentre `probability: 1.5` voit la feature toujours présente (équivalent à `required`), pas un crash.

### Stabilité du flux PRNG

Le générateur consomme **toujours** le PRNG pour chaque gate, indépendamment de son mode. Un gate `forbidden` tire et jette le résultat ; un gate `required` tire et garde toujours `true`. Conséquence cruciale : un game designer peut basculer un gate de `allowed` à `required` (ou inversement) **sans décaler** les autres champs (mass, noise, …) des bodies déjà nommés. Voir [§7 Stabilité](#_7-stabilite-a-travers-les-changements-de-regles).

## 3. `ZoneConstraints` — déclarer une zone

Une `ZoneConstraints` est l'enveloppe complète d'une zone gameplay. Tout body généré dans cette zone aura ses valeurs **strictement bornées** par cette enveloppe.

```ts
import type { ZoneConstraints } from '@cedric-pouilleux/stellexjs/sim'

interface ZoneConstraints {
  archetype: 'rocky' | 'gaseous' | 'metallic'   // hard pin
  features:  ZoneFeatureGates                   // gates par feature
  ranges:    ZoneRanges                         // ranges par knob
}
```

### `archetype`

Pin dur : tout body de la zone est de cet archétype. La lib mappe ensuite vers le `surfaceLook` adapté (`'rocky' → 'terrain'`, `'gaseous' → 'bands'`, `'metallic' → 'metallic'`). Les étoiles sont volontairement exclues — leur génération est structurellement différente (pilotée par le `spectralType`) et fera l'objet d'un générateur séparé.

### `features` — `ZoneFeatureGates`

Trois gates en v1, dans un ordre figé :

```ts
interface ZoneFeatureGates {
  atmosphere: FeatureGate   // → atmosphereThickness, atmosphereOpacity
  liquid:     FeatureGate   // → liquidState ('liquid' | 'none'), liquidCoverage
  rings:      FeatureGate   // → hasRings
}
```

Note importante : les FX visuels (`cracks`, `lava`) ne sont **pas** des gates de zone — ce sont des champs de [`BodyVariation`](/guides/variation), seedés indépendamment depuis `config.name` par `generateBodyVariation`. Si votre gameplay veut piloter ces FX par zone, c'est une couche à ajouter côté caller (cf. [§6 Champs caller-resolved](#_6-champs-resolus-cote-caller)).

### `ranges` — `ZoneRanges`

Plages numériques pour 17 knobs physiques + procéduraux :

| Catégorie | Champs |
| --------- | ------ |
| **Géométrie** | `radius`, `mass`, `coreRadiusRatio`, `rotationSpeed`, `axialTilt` |
| **Atmosphère** | `atmosphereThickness`, `atmosphereOpacity` |
| **Liquide** | `liquidCoverage` |
| **fBm** | `noiseScale`, `noiseOctaves`, `noisePersistence`, `noiseLacunarity`, `noisePower`, `noiseRidge`, `reliefFlatness`, `continentAmount`, `continentScale` |

Chaque champ est un `NumericRange = readonly [min, max]`.

::: tip Conventions de range
- Pour `noiseOctaves`, qui est un entier, le générateur applique `Math.floor` après tirage. Déclarez la plage en flottants (`[2, 6]`) — le résultat sera `2`, `3`, `4`, `5` ou `6`.
- Les ranges des features `forbidden` ou `liquid` sur une zone gazeuse peuvent rester techniques (`[0, 0]`) — elles ne seront jamais lues à l'arrivée mais le PRNG les consomme quand même pour respecter la séquence stable.
- Dimensionnez vos ranges selon le ressenti : un `radius: [0.8, 1.5]` Earth-like donnera des planètes très uniformes ; un `[0.5, 5]` produira des disparités énormes au sein de la même zone.
:::

### Exemple complet — zone habitable

```ts
const HABITABLE: ZoneConstraints = {
  archetype: 'rocky',
  features: {
    atmosphere: { mode: 'allowed', probability: 0.85, range: [0.10, 0.45] },
    liquid:     { mode: 'allowed', probability: 0.60, range: [0.05, 0.95] },
    rings:      { mode: 'allowed', probability: 0.05, range: [0, 1] },
  },
  ranges: {
    radius:              [0.8, 1.5],
    mass:                [0.5, 2.5],
    coreRadiusRatio:     [0.40, 0.60],
    rotationSpeed:       [0.005, 0.05],
    axialTilt:           [0.0, 0.6],
    atmosphereThickness: [0.10, 0.45],
    atmosphereOpacity:   [0.30, 0.60],
    liquidCoverage:      [0.05, 0.95],
    noiseScale:          [0.8, 2.5],
    noiseOctaves:        [2, 6],
    noisePersistence:    [0.4, 0.6],
    noiseLacunarity:     [1.8, 2.2],
    noisePower:          [0.8, 1.4],
    noiseRidge:          [0.0, 0.3],
    reliefFlatness:      [0.0, 0.4],
    continentAmount:     [0.4, 0.9],
    continentScale:      [1.0, 2.0],
  },
}
```

## 4. `generateBodyConfig` — la fonction

Signature unique :

```ts
import { generateBodyConfig } from '@cedric-pouilleux/stellexjs/sim'

function generateBodyConfig(
  seed:        string,
  constraints: ZoneConstraints,
): PlanetConfig
```

### Comportement

1. Hash de la seed : `seed + ':config'` → `seededPrng` (FNV-1a + SplitMix32, integer-pur).
2. Tirage de chaque knob dans son range, dans un ordre figé documenté en haut du fichier source.
3. Résolution de chaque feature gate (toujours un `rng()` consommé).
4. Composition d'un `PlanetConfig` complet avec :
   - `name = seed` (pour que [`generateBodyVariation`](/guides/variation) chaîne sur la même graine sans collision de namespace)
   - `surfaceLook` mappé depuis l'archétype
   - tous les knobs physiques + bruit
   - `liquidState: 'liquid' | 'none'`, `liquidCoverage` (à `0` si liquid absent)
   - `atmosphereThickness`, `atmosphereOpacity` (à `0` si atmo absente)
   - `hasRings`

### Champs laissés `undefined`

La lib **n'invente pas** ce qu'elle ne sait pas. Sur le `PlanetConfig` retourné, ces champs restent volontairement vides :

| Champ | Pourquoi | Qui le résout |
| ----- | -------- | ------------- |
| `liquidColor` | Dépend de la substance (eau / méthane / ammoniac…). La lib n'a pas de catalogue de chimie. | Caller, depuis son `liquidSubstances` pool |
| `terrainColorLow` / `terrainColorHigh` | Dépend de la température / de la composition minérale. | Caller, depuis son modèle thermique |
| `bandColors` | Dépend de la composition gazeuse. | Caller, depuis son catalogue gas-mix |
| `metallicBands` | Dépend de la composition métallique. | Caller, depuis son catalogue métallique |

Le caller remplit ces champs **après** `generateBodyConfig`, idéalement dans une fonction `hydrateBodyConfig` qui orchestre la résolution complète (cf. [§6](#_6-champs-resolus-cote-caller)).

### Promotion `'liquid' → 'frozen'`

La lib produit `liquidState: 'liquid' | 'none'` uniquement. La promotion vers `'frozen'` requiert une connaissance de température que la lib n'a pas (cf. [doctrine chemistry-agnostic](/guides/headless-simulation#ressources-et-chimie)). Le caller décide après hydratation : *« la température moyenne est sous le point de fusion de la substance dominante → je downgrade `liquid` à `frozen` »*.

```ts
const cfg = generateBodyConfig(seed, HABITABLE)
if (cfg.liquidState === 'liquid' && temperatureMean(seed) < -10) {
  cfg.liquidState = 'frozen'
}
```

## 5. Le contrat de déterminisme

Trois règles non-négociables. Les enfreindre casse la rétro-compatibilité visuelle de tous les bodies déjà nommés en prod.

### Règle 1 — Append-only sur l'ordre PRNG

Chaque appel à `rng()` à l'intérieur de `generateBodyConfig` se fait dans une séquence figée. Insérer un nouveau tirage **au milieu** décale tous les tirages suivants — toutes les seeds existantes produisent à ce moment-là des configs différentes.

```ts
// ❌ KO — insère au milieu
const radius = pick(rng, r.radius)
const mass   = pick(rng, r.mass)
const NEW    = pick(rng, r.somethingNew)   // ← shift toute la suite
const core   = pick(rng, r.coreRadiusRatio)

// ✅ OK — append à la fin
const radius = pick(rng, r.radius)
const mass   = pick(rng, r.mass)
const core   = pick(rng, r.coreRadiusRatio)
// … tous les tirages existants
const NEW    = pick(rng, r.somethingNew)   // ← nouveau, en dernier
```

### Règle 2 — Toujours consommer

Le PRNG est toujours consommé pour un range ou un gate, même si la valeur sera ignorée à l'arrivée. C'est ce qui permet de basculer un gate de `allowed` à `required` (ou de modifier les overrides) sans décaler le reste.

### Règle 3 — Namespace par usage

Le générateur seed son PRNG avec `seed + ':config'`. La variation shader (`generateBodyVariation`) utilise un namespace différent (`'var:' + config.name`). Les deux flux PRNG sont indépendants : refactoriser l'un ne décale pas l'autre. Vous **devez** appliquer la même discipline pour vos propres pioches caller-side (biomes, ressources, substances).

```ts
// ✅ Bonne pratique
const liquidRng    = seededPrng(seed + ':liquid')
const biomesRng    = seededPrng(seed + ':biomes')
const resourcesRng = seededPrng(seed + ':resources')

// ❌ À éviter — un seul flux partagé
const sharedRng = seededPrng(seed)
const liquid    = pickFromPool(sharedRng, …)
const biomes    = shuffleAndPick(sharedRng, …)   // refacto de liquid décale biomes
```

### Sécurité cross-runtime

Le `seededPrng` interne utilise FNV-1a + SplitMix32 sur entiers 32-bit (`Math.imul`, opérateurs bit-à-bit) — aucune opération flottante sensible. Conséquence : **identique sur Node, Bun, Chrome, Firefox**, jusqu'au dernier bit. Vous pouvez héberger `generateBodyConfig` côté serveur Node pour matérialiser un freeze, et reconstruire le même body côté client sans dérive ULP.

::: tip Test d'invariance cross-runtime
Configurez un test CI qui exécute le générateur sur Node + Bun + Chrome headless et compare les snapshots. Si une dérive apparaît, vous voulez le savoir tout de suite — pas dans 3 mois quand un joueur se plaint que sa planète a changé d'apparence après une mise à jour de Node.
:::

## 6. Champs résolus côté caller

La lib reste agnostique de votre vocabulaire gameplay (substances, biomes, ressources, températures). Le caller orchestre une hydratation complète en chaînant `generateBodyConfig` avec ses propres pioches déterministes :

```ts
import { generateBodyConfig, seededPrng } from '@cedric-pouilleux/stellexjs/sim'

interface HydratedBody {
  config: PlanetConfig
  meta: {
    biomes:          readonly BiomeId[]
    resources:       readonly ResourceId[]
    liquidSubstance: VolatileId | null
    temperatureMean: number
  }
}

function hydrateBodyConfig(d: BodyDescriptor): HydratedBody {
  const zone = ZONE_CONSTRAINTS[d.zoneId]

  // 1. Lib — physiques + features (PRNG namespace ':config')
  const seedConfig = generateBodyConfig(d.seed, zone)

  // 2. Caller — chimie / température / pools (PRNG namespaces séparés)
  const tMean      = pickInt(d.seed, 'temp', zone.temperatureMean)
  const substance  = seedConfig.liquidState !== 'none'
    ? pickFromPool(d.seed, 'liquid', zone.liquidSubstances)
    : null
  const colors     = deriveTerrainColors(tMean)
  const biomeCount = pickInt(d.seed, 'biomes:count', zone.biomes.count)

  // 3. Composition finale
  return {
    config: {
      ...seedConfig,
      terrainColorLow:  colors.low,
      terrainColorHigh: colors.high,
      liquidColor:      substance ? LIQUID_COLOR[substance] : undefined,
    },
    meta: {
      biomes:          shuffleAndPick(d.seed, 'biomes', zone.biomes.pool, biomeCount),
      resources:       shuffleAndPick(d.seed, 'res',    zone.resources.pool, resCount),
      liquidSubstance: substance,
      temperatureMean: tMean,
    },
  }
}
```

L'exemple complet et runnable se trouve dans [`examples/seed-roundtrip/hydrate.ts`](https://github.com/cedric-pouilleux/stellex-js/tree/main/examples/seed-roundtrip).

### Helpers réutilisables

Trois helpers couvrent 95 % des besoins caller-side. Tous opèrent en namespace `seed + ':' + purpose` pour garantir l'indépendance des flux.

```ts
/** Linéaire dans `[min, max)` */
function pickFloat(seed: string, ns: string, [min, max]: NumericRange): number {
  const rng = seededPrng(seed + ':' + ns)
  return min + rng() * (max - min)
}

/** Entier dans `[min, max]` (fermé) */
function pickInt(seed: string, ns: string, [min, max]: NumericRange): number {
  const rng = seededPrng(seed + ':' + ns)
  return Math.floor(min + rng() * (max - min + 1))
}

/** Élément aléatoire d'un pool */
function pickFromPool<T>(seed: string, ns: string, pool: readonly T[]): T | null {
  if (pool.length === 0) return null
  const rng = seededPrng(seed + ':' + ns)
  return pool[Math.floor(rng() * pool.length)]
}

/** Fisher-Yates seedé — `count` éléments uniques */
function shuffleAndPick<T>(seed: string, ns: string, pool: readonly T[], count: number): T[] {
  if (pool.length === 0 || count <= 0) return []
  const rng = seededPrng(seed + ':' + ns)
  const arr = [...pool]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr.slice(0, Math.min(count, arr.length))
}
```

## 7. Stabilité à travers les changements de règles

L'invariant clé que cette architecture vous offre :

> **Modifier un `mode` ou une `probability` d'un gate ne déplace PAS les valeurs des autres champs des bodies déjà nommés.**

Démonstration concrète. Soit deux versions des contraintes habitables qui ne diffèrent que sur le mode du gate `atmosphere` :

```ts
// Version A — atmo possible (probabiliste)
{ atmosphere: { mode: 'allowed', probability: 0.85, range: [0.10, 0.45] }, … }

// Version B — atmo garantie
{ atmosphere: { mode: 'required', range: [0.10, 0.45] }, … }
```

Pour la même seed `"seed-0"` :

| Champ | Version A | Version B | Stable ? |
| ----- | --------- | --------- | -------- |
| `radius` | `1.302` | `1.302` | ✅ |
| `mass` | `1.847` | `1.847` | ✅ |
| `noiseScale` | `2.027` | `2.027` | ✅ |
| `atmospherePresent` | `false` (rolled) | `true` (forced) | ❌ attendu |
| `atmosphereThickness` | `0` | `0.247` | ❌ attendu |

Tout ce qui n'est pas dans le gate impacté reste byte-stable. C'est le test [`PRNG stability across gate mode changes`](https://github.com/cedric-pouilleux/stellex-js/blob/main/render/body/generateBodyConfig.spec.ts) qui valide cet invariant.

::: warning Limites
Cet invariant tient pour les changements de `mode` et de `probability`. **Modifier un `range`** (par ex. `radius: [0.8, 1.5]` → `[0.5, 2.0]`) change évidemment la valeur tirée pour le même seed — le PRNG donne le même `rng()` brut, mais l'interpolation linéaire dans un range différent donne un autre flottant. C'est ce qui motive le `genVersion` (cf. §10).
:::

## 8. Le pattern `BodyDescriptor`

Le `BodyDescriptor` est le **format de stockage et de transport** d'un body. C'est un type **caller-side** (pas dans la lib) — vous le définissez dans votre package partagé server/front.

```ts
// Côté jeu, dans shared/
interface BodyDescriptor {
  seed:       string             // ex: "sys-7f3a2b8e:orbit-3"
  zoneId:     GameZoneId         // ex: "habitable"
  genVersion: number             // ex: 1
  overrides:  BodyOverrides      // mutations gameplay accumulées, souvent {}
}
```

Pourquoi pas embarquer les `ZoneConstraints` directement ? Parce que :

- Embarquer chaque enveloppe dans chaque descriptor multiplie le payload réseau ×N.
- Les contraintes sont des **constantes du build** — elles ne varient pas au cours d'une session.
- Un `zoneId` (`string`) référence le bon objet en O(1) côté client via une table locale.

**Coût** : ~80 octets/descriptor en JSON, vs plusieurs Ko si on embarquait l'enveloppe complète.

### Format du seed

Convention recommandée pour la seed :

```
${systemId}:orbit-${orbitIndex}
```

Le `systemId` est un UUID stable du système (peut appartenir à un user, une faction, un événement, ou à personne). Le `orbitIndex` positionne le body dans le système. **Ne jamais inclure un `userId` dans la seed** — un système peut changer de propriétaire (colonisation, abandon, conquête), un body procédural peut n'avoir aucun propriétaire, et les mondes scriptés ne sont liés à aucun joueur.

```ts
// ❌ Couplage user → identité body
seed: `${userId}:${systemId}:orbit-${orbitIndex}`

// ✅ Identité ancrée sur le système
seed: `${systemId}:orbit-${orbitIndex}`
```

La relation user ↔ système est une jointure DB séparée, pas un facteur d'identité du body.

## 9. Round-trip serveur → client

Le scénario complet — serveur émet le descriptor, le client le reçoit, l'hydrate, et obtient un body identique :

```ts
// ─── SERVEUR ────────────────────────────────────────────────────────
import type { BodyDescriptor, GameZoneId } from './shared/types'

function createBodyDescriptor(
  systemId:   string,
  orbitIndex: number,
  zoneId:     GameZoneId,
): BodyDescriptor {
  return {
    seed:       `${systemId}:orbit-${orbitIndex}`,
    zoneId,
    genVersion: 1,
    overrides:  {},
  }
}

// HTTP response
res.json(createBodyDescriptor('sys-7f3a2b8e', 3, 'habitable'))
// → { "seed":"sys-7f3a2b8e:orbit-3", "zoneId":"habitable", "genVersion":1, "overrides":{} }
//   100 octets sur le fil

// ─── CLIENT ─────────────────────────────────────────────────────────
import { hydrateBodyConfig } from './lib/hydrate'

const descriptor = await fetch('/api/body/123').then(r => r.json())
const hydrated   = hydrateBodyConfig(descriptor)

// Trois hydratations consécutives produisent un résultat byte-identique :
console.log(JSON.stringify(hydrateBodyConfig(descriptor)) === JSON.stringify(hydrated))
// → true

// Render
const body = useBody(hydrated.config, DEFAULT_TILE_SIZE)
```

Le repo contient un demo runnable de ce round-trip dans [`examples/seed-roundtrip/`](https://github.com/cedric-pouilleux/stellex-js/tree/main/examples/seed-roundtrip) :

```bash
# Pipe direct serveur → client
npx tsx examples/seed-roundtrip/server.ts | npx tsx examples/seed-roundtrip/client.ts

# Avec persistance intermédiaire
npx tsx examples/seed-roundtrip/server.ts > body.json
npx tsx examples/seed-roundtrip/client.ts < body.json
```

Le client vérifie automatiquement que trois hydratations consécutives sont strictement byte-identiques.

## 10. Intégration côté jeu

### Trois moments distincts à séparer

Avant de plonger dans le schéma DB, lever une confusion fréquente. Un body passe par trois états différents que l'on a tendance à confondre :

| Moment | État | Lieu | Action |
| ------ | ---- | ---- | ------ |
| **Création du système** | Paramètres **déterminés** | Mathématique pure | INSERT system. Les seeds de chaque orbit (`${systemId}:orbit-${idx}`) sont fixées dès cet instant. |
| **Visite / affichage** | Paramètres **calculés** | CPU pur (microsecondes) | `generateBodyConfig(seed, constraints)` rejouable à l'infini. Aucune écriture DB. |
| **Première observation** | Paramètres **persistés et verrouillés** | DB | INSERT body. Bloque le `genVersion` contre les futures évolutions de règles ; ouvre un emplacement pour les overrides. |

Le malentendu classique : *« le body prend ses paramètres au moment de la visite »*. **Faux**. Les paramètres sont déterminés à la création du système (parce que la seed est fixée à ce moment-là). La visite ne fait que les **calculer** — résultat identique à chaque appel parce que `generateBodyConfig` est une pure fonction. La première observation ne **crée** pas non plus les paramètres — elle les **fige** contre les futures mises à jour de règles, en stockant le `genVersion` courant en DB.

Conséquence pratique :

- Avant observation : `generateBodyConfig` est appelé à chaque visite. Si tu changes les règles entre deux visites, le body apparaît différemment. Acceptable tant que personne ne s'y est attaché.
- Après observation : `generateBodyConfig` est rappelé à chaque visite, mais **avec le `gen_version` stocké en DB** — ce qui pin le code aux anciennes règles. Le body reste byte-stable même si tu rebalance le game design.

::: tip Analogie
Penser à `π` : son 47ᵉ décimale est **déterminée** dès que tu décides de regarder π en base 10. Elle est **calculée** quand tu ouvres une calculatrice. Et tu peux la **persister** sur un papier si tu veux la garder à l'identique même après une réforme des chiffres.
:::

### Schéma DB recommandé

```sql
-- Le système est l'unité d'identité (peut appartenir à user / faction / personne)
CREATE TABLE system (
  id            UUID PRIMARY KEY,
  sector_x      INT NOT NULL,
  sector_y      INT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Relation propriétaire(s) — séparée de l'identité système
CREATE TABLE system_claim (
  system_id     UUID REFERENCES system,
  user_id       UUID,
  faction_id    UUID,
  claim_type    TEXT NOT NULL,   -- 'home' | 'colony' | 'territory' | …
  claimed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (system_id, claim_type)
);

-- Body — row créée uniquement à la première observation (cf. ci-dessous)
CREATE TABLE body (
  id            UUID PRIMARY KEY,
  system_id     UUID REFERENCES system NOT NULL,
  orbit_index   INT NOT NULL,
  zone_id       TEXT NOT NULL,
  gen_version   INT NOT NULL,
  overrides     JSONB NOT NULL DEFAULT '{}',
  observed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (system_id, orbit_index)
);
-- Pas besoin de stocker la `seed` — recalculée via `${system_id}:orbit-${orbit_index}`.
```

### Lazy persistence + freeze on observation

Stratégie recommandée pour évoluer les règles de game design **sans régression visuelle** pour les joueurs.

::: warning À ne pas confondre
Cette sous-section parle de **quand persister** un body en DB et **quand verrouiller** son `genVersion`. Les paramètres du body, eux, sont déterminés depuis la création du système (cf. §10.1) et calculables à tout instant via `generateBodyConfig`. La persistance et le verrouillage sont des décisions opérationnelles, pas le moment où le body « prend ses paramètres ».
:::

1. **Visite d'un secteur jamais exploré** : le serveur émet les `BodyDescriptor` de chaque orbit à la volée. **Aucun INSERT en DB** — les bodies sont calculés (et rendus) sans laisser de trace persistante. Si tu changes les règles entre deux visites avant qu'aucun joueur n'observe, ils apparaîtront différemment au prochain affichage. Acceptable.

2. **Premier clic d'un joueur sur une planète (first observation)** : le serveur **persiste** une row pour ce body et **verrouille** le `genVersion` courant :

   ```ts
   INSERT INTO body (system_id, orbit_index, zone_id, gen_version, overrides)
   VALUES ($1, $2, $3, 1, '{}')
   ON CONFLICT (system_id, orbit_index) DO NOTHING
   ```

   À partir de ce moment, deux choses sont acquises :
   - Le `gen_version` est stocké → toutes les hydratations futures utilisent les règles de la **version 1**, même après une mise à jour du code.
   - Une row existe → les overrides gameplay (terraformation, mining) ont un emplacement stable où s'accumuler.

3. **Mise à jour du game design** (ex: rebalance des ranges) :
   - Bumpez la `genVersion` du nouveau code à `2`.
   - Bodies déjà observés (`gen_version = 1`) : **inchangés visuellement**. Le client les hydrate en chargeant les règles version 1 (que tu maintiens en parallèle des nouvelles dans `shared/zones-v1.ts`).
   - Bodies non-observés : recalculés avec les règles version 2 à chaque affichage. Le jour où un joueur en observe un, sa row sera créée avec `gen_version = 2`.

Cette stratégie réconcilie *« on doit pouvoir équilibrer le jeu »* avec *« on ne doit pas changer la planète préférée d'un joueur »*.

::: tip Variante hard-freeze
Si tu veux garantir l'identité visuelle même contre des refactos profonds du PRNG, du namespacing ou de la séquence interne de `generateBodyConfig`, persiste la **config résolue complète** (radius, masse, noise, terrainColors, …) à la première observation. Coût : ~5-10 Ko par body observé en JSONB. Avantage : la planète est totalement décorrélée du code de génération courant. À considérer si tu prévois beaucoup d'évolutions sur le générateur ou si tu veux un audit trail visuel complet.
:::

### Validation des overrides côté serveur

Tout endpoint qui modifie un override doit valider la mutation contre la `ZoneConstraints` de la zone. C'est votre couche anti-cheat : un client trafiqué qui tenterait de pousser `atmosphereDelta: 999` doit être rejeté.

```ts
// POST /api/body/:id/terraform
async function terraform(bodyId: string, patch: { atmosphereDelta: number }) {
  const body  = await db.body.findUnique({ where: { id: bodyId } })
  const zone  = ZONE_CONSTRAINTS[body.zone_id]
  const [min, max] = zone.ranges.atmosphereThickness

  // Hydratation server-side pour connaître la valeur courante
  const current = hydrateBodyConfig({
    seed: `${body.system_id}:orbit-${body.orbit_index}`,
    zoneId: body.zone_id,
    genVersion: body.gen_version,
    overrides: body.overrides,
  })

  const proposed = (current.config.atmosphereThickness ?? 0) + patch.atmosphereDelta
  if (proposed < min || proposed > max) {
    throw new Error(`atmosphereDelta sortirait du range [${min}, ${max}]`)
  }

  await db.body.update({
    where: { id: bodyId },
    data:  { overrides: { ...body.overrides, atmosphereDelta: patch.atmosphereDelta } },
  })
}
```

Recommandation forte : **utilisez Zod (ou Valibot) aux frontières de l'API** pour valider la forme des payloads. Pas dans le hot path — uniquement à l'entrée/sortie HTTP. Voir [Performance](/guides/performance) pour la séparation hot path / boundaries.

### Genversion comme audit trail

Sous une stratégie freeze on observation, le `genVersion` n'est **pas** un mécanisme de migration — c'est un audit trail. Quand un joueur signale un bug visuel sur sa planète, le `genVersion` vous dit sous quelles règles elle a été créée. Vous pouvez recharger les anciennes règles dans un sandbox dev pour reproduire.

Bumpez `genVersion` à chaque fois que vous changez :
- Une `range` dans une zone (la valeur tirée pour la même seed change).
- L'ordre de consommation PRNG dans `generateBodyConfig` (cf. règle 1).
- Un namespace PRNG côté caller (cf. règle 3).
- Un catalogue caller-side (substances, biomes, ressources) qui change l'index pioché.

## 11. Couche d'overrides — pratique

Les `BodyOverrides` représentent les **mutations gameplay persistées**. Type strict côté caller (jamais un `Partial<BodyConfig>` libre), pour que le joueur ne puisse pas écraser des knobs procéduraux et perdre l'identité visuelle de sa planète.

```ts
// Côté jeu — type explicite
interface BodyOverrides {
  // Identité
  displayName?: string

  // Terraformation
  atmosphereDelta?:     number                                // -1..+1, additif clampé
  liquidStateOverride?: 'liquid' | 'frozen' | 'none'          // remplace

  // État de jeu
  tileMutations?:       readonly TileMutation[]
  unlockedResources?:   readonly ResourceId[]
  exhaustedResources?:  readonly ResourceId[]
}
```

Application des overrides dans `hydrateBodyConfig`, **après** la résolution caller-side :

```ts
function applyOverrides(
  config:    PlanetConfig,
  overrides: BodyOverrides,
  zone:      GameZoneConstraints,
): PlanetConfig {
  const next = { ...config }

  if (overrides.atmosphereDelta != null) {
    const [min, max] = zone.ranges.atmosphereThickness
    next.atmosphereThickness = Math.max(min, Math.min(max,
      (config.atmosphereThickness ?? 0) + overrides.atmosphereDelta))
  }

  if (overrides.liquidStateOverride) {
    next.liquidState = overrides.liquidStateOverride
    if (overrides.liquidStateOverride === 'none') next.liquidCoverage = 0
  }

  return next
}
```

### Pas dans `BodyOverrides`

Champs **interdits** dans les overrides — la planète perd son identité visuelle si le joueur peut les écraser :

- `noiseScale`, `noiseOctaves` et tous les knobs `noise*`
- `radius`, `mass`, `coreRadiusRatio`
- `archetype` / `surfaceLook`
- `terrainColorLow/High`, `liquidColor`, `bandColors` (ce sont des dérivés caller-side, pas des inputs joueur)

## 12. Versioning des règles — résumé

| Action | Bump `genVersion` ? | Impact bodies existants (sous freeze) |
| ------ | ------------------- | ------------------------------------- |
| Ajouter une nouvelle zone | Non | Aucun |
| Ajouter un nouveau range au schéma `ZoneRanges` (en fin) | Oui | Aucun (bodies anciens utilisent l'ancien schéma) |
| Modifier une `range` existante d'une zone | Oui | Aucun pour les observés ; les non-observés régénèrent avec la nouvelle valeur |
| Modifier une `probability` d'un gate | Oui | Idem |
| Modifier un `mode` (`forbidden`/`required`/`allowed`) | Oui | Idem |
| Ajouter un namespace caller-side (`seed + ':newPurpose'`) | Non | Aucun |
| Modifier un namespace caller-side existant | Oui | Bodies non-observés voient le résultat changer |

::: warning La règle d'or
Si un changement peut faire qu'un même seed produise un résultat différent → bumpez `genVersion`. Sinon → pas la peine.
:::

## 13. Voir aussi

- [Variation visuelle](/guides/variation) — l'autre couche seedée (params shader)
- [Concepts fondamentaux §3 — Le seed déterministe](/guides/core-concepts#_3-le-seed-est-enti%C3%A8rement-d%C3%A9termin%C3%A9-par-name)
- [Simulation headless](/guides/headless-simulation) — pour une utilisation backend / worker
- [Anatomie d'un BodyConfig](/guides/body-config-anatomy) — le type retourné par `generateBodyConfig`
- [API : `generateBodyConfig`](/api/sim/functions/generateBodyConfig)
- [API : `ZoneConstraints`](/api/sim/interfaces/ZoneConstraints)
- [API : `FeatureGate`](/api/sim/type-aliases/FeatureGate)
- [Demo round-trip](https://github.com/cedric-pouilleux/stellex-js/tree/main/examples/seed-roundtrip) (fichiers `server.ts`, `client.ts`, `hydrate.ts`, `zones.ts`)
