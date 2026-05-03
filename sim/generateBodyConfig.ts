/**
 * Seeded body generation — turns a seed + {@link ZoneConstraints} into a
 * deterministic {@link PlanetConfig}.
 *
 * Pure-logic module: no `three` import, no Vue, no DOM. Safe to call from
 * server code, headless workers and the lib's render layer alike.
 *
 * # Determinism contract
 *
 * Every PRNG consumption inside {@link generateBodyConfig} happens in a
 * **frozen sequence** (see `// FROZEN ORDER` block in the implementation).
 * The contract any future contributor must respect:
 *
 *   1. **Append, never insert.** New ranges or feature gates always go at
 *      the end of the sequence. Inserting in the middle changes every
 *      downstream value for every existing seed.
 *   2. **Always consume.** Both range picks and feature-gate rolls draw
 *      from the PRNG even when their result will be discarded (e.g. an
 *      atmosphere range when `features.atmosphere.mode === 'forbidden'`).
 *      This keeps the sequence stable when designers flip a gate's mode
 *      without invalidating the rest of the body.
 *   3. **Namespace by purpose.** This generator seeds its PRNG with
 *      `seed + ':config'`. The shader-side `generateBodyVariation` uses
 *      `seed + ':var'` (`'var:' + config.name` historically). The two
 *      streams are independent — refactoring one cannot shift the other.
 *
 * Breaking any of those rules forces a `genVersion` bump on the consumer
 * side and re-rolls every persisted body.
 */

import { seededPrng } from '../internal/prng'
import type { PlanetConfig } from '../types/body/config.types'
import type { SurfaceLook }  from '../types/surface.types'
import type {
  FeatureGate,
  NumericRange,
  SeededBodyArchetype,
  ZoneConstraints,
} from '../types/generation.types'

/**
 * Map an archetype to the `SurfaceLook` the lib consumes. Stars are excluded
 * from this generator (their pipeline is structurally different and lives in
 * a future seeded star generator).
 */
function surfaceLookFor(archetype: SeededBodyArchetype): SurfaceLook {
  switch (archetype) {
    case 'rocky':    return 'terrain'
    case 'gaseous':  return 'bands'
    case 'metallic': return 'metallic'
  }
}

/** Linearly interpolate within `[min, max]` using one PRNG draw. */
function pick(rng: () => number, [min, max]: NumericRange): number {
  return min + rng() * (max - min)
}

/** Clamp a probability to `[0, 1]`. Defends against caller-side typos. */
function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/**
 * Resolve a {@link FeatureGate} to a presence boolean. Always consumes
 * exactly one PRNG draw — including for `forbidden` and `required` modes
 * whose result is fixed — so the consumption sequence stays stable when a
 * designer flips a gate's mode (see determinism contract).
 */
function resolveGate(rng: () => number, gate: FeatureGate): boolean {
  const roll = rng()
  switch (gate.mode) {
    case 'forbidden': return false
    case 'required':  return true
    case 'allowed':   return roll < clamp01(gate.probability)
  }
}

/**
 * Generate a deterministic {@link PlanetConfig} from a seed and zone
 * constraints. The same `(seed, constraints)` pair always yields the same
 * config, byte-stable across runtimes (the underlying PRNG is integer-only
 * SplitMix32 with FNV-1a-hashed string seed — no floating-point divergence).
 *
 * Caller-resolved fields are intentionally left undefined on the returned
 * config:
 *
 *   - `liquidColor`, `bandColors`, `metallicBands`, `terrainColorLow/High`
 *     — derived from chemistry / temperature, owned by caller code.
 *   - `liquidState` is set to `'liquid'` or `'none'` only. Promoting to
 *     `'frozen'` requires temperature knowledge the lib does not carry;
 *     the caller downgrades after this call when its thermal model says so.
 *   - `gasMassFraction`, `spectralType` — outside v1 scope.
 *
 * @param seed - Stable string driving every random draw.
 * @param constraints - Generation envelope for the body's zone.
 * @returns A {@link PlanetConfig} with seed-driven physical and visual
 *          envelope filled, caller-resolved fields left undefined.
 */
export function generateBodyConfig(
  seed: string,
  constraints: ZoneConstraints,
): PlanetConfig {
  const rng = seededPrng(seed + ':config')
  const r   = constraints.ranges
  const f   = constraints.features

  // ────────────────────────────────────────────────────────────────────
  // FROZEN ORDER — every PRNG consumption below MUST stay in this exact
  // sequence. New ranges/gates always APPEND. Inserting in the middle
  // breaks every existing seed. See determinism contract at the top.
  // ────────────────────────────────────────────────────────────────────

  // 1. Geometry
  const radius          = pick(rng, r.radius)
  const mass            = pick(rng, r.mass)
  const coreRadiusRatio = pick(rng, r.coreRadiusRatio)
  const rotationSpeed   = pick(rng, r.rotationSpeed)
  const axialTilt       = pick(rng, r.axialTilt)

  // 2. Atmosphere — gate first, ranges always drawn (kept or discarded)
  const atmospherePresent       = resolveGate(rng, f.atmosphere)
  const atmosphereThicknessDraw = pick(rng, r.atmosphereThickness)
  const atmosphereOpacityDraw   = pick(rng, r.atmosphereOpacity)

  // 3. Liquid — gate first, range always drawn
  const liquidPresent       = resolveGate(rng, f.liquid)
  const liquidCoverageDraw  = pick(rng, r.liquidCoverage)

  // 4. Rings — gate only (ring shape variation lives on `BodyVariation`)
  const hasRings = resolveGate(rng, f.rings)

  // 5. Noise (fBm + reshaping)
  const noiseScale       = pick(rng, r.noiseScale)
  const noiseOctaves     = Math.max(1, Math.floor(pick(rng, r.noiseOctaves)))
  const noisePersistence = pick(rng, r.noisePersistence)
  const noiseLacunarity  = pick(rng, r.noiseLacunarity)
  const noisePower       = pick(rng, r.noisePower)
  const noiseRidge       = pick(rng, r.noiseRidge)
  const reliefFlatness   = pick(rng, r.reliefFlatness)
  const continentAmount  = pick(rng, r.continentAmount)
  const continentScale   = pick(rng, r.continentScale)

  // ── Compose final config ────────────────────────────────────────────
  return {
    type:        'planetary',
    name:        seed,
    surfaceLook: surfaceLookFor(constraints.archetype),

    radius,
    mass,
    coreRadiusRatio,
    rotationSpeed,
    axialTilt,

    atmosphereThickness: atmospherePresent ? atmosphereThicknessDraw : 0,
    atmosphereOpacity:   atmospherePresent ? atmosphereOpacityDraw   : 0,

    liquidState:         liquidPresent ? 'liquid' : 'none',
    liquidCoverage:      liquidPresent ? liquidCoverageDraw : 0,

    hasRings,

    noiseScale,
    noiseOctaves,
    noisePersistence,
    noiseLacunarity,
    noisePower,
    noiseRidge,
    reliefFlatness,
    continentAmount,
    continentScale,
  }
}
