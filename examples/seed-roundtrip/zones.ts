/**
 * Constantes de zones — partagées server ↔ client.
 *
 * En production : ce fichier vit dans un package partagé (`shared/zones.ts`)
 * importé par le serveur et le front. Pour le demo, on le place ici et les
 * deux scripts l'importent depuis le même chemin local.
 */

import type { ZoneConstraints } from '../../sim'

// ── Vocabulaire gameplay (hors lib) ──────────────────────────────────
export type VolatileId = 'h2o' | 'ch4' | 'nh3'
export type BiomeId    = 'ocean' | 'forest' | 'desert' | 'tundra' | 'mountain'
export type ResourceId = 'iron' | 'copper' | 'silicon' | 'water_ice'
export type GameZoneId = 'habitable' | 'frost-line'

/** Extension de `ZoneConstraints` avec le vocabulaire gameplay. */
export interface GameZoneConstraints extends ZoneConstraints {
  liquidSubstances: readonly VolatileId[]
  biomes:    { pool: readonly BiomeId[];    count: readonly [number, number] }
  resources: { pool: readonly ResourceId[]; count: readonly [number, number] }
  /** Plage de température équilibre (°C) — le caller la consomme pour les couleurs. */
  temperatureMean: readonly [number, number]
}

const HABITABLE: GameZoneConstraints = {
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
  liquidSubstances: ['h2o'],
  biomes:    { pool: ['ocean', 'forest', 'desert', 'tundra', 'mountain'], count: [3, 5] },
  resources: { pool: ['iron', 'copper', 'silicon', 'water_ice'],          count: [2, 4] },
  temperatureMean: [-10, 25],
}

const FROST_LINE: GameZoneConstraints = {
  archetype: 'gaseous',
  features: {
    atmosphere: { mode: 'required', range: [0.60, 0.90] },
    liquid:     { mode: 'forbidden' },
    rings:      { mode: 'allowed', probability: 0.50, range: [0, 1] },
  },
  ranges: {
    radius:              [3.0, 8.0],
    mass:                [10, 320],
    coreRadiusRatio:     [0.10, 0.25],
    rotationSpeed:       [0.05, 0.20],
    axialTilt:           [0.0, 0.5],
    atmosphereThickness: [0.60, 0.90],
    atmosphereOpacity:   [0.95, 1.00],
    liquidCoverage:      [0, 0],
    noiseScale:          [1.5, 4.0],
    noiseOctaves:        [3, 6],
    noisePersistence:    [0.5, 0.7],
    noiseLacunarity:     [1.8, 2.4],
    noisePower:          [0.8, 1.2],
    noiseRidge:          [0, 0],
    reliefFlatness:      [0.7, 1.0],
    continentAmount:     [0, 0],
    continentScale:      [1, 1],
  },
  liquidSubstances: [],
  biomes:    { pool: [], count: [0, 0] },
  resources: { pool: ['water_ice'], count: [1, 1] },
  temperatureMean: [-180, -120],
}

export const ZONE_CONSTRAINTS: Record<GameZoneId, GameZoneConstraints> = {
  habitable:    HABITABLE,
  'frost-line': FROST_LINE,
}

// ── Descriptor & Overrides — stockage server-side, payload réseau ────

export interface BodyOverrides {
  displayName?:         string
  atmosphereDelta?:     number
  liquidStateOverride?: 'liquid' | 'frozen' | 'none'
}

export interface BodyDescriptor {
  seed:       string
  zoneId:     GameZoneId
  genVersion: number
  overrides:  BodyOverrides
}
