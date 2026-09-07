/**
 * SAINT.adminStore — the whole app's login/identity state, plus the
 * managed-user roster (max 10) that SuperUser maintains. Same Map + pub/sub
 * shape as the other stores in this app; the roster is persisted to
 * localStorage since the dataset is tiny and bounded (10 users, unlike
 * suppliers which motivated the move to IndexedDB).
 *
 * Login accepts either the hardcoded SuperUser account or any managed
 * user's own userId/password (assigned by SuperUser when the account was
 * created). The current identity is stored in sessionStorage — it survives
 * a page refresh within the same tab, but not closing the tab — as
 * `{ kind: "superuser" }` or `{ kind: "user", id, firstName, lastName, role }`.
 *
 * SECURITY NOTE: passwords are stored in plain text (there is no backend to
 * hash them against, and no secret this static build could hash *with*
 * even if it tried) and the whole check runs in public, readable
 * JavaScript. This is a demo of the workflow, not a real access boundary —
 * see README before using this for anything beyond a demo.
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});
  const { createId, deepClone, debounce } = SAINT.utils;
  const {
    ROLE_OPTIONS,
    MAX_USERS,
    SUPERUSER_USERNAME,
    checkSuperUserCredentials,
    permissionsForRole,
    approvalLimitForRole,
  } = SAINT.adminData;

  const USERS_KEY = "saint.admin.users.v1";
  const SESSION_KEY = "saint.admin.session.v1";

  function safeParse(json, fallback) {
    if (!json) return fallback;
    try {
      return JSON.parse(json) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function createAdminStore() {
    /** @type {Map<string, object>} */
    const users = new Map();
    let identity = null; // null | { kind: "superuser" } | { kind: "user", id, firstName, lastName, role }
    const listeners = new Set();

    function notify() {
      Array.from(listeners).forEach((fn) => {
        try {
          fn();
        } catch (err) {
          console.error("SAINT.adminStore listener failed", err);
        }
      });
    }

    function subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }

    function persist() {
      try {
        localStorage.setItem(USERS_KEY, JSON.stringify(Array.from(users.values())));
      } catch (err) {
        console.warn("SAINT.adminStore: persistence failed, continuing in-memory only", err);
      }
    }
    const persistDebounced = debounce(persist, 250);

    function load() {
      const stored = safeParse(localStorage.getItem(USERS_KEY), []);
      if (Array.isArray(stored)) stored.forEach((u) => users.set(u.id, u));
      try {
        identity = safeParse(sessionStorage.getItem(SESSION_KEY), null);
      } catch {
        identity = null;
      }
    }

    /* ------------------------- session / identity ------------------------- */

    function isLoggedIn() {
      return identity !== null;
    }

    function isSuperUser() {
      return identity !== null && identity.kind === "superuser";
    }

    function getIdentity() {
      return identity ? deepClone(identity) : null;
    }

    function setSessionIdentity(next) {
      identity = next;
      try {
        if (next) sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
        else sessionStorage.removeItem(SESSION_KEY);
      } catch {
        /* session won't survive a refresh if sessionStorage is unavailable — still works for this tab load */
      }
    }

    /** Accepts either the SuperUser account or any managed user's own
     * userId/password. Both use the same login form — there's no separate
     * "admin login" anymore now that individual users have real accounts. */
    function login(userId, password) {
      const cleanId = (userId || "").trim();

      if (checkSuperUserCredentials(cleanId, password)) {
        setSessionIdentity({ kind: "superuser" });
        notify();
        return { ok: true, identity: getIdentity() };
      }

      const match = Array.from(users.values()).find((u) => u.userId === cleanId && u.password === password);
      if (!match) {
        return {
          ok: false,
          error: "Incorrect user ID or password. Check with your admin if your user ID hasn't been created yet.",
        };
      }

      setSessionIdentity({ kind: "user", id: match.id, firstName: match.firstName, lastName: match.lastName, role: match.role });
      notify();
      return { ok: true, identity: getIdentity() };
    }

    function logout() {
      setSessionIdentity(null);
      notify();
    }

    /* ---------------------- authorisation ------------------------ */

    /** Permissions held by whoever is signed in right now. */
    function currentPermissions() {
      const identity = getIdentity();
      if (!identity) return [];
      if (identity.kind === "superuser") return ["*"];
      return permissionsForRole(identity.role);
    }

    /**
     * Can the signed-in user do this?
     *
     * Every guarded action in the app routes through here, so the rule lives
     * in one place instead of being re-derived from the role string at each
     * call site. Fails closed: nobody signed in means no permission.
     */
    function can(permission) {
      const held = currentPermissions();
      return held.includes("*") || held.includes(permission);
    }

    /** Delegation-of-authority ceiling for the signed-in user; null = unlimited. */
    function currentApprovalLimit() {
      const identity = getIdentity();
      if (!identity) return 0;
      if (identity.kind === "superuser") return null;
      return approvalLimitForRole(identity.role);
    }

    /** Display name for audit trails ("Created by…", "Approved by…"). */
    function currentActorName() {
      const identity = getIdentity();
      if (!identity) return "Unknown";
      if (identity.kind === "superuser") return "SuperUser";
      return `${identity.firstName} ${identity.lastName}`;
    }

    function currentActorRole() {
      const identity = getIdentity();
      if (!identity) return "—";
      return identity.kind === "superuser" ? "Super User" : identity.role;
    }

    /* -------------------------- users ---------------------------- */

    function listUsers() {
      return Array.from(users.values())
        .map(deepClone)
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    }

    function getUser(id) {
      const u = users.get(id);
      return u ? deepClone(u) : null;
    }

    function userIdTaken(userId, excludingId) {
      const normalized = (userId || "").trim();
      if (normalized.toLowerCase() === SUPERUSER_USERNAME.toLowerCase()) return true; // reserved
      return Array.from(users.values()).some((u) => u.id !== excludingId && u.userId === normalized);
    }

    function validate({ firstName, lastName, dept, role, userId, password }, excludingId) {
      const errors = {};
      const cleanFirst = (firstName || "").trim().slice(0, 60);
      const cleanLast = (lastName || "").trim().slice(0, 60);
      const cleanDept = (dept || "").trim().slice(0, 100);
      const cleanUserId = (userId || "").trim().slice(0, 40);
      const cleanPassword = (password || "").slice(0, 100);

      if (!cleanFirst) errors.firstName = "First name is required.";
      if (!cleanLast) errors.lastName = "Last name is required.";
      if (!cleanDept) errors.dept = "Department is required.";
      if (!ROLE_OPTIONS.includes(role)) errors.role = "Select a role.";

      if (!cleanUserId) errors.userId = "User ID is required.";
      else if (userIdTaken(cleanUserId, excludingId)) errors.userId = "That user ID is already taken.";

      if (!cleanPassword || cleanPassword.length < 4) errors.password = "Password must be at least 4 characters.";

      return {
        valid: Object.keys(errors).length === 0,
        errors,
        data: { firstName: cleanFirst, lastName: cleanLast, dept: cleanDept, role, userId: cleanUserId, password: cleanPassword },
      };
    }

    function addUser(fields) {
      if (users.size >= MAX_USERS) {
        return { ok: false, errors: {}, limitReached: true };
      }
      const { valid, errors, data } = validate(fields, null);
      if (!valid) return { ok: false, errors };

      const id = createId();
      const record = { id, ...data, createdAt: new Date().toISOString() };
      users.set(id, record);
      persistDebounced();
      notify();
      return { ok: true, user: deepClone(record) };
    }

    function updateUser(id, fields) {
      const existing = users.get(id);
      if (!existing) return { ok: false, errors: { firstName: "User not found." } };

      const { valid, errors, data } = validate(fields, id);
      if (!valid) return { ok: false, errors };

      Object.assign(existing, data);
      persistDebounced();
      notify();
      return { ok: true, user: deepClone(existing) };
    }

    load();

    return {
      subscribe,
      isLoggedIn,
      isSuperUser,
      getIdentity,
      login,
      logout,
      listUsers,
      getUser,
      addUser,
      updateUser,
      can,
      currentPermissions,
      currentApprovalLimit,
      currentActorName,
      currentActorRole,
    };
  }

  SAINT.adminStore = createAdminStore();
})(window);
