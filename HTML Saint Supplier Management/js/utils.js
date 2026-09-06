/**
 * SAINT.utils — small, dependency-free helpers shared across the app.
 * Everything lives on a single global namespace (window.SAINT) so the
 * whole module works as plain <script> tags with no bundler/server and
 * no risk of colliding globals.
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});

  /** Short, URL-safe, sortable-enough id — client-side analogue of the server's createId(). */
  function createId() {
    if (global.crypto && typeof global.crypto.randomUUID === "function") {
      return global.crypto.randomUUID().replace(/-/g, "").slice(0, 24);
    }
    // Fallback for very old browsers without crypto.randomUUID.
    let out = "";
    for (let i = 0; i < 24; i++) out += Math.floor(Math.random() * 16).toString(16);
    return out;
  }

  const ESCAPE_MAP = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };

  /** Escape untrusted text before interpolating into an HTML template string — the only
   * thing standing between user input and stored/reflected XSS in this app. */
  function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value).replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
  }

  function formatDateTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  /** Debounce that always clears its previous timer — avoids the classic
   * "listener fires N times after N calls" leak pattern. */
  function debounce(fn, wait) {
    let timer = null;
    function debounced(...args) {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn.apply(null, args);
      }, wait);
    }
    debounced.cancel = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    return debounced;
  }

  function deepClone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  /** Deterministic-ish pseudo-random generator (mulberry32) seeded from a string.
   * Used only for cosmetic demo-data variety — never for anything security sensitive. */
  function seededRandom(seedStr) {
    let h = 1779033703 ^ seedStr.length;
    for (let i = 0; i < seedStr.length; i++) {
      h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    let a = h >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pick(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
  }

  /**
   * Wires up the ARIA APG "tabs, automatic activation" keyboard pattern:
   * roving tabindex (only the active tab sits in the Tab order; arrow keys
   * move focus within the strip) plus Left/Right/Home/End navigation and
   * click activation. `datasetKey` names the data-* attribute holding each
   * button's tab id (e.g. "tab" for data-tab). `onActivate(key)` does the
   * actual panel show/hide — this helper only owns the tab strip itself.
   * Shared by the main tab bar (js/app.js) and the RFP sub-tab bar
   * (js/components/rfp.js) so the pattern is implemented once, not twice.
   * Returns `activate(key)` so the caller can set the initial tab.
   */
  function initAriaTabs(nav, buttons, datasetKey, onActivate) {
    function activate(key, { focus } = {}) {
      buttons.forEach((b) => {
        const isActive = b.dataset[datasetKey] === key;
        b.setAttribute("aria-selected", String(isActive));
        b.tabIndex = isActive ? 0 : -1;
      });
      onActivate(key);
      if (focus) {
        const btn = buttons.find((b) => b.dataset[datasetKey] === key);
        if (btn) btn.focus();
      }
    }

    nav.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn || !buttons.includes(btn)) return;
      activate(btn.dataset[datasetKey]);
    });

    nav.addEventListener("keydown", (e) => {
      const moves = { ArrowRight: 1, ArrowLeft: -1 };
      const currentIndex = buttons.findIndex((b) => b.getAttribute("aria-selected") === "true");
      if (currentIndex === -1) return;

      let nextIndex = null;
      if (e.key in moves) nextIndex = (currentIndex + moves[e.key] + buttons.length) % buttons.length;
      else if (e.key === "Home") nextIndex = 0;
      else if (e.key === "End") nextIndex = buttons.length - 1;
      if (nextIndex === null) return;

      e.preventDefault();
      activate(buttons[nextIndex].dataset[datasetKey], { focus: true });
    });

    return activate;
  }

  SAINT.utils = { createId, escapeHtml, formatDateTime, debounce, deepClone, seededRandom, pick, initAriaTabs };
})(window);
