import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Read a brand value from src/index.css (the one place brand values live) at
 * build time. Throws rather than falling back: a wrong splash colour is
 * invisible in review and permanent on a home screen.
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
 * Origin of a configured URL for the CSP. Null when unset (the CI build has no
 * deploy-time secrets); warned about, not thrown, since the app can't boot
 * without them anyway.
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
 * Emits the Cloudflare `_headers` file. Generated, not committed, because
 * connect-src must name the build-time Supabase and Worker origins.
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
                // Never legitimately framed. X-Frame-Options below is the pre-CSP equivalent.
        "frame-ancestors 'none'",
        "form-action 'self'",
                // No inline scripts: session tokens live in localStorage, so script
                // injection is account takeover. This is the directive that matters.
        "script-src 'self'",
        // Inline styles are required: React style={{…}} attributes compile to
        // style attributes, which style-src governs.
        "style-src 'self' 'unsafe-inline'",
        // blob: for photo object URLs (PhotoViewer, PhotoCapture previews).
        "img-src 'self' blob: data:",
                // blob: for condition-video playback and preview (a live srcObject stream isn't gated by media-src).
        "media-src 'self' blob:",
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
                // Photos use <input capture>; the condition video uses getUserMedia
                // (camera=(self)). It records without audio, so the microphone stays off.
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
                    // Own file with the mark in the inner 60%, so a circular launcher mask doesn't slice the frame.
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
                // App-shell caching only. API responses are never cached, so nobody sees
                // stale records; the offline queue covers connectivity gaps.
        // Rubik: only the three scripts the app ships in (Hebrew, Cyrillic, Latin).
        globPatterns: ['**/*.{js,css,html,svg,png,ico}', '**/rubik-{latin,hebrew,cyrillic}-wght-normal-*.woff2'],
      },
    }),
  ],
});
