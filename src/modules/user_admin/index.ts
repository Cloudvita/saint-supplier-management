/**
 * `/user-admin` — RBAC, user provisioning, team hierarchies and the
 * delegation-of-authority limits that `/spend` enforces.
 *
 * Owns tables: users, roles, teams.
 * Public surface only — never import `@/modules/user_admin/schema` elsewhere.
 */
export {
  listUsers,
  getUser,
  getUserByUserName,
  getEffectiveAuthorisation,
  createUser,
  updateUser,
  deleteUser,
  listRoles,
  syncRoleCatalogue,
  listTeams,
  createTeam,
  getTeamSubtree,
  getUserStats,
} from "./services/user.service";

export {
  PERMISSIONS,
  ROLE_DEFINITIONS,
  ROLE_KEYS,
  findRoleDefinition,
  type Permission,
  type RoleDefinition,
} from "./domain/permissions";

export {
  createUserSchema,
  updateUserSchema,
  createTeamSchema,
  userViewSchema,
  userStatuses,
  type CreateUserInput,
  type UpdateUserInput,
  type CreateTeamInput,
  type UserView,
} from "./domain/validation";

export type { User, Role, Team } from "./schema";

export { userAdminAgentTools } from "./agent-tools";
