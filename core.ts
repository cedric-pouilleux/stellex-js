/**
 * Public API of the body feature — Three.js-ready entry point.
 *
 * Builds on `./sim` (pure-logic) and adds the render layer: shaders,
 * materials, GLSL, render builders, palettes, scene-display helpers and
 * Three.js-backed interaction helpers (raycasting). Free of any Vue or
 * TresJS dependency — suitable for consumers wiring their own scene
 * manually or using a non-Vue framework.
 *
 * Vue-specific additions (components, reactive composables) live in
 * `./index.ts` and augment this surface. For a fully WebGL-free
 * consumption (backend, worker, CLI), import from `./sim` directly.
 */

// ── Pure-logic surface (types, geometry, physics, sim…) ──────────
export * from './sim'

// ── Render-scoped types (THREE.js-coupled) ───────────────────────
export type { TerrainLevel } from './render/types/terrain.types'
export type { BodyRenderOptions } from './render/types/bodyRender.types'
export type {
  Body,
  BodyBase,
  PlanetBody,
  StarBody,
  BodyInteractive,
  BodyHover,
  BodyLiquid,
  BodyView,
  BoardTiles,
  SolBoardTiles,
  PlanetTiles,
  StarTiles,
  RGB,
  TileBaseVisual,
  WarmupPhase,
  WarmupProgress,
  WarmupOptions,
} from './render/types/bodyHandle.types'

// ── Render config (body-scoped) ──────────────────────────────────
export {
  PREVIEW_ORBIT_SPEED,
  FOCUS_LERP,
  SHADOW_SUN_RADIUS,
  ORBIT_TRAIL_SEGMENTS,
  DEFAULT_LENS_FLARE,
  DEFAULT_SUN_FX,
  DEFAULT_HOVER,
  DEFAULT_BODY_HOVER,
} from './config/render'
export type {
  GodRaysParams,
  LensFlareConfig,
  SunFXConfig,
  HoverConfig,
  BodyHoverConfig,
} from './config/render'

// ── Render-scoped types ──────────────────────────────────────────
export type { RenderableBody } from './render/types/renderableBody'
export type {
  HoverCursorConfig,
  HoverCursorPresets,
  HoverCursorRingConfig,
  HoverCursorEmissiveConfig,
} from './render/types/hoverCursor.types'

// ── Terrain palettes (produce THREE.Color) ───────────────────────
// Consumers wanting to tweak relief defaults can call the generator,
// map over the returned levels, and pass the result as
// `BodyRenderOptions.palette` at the render factory (`useBody`, `<Body>`).
// The rocky default is a plain low → high grey ramp whose anchors are
// exposed as `terrainColorLow` / `terrainColorHigh` on `BodyConfig`; the
// `DEFAULT_TERRAIN_LOW_COLOR` / `DEFAULT_TERRAIN_HIGH_COLOR` constants are
// the fallback values used when those knobs are omitted.
export {
  generateTerrainPalette,
  buildMetallicPalette,
  buildGasPalette,
} from './render/palettes/terrainPalette'
export type { GasBandColors } from './render/palettes/paletteGas'
export {
  DEFAULT_TERRAIN_LOW_COLOR,
  DEFAULT_TERRAIN_HIGH_COLOR,
} from './render/palettes/paletteRocky'
export { buildStarPalette } from './render/palettes/starPalette'

// ── Shaders (procedural planet + post-processing) ────────────────
export {
  BodyMaterial,
  BODY_PARAMS,
  getDefaultParams,
  SHADER_RANGES,
  kelvinToRGB,
  kelvinToThreeColor,
  kelvinLabel,
  GodRaysShader,
} from './shaders'
export type {
  BodyMaterialOptions,
  BodyLightUpdate,
  LibBodyType,
  ParamDef,
  BodyParamsMap,
  ParamRange,
  ParamMap,
  ParamValue,
  LiquidMaskOptions,
  RangeMap,
  KelvinRGB,
} from './shaders'

// ── Rendering ────────────────────────────────────────────────────
export {
  DEFAULT_CORE_RADIUS_RATIO,
  resolveTerrainLevelCount,
  resolveAtmosphereThickness,
  terrainBandLayout,
  type TerrainBandLayout,
} from './physics/body'
export { MIN_TERRAIN_LEVEL_COUNT } from './physics/terrain'
export { STAR_TILE_REF } from './physics/star'
export {
  useBody,
  tileSizeToSubdivisions,
  resolveTileHeight,
  resolveTileLevel,
  choosePalette,
} from './render/body/useBody'
export type { UseBodyOptions } from './render/body/useBody'
// Pure derivation: BodyConfig + variation → shader params. Exposed so
// callers can preview the resolved uniforms (UI panes, debugging,
// thumbnails) without having to build a full body. No GPU resource is
// created — same function `useBody` runs internally.
export { configToLibParams } from './render/body/configToLibParams'
export type {
  ShadowUniforms,
  OccluderUniforms,
  TileGeometryInfo,
  HoverListener,
} from './render/hex/hexMeshShared'
export type { InteractiveMesh, InteractiveMeshOptions } from './render/body/buildInteractiveMesh'
export { buildAtmoShell } from './render/shells/buildAtmoShell'
export type { AtmoShellConfig, AtmoShellHandle, AtmoShellParams } from './render/shells/buildAtmoShell'
export { buildBodyRings } from './render/shells/buildBodyRings'
export type { BodyRingsConfig, BodyRingsHandle } from './render/shells/buildBodyRings'
export { buildCoreMesh } from './render/shells/buildCoreMesh'
export type { CoreMesh, CoreMeshConfig } from './render/shells/buildCoreMesh'
export { buildLayeredPrismGeometry } from './render/layered/buildLayeredPrism'
export type { LayeredPrismGeometry, PrismRange } from './render/layered/buildLayeredPrism'
export { buildLayeredMergedGeometry } from './render/layered/buildLayeredMesh'
export type { LayeredMergedGeometry, SolHeightFn } from './render/layered/buildLayeredMesh'
export { buildLiquidShell } from './render/shells/buildLiquidShell'
export type { LiquidShellConfig, LiquidShellHandle } from './render/shells/buildLiquidShell'
export { buildSolidShell } from './render/shells/buildSolidShell'
export type { SolidShellConfig, SolidShellHandle } from './render/shells/buildSolidShell'
export { buildLayeredInteractiveMesh, resolveSolHeight } from './render/layered/buildLayeredInteractiveMesh'
export type { LayeredInteractiveMesh, LayeredInteractiveMeshOptions } from './render/layered/buildLayeredInteractiveMesh'
export { buildAtmoBoardMesh } from './render/atmo/buildAtmoBoardMesh'
export type { AtmoBoardMesh, AtmoBoardMeshOptions } from './render/atmo/buildAtmoBoardMesh'
export type { AtmoShellRGB } from './render/shells/atmoShellPaint'
export type { RaycastState } from './render/body/interactiveController'
export type {
  InteractiveLayer,
  InteractiveView,
  BoardTileRef,
  HoverPlacementOptions,
} from './render/types/bodyHandle.types'
export type { RingVariation, RingArchetype, Profile8 } from './render/shells/ringVariation'
export {
  RING_RANGES,
  RING_ARCHETYPES,
  ARCHETYPE_PROFILES,
  generateRingVariation,
} from './render/shells/ringVariation'
export { generateBodyVariation } from './render/body/bodyVariation'
export type { BodyVariation } from './render/body/bodyVariation'
export { createTileOverlayMesh } from './render/shells/TileOverlayMesh'
export type {
  TileOverlayMesh,
  TileOverlayOptions,
  TileOverlayKind,
  TileGeometryQuery,
  TileGeometryContext,
} from './render/shells/TileOverlayMesh'
export {
  computeBodyQuaternion,
  createBodyMotion,
} from './render/body/bodyMotion'
export type {
  BodyMotionInput,
  BodyMotionHandle,
} from './render/body/bodyMotion'
export { godRaysFromStar } from './render/lighting/godRaysFromStar'
export { createGraphicsUniforms } from './render/hex/hexGraphicsUniforms'
export type {
  GraphicsUniforms,
  NumberUniform,
  ColorUniform,
} from './render/hex/hexGraphicsUniforms'
export { resolveSphereDetail, MAX_SPHERE_DETAIL } from './render/quality/renderQuality'
export type { RenderQuality, SphereDetailQuality } from './render/quality/renderQuality'
export { createHoverChannel } from './render/state/hoverState'
export type { HoverChannel, MutableRef } from './render/state/hoverState'
export { findSceneRoot, findDominantLightWorldPos } from './render/lighting/findDominantLight'

// ── Surface-look strategy ──────────────────────────────────────
// Stars use a fixed strategy (their pipeline is structurally different);
// planetary bodies pick a `SurfaceLook` (`'terrain'` / `'bands'` /
// `'metallic'`) that drives palette generator + atmo defaults + shader
// family. Adding a new visual archetype collapses to one entry in
// `SURFACE_LOOK_STRATEGIES`.
export {
  SURFACE_LOOK_STRATEGIES,
  strategyFor,
} from './render/body/bodyTypeStrategy'
export type {
  BodyTypeStrategy,
  SolVariationRanges,
} from './render/body/bodyTypeStrategy'

// ── Scene display helpers ───────────────────────────────────────
export { bodyOuterRadius } from './render/body/sceneBodyUtils'

// ── Interaction ──────────────────────────────────────────────────
export { findBodyIndex, raycastBodies } from './render/body/bodyRaycast'
export type { RaycastBody, RaycastBodiesOptions, RaycastHit } from './render/body/bodyRaycast'
