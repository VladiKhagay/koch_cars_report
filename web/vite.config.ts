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

/**
 * Origin of a configured URL, for use in a CSP source list.
 *
 * Returns null when the variable is absent, which happens in the CI build (the
 * Supabase/Worker values are deploy-time secrets and that job only checks the
 * build compiles). Missing values are warned about rather than thrown on: an
 * app built without them cannot reach Supabase at all — createClient throws on
 * boot — so the CSP is never the thing that breaks first, and failing the
 * build here would only break CI to restate that.
 */
function originOf(url: string | undefined, name: string): string | null {
  if (!url) {
    console.warn(`[csp] ${name} is not set — omitting it from connect-src`);
    return null;
  }
  try {
    return new URL(url).origin;
  } catch {
    throw new Error(`vite.config: ${name} is not a valid URL: ${url}`);
  }
}

/**
 * Emits the Cloudflare `_headers` file for the static-assets deployment.
 *
 * Generated rather than committed to public/ because connect-src has to name
 * the Supabase and Worker origins, and those are build-time env vars. A static
 * file would silently drift the moment either moved, and a CSP that is wrong
 * in that direction fails closed — the whole app stops talking to its backend.
 */
function securityHeaders() {
  let headers = '';

  return {
    name: 'security-headers',
    apply: 'build' as const,

    configResolved(config: { env: Record<string, string> }) {
      const connect = [
        "'self'",
        originOf(config.env.VITE_SUPABASE_URL, 'VITE_SUPABASE_URL'),
        originOf(config.env.VITE_WORKER_URL, 'VITE_WORKER_URL'),
      ].filter(Boolean);

      const csp = [
        "default-src 'self'",
        "base-uri 'none'",
        "object-src 'none'",
        // The app is never legitimately framed. frame-ancestors is the modern
        // control; X-Frame-Options below is its pre-CSP equivalent, kept for
        // the browsers that still only read that one.
        "frame-ancestors 'none'",
        "form-action 'self'",
        // No inline scripts: the built index.html loads both the bundle and
        // registerSW.js as external files, so this stays strict. This is the
        // directive that actually matters — session tokens live in
        // localStorage, so script injection is account takeover.
        "script-src 'self'",
        // Inline styles are required: React style={{…}} attributes compile to
        // style attributes, which style-src governs.
        "style-src 'self' 'unsafe-inline'",
        // blob: for photo object URLs (PhotoViewer, PhotoCapture previews).
        "img-src 'self' blob: data:",
        "font-src 'self' data:",
        `connect-src ${connect.join(' ')}`,
        "worker-src 'self'",
        "manifest-src 'self'",
        'upgrade-insecure-requests',
      ].join('; ');

      headers = [
        '/*',
        `  Content-Security-Policy: ${csp}`,
        '  X-Content-Type-Options: nosniff',
        '  X-Frame-Options: DENY',
        '  Referrer-Policy: strict-origin-when-cross-origin',
        '  Strict-Transport-Security: max-age=31536000; includeSubDomains',
        // The camera is reached through <input capture>, which is the OS
        // picker rather than getUserMedia, but self is allowed so that stays
        // true if it ever changes. Everything else is off.
        '  Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=(), usb=()',
        '',
      ].join('\n');
    },

    generateBundle(this: { emitFile: (f: { type: 'asset'; fileName: string; source: string }) => void }) {
      this.emitFile({ type: 'asset', fileName: '_headers', source: headers });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    securityHeaders(),
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
