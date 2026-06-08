import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { useBody } from './useBody'
import { DEFAULT_CORE_RADIUS_RATIO } from '../../physics/body'
import type { BodyConfig } from '../../types/body.types'

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Mirrors the StatsOverlay polygon counting logic (position.count / 3). */
function countGroupPolygons(group: THREE.Group): number {
  let n = 0
  group.traverse(obj => {
    if ((obj as THREE.Mesh).isMesh) {
      const pos = (obj as THREE.Mesh).geometry?.getAttribute('position')
      if (pos) n += (pos.count / 3) | 0
    }
  })
  return n
}

/** Returns true when a substantial non-indexed mesh (merged prisms) is present. */
function hasNonIndexedMesh(group: THREE.Group): boolean {
  let found = false
  group.traverse(obj => {
    const mesh = obj as THREE.Mesh
    // Threshold filters out the hover-cursor ring (≤ ~36 vertices) — it
    // is mounted permanently but is not the merged hex board the swap
    // test cares about.
    if (mesh.isMesh && mesh.geometry && !mesh.geometry.index
      && mesh.geometry.getAttribute('position').count > 50) found = true
  })
  return found
}

/** Returns true when every non-trivial mesh geometry in the group is indexed (sphere). */
function hasIndexedMesh(group: THREE.Group): boolean {
  let found = false
  group.traverse(obj => {
    const mesh = obj as THREE.Mesh
    // Ignore the PlaneGeometry used by bodyHoverOverlay (4 vertices)
    if (mesh.isMesh && mesh.geometry && mesh.geometry.index
      && mesh.geometry.getAttribute('position').count > 10) found = true
  })
  return found
}

function makeStarConfig(radius = 1): BodyConfig {
  return {
    name: 'TestStar', type: 'star', spectralType: 'G',
    radius, rotationSpeed: 0.01, axialTilt: 0,
  }
}

function makeRockyConfig(radius = 1): BodyConfig {
  return {
    name: 'TestRocky', type: 'planetary', surfaceLook: 'terrain',
    atmosphereThickness: 0.5,
    liquidState: 'liquid',
    radius, rotationSpeed: 0.05, axialTilt: 0,
  }
}

// Large tile size â†’ subdivision 2 â†’ 42 tiles (fast test builds).
const TILE_SIZE = 0.5

// â”€â”€ Star display mesh is smooth sphere (indexed) in overview â”€â”€â”€â”€â”€â”€

describe('useBody â€” star', () => {
  it('places an indexed smooth sphere in the group without hex mode', () => {
    // Stars now use buildStarSmoothMesh (same pattern as rocky):
    // indexed SphereGeometry + animated BodyMaterial('star').
    const star = useBody(makeStarConfig(), TILE_SIZE)
    expect(hasIndexedMesh(star.group)).toBe(true)
    expect(hasNonIndexedMesh(star.group)).toBe(false)
    star.dispose()
  })

  it('polygon count stays low without hex mode (smooth sphere vertex count / 3)', () => {
    // SphereGeometry with segs â‰ˆ 64 â†’ far fewer than the old hex mesh.
    const star = useBody(makeStarConfig(), TILE_SIZE)
    expect(countGroupPolygons(star.group)).toBeLessThan(5_000)
    star.dispose()
  })

  it('exposes planetMaterial so ShaderPane can live-update star uniforms', () => {
    // The playground's shader slider pipeline calls `body.planetMaterial.setParams`
    // on every input event. Omitting this field here (previous regression) broke
    // every star shader control â€” temperature, pulsation, corona, granulationâ€¦
    const star = useBody(makeStarConfig(), TILE_SIZE)
    expect((star as any).planetMaterial?.setParams).toBeTypeOf('function')
    star.dispose()
  })

  it('switches to non-indexed hex mesh in interactive mode and back on deactivate', () => {
    // Same smooth â†” hex swap lifecycle as rocky planets.
    const star = useBody(makeStarConfig(), TILE_SIZE)

    expect(hasNonIndexedMesh(star.group)).toBe(false)
    expect(hasIndexedMesh(star.group)).toBe(true)

    star.interactive.activate()
    expect(hasNonIndexedMesh(star.group)).toBe(true)
    expect(hasIndexedMesh(star.group)).toBe(false)

    star.interactive.deactivate()
    expect(hasNonIndexedMesh(star.group)).toBe(false)
    expect(hasIndexedMesh(star.group)).toBe(true)

    star.dispose()
  })
})

// â”€â”€ Rocky display mesh is smooth sphere (indexed) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('useBody â€” rocky (non-interactive)', () => {
  it('places an indexed smooth sphere in the group (not a hex mesh)', () => {
    // Rocky planets use buildSmoothSphereMesh â†’ THREE.SphereGeometry (indexed).
    const rocky = useBody(makeRockyConfig(), TILE_SIZE)
    expect(hasIndexedMesh(rocky.group)).toBe(true)
    rocky.dispose()
  })

  it('polygon count stays low without hex mode (smooth sphere vertex count / 3)', () => {
    // SphereGeometry with segs â‰ˆ 72 â†’ position.count â‰ˆ 74Ã—37 = 2738 â†’ polys â‰ˆ 912.
    // The hex mesh (buildPlanetMesh + buildInteractiveMesh) is built but NOT in the group.
    const rocky = useBody(makeRockyConfig(), TILE_SIZE)
    const polys = countGroupPolygons(rocky.group)
    // Smooth sphere is indexed: position.count = (segs+1)*(segs/2+1) â‰ª tile prism count.
    // 5000 is a generous ceiling that no smooth sphere (segs â‰¤ ~120) would exceed.
    expect(polys).toBeLessThan(5_000)
    rocky.dispose()
  })

  it('mounts both boards (sol + atmo) alongside the smooth display sphere', () => {
    // The dual-board model mounts every mesh up-front: the smooth display
    // sphere (indexed), the sol interactive mesh (non-indexed prisms) and
    // the atmo board mesh (non-indexed prisms). The view switcher drives
    // their visibility — `interactive.activate` only flips the controller
    // mode, the scene-graph layout stays stable.
    const rocky = useBody(makeRockyConfig(), TILE_SIZE)

    expect(hasIndexedMesh(rocky.group)).toBe(true)     // smooth sphere
    expect(hasNonIndexedMesh(rocky.group)).toBe(true)  // sol mesh + atmo board

    rocky.interactive.activate()
    expect(hasNonIndexedMesh(rocky.group)).toBe(true)
    rocky.interactive.deactivate()
    expect(hasNonIndexedMesh(rocky.group)).toBe(true)

    rocky.dispose()
  })

  it('mounts a smooth ocean sphere in hex mode when the surface is liquid', () => {
    const rocky = useBody(makeRockyConfig(), TILE_SIZE)
    rocky.interactive.activate()

    // Count indexed meshes with non-trivial geometry â€” the ocean layer uses
    // a SphereGeometry which is indexed and contributes many vertices.
    let indexedMeshes = 0
    rocky.group.traverse(obj => {
      const mesh = obj as THREE.Mesh
      if (mesh.isMesh && mesh.geometry?.index
        && mesh.geometry.getAttribute('position').count > 10) indexedMeshes++
    })
    expect(indexedMeshes).toBeGreaterThanOrEqual(1)

    rocky.dispose()
  })

  it('repaintSmoothSphere re-reads tileStates so dig mutations surface on the display mesh', () => {
    // Regression: the shader pane used to stay pristine after a dig because
    // the smooth-sphere paint path cached noise bands at build time. The
    // tile-state delta branch + `repaint` must let the same mutation
    // propagate into the vertex colour buffer.
    const rocky = useBody(makeRockyConfig(), TILE_SIZE)
    let displayMesh: THREE.Mesh | undefined
    rocky.group.traverse(obj => {
      const mesh = obj as THREE.Mesh
      if (mesh.isMesh && mesh.geometry?.index
        && mesh.geometry.getAttribute('color')) displayMesh = mesh
    })
    expect(displayMesh).toBeDefined()

    const colorAttr = displayMesh!.geometry.getAttribute('color') as THREE.BufferAttribute
    const initialColours = Float32Array.from(colorAttr.array as Float32Array)

    // Drop every tile to elevation 0. The noise bands still rule vertex
    // placement, but the per-tile delta must pull the associated vertices
    // down to the lowest palette band.
    const states = rocky.sim.tileStates as Map<number, { tileId: number; elevation: number }>
    for (const [id] of states) states.set(id, { tileId: id, elevation: 0 })
    rocky.tiles.repaintSmoothSphere()

    const movedColours = colorAttr.array as Float32Array
    let anyChanged = false
    for (let i = 0; i < movedColours.length; i++) {
      if (Math.abs(movedColours[i] - initialColours[i]) > 1e-4) { anyChanged = true; break }
    }
    expect(anyChanged).toBe(true)

    rocky.dispose()
  })

  it('setSeaLevel drives the smooth sphere shader + vertex colours in addition to the hex mesh', () => {
    // Regression: the sea-level slider used to move only the hex view's
    // liquid sphere. The smooth display sphere stayed painted with its
    // initial band assignment, so the left pane looked "dry" while the
    // right pane updated. Both the ocean-mask uniform and the vertex
    // colour buffer must now react to every `setSeaLevel` call.
    const rocky = useBody(makeRockyConfig(), TILE_SIZE)

    // Grab the smooth display sphere (indexed SphereGeometry â€” the only
    // indexed mesh with vertex colours in non-interactive mode).
    let displayMesh: THREE.Mesh | undefined
    rocky.group.traverse(obj => {
      const mesh = obj as THREE.Mesh
      if (mesh.isMesh && mesh.geometry?.index
        && mesh.geometry.getAttribute('color')) displayMesh = mesh
    })
    expect(displayMesh).toBeDefined()

    const colorAttr = displayMesh!.geometry.getAttribute('color') as THREE.BufferAttribute
    const initialColours = Float32Array.from(colorAttr.array as Float32Array)
    const initialVersion = colorAttr.version
    const shader = rocky.planetMaterial.material as THREE.ShaderMaterial
    const initialSeaUniform = shader.uniforms.uSeaLevel?.value as number

    // Push sea level well above its initial world radius â†’ more submerged
    // vertices â†’ the smooth-sphere colour buffer flips them to the sea
    // anchor (the smooth sphere has no liquid mesh sitting on top in
    // shader view, so the underwater tint must come from vertex colour),
    // AND the shader uniform slides to track the new waterline.
    rocky.liquid.setSeaLevel(rocky.getSurfaceRadius() * 0.99)

    const movedColours = colorAttr.array as Float32Array
    let anyChanged = false
    for (let i = 0; i < movedColours.length; i++) {
      if (Math.abs(movedColours[i] - initialColours[i]) > 1e-4) { anyChanged = true; break }
    }
    expect(anyChanged).toBe(true)
    // `needsUpdate = true` bumps the internal `version` counter â€” the
    // observable side-effect renderers pick up to re-upload the buffer.
    expect(colorAttr.version).toBeGreaterThan(initialVersion)
    expect(shader.uniforms.uSeaLevel.value).not.toBe(initialSeaUniform)

    rocky.dispose()
  })
})

// â”€â”€ Core mesh transverse (step 1) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('useBody â€” core mesh (non-stellar bodies)', () => {
  it('rocky exposes getCoreRadius = radius * DEFAULT_CORE_RADIUS_RATIO when ratio is omitted', () => {
    // Drop the atmo so the clamp `coreRatio + atmoThick â‰¤ 0.95` is inert
    // and the default ratio survives end-to-end.
    const cfg = { ...makeRockyConfig(4), atmosphereThickness: 0 }
    const rocky = useBody(cfg, TILE_SIZE)
    expect(rocky.getCoreRadius?.()).toBeCloseTo(4 * DEFAULT_CORE_RADIUS_RATIO, 5)
    expect(rocky.getSurfaceRadius?.()).toBeCloseTo(4, 5)
    rocky.dispose()
  })

  it('rocky honours an explicit coreRadiusRatio override', () => {
    const cfg = { ...makeRockyConfig(4), coreRadiusRatio: 0.3 }
    const rocky = useBody(cfg, TILE_SIZE)
    expect(rocky.getCoreRadius?.()).toBeCloseTo(4 * 0.3, 5)
    rocky.dispose()
  })

  it('rocky group contains an additional opaque sphere mesh at the core radius', () => {
    const rocky  = useBody(makeRockyConfig(4), TILE_SIZE)
    const target = rocky.getCoreRadius!()
    let found    = false
    rocky.group.traverse(obj => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh || !mesh.geometry) return
      mesh.geometry.computeBoundingSphere()
      const r = mesh.geometry.boundingSphere?.radius ?? 0
      if (Math.abs(r - target) < 1e-3) found = true
    })
    expect(found).toBe(true)
    rocky.dispose()
  })

  it('star carries the StarBody discriminant and exposes coherent radii', () => {
    const config = makeStarConfig()
    const star   = useBody(config, TILE_SIZE)
    // Discriminant â€” callers narrow the Body union via `kind === 'star'`
    // before reaching for planet-only namespaces (liquid, view, atmoShell).
    expect(star.kind).toBe('star')
    // Radii are real â€” stars do carry a core + surface even though they
    // skip the 3-layer liquid plumbing.
    expect(star.getSurfaceRadius()).toBeCloseTo(config.radius, 5)
    expect(star.getCoreRadius()).toBeLessThanOrEqual(config.radius)
    star.dispose()
  })
})

// ── sunLight pipes the planet→sun direction into BodyMaterial ────

describe('useBody — sunLight option', () => {
  it('refreshes uLightDir from sunLight.getWorldPosition() on tick', () => {
    // Drives BodyMaterial via setLight({ direction }). The shader keeps a
    // default direction until the first tick; the explicit option must
    // overwrite it with the normalized planet→sun vector each frame so
    // the day/night terminator tracks the orbital motion.
    const sun = new THREE.PointLight(0xffffff, 1)
    sun.position.set(10, 0, 0)
    const rocky = useBody(makeRockyConfig(), TILE_SIZE, { sunLight: sun })

    rocky.tick(0.016)

    const shader = rocky.planetMaterial.material as THREE.ShaderMaterial
    const lightDir = shader.uniforms.uLightDir.value as THREE.Vector3
    // Body sits at the origin, light at +X → uLightDir points planet→sun = +X.
    expect(lightDir.x).toBeCloseTo(1, 5)
    expect(lightDir.y).toBeCloseTo(0, 5)
    expect(lightDir.z).toBeCloseTo(0, 5)

    rocky.dispose()
  })

  it('honours light world transforms — not raw .position — when nested in a group', () => {
    // Regression guard: reading `sunLight.position` directly would miss
    // any parent group transform. `getWorldPosition` covers nested rigs
    // (e.g. the light hung off an orbiting carrier in a binary system).
    const carrier = new THREE.Group()
    carrier.position.set(20, 0, 0)
    const sun = new THREE.PointLight(0xffffff, 1)
    sun.position.set(0, 0, 0) // origin in carrier-local space
    carrier.add(sun)
    carrier.updateMatrixWorld(true)

    const rocky = useBody(makeRockyConfig(), TILE_SIZE, { sunLight: sun })
    rocky.tick(0.016)

    const shader = rocky.planetMaterial.material as THREE.ShaderMaterial
    const lightDir = shader.uniforms.uLightDir.value as THREE.Vector3
    // Sun's world position is (20, 0, 0); body at origin → +X direction.
    expect(lightDir.x).toBeCloseTo(1, 5)

    rocky.dispose()
  })
})

// ── Display-only options (initialView + raycastable) ────────────

describe('useBody — display-only options', () => {
  it('initialView "shader" mounts the atmo halo shell without a manual view.set()', () => {
    // Default build leaves the atmo shell unmounted (parent === null); the
    // view switcher only adds it on the shader / surface views. Passing
    // initialView spares the caller the post-construction view.set('shader').
    const idle = useBody(makeRockyConfig(), TILE_SIZE)
    expect(idle.atmoShell?.mesh.parent).toBe(null)
    idle.dispose()

    const shown = useBody(makeRockyConfig(), TILE_SIZE, { initialView: 'shader' })
    expect(shown.atmoShell?.mesh.parent).toBe(shown.group)
    expect(shown.atmoShell?.mesh.visible).toBe(true)
    shown.dispose()
  })

  it('raycastable:false makes the body transparent to scene raycasting', () => {
    const ray = new THREE.Raycaster()
    ray.set(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1))

    const pickable = useBody(makeRockyConfig(1), TILE_SIZE, { initialView: 'shader' })
    pickable.group.updateMatrixWorld(true)
    expect(ray.intersectObject(pickable.group, true).length).toBeGreaterThan(0)
    pickable.dispose()

    const silent = useBody(makeRockyConfig(1), TILE_SIZE, {
      initialView: 'shader',
      raycastable: false,
    })
    silent.group.updateMatrixWorld(true)
    expect(ray.intersectObject(silent.group, true)).toHaveLength(0)
    silent.dispose()
  })

  it('raycastable:false also silences a display-only star', () => {
    const ray = new THREE.Raycaster()
    ray.set(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1))

    const star = useBody(makeStarConfig(1), TILE_SIZE, { raycastable: false })
    star.group.updateMatrixWorld(true)
    expect(ray.intersectObject(star.group, true)).toHaveLength(0)
    star.dispose()
  })
})

// â”€â”€ Surface liquid honoured on every non-stellar type â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('useBody â€” surface liquid', () => {
  it('honours liquidState on a gaseous body (deep ocean under the envelope)', () => {
    // Doctrine: every non-stellar type honours `liquidState`. A gaseous
    // config with `liquidState: 'liquid'` produces a real waterline; the
    // caller decides when that makes sense (composition, temperature,
    // biome). The lib only carries the resolved state.
    const gaseous = useBody({
      name:                'GasGiant',
      type:                'planetary', surfaceLook: 'bands',
      atmosphereThickness: 0.5,
      liquidState:         'liquid',
      liquidColor:         '#3a4f6e',
      liquidCoverage:      0.7,
      radius:              3,
      rotationSpeed:       0.4,
      axialTilt:           0,
    }, TILE_SIZE)

    expect(gaseous.sim.hasLiquidSurface).toBe(true)
    expect(gaseous.sim.seaLevelElevation).toBeGreaterThan(-1)
    expect(gaseous.sim.liquidCoverage).toBeGreaterThan(0)

    gaseous.dispose()
  })

  it('stays dry on a gaseous body with liquidState: none', () => {
    const dry = useBody({
      name:                'DryGas',
      type:                'planetary', surfaceLook: 'bands',
      atmosphereThickness: 0.5,
      liquidState:         'none',
      radius:              3,
      rotationSpeed:       0.4,
      axialTilt:           0,
    }, TILE_SIZE)

    expect(dry.sim.hasLiquidSurface).toBe(false)
    expect(dry.sim.seaLevelElevation).toBe(-1)
    expect(dry.sim.liquidCoverage).toBe(0)

    dry.dispose()
  })
})
