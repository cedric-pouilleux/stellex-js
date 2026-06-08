import * as THREE from 'three'
import { generateHexasphere } from '../../geometry/hexasphere'
import { initBodySimulation } from '../../sim/BodySimulation'
import type { BodyConfig } from '../../types/body.types'
import type { TerrainLevel } from '../types/terrain.types'
import type { Body, PlanetBody, BoardTileRef, InteractiveView } from '../types/bodyHandle.types'
import { generateBodyVariation } from './bodyVariation'
import { disableGroupRaycast } from './bodyRaycast'
import { useStar } from './useStar'
import { strategyFor } from './bodyTypeStrategy'
import { createHoverChannel, type HoverChannel } from '../state/hoverState'
import { createGraphicsUniforms, type GraphicsUniforms } from '../hex/hexGraphicsUniforms'
import type { RenderQuality } from '../quality/renderQuality'
import { tileSizeToSubdivisions, choosePalette } from './bodyHelpers'
import { assemblePlanetSceneGraph } from './assemblePlanetSceneGraph'
import { createPlanetViewSwitcher } from './createPlanetViewSwitcher'
import { hasAtmosphere, resolveAtmosphereThickness } from '../../physics/body'
import { mountHoverCursor } from '../hover/mountHoverCursor'
import { resolveLightWorldPos } from '../lighting/findDominantLight'
import type { HoverCursorConfig, HoverCursorPresets } from '../types/hoverCursor.types'
import type { WarmupOptions } from '../types/bodyHandle.types'
import { warmupBody, type WarmupPhaseSpec } from './warmupBody'

// Re-exports for the public API surface — keep historical import paths
// (`@cedric-pouilleux/stellexjs/core` → `useBody`, `resolveTileHeight`, …)
// stable while the implementations live in `bodyHelpers.ts`.
export {
  tileSizeToSubdivisions,
  choosePalette,
  resolveTileHeight,
  resolveTileLevel,
} from './bodyHelpers'

// ── Public API ────────────────────────────────────────────────────

const _planetWP = new THREE.Vector3()
const _sunWP    = new THREE.Vector3()
const _dir      = new THREE.Vector3()

/**
 * Optional hooks accepted by {@link useBody} — light source, palette
 * override, hover-cursor presets, render-quality knobs.
 *
 * Every field is optional: leaving the object empty (or omitted) yields a
 * lib-default body. Fields are documented inline so IntelliSense surfaces
 * the rationale at the call site.
 */
export interface UseBodyOptions {
  /**
   * Light source illuminating the body. On every `tick()`, the lib reads
   * `sunLight.getWorldPosition()`, computes a normalized planet→sun
   * direction and pushes it into the body shader (and atmo shell). Pass
   * a single `PointLight` shared across all bodies of the same star
   * system — the same instance that lives in the scene as the visible
   * light source. Bodies without rings or atmosphere simply ignore it
   * if absent (the shader keeps its last known direction, defaulting to
   * the +X axis at construction time).
   */
  sunLight?:         THREE.PointLight | THREE.DirectionalLight | null
  palette?:          TerrainLevel[]
  hoverChannel?:     HoverChannel
  graphicsUniforms?: GraphicsUniforms
  quality?:          RenderQuality
  variation?:        import('./bodyVariation').BodyVariation
  /** Hover cursor parameters — single style. */
  hoverCursor?:      HoverCursorConfig
  /** Hover cursor presets — multiple named styles, swapped at runtime. */
  hoverCursors?:     HoverCursorPresets
  /** Initial preset name when `hoverCursors` is supplied. */
  defaultCursor?:    string
  /**
   * View applied right after construction. Omitted → the body keeps its
   * assembled default (smooth display sphere visible, atmo halo shell not
   * yet mounted). Pass `'shader'` for a ready-to-display overview without
   * having to call `view.set()` by hand. Ignored by stars (no view switch).
   */
  initialView?:      InteractiveView
  /**
   * When `false`, every renderable mesh of the body is made transparent to
   * scene raycasting (display-only), so a caller can place its own hitbox
   * and pick it without the atmo shell or smooth sphere intercepting the
   * ray. Interactive hover queries (hex picking) are unaffected — they run
   * through a dedicated proxy. Defaults to `true`.
   */
  raycastable?:      boolean
}

/**
 * Factory that builds a complete celestial body — hex mesh, interactive
 * raycast proxy, smooth display mesh, atmosphere glow, rings and effect
 * layers — deterministically from a {@link BodyConfig}.
 *
 * Dispatches to the star sub-builder (which keeps its own smooth + hex
 * meshes) or to the dual-board planet path (rocky / metallic / gaseous all
 * share the same sol mesh + atmo board pair).
 *
 * @param config    - Physics + visual configuration of the body.
 * @param tileSize  - Target world-space tile edge length (drives subdivisions
 *                    on both sol and atmo hexaspheres).
 * @param options   - Optional hooks — see {@link UseBodyOptions}.
 */
export function useBody(
  config: BodyConfig,
  tileSize: number,
  options?: UseBodyOptions,
): Body {
  const hoverChannel     = options?.hoverChannel     ?? createHoverChannel()
  const graphicsUniforms = options?.graphicsUniforms ?? createGraphicsUniforms()
  const sunLight         = options?.sunLight         ?? null
  const quality          = options?.quality
  const strategy         = strategyFor(config)
  // Tile-reference radius is per-type — stars look up their spectral
  // class so tile counts stay stable across the (much larger) display
  // sphere; planets use their **sol outer radius** (the radius the sol
  // mesh actually projects its prisms onto), NOT the silhouette radius.
  // Doing otherwise would shrink the apparent tile size on bodies with a
  // thick atmosphere — sol tiles projected at `solOuterRadius` would read
  // as miniatures while the atmo board tiles, projected at the silhouette,
  // keep the nominal footprint. The tile size stays uniform across both
  // boards by construction.
  const atmoFraction   = resolveAtmosphereThickness(config)
  const solRefRadius   = config.type === 'star'
    ? strategy.tileRefRadius(config)
    : config.radius * (1 - atmoFraction)
  const subdivisions   = tileSizeToSubdivisions(solRefRadius, tileSize)
  const data           = generateHexasphere(config.radius, subdivisions)
  // Atmosphere board hexasphere — own subdivision derived from the
  // silhouette radius (= `config.radius`). Tile size stays the project-wide
  // `tileSize` so atmo hexes share the same apparent footprint as sol
  // hexes; their *count* differs because the radius they span differs.
  // Skipped on bodies without an atmosphere (`atmosphereThickness === 0`)
  // and on stars (handled by the dedicated star path below).
  const atmoTiles    = hasAtmosphere(config)
    ? generateHexasphere(config.radius, tileSizeToSubdivisions(config.radius, tileSize)).tiles
    : []
  const variation    = options?.variation ?? generateBodyVariation(config)
  const sim          = initBodySimulation(data.tiles, config, atmoTiles)
  const palette      = choosePalette(config, options?.palette)

  // Star path is fully delegated to `useStar` — its returned shape mirrors
  // the planet path so callers keep a single code surface.
  if (config.type === 'star') {
    return useStar({
      config, sim, palette, variation,
      tileCount: data.tiles.length,
      hoverChannel, graphicsUniforms, quality, strategy,
      hoverCursor:   options?.hoverCursor,
      hoverCursors:  options?.hoverCursors,
      defaultCursor: options?.defaultCursor,
      raycastable:   options?.raycastable,
    })
  }

  // Rocky / Metallic / Gaseous — assembly + view switcher.
  const graph = assemblePlanetSceneGraph({
    config, sim, palette, variation,
    hoverChannel, graphicsUniforms, quality,
  })
  const viewSwitcher = createPlanetViewSwitcher(graph)

  const {
    group, smoothSphere, displayMesh, planetMaterial,
    interactive, ctrl, bodyHover,
    coreMesh, atmoShell,
    atmoBoard,
    shadowUniforms, occluderUniforms,
  } = graph

  // Track the active view so the public `queryHover` knows which board to
  // route the ray at. The view switcher mutates the visibility flags but
  // does not own the view enum — we intercept `set()` to keep this state.
  let activeView: import('../types/bodyHandle.types').InteractiveView = 'surface'
  const switcherSet = viewSwitcher.set
  function setView(view: import('../types/bodyHandle.types').InteractiveView): void {
    activeView = view
    switcherSet(view)
  }

  // ── Hover cursor (preset orchestrator over the unified primitive) ──
  // Built after the interactive mesh + atmo board so the cursor's ports
  // can resolve cap radii from their geometry. The body group is the
  // mount target; primitives follow the planet's rotation / axial tilt.
  const atmoOuterRadius = config.radius
  const atmoInnerRadius = config.radius * (1 - atmoFraction)
  const { cursor, useCursor } = mountHoverCursor(
    {
      hoverCursor:   options?.hoverCursor,
      hoverCursors:  options?.hoverCursors,
      defaultCursor: options?.defaultCursor,
    },
    {
      group,
      bodyRadius:   config.radius,
      hoverChannel,
      sol: {
        getTile: id => {
          const info = interactive.tileGeometry(id)
          return info?.tile ?? null
        },
        getCapRadius: id => {
          const pos = interactive.getTilePosition(id)
          return pos ? pos.length() : config.radius
        },
        getFloorRadius: () => coreMesh.radius,
      },
      liquid: sim.hasLiquidSurface ? {
        getTile: id => {
          const info = interactive.tileGeometry(id)
          return info?.tile ?? null
        },
        getCapRadius: () => interactive.getSeaLevelRadius(),
        getFloorRadius: id => {
          const pos = interactive.getTilePosition(id)
          return pos ? pos.length() : coreMesh.radius
        },
        isCoreWindow: id => sim.tileStates.get(id)?.elevation === 0,
      } : null,
      atmo: atmoBoard ? {
        getTile: id => atmoBoard.tiles[id] ?? null,
        getCapRadius:   () => atmoOuterRadius,
        getFloorRadius: () => atmoInnerRadius,
      } : null,
    },
  )

  let elapsed = 0
  function dispose() {
    cursor.dispose()
    bodyHover.dispose()
    displayMesh.geometry.dispose()
    ;(displayMesh.material as THREE.Material).dispose()
    interactive.dispose()
    planetMaterial.dispose()
    coreMesh.dispose()
    atmoShell?.dispose()
    atmoBoard?.dispose()
  }

  // ── Warmup (pre-compile every shader the body will use) ──────────
  // The `'surface'` phase covers the smooth display mesh, the opaque
  // core mesh, the body-hover ring and the interactive sol mesh
  // (the latter is detached from the body group until `activate()`,
  // hence enumerated explicitly so the first activation does not
  // freeze on a fresh shader link).
  // The `'atmosphere'` phase covers the atmo halo shell and the
  // playable atmo board — present only on bodies with an atmosphere.
  // The `'cursor'` phase covers the hover cursor primitives.
  function warmup(
    renderer: THREE.WebGLRenderer,
    camera:   THREE.Camera,
    progressOptions?: WarmupOptions,
  ): Promise<void> {
    const phases: WarmupPhaseSpec[] = [
      {
        phase:   'surface',
        label:   'Compiling surface shaders…',
        targets: [displayMesh, coreMesh.mesh, bodyHover.mesh, interactive.group],
      },
    ]
    const atmoTargets: THREE.Object3D[] = []
    if (atmoShell) atmoTargets.push(atmoShell.mesh)
    if (atmoBoard) atmoTargets.push(atmoBoard.group)
    if (atmoTargets.length > 0) {
      phases.push({
        phase:   'atmosphere',
        label:   'Compiling atmosphere shaders…',
        targets: atmoTargets,
      })
    }
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

  /**
   * Routes the hover query to the active board: liquid surface (priority,
   * sits on top), then sol mesh in surface view, atmo board in
   * atmosphere view. No-op in shader view (the controller already
   * returns null when the body is not in interactive mode).
   *
   * Liquid wins over sol because the user visually picks the water
   * surface first; rejecting the liquid hit would mean clicking through
   * the ocean to the seabed, which is not what the cursor "points" at.
   */
  function queryHover(raycaster: THREE.Raycaster): BoardTileRef | null {
    if (activeView === 'atmosphere' && atmoBoard) {
      const id = atmoBoard.queryHover(raycaster, group)
      return id === null ? null : { layer: 'atmo', tileId: id }
    }
    if (activeView === 'surface') {
      // Liquid takes priority — the visible top surface is the waterline.
      const liquid = interactive.getLiquidRaycastState?.()
      if (liquid && liquid.mesh.visible) {
        group.updateWorldMatrix(true, true)
        const hits: THREE.Intersection[] = []
        liquid.mesh.raycast(raycaster, hits)
        for (const hit of hits) {
          if (hit.faceIndex == null) continue
          const tileId = liquid.faceToTileId[hit.faceIndex]
          if (tileId === undefined) continue
          return { layer: 'liquid', tileId }
        }
      }
      const id = ctrl.queryHover(raycaster)
      return id === null ? null : { layer: 'sol', tileId: id }
    }
    return null
  }

  const planet: PlanetBody = {
    kind: 'planet',
    group,
    config,
    sim,
    palette,
    variation,
    tileCount: data.tiles.length,
    shadowUniforms,
    occluderUniforms,
    planetMaterial,
    hoverChannel,
    graphicsUniforms,

    tick: (dt: number) => {
      elapsed += dt
      planetMaterial.tick(elapsed)
      interactive.tick(elapsed)
      coreMesh.tick(elapsed)
      atmoShell?.tick(elapsed)
      if (sunLight) {
        group.getWorldPosition(_planetWP)
        // Resolve the light to a world-space sun position. PointLight →
        // literal world pos; DirectionalLight → virtual point projected
        // far behind so the resulting direction reads as near-parallel.
        resolveLightWorldPos(sunLight, _sunWP)
        _dir.copy(_sunWP).sub(_planetWP).normalize()
        planetMaterial.setLight({ direction: _dir })
        atmoShell?.setLight(_dir)
      }
    },
    dispose,
    warmup,

    getCoreRadius:    () => coreMesh.radius,
    getSurfaceRadius: () => config.radius,

    atmoShell,

    interactive: {
      activate:   ctrl.activateInteractive,
      deactivate: ctrl.deactivateInteractive,
      queryHover,
    },
    hover: {
      setTile: (id, opts) => {
        cursor.setBoardTile(id === null ? null : { layer: 'sol', tileId: id }, opts)
        // Atmo board's vertex-tint highlight is layer-specific — clear it
        // when sol is targeted so atmo isn't double-highlighted on layer
        // switches mid-frame.
        atmoBoard?.setHover(null)
      },
      setBoardTile(ref, options) {
        cursor.setBoardTile(ref, options)
        // Mirror the atmo board's tint dispatch alongside the ring/light
        // so the atmo tile stays highlighted when relevant.
        if (atmoBoard) {
          atmoBoard.setHover(ref && ref.layer === 'atmo' ? ref.tileId : null)
        }
      },
      setBodyHover:  bodyHover.setVisible,
      onChange:      cursor.onHoverChange,
      updateCursor:  cursor.updateConfig,
      useCursor,
    },
    liquid: {
      setSeaLevel: (worldRadius: number) => {
        interactive.setSeaLevel(worldRadius)
        smoothSphere.setSeaLevel(worldRadius)
      },
      setVisible:      interactive.setLiquidVisible,
      setOpacity:      interactive.setLiquidOpacity,
      setColor:        interactive.setLiquidColor,
      getRaycastState: interactive.getLiquidRaycastState,
    },
    view: {
      set: setView,
    },
    tiles: {
      sol: {
        tiles:               sim.tiles,
        surfaceOffset:       interactive.surfaceOffset,
        tileGeometry:        interactive.tileGeometry,
        writeTileColor:      interactive.writeTileColor,
        applyOverlay:        interactive.applyTileOverlay,
        getTilePosition:     interactive.getTilePosition,
        updateTileSolHeight: (updates) => {
          interactive.updateTileSolHeight(updates)
          // Re-apply the cursor on its current target — sol cap moved.
          cursor.refresh()
        },
        tileBaseVisual:      interactive.tileBaseVisual,
      },
      atmo: atmoBoard ? {
        tiles:           atmoBoard.tiles,
        writeTileColor:  atmoBoard.writeTileColor,
        applyOverlay:    atmoBoard.applyOverlay,
        getTilePosition: atmoBoard.getTilePosition,
      } : null,
      repaintSmoothSphere: smoothSphere.repaint,
      paintSmoothSphere:   smoothSphere.paintFromTiles,
      paintAtmoShell:      atmoShell ? atmoShell.paintFromTiles : () => { /* noop */ },
    },
  }

  // Apply the requested initial view before disabling raycast, so the atmo
  // halo shell (mounted lazily by the view switcher) is part of the subtree
  // when we silence it.
  if (options?.initialView) setView(options.initialView)
  if (options?.raycastable === false) disableGroupRaycast(group)

  return planet
}
