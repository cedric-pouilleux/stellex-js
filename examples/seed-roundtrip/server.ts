/**
 * SERVER — émet un BodyDescriptor pour un body donné.
 *
 * Usage : npx tsx examples/seed-roundtrip/server.ts [systemId] [orbitIndex] [zoneId]
 *
 * Output : un JSON de BodyDescriptor sur stdout. C'est exactement ce que
 * ton API serveur renverrait au client (~80 octets une fois minifié).
 *
 * Le serveur ne calcule PAS la config résolue — il se contente de stocker
 * et d'émettre le descriptor. La config est reconstruite côté client par
 * `hydrateBodyConfig` (voir `client.ts`). Avantage : payload réseau
 * minimal, et le client peut cacher l'hydratation par seed.
 */

import type { BodyDescriptor, GameZoneId } from './zones'

// ── Args (avec valeurs par défaut pour un demo rapide) ───────────────
const systemId   = process.argv[2] ?? 'sys-7f3a2b8e'
const orbitIndex = Number.parseInt(process.argv[3] ?? '3', 10)
const zoneId     = (process.argv[4] ?? 'habitable') as GameZoneId

// ── Création du descriptor ───────────────────────────────────────────
// La seed est dérivée déterministiquement de (systemId, orbitIndex). Aucun
// `userId` n'apparaît : la propriété d'un système est une jointure DB
// séparée, pas un facteur d'identité du body.
const descriptor: BodyDescriptor = {
  seed:       `${systemId}:orbit-${orbitIndex}`,
  zoneId,
  genVersion: 1,
  overrides:  {},   // body neuf, aucune mutation gameplay encore
}

// ── Sortie : JSON sur stdout ─────────────────────────────────────────
// Format identique à une réponse d'API. Pipe vers `client.ts` pour le
// roundtrip, ou redirige vers un fichier pour persister.
process.stdout.write(JSON.stringify(descriptor, null, 2) + '\n')
