/**
 * The cross-module event catalogue.
 *
 * Modules must not read each other's tables. When one domain needs to react to
 * something that happened in another, it subscribes here. Adding an event is
 * the explicit, reviewable way to couple two modules.
 */
export type DomainEventMap = {
  "supplier.created": { supplierId: string; supplierCode: string; legalName: string };
  "supplier.status_changed": { supplierId: string; from: string; to: string };
  "supplier.risk_alert_raised": {
    supplierId: string;
    alertId: string;
    eventType: string;
    severity: string;
    headline: string;
  };
  "contract.created": { contractId: string; supplierId: string; value: number | null };
  "contract.expiring": { contractId: string; supplierId: string; daysRemaining: number };
  "contract.signed": { contractId: string; supplierId: string };
  "spend.requisition_submitted": { requisitionId: string; requesterId: string; amount: number };
  "spend.po_issued": { purchaseOrderId: string; supplierId: string; amount: number };
  "spend.invoice_matched": { invoiceId: string; purchaseOrderId: string; variance: number };
  "spend.invoice_exception": { invoiceId: string; reason: string };
  "auth.session_created": { userId: string; sessionId: string };
  "user_admin.role_assigned": { userId: string; role: string };
};

export type DomainEventName = keyof DomainEventMap;

export type DomainEvent<N extends DomainEventName = DomainEventName> = {
  name: N;
  payload: DomainEventMap[N];
  occurredAt: Date;
};
