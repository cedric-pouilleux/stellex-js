import * as THREE from 'three'

// ── Types ────────────────────────────────────────────────────────────

/** Minimal body shape required by raycast helpers. */
export interface RaycastBody {
  group:  THREE.Group
  config: { radius: number }
}

/** Optional tuning for {@link raycastBodies}. */
export interface RaycastBodiesOptions {
  /** Index of the focused body — skipped as a candidate and used as occluder. */
  focusedIndex?: number | null
}

/**
 * Result returned by {@link raycastBodies} — the index of the first body
 * hit and the raw THREE intersection for callers that need the exact point
 * or object.
 */
export interface RaycastHit {
  bodyIndex:    number
  intersection: THREE.Intersection
}

// ── Reusable temporaries ─────────────────────────────────────────────

const _bodyCenter     = new THREE.Vector3()
const _occluderCenter = new THREE.Vector3()
const _occluderSphere = new THREE.Sphere()
const _occluderNear   = new THREE.Vector3()

// ── Public API ───────────────────────────────────────────────────────

/**
 * Makes every object under `root` transparent to scene raycasting by
 * replacing its `raycast` method with a no-op. Used for display-only bodies
 * whose picking is delegated to a caller-owned hitbox — the body's own meshes
 * (atmo shell, smooth sphere) must not intercept the ray and swallow the
 * click. One-way by design: a display body never needs to become raycastable
 * again, and restoring the per-class prototype methods would be brittle.
 *
 * Interactive hover queries are unaffected: they run through a dedicated
 * proxy mesh kept outside the scene graph, not through `intersectObjects`.
 */
export function disableGroupRaycast(root: THREE.Object3D): void {
  root.traverse(obj => { obj.raycast = () => {} })
}

/**
 * Walks up the scene graph to find which body index owns a given object.
 * Returns -1 when no match is found.
 */
export function findBodyIndex(obj: THREE.Object3D, bodies: RaycastBody[]): number {
  let o: THREE.Object3D | null = obj
  while (o) {
    const i = bodies.findIndex(b => b.group === o)
    if (i !== -1) return i
    o = o.parent
  }
  return -1
}

/**
 * Raycasts against all body groups and returns the first valid hit.
 *
 * Filtering rules:
 * - Hits beyond the body's radius are discarded (avoids mesh-edge false hits).
 * - When a focused body is provided, it is skipped as a candidate and used as
 *   an occluder sphere — hits behind it are discarded.
 */
export function raycastBodies(
  raycaster: THREE.Raycaster,
  bodies:    RaycastBody[],
  options?:  RaycastBodiesOptions,
): RaycastHit | null {
  const focusedIndex = options?.focusedIndex ?? null

  bodies.forEach(b => b.group.updateMatrixWorld(true))
  const hits = raycaster.intersectObjects(bodies.map(b => b.group), true)

  // Build occluder sphere from the focused body (if any) and compute the
  // distance to its near-side surface along the ray. A satellite hit whose
  // distance is greater than this is behind the focused body and is discarded.
  let focusedNearDist = Infinity
  if (focusedIndex !== null && bodies[focusedIndex]) {
    bodies[focusedIndex].group.getWorldPosition(_occluderCenter)
    _occluderSphere.set(_occluderCenter, bodies[focusedIndex].config.radius)
    if (raycaster.ray.intersectSphere(_occluderSphere, _occluderNear)) {
      focusedNearDist = raycaster.ray.origin.distanceTo(_occluderNear)
    }
  }

  for (const hit of hits) {
    const i = findBodyIndex(hit.object, bodies)
    if (i === -1 || i === focusedIndex) continue

    bodies[i].group.getWorldPosition(_bodyCenter)
    if (hit.point.distanceTo(_bodyCenter) > bodies[i].config.radius) continue

    if (hit.distance > focusedNearDist) continue

    return { bodyIndex: i, intersection: hit }
  }

  return null
}
