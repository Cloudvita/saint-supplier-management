/**
 * SAINT app entry point — wires up tab navigation and mounts every component
 * exactly once. No framework, no virtual DOM: each component owns a fixed
 * DOM region and re-renders only itself in response to store changes.
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});

  function initTabs() {
    const tabsNav = document.getElementById("tabs");
    const buttons = Array.from(tabsNav.querySelectorAll(".tab-btn"));
    const panels = {
      alerts: document.getElementById("panel-alerts"),
      add: document.getElementById("panel-add"),
      suppliers: document.getElementById("panel-suppliers"),
      genie: document.getElementById("panel-genie"),
      rfp: document.getElementById("panel-rfp"),
      admin: document.getElementById("panel-admin"),
    };

    const activate = SAINT.utils.initAriaTabs(tabsNav, buttons, "tab", (key) => {
      Object.entries(panels).forEach(([k, el]) => {
        el.hidden = k !== key;
      });
    });

    activate("alerts");
  }

  function boot() {
    SAINT.components.authGate.init();
    initTabs();
    SAINT.components.alerts.init();
    SAINT.components.form.init();
    SAINT.components.table.init();
    SAINT.components.genie.init();
    SAINT.components.rfp.init();
    SAINT.components.admin.init();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})(window);
