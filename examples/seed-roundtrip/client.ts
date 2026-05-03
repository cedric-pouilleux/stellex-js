/**
 * CLIENT — reçoit un BodyDescriptor JSON, le reconstruit, et prouve que
 * la reconstruction est byte-stable (déterminisme absolu depuis la seed).
 *
 * Usage : npx tsx examples/seed-roundtrip/client.ts < body.json
 *      ou : npx tsx examples/seed-roundtrip/server.ts | npx tsx examples/seed-roundtrip/client.ts
 *
 * Étapes :
 *   1. Lit le descriptor depuis stdin.
 *   2. L'hydrate — `generateBodyConfig` (lib) + résolution caller-side.
 *   3. Re-hydrate UNE SECONDE FOIS, et vérifie que le résultat est strictement
 *      identique au premier (preuve du déterminisme).
 *   4. Affiche le body reconstruit.
 */

import { hydrateBodyConfig } from './hydrate'
import type { BodyDescriptor } from './zones'

// ── Lecture du descriptor depuis stdin ───────────────────────────────
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

const raw        = await readStdin()
const descriptor = JSON.parse(raw) as BodyDescriptor

// ── Round-trip determinism check ─────────────────────────────────────
// On hydrate trois fois et on compare. Si une dérive existait (ordre PRNG
// instable, randomness non-seedée, etc.), elle apparaîtrait ici.
const a = hydrateBodyConfig(descriptor)
const b = hydrateBodyConfig(descriptor)
const c = hydrateBodyConfig(descriptor)

const sa = JSON.stringify(a)
const sb = JSON.stringify(b)
const sc = JSON.stringify(c)

const stable = sa === sb && sb === sc
if (!stable) {
  console.error('❌ DETERMINISM BROKEN — three hydrations of the same descriptor diverged.')
  process.exit(1)
}

// ── Affichage ────────────────────────────────────────────────────────
const cfg = a.config

console.log('═══════════════════════════════════════════════════════════')
console.log('  Reconstruction byte-stable depuis le descriptor')
console.log('═══════════════════════════════════════════════════════════')
console.log()
console.log('Descriptor reçu :')
console.log('  seed       :', descriptor.seed)
console.log('  zoneId     :', descriptor.zoneId)
console.log('  genVersion :', descriptor.genVersion)
console.log('  overrides  :', JSON.stringify(descriptor.overrides))
console.log('  → ' + Buffer.byteLength(raw, 'utf8') + ' octets sur le fil')
console.log()
console.log('Body reconstruit :')
console.log('  name           :', cfg.name)
console.log('  archetype      :', cfg.surfaceLook)
console.log('  radius         :', cfg.radius?.toFixed(3))
console.log('  mass           :', cfg.mass?.toFixed(3))
console.log('  rotationSpeed  :', cfg.rotationSpeed?.toFixed(4))
console.log('  axialTilt      :', cfg.axialTilt?.toFixed(3))
console.log('  atmoThickness  :', cfg.atmosphereThickness?.toFixed(3))
console.log('  liquidState    :', cfg.liquidState)
console.log('  liquidCoverage :', cfg.liquidCoverage?.toFixed(3))
console.log('  liquidColor    :', cfg.liquidColor)
console.log('  hasRings       :', cfg.hasRings)
console.log('  noiseScale     :', cfg.noiseScale?.toFixed(3))
console.log('  noiseOctaves   :', cfg.noiseOctaves)
console.log('  terrainLow     :', cfg.terrainColorLow)
console.log('  terrainHigh    :', cfg.terrainColorHigh)
console.log()
console.log('Métadonnées caller-resolved :')
console.log('  displayName     :', a.meta.displayName)
console.log('  temperatureMean :', a.meta.temperatureMean, '°C')
console.log('  liquidSubstance :', a.meta.liquidSubstance ?? '(aucune)')
console.log('  biomes          :', a.meta.biomes.join(', ') || '(aucun)')
console.log('  resources       :', a.meta.resources.join(', ') || '(aucune)')
console.log()
console.log('✓ Trois hydratations indépendantes produisent un résultat identique.')
console.log('  Hash JSON : ' + sa.length + ' chars, byte-stable.')
