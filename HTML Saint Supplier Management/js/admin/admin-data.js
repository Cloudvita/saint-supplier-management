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

  /**
   * What each role may do.
   *
   * These strings are the vocabulary the whole app checks against
   * (SAINT.adminStore.can). The separation that matters for the contract
   * workflow: a Sourcing Analyst may *draft and submit* a contract but not
   * approve one, and only an approver can turn an approved contract into a
   * purchase order. That is a segregation-of-duties control, so it is data
   * here rather than a condition buried in a component.
   *
   * "*" means every permission (SuperUser only).
   */
  const PERMISSIONS = [
    "suppliers:read",
    "suppliers:write",
    "suppliers:delete",
    "rfp:manage",
    "contracts:read",
    "contracts:write",
    "contracts:submit",
    "contracts:approve",
    "spend:read",
    "spend:issue_po",
    "reports:read",
    "users:manage",
  ];

  const ROLE_PERMISSIONS = {
    "Sourcing Analyst": [
      "suppliers:read",
      "suppliers:write",
      "rfp:manage",
      "contracts:read",
      "contracts:write",
      "contracts:submit",
      "spend:read",
      "reports:read",
    ],
    "Sourcing Operations": [
      "suppliers:read",
      "suppliers:write",
      "contracts:read",
      "contracts:write",
      "contracts:submit",
      "spend:read",
      "reports:read",
    ],
    "Sourcing Lead": [
      "suppliers:read",
      "suppliers:write",
      "rfp:manage",
      "contracts:read",
      "contracts:write",
      "contracts:submit",
      "contracts:approve",
      "spend:read",
      "reports:read",
    ],
    "Sourcing Manager": [
      "suppliers:read",
      "suppliers:write",
      "suppliers:delete",
      "rfp:manage",
      "contracts:read",
      "contracts:write",
      "contracts:submit",
      "contracts:approve",
      "spend:read",
      "spend:issue_po",
      "reports:read",
    ],
    "Chief Procurement Officer": [
      "suppliers:read",
      "suppliers:write",
      "suppliers:delete",
      "rfp:manage",
      "contracts:read",
      "contracts:write",
      "contracts:approve",
      "spend:read",
      "spend:issue_po",
      "reports:read",
    ],
    "Finance Lead": [
      "suppliers:read",
      "contracts:read",
      "contracts:approve",
      "spend:read",
      "spend:issue_po",
      "reports:read",
    ],
  };

  /** Delegation-of-authority ceiling per role, in USD. null = unlimited. */
  const APPROVAL_LIMITS = {
    "Sourcing Analyst": 0,
    "Sourcing Operations": 25000,
    "Sourcing Lead": 100000,
    "Sourcing Manager": 250000,
    "Chief Procurement Officer": null,
    "Finance Lead": 500000,
  };

  function permissionsForRole(role) {
    return ROLE_PERMISSIONS[role] || [];
  }

  function approvalLimitForRole(role) {
    return role in APPROVAL_LIMITS ? APPROVAL_LIMITS[role] : 0;
  }

  function checkSuperUserCredentials(username, password) {
    return username === SUPERUSER_USERNAME && password === SUPERUSER_PASSWORD;
  }

  SAINT.adminData = {
    SUPERUSER_USERNAME,
    ROLE_OPTIONS,
    MAX_USERS,
    PERMISSIONS,
    ROLE_PERMISSIONS,
    APPROVAL_LIMITS,
    permissionsForRole,
    approvalLimitForRole,
    checkSuperUserCredentials,
  };
})(window);
