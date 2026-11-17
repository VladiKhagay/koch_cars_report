/**
 * `?vp=1` on any URL prints the numbers behind a bottom-edge gap on an iPhone
 * home-screen app, where the layout viewport can end above the screen's bottom.
 * Read them off the phone: if innerHeight is smaller than screen.height by about
 * the gap, the viewport is reported short; nav.bottom shows where the tab bar
 * actually ends. Diagnostic only; nothing links to it.
 */
export function showViewportDebug() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;padding-bottom:env(safe-area-inset-bottom)';
  const box = document.createElement('pre');
  box.style.cssText =
    'position:fixed;top:env(safe-area-inset-top);inset-inline:0;z-index:99999;margin:0;padding:4px 8px;' +
    'font:11px/1.3 monospace;background:rgba(0,0,0,.8);color:#0f0;pointer-events:none;white-space:pre-wrap';
  const render = () => {
    const nav = document.querySelector('nav[aria-label]:not([class*="flex-col"])');
    const navBottom = nav ? Math.round(nav.getBoundingClientRect().bottom) : 'n/a';
    box.textContent = [
      `innerH ${window.innerHeight}  visualVP ${Math.round(window.visualViewport?.height ?? 0)}`,
      `clientH ${document.documentElement.clientHeight}  screenH ${screen.height}  availH ${screen.availHeight}`,
      `safe-bottom ${parseFloat(getComputedStyle(probe).paddingBottom) || 0}  nav.bottom ${navBottom}`,
      `standalone ${(navigator as Navigator & { standalone?: boolean }).standalone ?? matchMedia('(display-mode: standalone)').matches}`,
    ].join('\n');
  };
  document.body.append(probe, box);
  render();
  addEventListener('resize', render);
  window.visualViewport?.addEventListener('resize', render);
  setInterval(render, 1000);
}
