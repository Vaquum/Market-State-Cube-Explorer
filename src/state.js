(() => {
  "use strict";
  const storageKey = "market-state-cube-explorer:view:v4";
  let saved = null;
  try {
    const text = localStorage.getItem(storageKey);
    if (text !== null) saved = JSON.parse(text);
  } catch (error) {
    console.warn("Saved explorer view could not be restored.", error);
  }
  window.explorerState = {
    get saved() {
      return saved;
    },
    save(view) {
      localStorage.setItem(storageKey, JSON.stringify(view));
      saved = view;
    },
  };
})();
