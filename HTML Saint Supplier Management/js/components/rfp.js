/**
 * SAINT.components.rfp — top-level RFP tab: wires the 4-step sub-navigation
 * and mounts each step's component exactly once (each owns its own DOM
 * region from then on, same pattern as the main app.js tab wiring).
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});
  SAINT.components = SAINT.components || {};

  function initSubTabs() {
    const nav = document.getElementById("rfp-subtabs");
    const buttons = Array.from(nav.querySelectorAll(".subtab-btn"));
    const panels = {
      vendors: document.getElementById("rfp-subpanel-vendors"),
      builder: document.getElementById("rfp-subpanel-builder"),
      eval: document.getElementById("rfp-subpanel-eval"),
      dashboard: document.getElementById("rfp-subpanel-dashboard"),
    };

    const activate = SAINT.utils.initAriaTabs(nav, buttons, "subtab", (key) => {
      Object.entries(panels).forEach(([k, el]) => {
        el.hidden = k !== key;
      });
    });

    activate("vendors");
  }

  function init() {
    initSubTabs();
    SAINT.components.rfpVendors.init();
    SAINT.components.rfpBuilder.init();
    SAINT.components.rfpEval.init();
    SAINT.components.rfpDashboard.init();
  }

  SAINT.components.rfp = { init };
})(window);
