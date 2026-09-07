/**
 * `/contracts` — contract lifecycle, metadata extraction, renewal tracking,
 * clause compliance and e-signature orchestration.
 *
 * Owns tables: contracts, contract_documents, contract_signatures.
 * References suppliers by id only (soft reference); it never reads supplier rows.
 */
export {
  listContracts,
  getContract,
  createContract,
  updateContract,
  deleteContract,
  getExpiringContracts,
  runRenewalSweep,
  applyClauseAudit,
  getActiveContractsForSupplier,
  getContractStats,
  type ContractListFilters,
} from "./services/contract.service";

export {
  intakeContractDocument,
  getContractDocumentUrl,
  type ContractIntakeResult,
} from "./services/document.service";

export { requestSignatures, recordSignature } from "./services/signature.service";

export {
  auditClauses,
  detectClauses,
  MANDATORY_CLAUSES,
  CLAUSE_LABELS,
  type ClauseAudit,
  type ClauseKey,
} from "./domain/clauses";

export {
  extractContractMetadata,
  type ContractMetadata,
  type ContractExtraction,
} from "./domain/metadata";

export {
  contractSchema,
  contractViewSchema,
  signatureRequestSchema,
  contractTypes,
  contractStatuses,
  renewalTypes,
  type ContractInput,
  type ContractView,
  type SignatureRequestInput,
} from "./domain/validation";

export type { Contract, ContractDocument, ContractSignature } from "./schema";

export { contractAgentTools } from "./agent-tools";
