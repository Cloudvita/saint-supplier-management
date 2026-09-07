/**
 * SAINT.spendAgent — the Spend Management AI Agent.
 *
 * It drafts purchase requisitions automatically and stops there. A requisition
 * commits nothing and reaches no supplier; a person approves it, which creates
 * the purchase order, and a person then sends that order. The agent never
 * touches a vendor.
 *
 * That boundary is the whole design. An agent that could issue a PO could
 * commit company money to an outside party with no human in the loop, so the
 * capability simply is not wired: `spendStore.createRequisition` is the only
 * write it can reach, and `approveRequisition` is what creates the order.
 *
 * When it proposes a requisition
 * ------------------------------
 * For each approved contract, using only what the record already says:
 *
 *  - **Unused contract.** Approved, live, and no purchase order raised yet —
 *    the contract was negotiated to be used.
 *  - **Expiring with headroom left.** Inside the 60-day expiry window with
 *    budget unspent; either draw it down or knowingly let it lapse.
 *  - **Depleted contract.** Over 85% committed while months still remain — a
 *    variation is likely needed, so this one is raised as a flag rather than a
 *    drawdown.
 *
 * Every proposal is sized against *available* headroom, which already nets off
 * other pending requisitions, so the agent cannot over-request by running twice.
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});

  const EXPIRY_WINDOW_DAYS = 60;
  /** Fraction of remaining headroom a routine drawdown asks for. */
  const DRAWDOWN_FRACTION = 0.25;
  /** Below this, a proposal is not worth a person's attention. */
  const MIN_PROPOSAL_VALUE = 1000;
  const DEPLETION_THRESHOLD = 0.85;

  const round2 = (n) => Math.round(n * 100) / 100;

  function categoryFor(contract) {
    const supplier = SAINT.store.getSupplier(contract.supplierId);
    return (supplier && supplier.category) || contract.contractType || "Uncategorised";
  }

  /**
   * Decide what, if anything, to propose for one contract.
   *
   * Pure — it returns proposals, it does not write them. `runScan` owns
   * persistence, which keeps the rule set testable on its own.
   */
  function assess(contract, now) {
    if (contract.status !== "APPROVED" && contract.status !== "ACTIVE") return [];

    const headroom = SAINT.spendStore.contractHeadroom(contract.id);
    if (!headroom || headroom.available === null) return [];

    const available = headroom.available;
    const days = SAINT.contractAgent.daysUntil(contract.expiryDate, now);
    const orders = SAINT.spendStore.listOrders({ contractId: contract.id });
    const liveOrders = orders.filter((o) => o.status !== "CANCELLED");
    const committedShare = contract.totalValue ? headroom.committed / contract.totalValue : 0;

    // Nothing left to request against.
    if (available < MIN_PROPOSAL_VALUE) {
      if (committedShare >= DEPLETION_THRESHOLD && days !== null && days > EXPIRY_WINDOW_DAYS) {
        return [
          {
            kind: "DEPLETION",
            dedupeKey: `depletion:${contract.id}`,
            contractId: contract.id,
            amount: null,
            rationale: `Contract ${contract.contractNumber} is ${Math.round(
              committedShare * 100
            )}% committed with ${days} days still to run. A contract variation is likely needed before further spend.`,
          },
        ];
      }
      return [];
    }

    // Expiring with money left on the table.
    if (days !== null && days >= 0 && days <= EXPIRY_WINDOW_DAYS) {
      return [
        {
          kind: "EXPIRING_HEADROOM",
          dedupeKey: `expiring-drawdown:${contract.id}:${contract.expiryDate}`,
          contractId: contract.id,
          amount: round2(Math.min(available, available * 0.5)),
          rationale: `Contract ${contract.contractNumber} expires in ${days} day${
            days === 1 ? "" : "s"
          } with ${headroom.currency} ${available.toLocaleString()} uncommitted. Draw it down or let it lapse deliberately.`,
        },
      ];
    }

    // Approved but never used.
    if (liveOrders.length === 0) {
      return [
        {
          kind: "UNUSED_CONTRACT",
          dedupeKey: `unused:${contract.id}`,
          contractId: contract.id,
          amount: round2(Math.max(MIN_PROPOSAL_VALUE, available * DRAWDOWN_FRACTION)),
          rationale: `Contract ${contract.contractNumber} was approved but no purchase order has been raised against it. Proposing an initial drawdown of ${Math.round(
            DRAWDOWN_FRACTION * 100
          )}% of the available value.`,
        },
      ];
    }

    return [];
  }

  const DESCRIPTIONS = {
    UNUSED_CONTRACT: (c) => `Initial drawdown against ${c.contractNumber} — ${c.title}`,
    EXPIRING_HEADROOM: (c) => `Pre-expiry drawdown against ${c.contractNumber} — ${c.title}`,
  };

  /**
   * Scan approved contracts and raise requisitions for human approval.
   *
   * Returns a summary; a contract that cannot be turned into a valid
   * requisition is counted as skipped rather than aborting the run.
   */
  function runScan({ now = new Date() } = {}) {
    const contracts = SAINT.contractStore.approvedContracts();
    let raised = 0;
    let suppressed = 0;
    let flagged = 0;
    const items = [];

    contracts.forEach((contract) => {
      assess(contract, now).forEach((proposal) => {
        // A depletion finding is advice, not a request — it carries no amount,
        // so it goes to the contract notification stream instead.
        if (proposal.amount === null) {
          const res = SAINT.contractStore.raiseNotification({
            kind: "SPEND_DEPLETION",
            contractId: contract.id,
            dedupeKey: proposal.dedupeKey,
            severity: "MEDIUM",
            title: `${contract.contractNumber} is nearly fully committed`,
            detail: proposal.rationale,
            recipient: contract.approvedBy || contract.createdBy,
          });
          if (res.ok) flagged++;
          else suppressed++;
          return;
        }

        const describe = DESCRIPTIONS[proposal.kind] || ((c) => `Requisition against ${c.contractNumber}`);
        const result = SAINT.spendStore.createRequisition(
          {
            contractId: contract.id,
            description: describe(contract),
            amount: proposal.amount,
            category: categoryFor(contract),
            needByDate: contract.expiryDate || "",
          },
          "Spend AI Agent",
          { dedupeKey: proposal.dedupeKey, rationale: proposal.rationale }
        );

        if (result.ok) {
          raised++;
          items.push(result.requisition);
        } else {
          suppressed++;
        }
      });
    });

    return {
      at: now.toISOString(),
      contractsScanned: contracts.length,
      raised,
      suppressed,
      flagged,
      items,
    };
  }

  SAINT.spendAgent = {
    EXPIRY_WINDOW_DAYS,
    DRAWDOWN_FRACTION,
    MIN_PROPOSAL_VALUE,
    DEPLETION_THRESHOLD,
    assess,
    runScan,
  };
})(window);
