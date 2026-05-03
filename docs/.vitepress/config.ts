import { defineConfig } from 'vitepress'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { templateCompilerOptions } from '@tresjs/core'
import typedocSidebar from '../api/typedoc-sidebar.json' with { type: 'json' }

/**
 * VitePress configuration for the `@cedric-pouilleux/stellexjs` docs.
 *
 * Three top-level sections:
 * - Guides: hand-written conceptual + how-to material (FR).
 * - Examples: a live demo per page, with Three.js and Vue/TresJS tabs.
 * - API: auto-generated reference from TypeDoc + typedoc-vitepress-theme.
 */

const here = path.dirname(fileURLToPath(import.meta.url)) // docs/.vitepress
const root = path.resolve(here, '../..') // monorepo root

export default defineConfig({
  vue: { ...templateCompilerOptions },

  vite: {
    resolve: {
      alias: {
        '@cedric-pouilleux/stellexjs/sim':  path.resolve(root, 'sim.ts'),
        '@cedric-pouilleux/stellexjs/core': path.resolve(root, 'core.ts'),
        '@cedric-pouilleux/stellexjs':      path.resolve(root, 'index.ts'),
      },
    },
  },

  title:       'StellexJS',
  description: 'Générateur procédural de corps stellaires — géométrie, physique, simulation et rendu pour Three.js et Vue 3.',
  cleanUrls:   true,
  lastUpdated: true,
  base:        '/stellex-js/',

  themeConfig: {
    nav: [
      { text: 'Guides',     link: '/guides/getting-started'    },
      { text: 'Exemples',   link: '/examples/body-types/rocky' },
      { text: 'API',        link: '/api/'                      },
      // Sibling SPA built separately and embedded under `/playground/` at
      // deploy time. VitePress treats it as a plain external link.
      { text: 'Playground', link: '/playground/', target: '_self' },
      {
        text: 'GitHub',
        link: 'https://github.com/cedric-pouilleux/stellex-js',
      },
    ],

    sidebar: {
      '/guides/': [
        {
          text: 'Démarrer',
          items: [
            { text: 'Installation',           link: '/guides/getting-started'      },
            { text: 'Concepts fondamentaux',  link: '/guides/core-concepts'        },
            { text: 'Anatomie d\'un BodyConfig', link: '/guides/body-config-anatomy' },
          ],
        },
        {
          text: 'Intégrations',
          items: [
            { text: 'Three.js (vanille)',  link: '/guides/threejs-integration' },
            { text: 'Vue 3 + TresJS',      link: '/guides/vue-integration'     },
            { text: 'Composants de scène', link: '/guides/scene-components'    },
            { text: 'Headless / serveur',  link: '/guides/headless-simulation' },
          ],
        },
        {
          text: 'Approfondir',
          items: [
            { text: 'Shaders & matériaux',     link: '/guides/shaders-and-materials' },
            { text: 'Palettes & terrain',      link: '/guides/palettes-and-terrain'  },
            { text: 'Étoiles',                 link: '/guides/stars'                 },
            { text: 'Variation visuelle',      link: '/guides/variation'             },
            { text: 'Génération seedée',       link: '/guides/seeded-generation'     },
            { text: 'Curseur de survol',       link: '/guides/hover-cursor'          },
            { text: 'Graphics uniforms',       link: '/guides/graphics-uniforms'     },
            { text: 'Intégrer du gameplay',    link: '/guides/gameplay-integration'  },
            { text: 'Performance',             link: '/guides/performance'           },
            { text: 'API avancée',             link: '/guides/advanced-api'          },
          ],
        },
      ],
      '/examples/': [
        {
          text: 'Types de corps',
          items: [
            { text: 'Planète rocheuse',  link: '/examples/body-types/rocky'    },
            { text: 'Planète métallique', link: '/examples/body-types/metallic' },
            { text: 'Géante gazeuse',    link: '/examples/body-types/gas'      },
            { text: 'Étoile',            link: '/examples/body-types/star'     },
          ],
        },
        {
          text: 'Atmosphère',
          items: [
            { text: 'Aspect visuel',      link: '/examples/atmosphere/basic'    },
            { text: 'Atmosphère jouable', link: '/examples/atmosphere/playable' },
          ],
        },
        {
          text: 'Palettes & couleurs',
          items: [
            { text: 'Gradient de température', link: '/examples/palettes/temperature-gradient' },
          ],
        },
        {
          text: 'Relief & bruit',
          items: [
            { text: 'Profil de bruit', link: '/examples/relief/noise-profile' },
          ],
        },
        {
          text: 'Liquides',
          items: [
            { text: 'Océan',         link: '/examples/liquids/ocean'  },
            { text: 'Surface gelée', link: '/examples/liquids/frozen' },
            { text: 'Lave',          link: '/examples/liquids/lava'   },
          ],
        },
        {
          text: 'Anneaux',
          items: [
            { text: 'Anneaux simples',   link: '/examples/rings/basic'      },
            { text: 'Archétypes',        link: '/examples/rings/archetypes' },
            { text: 'Ombres planétaires', link: '/examples/rings/shadows'    },
          ],
        },
        {
          text: 'Tuiles hexagonales',
          items: [
            { text: 'Mode jouable',           link: '/examples/hex-tiles/playable-mode'      },
            { text: 'Visualiseur interactif', link: '/examples/hex-tiles/interactive-viewer' },
            { text: 'Voisinage & BFS',        link: '/examples/hex-tiles/neighbors'          },
          ],
        },
        {
          text: 'Noyau & structure',
          items: [
            { text: 'Noyau & coquilles', link: '/examples/core/core-and-shells' },
          ],
        },
        {
          text: 'Éclairage',
          items: [
            { text: 'God rays stellaires', link: '/examples/lighting/star-godrays'   },
            { text: 'Multi-sources',       link: '/examples/lighting/multi-light'    },
          ],
        },
        {
          text: 'Scènes complètes',
          items: [
            { text: 'Système solaire',          link: '/examples/scenes/solar-system'          },
            { text: 'Géante & ses anneaux',     link: '/examples/scenes/gas-giant-with-rings'  },
          ],
        },
        {
          text: 'Headless',
          items: [
            { text: 'Génération depuis un seed', link: '/examples/headless/generate-config' },
            { text: 'Analyse des tuiles',        link: '/examples/headless/analyze-tiles'   },
          ],
        },
      ],
      '/api/': [
        { text: 'Vue d\'ensemble', link: '/api/' },
        ...typedocSidebar,
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/cedric-pouilleux/stellex-js' },
    ],

    search: { provider: 'local' },

    outline: { level: [2, 3] },

    footer: {
      message: 'Distribué sous la licence indiquée dans le dépôt.',
      copyright: 'Copyright © Cedric Pouilleux',
    },
  },
})
