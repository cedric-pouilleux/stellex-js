import * as THREE from 'three'
import type { BodySimulation } from '../../sim/BodySimulation'
import type { StarConfig } from '../../types/body.types'
import type { TerrainLevel } from '../types/terrain.types'
import type { StarBody, BoardTileRef } from '../types/bodyHandle.types'
import type { BodyVariation } from './bodyVariation'
import type { HoverChannel } from '../state/hoverState'
import type { GraphicsUniforms } from '../hex/hexGraphicsUniforms'
import type { RenderQuality } from '../quality/renderQuality'
import type { BodyTypeStrategy } from './bodyTypeStrategy'
import { buildPlanetMesh, buildStarSmoothMesh } from './buildPlanetMesh'
import { buildInteractiveMesh } from './buildInteractiveMesh'
import { buildBodyHoverOverlay } from '../shells/buildBodyHoverOverlay'
import { makeInteractiveController } from './interactiveController'
import { disableGroupRaycast } from './bodyRaycast'
import { accelerateRaycast } from '../lighting/accelerateRaycast'
import { mountHoverCursor } from '../hover/mountHoverCursor'
import type { HoverCursorConfig, HoverCursorPresets } from '../types/hoverCursor.types'
import type { WarmupOptions } from '../types/bodyHandle.types'
import { warmupBody, type WarmupPhaseSpec } from './warmupBody'

/**
 * Pre-computed inputs the star factory needs from the dispatcher. Receiving
 * them as parameters (rather than recomputing) keeps `useStar` decoupled
 * from `useBody` and avoids a circular import edge.
 */
export interface UseStarInputs {
  /** Original body config — needed for radius, coreRadiusRatio fallback. */
  config:    StarConfig
  /** Initialised body simulation (tile states + sea level). */
  sim:       BodySimulation
  /** Resolved terrain palette for this star. */
  palette:   TerrainLevel[]
  /** Deterministic visual variation for this star. */
  variation: BodyVariation
  /** Tile count from the generated hexasphere — surfaced on the return value. */
  tileCount: number
  /** Per-body hover/pin channel — surfaced on the handle so projectors can subscribe. */
  hoverChannel:     HoverChannel
  /** Per-body graphics uniform bag — wired into the hex terrain shader. */
  graphicsUniforms: GraphicsUniforms
  /** Optional render-quality bag — propagated to the smooth-sphere builder. */
  quality?:         RenderQuality
  /**
   * Pre-resolved body-type strategy. Forwarded to the interactive mesh so
   * the lookup is shared with the dispatcher (`useBody` resolves it once,
   * passes it through).
   */
  strategy:         BodyTypeStrategy
  /** Optional hover cursor parameters — ring / emissive (no column on stars). */
  hoverCursor?:     HoverCursorConfig
  /** Optional named cursor presets, swappable via `body.hover.useCursor(name)`. */
  hoverCursors?:    HoverCursorPresets
  /** Initial preset name when `hoverCursors` is supplied. */
  defaultCursor?:   string
  /**
   * When `false`, the star's renderable meshes are made transparent to scene
   * raycasting (display-only). See {@link import('./useBody').UseBodyOptions.raycastable}.
   * Defaults to `true`.
   */
  raycastable?:     boolean
}

/**
 * Builds the star-specific scene graph: a smooth sphere display mesh with
 * the animated star shader, a flat raycast proxy for hover queries and a
 * full hex interactive mesh swapped in on `activateInteractive()`.
 *
 * Stars carry no liquid shell, no atmosphere and no layered sol —
 * features absent from {@link StarBody}. Callers narrow the {@link Body}
 * union via `body.kind === 'star'` before reaching for planet-only
 * namespaces.
 *
 * @param inputs - Dispatcher-supplied state (config, sim, palette, …).
 * @returns      Star-specific body handle.
 */
export function useStar(inputs: UseStarInputs): StarBody {
  const {
    config, sim, palette, variation, tileCount,
    hoverChannel, graphicsUniforms, quality, strategy,
    hoverCursor, hoverCursors, defaultCursor, raycastable,
  } = inputs
  const group = new THREE.Group()

  const { mesh: displayMesh, tick, planetMaterial: starMat } = buildStarSmoothMesh(sim, palette, variation, { quality })
  const { mesh: raycastProxy, faceToTileId }                  = buildPlanetMesh(sim, palette)
  const interactive                                            = buildInteractiveMesh(sim, palette, { hoverChannel, graphicsUniforms, strategy })
  // Accelerate the raycast proxy with a single-layer BVH (stars have no
  // atmo band). `firstHitOnly` in the controller then resolves hovers in
  // sub-millisecond time instead of walking every triangle.
  const releaseRaycastBVH                                      = accelerateRaycast(raycastProxy)
  const raycastState                                           = {
    mesh:         raycastProxy,
    faceToTileId,
    coreRadius:   config.radius * (config.coreRadiusRatio ?? 0),
  }
  const ctrl                                                   = makeInteractiveController(group, displayMesh, () => raycastState, interactive)
  const bodyHover                                              = buildBodyHoverOverlay(group, config.radius)

  // Stars carry a single sol-like board. Cursor uses the palette height
  // for the cap radius so prism-relative positioning stays correct on
  // ridge tiles.
  const tileById = new Map(sim.tiles.map(t => [t.id, t] as const))
  const { cursor, useCursor } = mountHoverCursor(
    { hoverCursor, hoverCursors, defaultCursor },
    {
      group,
      bodyRadius:   config.radius,
      hoverChannel,
      sol: {
        getTile:        id => tileById.get(id) ?? null,
        getCapRadius:   id => {
          const info = interactive.tileGeometry(id)
          return config.radius + (info?.level.height ?? 0)
        },
        getFloorRadius: () => config.radius * (config.coreRadiusRatio ?? 0),
      },
      liquid: null,
      atmo:   null,
    },
  )

  let starElapsed = 0
  function tickStar(dt: number): void {
    starElapsed += dt
    tick(dt)
    interactive.tick(starElapsed)
  }

  function dispose(): void {
    cursor.dispose()
    releaseRaycastBVH()
    bodyHover.dispose()
    displayMesh.geometry.dispose()
    ;(displayMesh.material as THREE.Material).dispose()
    starMat.dispose()
    raycastProxy.geometry.dispose()
    ;(raycastProxy.material as THREE.Material).dispose()
    interactive.dispose()
  }

  // ── Warmup ───────────────────────────────────────────────────────
  // Stars carry a single sol-like board — no atmosphere, no liquid.
  // Surface phase compiles the smooth display + body-hover ring +
  // the interactive sol mesh (detached from the group until the
  // caller activates interactive mode).
  function warmup(
    renderer:        THREE.WebGLRenderer,
    camera:          THREE.Camera,
    progressOptions?: WarmupOptions,
  ): Promise<void> {
    const phases: WarmupPhaseSpec[] = [
      {
        phase:   'surface',
        label:   'Compiling surface shaders…',
        targets: [displayMesh, bodyHover.mesh, interactive.group],
      },
    ]
    const cursorTargets = cursor.objects()
    if (cursorTargets.length > 0) {
      phases.push({
        phase:   'cursor',
        label:   'Compiling cursor shaders…',
        targets: [...cursorTargets],
      })
    }
    return warmupBody(renderer, camera, phases, progressOptions)
  }

  // Display-only stars (e.g. a system's central sun used purely as a light
  // source) opt out of scene raycasting so a caller hitbox can win.
  if (raycastable === false) disableGroupRaycast(group)

  return {
    kind: 'star',
    group, config, sim, palette, variation, tileCount,
    hoverChannel, graphicsUniforms,
    // Stars don't cast shadows on themselves and don't receive occlusion
    // from the cloud shell (they have none), so both uniform handles are
    // dormant stubs — present only to satisfy the shared `BodyBase` shape.
    shadowUniforms:   { pos: { value: new THREE.Vector3() }, radius: { value: 0 } },
    occluderUniforms: { pos: { value: new THREE.Vector3() }, radius: { value: 0 } },
    planetMaterial:   starMat,

    tick:    tickStar,
    dispose,
    warmup,

    getCoreRadius:    () => config.radius * (config.coreRadiusRatio ?? 0),
    getSurfaceRadius: () => config.radius,

    interactive: {
      activate:   ctrl.activateInteractive,
      deactivate: ctrl.deactivateInteractive,
      // Stars only carry a single board (sol-like). Wrap the legacy id
      // result into the discriminated `BoardTileRef` so callers can use a
      // single hover-handling code path across stars and planets.
      queryHover(raycaster): BoardTileRef | null {
        const id = ctrl.queryHover(raycaster)
        return id === null ? null : { layer: 'sol', tileId: id }
      },
    },
    hover: {
      setTile: (id, opts) => {
        cursor.setBoardTile(id === null ? null : { layer: 'sol', tileId: id }, opts)
      },
      setBoardTile(ref, options) {
        // Stars carry a single sol-like board — non-sol refs collapse to
        // a clear (no liquid, no atmo on stars).
        cursor.setBoardTile(ref && ref.layer === 'sol' ? ref : null, options)
      },
      setBodyHover:  bodyHover.setVisible,
      onChange:      cursor.onHoverChange,
      updateCursor:  cursor.updateConfig,
      useCursor,
    },
    tiles: {
      surfaceOffset:  interactive.surfaceOffset,
      tiles:          sim.tiles,
      tileGeometry:   interactive.tileGeometry,
      writeTileColor: interactive.writeTileColor,
      tileBaseVisual: interactive.tileBaseVisual,
    },
  }
}
