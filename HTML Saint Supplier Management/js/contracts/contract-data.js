/**
 * SAINT.contractData — contract vocabulary, the clause risk rules, and demo
 * seed records.
 *
 * The rules are deterministic keyword rules rather than an LLM call, for the
 * same reason as the RFP generator and the W-9 bot: this is a static build
 * with no backend to hold an API key. That is not purely a constraint — a
 * compliance finding that says "this contract cannot go to signature" should
 * be reproducible and explainable, and a keyword rule with a named source is
 * both. See README for wiring a model-backed reviewer in its place.
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});

  const CONTRACT_TYPES = ["MSA", "SOW", "NDA", "RATE_CARD", "LICENCE", "OTHER"];

  /**
   * Lifecycle. The workflow the business asked for is the middle three:
   * an analyst drafts and submits, a manager approves or rejects.
   */
  const CONTRACT_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "ACTIVE", "EXPIRED"];

  const STATUS_LABELS = {
    DRAFT: "Draft",
    PENDING_APPROVAL: "Pending approval",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    ACTIVE: "Active",
    EXPIRED: "Expired",
  };

  const STATUS_CHIPS = {
    DRAFT: "chip-slate",
    PENDING_APPROVAL: "chip-amber",
    APPROVED: "chip-emerald",
    REJECTED: "chip-red",
    ACTIVE: "chip-emerald",
    EXPIRED: "chip-orange",
  };

  const RENEWAL_TYPES = ["MANUAL", "AUTO_RENEW", "NONE"];
  const PAYMENT_TERMS = ["NET15", "NET30", "NET45", "NET60", "NET90", "DUE_ON_RECEIPT"];

  /* ------------------------- clause detection ------------------------- */

  const CLAUSE_RULES = [
    {
      key: "DATA_PRIVACY",
      label: "Data privacy / GDPR",
      patterns: [/\bgdpr\b/i, /data protection/i, /personal data/i, /data processing agreement/i, /\bdpa\b/i, /privacy/i],
    },
    {
      key: "LIMITATION_OF_LIABILITY",
      label: "Limitation of liability",
      patterns: [/limitation of liability/i, /liability (?:shall be |is )?(?:capped|limited)/i, /aggregate liability/i, /consequential damages/i],
    },
    {
      key: "TERMINATION_FOR_CONVENIENCE",
      label: "Termination for convenience",
      patterns: [/termination for convenience/i, /terminate[^.]{0,40}without cause/i, /\d{1,3}\s*days[^.]{0,30}written notice/i],
    },
    { key: "INDEMNIFICATION", label: "Indemnification", patterns: [/indemnif(?:y|ication|ies)/i, /hold harmless/i] },
    { key: "CONFIDENTIALITY", label: "Confidentiality", patterns: [/confidential(?:ity)?/i, /non[- ]disclosure/i, /proprietary information/i] },
    { key: "SLA", label: "Service levels", patterns: [/service level/i, /\bsla\b/i, /uptime/i, /service credits?/i, /response time/i] },
    { key: "AUDIT_RIGHTS", label: "Audit rights", patterns: [/right to audit/i, /audit rights/i, /books and records/i] },
    { key: "INSURANCE", label: "Insurance", patterns: [/insurance/i, /certificate of insurance/i] },
    { key: "FORCE_MAJEURE", label: "Force majeure", patterns: [/force majeure/i, /acts? of god/i] },
    { key: "GOVERNING_LAW", label: "Governing law", patterns: [/governing law/i, /governed by the laws/i, /jurisdiction/i] },
    { key: "IP_OWNERSHIP", label: "IP ownership", patterns: [/intellectual property/i, /work (?:made )?for hire/i, /ownership of deliverables/i] },
    { key: "PRICE_ESCALATION", label: "Price escalation", patterns: [/price (?:increase|escalation|adjustment)/i, /\bcpi\b/i, /annual uplift/i] },
  ];

  /**
   * Clauses a contract must carry before it can be approved. Missing any one
   * of these is a blocking finding, not advice — the approval action refuses.
   */
  const MANDATORY_CLAUSES = ["DATA_PRIVACY", "LIMITATION_OF_LIABILITY", "TERMINATION_FOR_CONVENIENCE"];

  const CLAUSE_LABELS = CLAUSE_RULES.reduce((acc, r) => {
    acc[r.key] = r.label;
    return acc;
  }, {});

  function detectClauses(text) {
    return CLAUSE_RULES.filter((rule) => rule.patterns.some((p) => p.test(text))).map((r) => r.key);
  }

  /** Non-standard commercial terms worth a human read before signature. */
  function detectRiskFlags(text, contract) {
    const flags = [];
    const add = (severity, title, detail) => flags.push({ severity, title, detail });

    if (/auto(?:matically)?[- ]renew/i.test(text) && !/termination for convenience/i.test(text)) {
      add("HIGH", "Auto-renewal without an exit", "The agreement renews automatically but grants no termination-for-convenience right. Exiting may require cause or waiting out the term.");
    }
    if (/unlimited liability|liability[^.]{0,40}not[^.]{0,20}limited|no cap on liability/i.test(text)) {
      add("CRITICAL", "Uncapped liability", "Liability appears not to be capped. Legal review is required before signature.");
    }
    if (/exclusiv(?:e|ity)/i.test(text)) {
      add("MEDIUM", "Exclusivity commitment", "An exclusivity obligation creates single-source dependency. Confirm there is a contingency supplier.");
    }
    const longTerms = text.match(/\bnet\s*(60|75|90|120)\b/i);
    if (longTerms) add("LOW", `Payment terms ${longTerms[0].toUpperCase()}`, "Longer than the NET30 standard. Confirm this was negotiated deliberately.");

    if (/perpetual/i.test(text) && /licen[cs]e/i.test(text)) {
      add("MEDIUM", "Perpetual licence grant", "A perpetual grant survives termination. Confirm the scope is intended.");
    }
    if (/assign[^.]{0,40}without[^.]{0,20}consent/i.test(text)) {
      add("MEDIUM", "Assignment without consent", "The counterparty may transfer the agreement without approval, including to a competitor.");
    }
    // Matches both "8% annual increase" and "price increase of 8%".
    const esc =
      text.match(/(\d{1,2}(?:\.\d)?)\s*%[^.\n]{0,30}?(?:increase|escalation|uplift|adjustment)/i) ||
      text.match(/(?:increase|escalation|uplift|adjustment)[^.\n]{0,30}?(\d{1,2}(?:\.\d)?)\s*%/i);
    if (esc && Number(esc[1]) > 5) {
      add("MEDIUM", `Price escalation above 5% (${esc[1]}%)`, "Above typical inflation indexing. Consider capping to CPI.");
    }
    if (/\bevergreen\b/i.test(text)) add("MEDIUM", "Evergreen term", "The agreement continues indefinitely until cancelled. Diarise the notice date.");

    // Structural checks that read the record rather than the prose.
    if (contract) {
      if (!contract.expiryDate) add("MEDIUM", "No expiry date recorded", "Without an end date the renewal window cannot be tracked.");
      if (contract.renewalType === "AUTO_RENEW" && !contract.noticePeriodDays) {
        add("HIGH", "Auto-renew with no notice period", "An auto-renewing contract with no recorded notice period will renew silently.");
      }
      if (!contract.totalValue) add("LOW", "No contract value recorded", "Spend against this contract cannot be tracked without a value.");
    }
    return flags;
  }

  const SEVERITY_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

  /**
   * Full review of a contract's terms.
   *
   * Returns detected clauses, missing mandatory clauses, risk flags and a
   * single verdict. `approvable` is the gate the store enforces on approval.
   */
  function reviewContract(contract) {
    const text = [contract.termsText || "", contract.notes || "", contract.title || ""].join("\n");
    const detected = detectClauses(text);
    const missing = MANDATORY_CLAUSES.filter((c) => !detected.includes(c));
    const flags = detectRiskFlags(text, contract).sort(
      (a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0)
    );

    const critical = flags.filter((f) => f.severity === "CRITICAL");
    const approvable = missing.length === 0;

    let verdict;
    if (!text.trim()) {
      verdict = "No contract terms have been pasted in, so no review has been performed. Add the terms to run a review.";
    } else if (missing.length > 0) {
      verdict = `BLOCKED — missing ${missing.length} mandatory clause${missing.length === 1 ? "" : "s"}: ${missing
        .map((c) => CLAUSE_LABELS[c])
        .join(", ")}. This contract cannot be approved until they are added.`;
    } else if (critical.length > 0) {
      verdict = `All mandatory clauses present, but ${critical.length} critical risk finding${critical.length === 1 ? "" : "s"} require legal review before signature.`;
    } else if (flags.length > 0) {
      verdict = `All mandatory clauses present. ${flags.length} non-standard term${flags.length === 1 ? "" : "s"} flagged for review.`;
    } else {
      verdict = "All mandatory clauses present and no non-standard terms detected.";
    }

    return {
      reviewedAt: new Date().toISOString(),
      detected,
      missing,
      flags,
      approvable,
      riskScore: Math.min(100, missing.length * 25 + flags.reduce((s, f) => s + SEVERITY_RANK[f.severity] * 7, 0)),
      verdict,
    };
  }

  /* ---------------------------- demo seed ---------------------------- */

  const DEMO_TERMS_CLEAN = `MASTER SERVICES AGREEMENT
1. Confidentiality. Each party shall treat the other's proprietary information as confidential.
2. Data protection. The parties shall comply with GDPR and all applicable data protection law. Personal data is processed under the attached data processing agreement.
3. Limitation of liability. Each party's aggregate liability is limited to the fees paid in the preceding twelve months. Neither party is liable for consequential damages.
4. Service levels. Supplier shall maintain 99.9% uptime with service credits for any shortfall.
5. Termination for convenience. Either party may terminate on 90 days written notice.
6. Governing law. This agreement is governed by the laws of the State of New York.
7. Insurance. Supplier shall maintain commercial general liability insurance and provide a certificate of insurance annually.`;

  const DEMO_TERMS_RISKY = `SOFTWARE LICENCE AND SUPPORT AGREEMENT
1. Term. This agreement shall automatically renew for successive twelve month terms.
2. Fees. Annual price increase of 8% shall apply at each renewal.
3. Licence. Customer is granted a perpetual licence to the software.
4. Exclusivity. Customer shall purchase all requirements of this category exclusively from Supplier.
5. Liability. Supplier's liability under this agreement is not limited in any way.
6. Payment. Invoices are payable Net 90 from date of receipt.
7. Confidentiality. Both parties agree to keep commercial terms confidential.`;

  function buildDemoContracts() {
    return [
      {
        title: "Cloud infrastructure master services agreement",
        contractType: "MSA",
        totalValue: 480000,
        currency: "USD",
        paymentTerms: "NET30",
        effectiveDate: "2026-01-01",
        expiryDate: "2027-12-31",
        renewalType: "MANUAL",
        noticePeriodDays: 90,
        termsText: DEMO_TERMS_CLEAN,
        notes: "Negotiated down from list following competitive RFP.",
        seedStatus: "APPROVED",
      },
      {
        title: "ERP software licence and support",
        contractType: "LICENCE",
        totalValue: 265000,
        currency: "USD",
        paymentTerms: "NET90",
        effectiveDate: "2026-03-01",
        expiryDate: "2027-02-28",
        renewalType: "AUTO_RENEW",
        noticePeriodDays: 0,
        termsText: DEMO_TERMS_RISKY,
        notes: "Renewal inherited from incumbent. Terms not yet renegotiated.",
        seedStatus: "PENDING_APPROVAL",
      },
      {
        title: "Contingent labour rate card",
        contractType: "RATE_CARD",
        totalValue: 120000,
        currency: "USD",
        paymentTerms: "NET45",
        effectiveDate: "2026-02-01",
        expiryDate: "2026-12-31",
        renewalType: "MANUAL",
        noticePeriodDays: 30,
        termsText: DEMO_TERMS_CLEAN,
        notes: "Blended rates agreed for three skill bands.",
        seedStatus: "DRAFT",
      },
    ];
  }

  SAINT.contractData = {
    CONTRACT_TYPES,
    CONTRACT_STATUSES,
    STATUS_LABELS,
    STATUS_CHIPS,
    RENEWAL_TYPES,
    PAYMENT_TERMS,
    CLAUSE_RULES,
    CLAUSE_LABELS,
    MANDATORY_CLAUSES,
    SEVERITY_RANK,
    detectClauses,
    detectRiskFlags,
    reviewContract,
    buildDemoContracts,
  };
})(window);
