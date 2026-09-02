import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Teaches the dev and preview servers the one rewrite Netlify does for us.
 *
 * /how-it-works is built as its own HTML entry, so on Netlify the extensionless
 * URL resolves to how-it-works/index.html before any redirect rule is consulted
 * (and netlify.toml states the rewrite explicitly on top of that). Neither local
 * server has that rule: each looks for a file called `how-it-works`, does not
 * find one, and hands the request to the SPA fallback — which serves the
 * LANDING page's head under the guide's URL. The page still *works*, which is
 * what makes it dangerous: it is precisely the bug this pass exists to fix, so
 * a local server that reproduces it would quietly invalidate every check run
 * against it. Serving only; the build output is untouched.
 */
function netlifyPrettyUrls(): Plugin {
  const rewrite = (req: { url?: string }) => {
    const url = req.url || '/';
    const pathname = url.split('?')[0];
    if (pathname === '/how-it-works') req.url = `/how-it-works/index.html${url.slice(pathname.length)}`;
  };
  return {
    name: 'airo-pretty-urls',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => (rewrite(req), next()));
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => (rewrite(req), next()));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), netlifyPrettyUrls()],
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  build: {
    // three.js and the React/UI layers change on completely different cadences,
    // so splitting them lets a UI tweak reuse the cached (and much larger)
    // rendering bundle.
    rollupOptions: {
      // Two HTML entries, one app. There is no SSR here, so this is the only
      // way /how-it-works can carry its own title, description, canonical and
      // FAQ structured data instead of inheriting the landing page's head via
      // the SPA fallback. Both documents boot the same /src/main.tsx and the
      // router picks the route; the difference is purely what a crawler is
      // handed before any JavaScript runs.
      input: {
        main: path.resolve(__dirname, 'index.html'),
        howItWorks: path.resolve(__dirname, 'how-it-works/index.html'),
      },
      output: {
        // The function form, not the object form. The object form only claims
        // each listed package's MAIN entry, so subpath entries the app actually
        // imports (react/jsx-runtime, react-dom/client, motion/react) and the
        // CJS shims rollup synthesises for them fell into the three chunk —
        // which made 1.1 MB of rendering code a hard dependency of every page
        // just to obtain the JSX runtime. Two rules keep the split honest:
        // every package that imports three rides in the three chunk (otherwise
        // vendor would import the three chunk and reintroduce the dependency at
        // the chunk level), and everything else from node_modules is vendor.
        manualChunks(id: string) {
          if (id.startsWith('\0')) return 'vendor'; // vite/rollup virtual helpers
          const m = id.match(/node_modules\/(@[^/]+\/[^/]+|[^/]+)/);
          if (!m) return undefined; // app code splits along dynamic imports
          const pkg = m[1];
          if (
            pkg === 'three' ||
            pkg.startsWith('@react-three/') ||
            pkg.startsWith('three-') || // three-mesh-bvh, three-stdlib
            pkg.startsWith('troika-three') ||
            pkg === '@monogrid/gainmap-js' ||
            pkg === 'camera-controls' ||
            pkg === 'maath' ||
            pkg === 'meshline' ||
            pkg === 'stats-gl'
          ) {
            return 'three';
          }
          if (pkg.startsWith('@supabase/')) return 'net';
          return 'vendor';
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: true,
  },
});
