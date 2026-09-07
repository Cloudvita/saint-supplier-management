/**
 * SAINT.demoData — seed suppliers (ported from src/db/seed-data.ts) plus a fully
 * client-side "market intelligence" simulator that stands in for the original
 * Textract / news-API integrations, which needed server-held credentials and
 * therefore cannot run safely in a static, key-less front end.
 *
 * Everything generated here is clearly labeled SIMULATED in the UI — never
 * presented as real OCR or real news.
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});
  const { seededRandom, pick } = SAINT.utils;

  const DEMO_SUPPLIERS = [
    ["Acme Industrial Supply Inc", "Acme Industrial", "PUBLIC", "ACME", "C_CORPORATION", "MRO & Industrial", "Chicago", "IL", "60601"],
    ["Northwind Logistics LLC", null, "PRIVATE", null, "LLC", "Freight & Logistics", "Seattle", "WA", "98104"],
    ["Bluepeak Software Corp", "Bluepeak", "PUBLIC", "BPK", "C_CORPORATION", "IT Software", "Austin", "TX", "78701"],
    ["Cedar Ridge Facilities Services", null, "PRIVATE", null, "S_CORPORATION", "Facilities", "Denver", "CO", "80202"],
    ["Global Precision Components Ltd", "GPC", "PUBLIC", "GPCL", "C_CORPORATION", "Direct Materials", "Detroit", "MI", "48226"],
    ["Harbor Point Consulting Partners", null, "PRIVATE", null, "PARTNERSHIP", "Professional Services", "Boston", "MA", "02110"],
    ["Vertex Chemical Solutions Inc", null, "PUBLIC", "VRTXC", "C_CORPORATION", "Chemicals", "Houston", "TX", "77002"],
    ["Silverline Packaging Co", "Silverline", "PRIVATE", null, "C_CORPORATION", "Packaging", "Atlanta", "GA", "30303"],
    ["Meridian Staffing Group LLC", null, "PRIVATE", null, "LLC", "Contingent Labour", "Phoenix", "AZ", "85004"],
    ["Orchard Data Centers Inc", "Orchard DC", "PUBLIC", "ORCD", "C_CORPORATION", "IT Infrastructure", "Reston", "VA", "20190"],
  ];

  function buildDemoRows(managerEmail) {
    return DEMO_SUPPLIERS.map(([legalName, dbaName, companyType, ticker, taxClass, category, city, state, zip], i) => {
      const taxIdDigits = String(100000000 + i * 7654321).slice(0, 9);
      return {
        legalName,
        dbaName: dbaName || null,
        companyType,
        tickerSymbol: ticker || null,
        taxClassification: taxClass,
        taxIdType: "EIN",
        taxId: taxIdDigits, // validated/stripped by validateSupplier; only the last 4 digits are ever persisted
        contactName: "A/P Contact",
        contactEmail: `ap@${legalName.toLowerCase().replace(/[^a-z0-9]+/g, "")}.com`,
        contactPhone: `+1-555-01${String(i).padStart(2, "0")}`,
        website: null,
        addressLine1: `${100 + i} Commerce Way`,
        addressLine2: null,
        city,
        state,
        postalCode: zip,
        country: "USA",
        category,
        paymentTerms: i % 3 === 0 ? "NET45" : "NET30",
        currency: "USD",
        status: i % 5 === 0 ? "DRAFT" : "ACTIVE",
        newsCadence: i % 2 === 0 ? "WEEKLY" : "MONTHLY",
        diverseSupplier: i % 4 === 0,
        alertsEnabled: true,
        procurementManagerEmail: managerEmail,
        marketNews: null,
        newsKeywords: null,
      };
    });
  }

  /* ------------------ simulated market intelligence ------------------ */

  const NEUTRAL_HEADLINES = [
    "posted quarterly results in line with prior guidance",
    "announced a new regional distribution partnership",
    "was named to a regional \"best places to work\" list",
    "renewed its primary facility lease for another term",
    "expanded its sales team in the Midwest region",
    "published its annual sustainability report",
    "hosted a supplier day for its top procurement partners",
  ];

  const RISK_EVENTS = [
    { eventType: "ACQUISITION", severity: "MEDIUM", headline: "is reportedly in talks to be acquired by a larger competitor" },
    { eventType: "ACQUISITION", severity: "HIGH", headline: "signed a definitive agreement to be acquired" },
    { eventType: "MERGER", severity: "MEDIUM", headline: "announced a merger of equals with an industry peer" },
    { eventType: "BANKRUPTCY", severity: "CRITICAL", headline: "filed for Chapter 11 bankruptcy protection" },
    { eventType: "BANKRUPTCY", severity: "HIGH", headline: "warned of \"going concern\" doubts in its latest filing" },
    { eventType: "DISPUTE", severity: "MEDIUM", headline: "is facing a contract dispute with a major customer" },
    { eventType: "DISPUTE", severity: "LOW", headline: "settled a minor vendor dispute out of court" },
  ];

  /**
   * Deterministic per-(company, day) simulation — same inputs on the same day
   * produce the same digest, so repeat "pulls" in a demo don't feel random,
   * but a real Refresh the next day will differ.
   */
  function generateNewsDigest(companyName, cadence, keywords, ticker) {
    const today = new Date().toISOString().slice(0, 10);
    const rng = seededRandom(`${companyName}|${ticker || ""}|${keywords || ""}|${today}`);

    const lines = [];
    lines.push(`SIMULATED MARKET BRIEF — ${cadence || "WEEKLY"} cadence — generated ${new Date().toLocaleString()}`);
    lines.push(`(No external news source is connected in this static build; see README for wiring a real feed.)`);
    lines.push("");

    const neutralCount = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < neutralCount; i++) {
      lines.push(`• ${companyName} ${pick(rng, NEUTRAL_HEADLINES)}.`);
    }

    const riskEvents = [];
    // ~30% chance of a risk-relevant event, matching the "occasional alert" feel of the original demo.
    if (rng() < 0.3) {
      const evt = pick(rng, RISK_EVENTS);
      riskEvents.push({ ...evt, headline: `${companyName} ${evt.headline}` });
      lines.push(`• [${evt.eventType}] ${companyName} ${evt.headline}.`);
    }

    if (keywords) {
      lines.push("");
      lines.push(`Keyword watch (${keywords}): no additional matches this cycle.`);
    }

    return { digest: lines.join("\n"), riskEvents };
  }

  // W-9 extraction lives in js/ai/w9-bot.js now — it parses the document
  // itself rather than guessing from the filename, so the old filename-only
  // stand-in was removed rather than left as a second, worse code path.

  SAINT.demoData = { DEMO_SUPPLIERS, buildDemoRows, generateNewsDigest };
})(window);
