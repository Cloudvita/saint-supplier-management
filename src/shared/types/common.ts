/** Cursor-free pagination envelope used by every module's list endpoint. */
export type Paginated<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type ListParams = {
  q?: string;
  limit?: number;
  offset?: number;
};

/** Shared risk vocabulary — suppliers, contracts and spend all grade risk the same way. */
export const RISK_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type RiskSeverity = (typeof RISK_SEVERITIES)[number];

export const SEVERITY_RANK: Record<RiskSeverity, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export const CADENCES = ["DAILY", "WEEKLY", "MONTHLY"] as const;
export type Cadence = (typeof CADENCES)[number];

export const CURRENCIES = ["USD", "EUR", "GBP", "INR", "CAD", "AUD"] as const;
