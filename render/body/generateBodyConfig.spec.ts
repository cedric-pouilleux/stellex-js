/**
 * Tests d'invariance pour `generateBodyConfig`.
 *
 * Couvre les propriétés non-négociables du générateur :
 *   1. Déterminisme bit-stable pour `(seed, constraints)`.
 *   2. Respect des `NumericRange` déclarés.
 *   3. Sémantique des `FeatureGate` (forbidden / required / allowed).
 *   4. Stabilité du flux PRNG quand un gate change de mode (les autres
 *      champs ne doivent PAS bouger — propriété clé pour le tuning sans
 *      régression).
 *   5. Mapping archétype → `surfaceLook`.
 *   6. Intégrité des champs entiers (`noiseOctaves`).
 *   7. Champs caller-resolved laissés `undefined` (couleurs, substance).
 */

import { describe, it, expect } from 'vitest'
import { generateBodyConfig } from './generateBodyConfig'
import type {
  FeatureGate,
  NumericRange,
  ZoneConstraints,
} from '../../types/generation.types'

// ─────────────────────────────────────────────────────────────────────
// Fixtures — 2 zones réalistes + 1 zone "tout interdit" pour les bornes
// ─────────────────────────────────────────────────────────────────────

const ROCKY_HABITABLE: ZoneConstraints = {
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

const GAS_GIANT: ZoneConstraints = {
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
}

const ALL_FORBIDDEN: ZoneConstraints = {
  archetype: 'rocky',
  features: {
    atmosphere: { mode: 'forbidden' },
    liquid:     { mode: 'forbidden' },
    rings:      { mode: 'forbidden' },
  },
  ranges: ROCKY_HABITABLE.ranges,
}

const ALL_REQUIRED: ZoneConstraints = {
  archetype: 'rocky',
  features: {
    atmosphere: { mode: 'required', range: [0.10, 0.45] },
    liquid:     { mode: 'required', range: [0.05, 0.95] },
    rings:      { mode: 'required', range: [0, 1] },
  },
  ranges: ROCKY_HABITABLE.ranges,
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/** Generate `n` distinct seeds for statistical assertions. */
function seeds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `seed-${i.toString(16).padStart(4, '0')}`)
}

/** Assert a numeric value lies within a closed range. */
function expectInRange(value: number, [min, max]: NumericRange): void {
  expect(value).toBeGreaterThanOrEqual(min)
  expect(value).toBeLessThanOrEqual(max)
}

// ─────────────────────────────────────────────────────────────────────
// Determinism
// ─────────────────────────────────────────────────────────────────────

describe('generateBodyConfig — determinism', () => {
  it('produces identical configs for the same (seed, constraints)', () => {
    const a = generateBodyConfig('planet-alpha', ROCKY_HABITABLE)
    const b = generateBodyConfig('planet-alpha', ROCKY_HABITABLE)
    expect(a).toEqual(b)
  })

  it('decorrelates outputs across seeds', () => {
    const a = generateBodyConfig('planet-alpha', ROCKY_HABITABLE)
    const b = generateBodyConfig('planet-beta',  ROCKY_HABITABLE)
    expect(a).not.toEqual(b)
  })

  it('decorrelates outputs across constraints', () => {
    const a = generateBodyConfig('planet-alpha', ROCKY_HABITABLE)
    const b = generateBodyConfig('planet-alpha', GAS_GIANT)
    expect(a).not.toEqual(b)
  })

  it('uses the seed as the body name (drives downstream variation seeding)', () => {
    const cfg = generateBodyConfig('planet-alpha', ROCKY_HABITABLE)
    expect(cfg.name).toBe('planet-alpha')
  })
})

// ─────────────────────────────────────────────────────────────────────
// Range respect
// ─────────────────────────────────────────────────────────────────────

describe('generateBodyConfig — range respect', () => {
  it('keeps every numeric field within its declared range over 200 seeds', () => {
    for (const seed of seeds(200)) {
      const cfg = generateBodyConfig(seed, ROCKY_HABITABLE)
      const r   = ROCKY_HABITABLE.ranges
      expectInRange(cfg.radius,           r.radius)
      expectInRange(cfg.mass!,            r.mass)
      expectInRange(cfg.coreRadiusRatio!, r.coreRadiusRatio)
      expectInRange(cfg.rotationSpeed,    r.rotationSpeed)
      expectInRange(cfg.axialTilt,        r.axialTilt)
      expectInRange(cfg.noiseScale!,       r.noiseScale)
      expectInRange(cfg.noisePersistence!, r.noisePersistence)
      expectInRange(cfg.noiseLacunarity!,  r.noiseLacunarity)
      expectInRange(cfg.noisePower!,       r.noisePower)
      expectInRange(cfg.noiseRidge!,       r.noiseRidge)
      expectInRange(cfg.reliefFlatness!,   r.reliefFlatness)
      expectInRange(cfg.continentAmount!,  r.continentAmount)
      expectInRange(cfg.continentScale!,   r.continentScale)
    }
  })

  it('floors noiseOctaves to an integer >= 1', () => {
    for (const seed of seeds(50)) {
      const cfg = generateBodyConfig(seed, ROCKY_HABITABLE)
      expect(Number.isInteger(cfg.noiseOctaves)).toBe(true)
      expect(cfg.noiseOctaves!).toBeGreaterThanOrEqual(1)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────
// Feature gates
// ─────────────────────────────────────────────────────────────────────

describe('generateBodyConfig — feature gates', () => {
  describe('forbidden', () => {
    it('zeroes the atmosphere fields when atmosphere.mode === forbidden', () => {
      for (const seed of seeds(20)) {
        const cfg = generateBodyConfig(seed, ALL_FORBIDDEN)
        expect(cfg.atmosphereThickness).toBe(0)
        expect(cfg.atmosphereOpacity).toBe(0)
      }
    })

    it("returns liquidState 'none' and zero coverage when liquid.mode === forbidden", () => {
      for (const seed of seeds(20)) {
        const cfg = generateBodyConfig(seed, ALL_FORBIDDEN)
        expect(cfg.liquidState).toBe('none')
        expect(cfg.liquidCoverage).toBe(0)
      }
    })

    it('keeps hasRings false when rings.mode === forbidden', () => {
      for (const seed of seeds(20)) {
        const cfg = generateBodyConfig(seed, ALL_FORBIDDEN)
        expect(cfg.hasRings).toBe(false)
      }
    })
  })

  describe('required', () => {
    it('always produces a present atmosphere with values within range', () => {
      for (const seed of seeds(20)) {
        const cfg = generateBodyConfig(seed, ALL_REQUIRED)
        expect(cfg.atmosphereThickness!).toBeGreaterThan(0)
        expectInRange(cfg.atmosphereThickness!, [0.10, 0.45])
        expectInRange(cfg.atmosphereOpacity!,   [0.30, 0.60])
      }
    })

    it("always sets liquidState to 'liquid' with coverage in range", () => {
      for (const seed of seeds(20)) {
        const cfg = generateBodyConfig(seed, ALL_REQUIRED)
        expect(cfg.liquidState).toBe('liquid')
        expectInRange(cfg.liquidCoverage!, [0.05, 0.95])
      }
    })

    it('always sets hasRings to true', () => {
      for (const seed of seeds(20)) {
        const cfg = generateBodyConfig(seed, ALL_REQUIRED)
        expect(cfg.hasRings).toBe(true)
      }
    })
  })

  describe('allowed', () => {
    it('never keeps the feature when probability === 0', () => {
      const constraints: ZoneConstraints = {
        ...ROCKY_HABITABLE,
        features: {
          ...ROCKY_HABITABLE.features,
          atmosphere: { mode: 'allowed', probability: 0, range: [0.1, 0.4] },
        },
      }
      for (const seed of seeds(50)) {
        const cfg = generateBodyConfig(seed, constraints)
        expect(cfg.atmosphereThickness).toBe(0)
      }
    })

    it('always keeps the feature when probability === 1', () => {
      const constraints: ZoneConstraints = {
        ...ROCKY_HABITABLE,
        features: {
          ...ROCKY_HABITABLE.features,
          atmosphere: { mode: 'allowed', probability: 1, range: [0.1, 0.4] },
        },
      }
      for (const seed of seeds(50)) {
        const cfg = generateBodyConfig(seed, constraints)
        expect(cfg.atmosphereThickness!).toBeGreaterThan(0)
      }
    })

    it('approximates the requested probability over many seeds', () => {
      const constraints: ZoneConstraints = {
        ...ROCKY_HABITABLE,
        features: {
          ...ROCKY_HABITABLE.features,
          atmosphere: { mode: 'allowed', probability: 0.5, range: [0.1, 0.4] },
        },
      }
      const N = 1000
      let kept = 0
      for (const seed of seeds(N)) {
        const cfg = generateBodyConfig(seed, constraints)
        if (cfg.atmosphereThickness! > 0) kept++
      }
      const observed = kept / N
      // ±5 % tolerance for a 1000-sample empirical rate
      expect(observed).toBeGreaterThan(0.45)
      expect(observed).toBeLessThan(0.55)
    })

    it('clamps a negative probability to 0', () => {
      const negativeProb = { mode: 'allowed', probability: -1, range: [0.1, 0.4] } satisfies FeatureGate
      const constraints: ZoneConstraints = {
        ...ROCKY_HABITABLE,
        features: { ...ROCKY_HABITABLE.features, atmosphere: negativeProb },
      }
      for (const seed of seeds(20)) {
        const cfg = generateBodyConfig(seed, constraints)
        expect(cfg.atmosphereThickness).toBe(0)
      }
    })

    it('clamps a probability > 1 to 1', () => {
      const tooHigh = { mode: 'allowed', probability: 5, range: [0.1, 0.4] } satisfies FeatureGate
      const constraints: ZoneConstraints = {
        ...ROCKY_HABITABLE,
        features: { ...ROCKY_HABITABLE.features, atmosphere: tooHigh },
      }
      for (const seed of seeds(20)) {
        const cfg = generateBodyConfig(seed, constraints)
        expect(cfg.atmosphereThickness!).toBeGreaterThan(0)
      }
    })
  })
})

// ─────────────────────────────────────────────────────────────────────
// Stability across gate mode changes (la propriété la plus importante
// pour permettre du tuning sans casser tous les seeds)
// ─────────────────────────────────────────────────────────────────────

describe('generateBodyConfig — PRNG stability across gate mode changes', () => {
  it('keeps geometry / noise stable when atmosphere flips required ↔ forbidden', () => {
    const required: ZoneConstraints = {
      ...ROCKY_HABITABLE,
      features: {
        ...ROCKY_HABITABLE.features,
        atmosphere: { mode: 'required', range: [0.10, 0.45] },
      },
    }
    const forbidden: ZoneConstraints = {
      ...ROCKY_HABITABLE,
      features: { ...ROCKY_HABITABLE.features, atmosphere: { mode: 'forbidden' } },
    }
    const a = generateBodyConfig('seed-0', required)
    const b = generateBodyConfig('seed-0', forbidden)

    // Atmosphere fields differ as expected
    expect(a.atmosphereThickness).not.toBe(b.atmosphereThickness)
    // But every other seed-driven field MUST stay identical
    expect(a.radius).toBe(b.radius)
    expect(a.mass).toBe(b.mass)
    expect(a.coreRadiusRatio).toBe(b.coreRadiusRatio)
    expect(a.rotationSpeed).toBe(b.rotationSpeed)
    expect(a.axialTilt).toBe(b.axialTilt)
    expect(a.liquidState).toBe(b.liquidState)
    expect(a.liquidCoverage).toBe(b.liquidCoverage)
    expect(a.hasRings).toBe(b.hasRings)
    expect(a.noiseScale).toBe(b.noiseScale)
    expect(a.noiseOctaves).toBe(b.noiseOctaves)
    expect(a.noisePersistence).toBe(b.noisePersistence)
    expect(a.continentAmount).toBe(b.continentAmount)
  })

  it('keeps geometry / noise stable when rings flips allowed ↔ required', () => {
    const allowed: ZoneConstraints = {
      ...ROCKY_HABITABLE,
      features: { ...ROCKY_HABITABLE.features, rings: { mode: 'allowed', probability: 0.5, range: [0, 1] } },
    }
    const required: ZoneConstraints = {
      ...ROCKY_HABITABLE,
      features: { ...ROCKY_HABITABLE.features, rings: { mode: 'required', range: [0, 1] } },
    }
    const a = generateBodyConfig('seed-7', allowed)
    const b = generateBodyConfig('seed-7', required)
    expect(a.radius).toBe(b.radius)
    expect(a.noiseScale).toBe(b.noiseScale)
    expect(a.continentScale).toBe(b.continentScale)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Archetype mapping
// ─────────────────────────────────────────────────────────────────────

describe('generateBodyConfig — archetype mapping', () => {
  it('maps rocky → terrain', () => {
    const cfg = generateBodyConfig('seed', { ...ROCKY_HABITABLE, archetype: 'rocky' })
    expect(cfg.surfaceLook).toBe('terrain')
  })
  it('maps gaseous → bands', () => {
    const cfg = generateBodyConfig('seed', { ...GAS_GIANT, archetype: 'gaseous' })
    expect(cfg.surfaceLook).toBe('bands')
  })
  it('maps metallic → metallic', () => {
    const cfg = generateBodyConfig('seed', { ...ROCKY_HABITABLE, archetype: 'metallic' })
    expect(cfg.surfaceLook).toBe('metallic')
  })
})

// ─────────────────────────────────────────────────────────────────────
// Caller-resolved fields
// ─────────────────────────────────────────────────────────────────────

describe('generateBodyConfig — caller-resolved fields', () => {
  it('leaves caller-resolved colour and substance fields undefined', () => {
    const cfg = generateBodyConfig('seed', ROCKY_HABITABLE)
    expect(cfg.liquidColor).toBeUndefined()
    expect(cfg.terrainColorLow).toBeUndefined()
    expect(cfg.terrainColorHigh).toBeUndefined()
    expect(cfg.bandColors).toBeUndefined()
    expect(cfg.metallicBands).toBeUndefined()
  })

  it('returns type "planetary" — stars are not in v1 scope', () => {
    const cfg = generateBodyConfig('seed', ROCKY_HABITABLE)
    expect(cfg.type).toBe('planetary')
  })
})
