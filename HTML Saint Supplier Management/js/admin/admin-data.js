/**
 * SAINT.adminData — role options and the SuperUser credential check.
 *
 * IMPORTANT: this is a demo-only, client-side login gate, not real
 * authentication. Everything in this file ships as public JavaScript — the
 * credential check below is trivially readable and bypassable from the
 * browser's dev tools. It exists to demonstrate the User Administration
 * workflow, not to protect anything. See README for what real auth would
 * require (a backend, same as every other "needs a server" feature in this
 * build).
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});

  const SUPERUSER_USERNAME = "SuperUser";
  const SUPERUSER_PASSWORD = "SuperUser";

  const ROLE_OPTIONS = [
    "Sourcing Analyst",
    "Sourcing Operations",
    "Sourcing Lead",
    "Sourcing Manager",
    "Chief Procurement Officer",
    "Finance Lead",
  ];

  const MAX_USERS = 10;

  function checkSuperUserCredentials(username, password) {
    return username === SUPERUSER_USERNAME && password === SUPERUSER_PASSWORD;
  }

  SAINT.adminData = { SUPERUSER_USERNAME, ROLE_OPTIONS, MAX_USERS, checkSuperUserCredentials };
})(window);
