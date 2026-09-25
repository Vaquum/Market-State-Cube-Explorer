(() => {
  "use strict";
  // Browser storage for the explorer. This browser keeps the workspace, the last view and the
  // named views for every tab; each tab keeps its own history. Storage can be unavailable
  // (private windows, blocked site data): reads then come back empty and writes throw.
  const prefix = "market-state-cube-explorer:";
  const read = (area, key) => {
    try {
      const text = window[area].getItem(prefix + key);
      return text === null ? null : JSON.parse(text);
    } catch (error) {
      console.warn(`The explorer's saved ${key} could not be read.`, error);
      return null;
    }
  };
  const write = (area, key, value) =>
    window[area].setItem(prefix + key, JSON.stringify(value));
  window.explorerState = {
    // Version 4 kept the workspace and the view in one object; version 5 splits them.
    saved: read("localStorage", "view:v5") || read("localStorage", "view:v4"),
    save: (state) => write("localStorage", "view:v5", state),
    views: () => read("localStorage", "views:v1"),
    saveViews: (list) => write("localStorage", "views:v1", list),
    viewsKey: prefix + "views:v1",
    history: () => read("sessionStorage", "history:v1"),
    saveHistory: (history) => write("sessionStorage", "history:v1", history),
  };
})();
