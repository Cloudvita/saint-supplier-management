/**
 * SAINT.components.authGate — the whole app's login screen and session
 * chrome. Nothing in `#app-shell` (the tab bar + all panels) is shown until
 * SAINT.adminStore reports a logged-in identity; this component owns that
 * toggle plus the header's "logged in as X" + Log Out control.
 *
 * Every other component still initializes normally at boot regardless of
 * login state — they just aren't visible until this component reveals
 * `#app-shell`. See js/admin/admin-store.js for what "logged in" actually
 * checks (SuperUser, or any admin-created user's own credentials) and the
 * security caveat (this is a demo gate, not real auth).
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});
  SAINT.components = SAINT.components || {};
  const { escapeHtml } = SAINT.utils;

  function init() {
    const authGate = document.getElementById("auth-gate");
    const appShell = document.getElementById("app-shell");
    const loginForm = document.getElementById("login-form");
    const userIdEl = document.getElementById("login-userId");
    const passwordEl = document.getElementById("login-password");
    const loginFlash = document.getElementById("login-flash");
    const sessionInfo = document.getElementById("header-session-info");

    function render() {
      const loggedIn = SAINT.adminStore.isLoggedIn();
      authGate.hidden = loggedIn;
      appShell.hidden = !loggedIn;

      if (!loggedIn) {
        sessionInfo.innerHTML = "";
        return;
      }

      const identity = SAINT.adminStore.getIdentity();
      const label =
        identity.kind === "superuser" ? "SuperUser" : `${identity.firstName} ${identity.lastName} (${identity.role})`;
      sessionInfo.innerHTML = `Logged in as <strong>${escapeHtml(label)}</strong> &middot; <button type="button" class="btn-link" id="header-logout-btn">Log Out</button>`;

      document.getElementById("header-logout-btn").addEventListener("click", () => {
        SAINT.adminStore.logout();
        userIdEl.value = "";
        passwordEl.value = "";
        loginFlash.innerHTML = "";
      });
    }

    loginForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const result = SAINT.adminStore.login(userIdEl.value, passwordEl.value);
      if (!result.ok) {
        loginFlash.innerHTML = `<div class="flash flash-err">${escapeHtml(result.error)}</div>`;
        return;
      }
      loginFlash.innerHTML = "";
      passwordEl.value = "";
      render();
    });

    render();
    SAINT.adminStore.subscribe(render);
  }

  SAINT.components.authGate = { init };
})(window);
