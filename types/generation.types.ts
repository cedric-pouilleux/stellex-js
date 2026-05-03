/**
 * Seeded body generation — types fed to {@link generateBodyConfig}.
 *
 * Doctrine alignment: this module carries **no chemistry, no biomes, no
 * temperature, no gameplay vocabulary**. It only describes the physical and
 * visual envelope a body can be drawn within. Consumers extend
 * {@link ZoneConstraints} with their own domain types (biome pools, resource
 * lists, allowed substances, terraforming overrides…) and resolve those
 * fields after calling the generator.
 *
 * Determinism contract: every numeric range is consumed by the generator in
 * a frozen order documented in `generateBodyConfig`. New fields MUST be
 * appended at the end of the order — inserting in the middle breaks every
 * existing seed.
 */

import type { LibBodyType } from '../shaders'

// ─────────────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Closed numeric range `[min, max]` consumed by the generator. The invariant
 * `min <= max` is the caller's responsibility — not enforced at the type
 * level to keep the shape compatible with literal tuples.
 */
export type NumericRange = readonly [min: number, max: number]

/**
 * Resolution rule for an optional body feature (atmosphere, liquid, rings…).
 * The seed PRNG resolves the gate before any range is drawn:
 *
 *   - `forbidden`: the feature is never present; matching ranges are skipped.
 *   - `required`:  the feature is always present; values drawn within `range`.
 *   - `allowed`:   the seed rolls a coin biased by `probability`. If kept,
 *                  values are drawn within `range`; otherwise the feature is
 *                  treated as absent (range pick skipped).
 *
 * `range` is the value range used **only** when the feature ends up present.
 * Probabilities outside `[0, 1]` are clamped by the generator.
 */
export type FeatureGate =
  | { mode: 'forbidden' }
  | { mode: 'required'; range: NumericRange }
  | { mode: 'allowed'; probability: number; range: NumericRange }

// ─────────────────────────────────────────────────────────────────────────────
// Zone constraints — physics + visual envelope only
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Archetype slice supported by {@link generateBodyConfig}. Stars are excluded
 * from v1: their generation pipeline is structurally different (spectral type
 * drives mass / radius / color) and warrants its own seeded generator.
 */
export type SeededBodyArchetype = Exclude<LibBodyType, 'star'>

/**
 * Per-feature gates collected on a {@link ZoneConstraints}. Each entry is
 * resolved before the corresponding ranges are consumed, in the order
 * declared by `FEATURE_ORDER` in the generator. Adding a new feature is a
 * breaking change for existing seeds and MUST bump the `genVersion` carried
 * by callers.
 */
export interface ZoneFeatureGates {
  /** Halo + atmospheric layer. Drives `atmosphereThickness` / `atmosphereOpacity`. */
  atmosphere: FeatureGate
  /** Surface liquid (oceans / lakes). Drives `liquidState` and `liquidCoverage`. */
  liquid:     FeatureGate
  /** Planetary ring system. Drives `hasRings`. */
  rings:      FeatureGate
}

/**
 * Numeric ranges consumed by the generator, one entry per knob it can roll.
 * The order in which these are picked is frozen in the generator
 * (`RANGE_ORDER`). Inserting a key in this interface does not affect the
 * generator — only the explicit consumption order does.
 */
export interface ZoneRanges {
  // ── Geometry ──────────────────────────────────────────────────────
  radius:               NumericRange
  mass:                 NumericRange
  coreRadiusRatio:      NumericRange
  rotationSpeed:        NumericRange
  axialTilt:            NumericRange
  // ── Atmosphere (used only when `features.atmosphere` resolves present) ──
  atmosphereThickness:  NumericRange
  atmosphereOpacity:    NumericRange
  // ── Liquid (used only when `features.liquid` resolves present) ──
  liquidCoverage:       NumericRange
  // ── Noise (fBm + reshaping) ──────────────────────────────────────
  noiseScale:           NumericRange
  /** Drawn as an integer — generator floors the picked value. */
  noiseOctaves:         NumericRange
  noisePersistence:     NumericRange
  noiseLacunarity:      NumericRange
  noisePower:           NumericRange
  noiseRidge:           NumericRange
  reliefFlatness:       NumericRange
  continentAmount:      NumericRange
  continentScale:       NumericRange
}

/**
 * Generation envelope for a body. Designed to be a constant of the consumer's
 * build (one per gameplay zone), referenced by id from a body descriptor.
 *
 * The lib reads only what is in this shape — biome pools, resource lists,
 * substance vocabulary, terraforming rules and any other gameplay state are
 * carried by the consumer alongside (typically via interface extension).
 */
export interface ZoneConstraints {
  /** Body archetype imposed by the zone. */
  archetype: SeededBodyArchetype
  /** Optional features and their resolution rules. */
  features:  ZoneFeatureGates
  /** Numeric envelope for every knob the seed can roll. */
  ranges:    ZoneRanges
}
