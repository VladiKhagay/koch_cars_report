import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Read a brand value out of the token source at build time.
 *
 * src/index.css claims to be the ONLY place a brand-carrying value is written
 * down. Until now that was not true of the shell: the manifest and the
 * theme-color meta tag each carried their own hardcoded #0f172a, so the install
 * splash flashed near-black before a white app — and anyone grepping for a hex
 * found none and trusted the comment.
 *
 * Throws rather than falling back: a wrong splash colour is invisible in review
 * and permanent on someone's home screen. A failed build is the cheaper failure.
 */
function brandToken(name: string): string {
  const css = readFileSync(new URL('./src/index.css', import.meta.url), 'utf8');
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8})`));
  if (!match) throw new Error(`vite.config: ${name} not found in src/index.css`);
  return match[1];
}

/** The app's first painted frame is the paper surface; the splash must match it. */
const SURFACE = brandToken('--color-surface');

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      // index.html is static, so the meta tag needs the same value injected.
      name: 'brand-theme-color',
      transformIndexHtml: (html: string) =>
        html.replace(/(<meta name="theme-color" content=")[^"]*(")/, `$1${SURFACE}$2`),
    },
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Koch-Chemie Car Tracker',
        // Home screens truncate past ~12 characters, and the icon already says
        // whose product this is.
        short_name: 'Car Tracker',
        description: 'Log finished vehicle prep jobs from your phone.',
        theme_color: SURFACE,
        background_color: SURFACE,
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          // Its own file, drawn with the mark inside the inner 60%. The mark is
          // a bordered square, so reusing the full-bleed icon here would let a
          // circular launcher mask slice the frame off.
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // App-shell caching only. Job data always goes straight to Supabase —
        // we do NOT cache API responses, so managers/workers never see stale
        // records. The offline submit queue (see src/lib/offlineQueue.ts)
        // handles connectivity gaps at the data layer instead.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
    }),
  ],
});
