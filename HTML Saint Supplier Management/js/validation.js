/**
 * SAINT.validation — mirrors the field rules from the original Zod schema
 * (src/lib/validation.ts) so a supplier accepted here would also pass the
 * original server-side schema.
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});

  const companyTypes = ["PUBLIC", "PRIVATE"];
  const supplierStatuses = ["DRAFT", "ACTIVE", "ON_HOLD", "BLOCKED"];
  const taxClassifications = [
    "INDIVIDUAL_SOLE_PROPRIETOR",
    "C_CORPORATION",
    "S_CORPORATION",
    "PARTNERSHIP",
    "TRUST_ESTATE",
    "LLC",
    "OTHER",
    "UNKNOWN",
  ];
  const newsCadences = ["DAILY", "WEEKLY", "MONTHLY"];
  const paymentTermsOptions = ["NET15", "NET30", "NET45", "NET60", "NET90", "DUE_ON_RECEIPT"];
  const currencyOptions = ["USD", "EUR", "GBP", "INR", "CAD", "AUD"];

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const TICKER_RE = /^[A-Za-z.-]+$/;

  function trimmed(v) {
    return typeof v === "string" ? v.trim() : v;
  }

  /**
   * Validates + normalizes raw form input.
   * Returns { valid, errors, data } where `data` holds only clean values —
   * never call this with data you intend to render without re-checking `valid`.
   */
  function validateSupplier(raw) {
    const errors = {};
    const data = {};

    const legalName = trimmed(raw.legalName || "");
    if (legalName.length < 2 || legalName.length > 200) {
      errors.legalName = ["Legal name is required (2-200 characters)"];
    }
    data.legalName = legalName;

    data.dbaName = trimmed(raw.dbaName || "").slice(0, 200) || null;

    data.companyType = companyTypes.includes(raw.companyType) ? raw.companyType : "PRIVATE";

    let ticker = trimmed(raw.tickerSymbol || "").toUpperCase();
    if (ticker) {
      if (ticker.length > 12 || !TICKER_RE.test(ticker)) {
        errors.tickerSymbol = ["Invalid ticker"];
      }
    }
    data.tickerSymbol = data.companyType === "PUBLIC" ? ticker || null : null;

    data.taxClassification = taxClassifications.includes(raw.taxClassification)
      ? raw.taxClassification
      : "UNKNOWN";

    data.taxIdType = raw.taxIdType === "SSN" ? "SSN" : "EIN";

    const digits = String(raw.taxId || "").replace(/[^0-9]/g, "");
    if (digits && digits.length !== 9) {
      errors.taxId = ["Tax ID must be 9 digits"];
    }
    data.taxIdDigits = digits || null; // consumed once by the store, then discarded

    data.contactName = trimmed(raw.contactName || "").slice(0, 120) || null;

    const contactEmail = trimmed(raw.contactEmail || "");
    if (contactEmail && !EMAIL_RE.test(contactEmail)) {
      errors.contactEmail = ["Invalid email"];
    }
    data.contactEmail = contactEmail || null;

    data.contactPhone = trimmed(raw.contactPhone || "").slice(0, 40) || null;
    data.website = trimmed(raw.website || "").slice(0, 200) || null;
    data.addressLine1 = trimmed(raw.addressLine1 || "").slice(0, 200) || null;
    data.addressLine2 = trimmed(raw.addressLine2 || "").slice(0, 200) || null;
    data.city = trimmed(raw.city || "").slice(0, 100) || null;
    data.state = trimmed(raw.state || "").slice(0, 60) || null;
    data.postalCode = trimmed(raw.postalCode || "").slice(0, 20) || null;
    data.country = trimmed(raw.country || "USA").slice(0, 60) || "USA";
    data.category = trimmed(raw.category || "").slice(0, 120) || null;
    data.paymentTerms = paymentTermsOptions.includes(raw.paymentTerms) ? raw.paymentTerms : "NET30";
    data.currency = currencyOptions.includes(raw.currency) ? raw.currency : "USD";
    data.status = supplierStatuses.includes(raw.status) ? raw.status : "DRAFT";
    data.diverseSupplier = Boolean(raw.diverseSupplier);
    data.newsCadence = newsCadences.includes(raw.newsCadence) ? raw.newsCadence : "WEEKLY";
    data.marketNews = trimmed(raw.marketNews || "").slice(0, 8000) || null;
    data.newsKeywords = trimmed(raw.newsKeywords || "").slice(0, 300) || null;
    data.alertsEnabled = raw.alertsEnabled !== undefined ? Boolean(raw.alertsEnabled) : true;

    const managerEmail = trimmed(raw.procurementManagerEmail || "");
    if (managerEmail && !EMAIL_RE.test(managerEmail)) {
      errors.procurementManagerEmail = ["Invalid manager email"];
    }
    data.procurementManagerEmail = managerEmail || null;

    return { valid: Object.keys(errors).length === 0, errors, data };
  }

  /** Mask a 9-digit tax id for display: **-***6789 — mirrors maskTaxId() server-side.
   * Accepts either the full digit string (masks then the caller should discard it) or
   * just the last 4 digits, which is all this app persists after creation. */
  function maskTaxId(last4, type) {
    if (!last4) return "—"; // em dash
    return type === "SSN" ? `***-**-${last4}` : `**-***${last4}`;
  }

  SAINT.validation = {
    companyTypes,
    supplierStatuses,
    taxClassifications,
    newsCadences,
    paymentTermsOptions,
    currencyOptions,
    validateSupplier,
    maskTaxId,
  };
})(window);
