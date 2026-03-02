const VALID_ROUTES = new Set(['sws', 'legacy']);

export function createSwsAdapter(options = {}) {
  const routeByScreen = new Map();

  const getSettingsWindow = options.getSettingsWindow || (() => globalThis?.SettingsWindow || null);
  const openLegacyModal = options.openLegacyModal || ((payload) => globalThis?.UI?.modal?.open?.(payload));

  function setRoute(screenId, route) {
    if (!screenId) throw new Error('setRoute requires screenId');
    if (!VALID_ROUTES.has(route)) throw new Error(`Unsupported route: ${route}`);
    routeByScreen.set(String(screenId), route);
  }

  function getRoute(screenId) {
    return routeByScreen.get(String(screenId)) || 'sws';
  }

  function clearRoute(screenId) {
    if (!screenId) throw new Error('clearRoute requires screenId');
    return routeByScreen.delete(String(screenId));
  }

  function clearAllRoutes() {
    routeByScreen.clear();
  }

  function open(payload = {}) {
    const screenId = String(payload.screenId || 'unknown');
    const preferred = getRoute(screenId);
    const sw = getSettingsWindow();

    if (preferred === 'sws' && sw) {
      if (typeof payload.swsOpen === 'function') {
        payload.swsOpen(sw);
        return { ok: true, channel: 'sws', screenId, mode: 'custom-root' };
      }
      if (typeof sw.push === 'function' && payload.sws) {
        sw.push(payload.sws);
        return { ok: true, channel: 'sws', screenId, mode: 'push' };
      }
    }

    if (payload.legacy) {
      openLegacyModal(payload.legacy);
      return { ok: true, channel: 'legacy', screenId, fallback: preferred !== 'legacy' };
    }

    return {
      ok: false,
      channel: 'none',
      screenId,
      error: 'No available channel (missing sws or legacy payload).'
    };
  }

  function getHealth() {
    const sw = getSettingsWindow();
    return {
      hasSettingsWindow: !!sw,
      canPushSws: typeof sw?.push === 'function',
      hasLegacyModalOpen: typeof openLegacyModal === 'function',
      routesCount: routeByScreen.size
    };
  }

  return {
    setRoute,
    getRoute,
    clearRoute,
    clearAllRoutes,
    open,
    getHealth,
    getRoutesSnapshot: () => Object.fromEntries(routeByScreen.entries())
  };
}
