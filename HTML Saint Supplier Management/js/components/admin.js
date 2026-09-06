/**
 * SAINT.components.admin — User Administration tab content. Login itself is
 * now handled globally by js/components/auth-gate.js (the whole app is
 * gated); this component only decides, for whoever is already logged in,
 * whether they're SuperUser (full add/edit access) or a regular managed
 * user (read-only "not authorized" message).
 *
 * One shared form serves both add and edit — clicking a roster card's
 * "Edit" button switches it into edit mode (pre-filled, `editingId` set);
 * Cancel/successful Submit switches it back to add mode.
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});
  SAINT.components = SAINT.components || {};
  const { escapeHtml, formatDateTime } = SAINT.utils;
  const { ROLE_OPTIONS, MAX_USERS } = SAINT.adminData;

  const ROLE_CHIP_CLASS = {
    "Sourcing Analyst": "chip-slate",
    "Sourcing Operations": "chip-violet",
    "Sourcing Lead": "chip-saint",
    "Sourcing Manager": "chip-emerald",
    "Chief Procurement Officer": "chip-amber",
    "Finance Lead": "chip-orange",
  };

  function userCard(u) {
    return `
      <div class="vendor-card">
        <h4>👤 ${escapeHtml(u.firstName)} ${escapeHtml(u.lastName)}</h4>
        <p class="muted" style="font-size:12px; margin:0 0 4px;">${escapeHtml(u.dept)}</p>
        <p class="mono" style="font-size:11px; margin:0 0 8px;">login: ${escapeHtml(u.userId)}</p>
        <span class="chip ${ROLE_CHIP_CLASS[u.role] || "chip-slate"}">${escapeHtml(u.role)}</span>
        <p class="muted mt-2" style="font-size:11px;">Added ${escapeHtml(formatDateTime(u.createdAt))}</p>
        <button type="button" class="btn-ghost btn-sm mt-2" data-action="edit-user" data-id="${escapeHtml(u.id)}">Edit</button>
      </div>
    `;
  }

  function init() {
    const unauthorizedMount = document.getElementById("admin-unauthorized-mount");
    const adminPanel = document.getElementById("admin-panel");
    const userCountLabel = document.getElementById("admin-user-count-label");

    const formTitle = document.getElementById("admin-form-title");
    const userForm = document.getElementById("admin-user-form");
    const firstNameEl = document.getElementById("admin-firstName");
    const lastNameEl = document.getElementById("admin-lastName");
    const deptEl = document.getElementById("admin-dept");
    const roleEl = document.getElementById("admin-role");
    const userIdEl = document.getElementById("admin-userId");
    const userPasswordEl = document.getElementById("admin-userPassword");
    const formFlash = document.getElementById("admin-form-flash");
    const submitBtn = document.getElementById("admin-submit-btn");
    const cancelBtn = document.getElementById("admin-cancel-btn");
    const listMount = document.getElementById("admin-user-list-mount");

    let editingId = null; // null = add mode; otherwise the user id being edited

    // Populate the role dropdown once from the shared option list.
    ROLE_OPTIONS.forEach((role) => {
      const opt = document.createElement("option");
      opt.value = role;
      opt.textContent = role;
      roleEl.appendChild(opt);
    });

    function clearFieldErrors() {
      userForm.querySelectorAll("[data-error-for]").forEach((el) => (el.textContent = ""));
    }

    function showFieldErrors(errors) {
      clearFieldErrors();
      Object.entries(errors).forEach(([key, msg]) => {
        const el = userForm.querySelector(`[data-error-for="${key}"]`);
        if (el) el.textContent = msg;
      });
    }

    // Disables the add/edit fields once at the 10-user cap — but only in add
    // mode; editing an existing user never adds a new one, so it should stay
    // enabled even at cap. Re-run this whenever `editingId` changes (entering
    // or leaving edit mode), not just when the user list itself mutates.
    function updateCapState() {
      const atCap = SAINT.adminStore.listUsers().length >= MAX_USERS && editingId === null;
      [firstNameEl, lastNameEl, deptEl, roleEl, userIdEl, userPasswordEl, submitBtn].forEach((el) => (el.disabled = atCap));
      if (atCap) {
        formFlash.innerHTML = `<div class="flash flash-err">Maximum of ${MAX_USERS} users reached. Edit an existing user, or this build doesn't yet support removing one.</div>`;
      }
    }

    function resetToAddMode() {
      editingId = null;
      userForm.reset();
      clearFieldErrors();
      formFlash.innerHTML = "";
      formTitle.textContent = "Add New User";
      updateCapState();
    }

    function enterEditMode(user) {
      editingId = user.id;
      firstNameEl.value = user.firstName;
      lastNameEl.value = user.lastName;
      deptEl.value = user.dept;
      roleEl.value = user.role;
      userIdEl.value = user.userId;
      userPasswordEl.value = user.password;
      clearFieldErrors();
      formFlash.innerHTML = "";
      formTitle.textContent = `Editing: ${user.firstName} ${user.lastName}`;
      updateCapState();
      firstNameEl.focus();
    }

    function renderRoster() {
      const users = SAINT.adminStore.listUsers();
      userCountLabel.textContent = `(${users.length}/${MAX_USERS})`;

      listMount.innerHTML =
        users.length === 0
          ? `<div class="card empty">No users yet. Add one above.</div>`
          : `<div class="grid grid-3">${users.map(userCard).join("")}</div>`;

      updateCapState();
    }

    function render() {
      const isSuperUser = SAINT.adminStore.isSuperUser();
      adminPanel.hidden = !isSuperUser;

      if (isSuperUser) {
        unauthorizedMount.innerHTML = "";
        renderRoster();
        return;
      }

      const identity = SAINT.adminStore.getIdentity();
      unauthorizedMount.innerHTML = identity
        ? `<div class="card empty">Only SuperUser can add or edit users. You're logged in as <strong>${escapeHtml(identity.firstName)} ${escapeHtml(identity.lastName)}</strong> (${escapeHtml(identity.role)}).</div>`
        : "";
    }

    /* -------------------- add / edit user -------------------- */
    userForm.addEventListener("submit", (e) => {
      e.preventDefault();
      clearFieldErrors();

      const fields = {
        firstName: firstNameEl.value,
        lastName: lastNameEl.value,
        dept: deptEl.value,
        role: roleEl.value,
        userId: userIdEl.value,
        password: userPasswordEl.value,
      };

      const result = editingId ? SAINT.adminStore.updateUser(editingId, fields) : SAINT.adminStore.addUser(fields);

      if (!result.ok) {
        if (result.limitReached) {
          formFlash.innerHTML = `<div class="flash flash-err">Maximum of ${MAX_USERS} users reached.</div>`;
        } else {
          showFieldErrors(result.errors);
          formFlash.innerHTML = `<div class="flash flash-err">Please fix the highlighted fields.</div>`;
        }
        return;
      }

      formFlash.innerHTML = `<div class="flash flash-ok">${editingId ? "Updated" : "Added"} ${escapeHtml(result.user.firstName)} ${escapeHtml(result.user.lastName)} — login ID <strong>${escapeHtml(result.user.userId)}</strong>.</div>`;
      const savedFlash = formFlash.innerHTML;
      resetToAddMode();
      formFlash.innerHTML = savedFlash; // resetToAddMode() clears the flash — restore the confirmation after
    });

    cancelBtn.addEventListener("click", resetToAddMode);

    listMount.addEventListener("click", (e) => {
      const btn = e.target.closest('[data-action="edit-user"]');
      if (!btn) return;
      const user = SAINT.adminStore.getUser(btn.dataset.id);
      if (user) enterEditMode(user);
    });

    render();
    SAINT.adminStore.subscribe(render);
  }

  SAINT.components.admin = { init };
})(window);
