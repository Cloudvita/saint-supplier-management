/**
 * The permission catalogue — the vocabulary every module's guards and agent
 * tools check against.
 *
 * Format is `<module>:<capability>`. A grant of `suppliers:*` covers every
 * suppliers permission; `*` covers everything (see `hasPermission` in core).
 */
export const PERMISSIONS = [
  "suppliers:read",
  "suppliers:write",
  "suppliers:admin",
  "contracts:read",
  "contracts:write",
  "contracts:approve",
  "spend:read",
  "spend:write",
  "spend:approve",
  "reports:read",
  "reports:export",
  "user_admin:read",
  "user_admin:write",
  "ai_agents:invoke",
  "ai_agents:admin",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Role definitions, carried over from the procurement roles the platform
 * already used, now with explicit permission sets and a delegation-of-authority
 * limit that `/spend` enforces on every purchase order.
 */
export type RoleDefinition = {
  key: string;
  name: string;
  description: string;
  permissions: string[];
  /** Delegation-of-authority ceiling in USD. null = unlimited. */
  approvalLimit: number | null;
};

export const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    key: "SUPER_USER",
    name: "Super User",
    description: "Platform administrator. Full access including user administration.",
    permissions: ["*"],
    approvalLimit: null,
  },
  {
    key: "CHIEF_PROCUREMENT_OFFICER",
    name: "Chief Procurement Officer",
    description: "Owns the procurement function. Unlimited approval authority.",
    permissions: [
      "suppliers:*",
      "contracts:*",
      "spend:*",
      "reports:*",
      "user_admin:read",
      "ai_agents:invoke",
    ],
    approvalLimit: null,
  },
  {
    key: "SOURCING_MANAGER",
    name: "Sourcing Manager",
    description: "Manages sourcing events and supplier relationships.",
    permissions: [
      "suppliers:read",
      "suppliers:write",
      "contracts:read",
      "contracts:write",
      "contracts:approve",
      "spend:read",
      "spend:write",
      "spend:approve",
      "reports:read",
      "reports:export",
      "ai_agents:invoke",
    ],
    approvalLimit: 250_000,
  },
  {
    key: "SOURCING_LEAD",
    name: "Sourcing Lead",
    description: "Leads category sourcing. Approves mid-value commitments.",
    permissions: [
      "suppliers:read",
      "suppliers:write",
      "contracts:read",
      "contracts:write",
      "spend:read",
      "spend:write",
      "spend:approve",
      "reports:read",
      "ai_agents:invoke",
    ],
    approvalLimit: 100_000,
  },
  {
    key: "SOURCING_OPERATIONS",
    name: "Sourcing Operations",
    description: "Runs day-to-day buying operations and supplier onboarding.",
    permissions: [
      "suppliers:read",
      "suppliers:write",
      "contracts:read",
      "spend:read",
      "spend:write",
      "reports:read",
      "ai_agents:invoke",
    ],
    approvalLimit: 25_000,
  },
  {
    key: "SOURCING_ANALYST",
    name: "Sourcing Analyst",
    description: "Analyses spend and supplier data. Read-mostly.",
    permissions: [
      "suppliers:read",
      "contracts:read",
      "spend:read",
      "reports:read",
      "reports:export",
      "ai_agents:invoke",
    ],
    approvalLimit: 0,
  },
  {
    key: "FINANCE_LEAD",
    name: "Finance Lead",
    description: "Owns budget verification and invoice exception handling.",
    permissions: [
      "suppliers:read",
      "contracts:read",
      "spend:read",
      "spend:write",
      "spend:approve",
      "reports:*",
      "ai_agents:invoke",
    ],
    approvalLimit: 500_000,
  },
];

export const ROLE_KEYS = ROLE_DEFINITIONS.map((r) => r.key);

export function findRoleDefinition(key: string): RoleDefinition | undefined {
  return ROLE_DEFINITIONS.find((r) => r.key === key);
}
