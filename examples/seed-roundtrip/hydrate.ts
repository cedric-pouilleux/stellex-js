/**
 * Hydratation — pipeline complet d'un `BodyDescriptor` à un body prêt à
 * rendre. Pure fonction, exécutable côté serveur ou côté front à
 * l'identique.
 *
 *   1. `generateBodyConfig` (lib) — pioche déterministe dans les contraintes
 *   2. resolveCallerFields (jeu) — chimie / température / pools, namespacés
 *      par `seed + ':<purpose>'` pour rester indépendants entre eux
 *   3. applyOverrides (jeu) — patch gameplay sur le résultat
 */

import { generateBodyConfig, seededPrng } from '../../sim'
import type { PlanetConfig } from '../../sim'
import { ZONE_CONSTRAINTS } from './zones'
import type {
  BiomeId, BodyDescriptor, BodyOverrides,
  GameZoneConstraints, ResourceId, VolatileId,
} from './zones'

/** Vue gameplay-enrichie — config lib + métadonnées caller-side. */
export interface HydratedBody {
  config: PlanetConfig
  meta: {
    displayName:     string
    biomes:          readonly BiomeId[]
    resources:       readonly ResourceId[]
    liquidSubstance: VolatileId | null
    temperatureMean: number
  }
}

/** Pioche déterministe d'un élément dans un pool, namespacée par purpose. */
function pickFromPool<T>(seed: string, ns: string, pool: readonly T[]): T | null {
  if (pool.length === 0) return null
  const rng = seededPrng(seed + ':' + ns)
  return pool[Math.floor(rng() * pool.length)]
}

/** Fisher-Yates seedé — pioche `count` éléments uniques dans un pool. */
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

/** Tirage entier dans une plage fermée `[min, max]`. */
function pickInt(seed: string, ns: string, [min, max]: readonly [number, number]): number {
  const rng = seededPrng(seed + ':' + ns)
  return Math.floor(min + rng() * (max - min + 1))
}

/** Tirage flottant dans une plage `[min, max)`. */
function pickFloat(seed: string, ns: string, [min, max]: readonly [number, number]): number {
  const rng = seededPrng(seed + ':' + ns)
  return min + rng() * (max - min)
}

/** Catalogue substance → couleur liquide (caller, pas lib). */
const LIQUID_COLOR: Record<VolatileId, string> = {
  h2o: '#2878d0',
  ch4: '#a06030',
  nh3: '#88aacc',
}

/** Température moyenne → ramp couleur terrain low/high. */
function deriveTerrainColors(meanC: number): { low: string; high: string } {
  if (meanC < -50) return { low: '#1a2030', high: '#c0d8f0' }
  if (meanC < 10)  return { low: '#3a4a3a', high: '#a8b0a0' }
  if (meanC < 60)  return { low: '#705030', high: '#d8c090' }
  return                  { low: '#502010', high: '#f08060' }
}

/** Apply gameplay overrides on top of the seed-driven config. */
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

/**
 * Pipeline complet — déterministe et pure. Même `descriptor` → même
 * `HydratedBody`, byte-stable, indépendant du runtime.
 */
export function hydrateBodyConfig(d: BodyDescriptor): HydratedBody {
  const zone = ZONE_CONSTRAINTS[d.zoneId]

  // 1. Lib — physiques + features
  const seedConfig = generateBodyConfig(d.seed, zone)

  // 2. Caller — chimie / température / pools (PRNG indépendants par namespace)
  const tMean      = Math.round(pickFloat(d.seed, 'temp', zone.temperatureMean))
  const substance  = seedConfig.liquidState !== 'none'
    ? pickFromPool(d.seed, 'liquid', zone.liquidSubstances)
    : null
  const colors     = deriveTerrainColors(tMean)
  const biomeCount = pickInt(d.seed, 'biomes:count', zone.biomes.count)
  const resCount   = pickInt(d.seed, 'res:count',    zone.resources.count)

  const enriched: PlanetConfig = {
    ...seedConfig,
    terrainColorLow:  colors.low,
    terrainColorHigh: colors.high,
    liquidColor:      substance ? LIQUID_COLOR[substance] : undefined,
  }

  // 3. Overrides
  const final = applyOverrides(enriched, d.overrides, zone)

  return {
    config: final,
    meta: {
      displayName:     d.overrides.displayName ?? d.seed,
      biomes:          shuffleAndPick(d.seed, 'biomes', zone.biomes.pool, biomeCount),
      resources:       shuffleAndPick(d.seed, 'res',    zone.resources.pool, resCount),
      liquidSubstance: substance,
      temperatureMean: tMean,
    },
  }
}
