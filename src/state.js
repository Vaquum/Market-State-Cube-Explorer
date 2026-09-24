(() => {
  "use strict";
  const storageKey = "market-state-cube-explorer:view:v3";
  let widgetState = null;
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved !== null) widgetState = JSON.parse(saved);
  } catch (error) {
    console.warn("Saved explorer state could not be restored.", error);
  }
  window.explorerState = {
    get widgetState() {
      return widgetState;
    },
    async setWidgetState(state) {
      localStorage.setItem(storageKey, JSON.stringify(state));
      widgetState = state;
    },
  };
})();
