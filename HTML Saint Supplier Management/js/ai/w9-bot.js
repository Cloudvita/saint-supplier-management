/**
 * SAINT.w9Bot — the Supplier AI Bot that reads a W-9 and proposes supplier
 * metadata for a human to review.
 *
 * Two things worth being explicit about:
 *
 * 1. This runs entirely in the browser, so there is no OCR service and no LLM
 *    call — shipping an API key in public JavaScript is not an option (the
 *    same constraint documented in js/rfp/rfp-data.js). What it does instead
 *    is a genuine parse: PDFs and images carry recoverable text and metadata,
 *    and the bot reads what it actually can, then derives the rest from the
 *    filename and document structure. Every field it proposes carries a real
 *    confidence score reflecting where the value came from — it never claims
 *    certainty it doesn't have. See README for wiring a real Textract/LLM
 *    endpoint in its place.
 *
 * 2. Nothing it extracts is ever written directly to a supplier record. The
 *    bot returns *proposals*; a person accepts, edits or rejects each field,
 *    and only accepted fields are applied. That review gate is the point of
 *    the feature, not a formality — an extraction confident enough to skip
 *    review is still a machine guess about a tax document.
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});

  /** Confidence bands, so the UI and the bot agree on what "low" means. */
  const CONFIDENCE = {
    HIGH: 0.9, // read verbatim from the document
    GOOD: 0.75, // read, but with an assumption applied
    FAIR: 0.55, // inferred from filename or document conventions
    LOW: 0.35, // a guess worth showing but not trusting
  };

  const TAX_CLASSIFICATIONS = [
    "INDIVIDUAL_SOLE_PROPRIETOR",
    "C_CORPORATION",
    "S_CORPORATION",
    "PARTNERSHIP",
    "TRUST_ESTATE",
    "LLC",
    "OTHER",
    "UNKNOWN",
  ];

  const US_STATES =
    "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";

  /* ------------------------------------------------------------------ */
  /* Text recovery                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Pull whatever readable text the file actually contains.
   *
   * Uncompressed PDF text lives in `BT … Tj/TJ … ET` blocks; many real W-9s
   * (including the IRS fillable form) store field values as plain literals we
   * can recover without a PDF library. Compressed streams are unreadable this
   * way, which is exactly when confidence should drop — and it does.
   */
  function recoverText(buffer) {
    const bytes = new Uint8Array(buffer);
    let raw = "";
    // latin1 keeps byte values intact; UTF-8 decoding would mangle binary runs.
    for (let i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i]);

    const chunks = [];

    // PDF text-showing operators: (literal) Tj  and  [(a) -2 (b)] TJ
    const tjRe = /\(((?:[^()\\]|\\.)*)\)\s*T[jJ]/g;
    let m;
    while ((m = tjRe.exec(raw)) !== null) {
      const text = m[1]
        .replace(/\\([()\\])/g, "$1")
        .replace(/\\[0-7]{1,3}/g, " ")
        .trim();
      if (text) chunks.push(text);
    }

    // PDF AcroForm field values: /V (value)
    const fieldRe = /\/V\s*\(((?:[^()\\]|\\.)*)\)/g;
    while ((m = fieldRe.exec(raw)) !== null) {
      const text = m[1].replace(/\\([()\\])/g, "$1").trim();
      if (text) chunks.push(text);
    }

    // XMP / EXIF-style metadata often carries the originating company name.
    const xmpRe = /<(?:dc:title|dc:creator|pdf:Author|xmp:CreatorTool)[^>]*>([^<]{3,120})</g;
    while ((m = xmpRe.exec(raw)) !== null) chunks.push(m[1].trim());

    // Long printable runs — catches plain-text and lightly-wrapped documents.
    const asciiRe = /[\x20-\x7E]{12,}/g;
    while ((m = asciiRe.exec(raw)) !== null) {
      const t = m[0].trim();
      if (/[A-Za-z]{4}/.test(t)) chunks.push(t);
    }

    return chunks.join("\n");
  }

  /* ------------------------------------------------------------------ */
  /* Field extraction                                                    */
  /* ------------------------------------------------------------------ */

  function nameFromFileName(fileName) {
    return fileName
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/\b(w-?9|form|signed|completed|final|copy|scan|fillable|\d{4})\b/gi, " ")
      .replace(/[_\-.]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function detectTaxClassification(text) {
    const t = text.toLowerCase();
    // Checkbox marks next to a classification label are the strongest signal.
    const marked = [
      [/\b[x✓]\s*(?:\]|\))?\s*(?:individual|sole proprietor)/, "INDIVIDUAL_SOLE_PROPRIETOR"],
      [/\b[x✓]\s*(?:\]|\))?\s*c corporation/, "C_CORPORATION"],
      [/\b[x✓]\s*(?:\]|\))?\s*s corporation/, "S_CORPORATION"],
      [/\b[x✓]\s*(?:\]|\))?\s*partnership/, "PARTNERSHIP"],
      [/\b[x✓]\s*(?:\]|\))?\s*trust/, "TRUST_ESTATE"],
      [/\b[x✓]\s*(?:\]|\))?\s*limited liability/, "LLC"],
    ];
    for (const [re, value] of marked) if (re.test(t)) return { value, confidence: CONFIDENCE.HIGH };

    // Otherwise infer from the legal entity suffix, which is conventional but
    // not authoritative — an "Inc" can still elect S-corp treatment.
    if (/\bl\.?l\.?c\.?\b/.test(t)) return { value: "LLC", confidence: CONFIDENCE.FAIR };
    if (/\b(inc|corp|corporation|incorporated)\b/.test(t)) return { value: "C_CORPORATION", confidence: CONFIDENCE.FAIR };
    if (/\b(llp|lp|partners|partnership)\b/.test(t)) return { value: "PARTNERSHIP", confidence: CONFIDENCE.FAIR };
    if (/\btrust\b|\bestate\b/.test(t)) return { value: "TRUST_ESTATE", confidence: CONFIDENCE.FAIR };
    return { value: "UNKNOWN", confidence: CONFIDENCE.LOW };
  }

  function extractTaxId(text) {
    // EIN is NN-NNNNNNN; SSN is NNN-NN-NNNN. Check SSN first — otherwise an
    // SSN's leading "NNN-NN" can be mistaken for a malformed EIN.
    const ssn = text.match(/\b(\d{3})[-–\s](\d{2})[-–\s](\d{4})\b/);
    if (ssn) return { type: "SSN", digits: ssn[1] + ssn[2] + ssn[3], confidence: CONFIDENCE.HIGH };
    const ein = text.match(/\b(\d{2})[-–\s](\d{7})\b/);
    if (ein) return { type: "EIN", digits: ein[1] + ein[2], confidence: CONFIDENCE.HIGH };
    return null;
  }

  function extractAddress(text) {
    const out = {};
    const street = text.match(
      /\b(\d{1,6}\s+[A-Za-z0-9.'\- ]{2,40}\s(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Plaza|Parkway|Pkwy|Suite|Ste)\b\.?[A-Za-z0-9.,'\- ]{0,30})/i
    );
    if (street) out.addressLine1 = { value: street[1].trim(), confidence: CONFIDENCE.GOOD };

    const csz = text.match(new RegExp(`\\b([A-Za-z .'\\-]{2,40}),\\s*(${US_STATES})\\s+(\\d{5})(?:-\\d{4})?\\b`));
    if (csz) {
      out.city = { value: csz[1].trim(), confidence: CONFIDENCE.HIGH };
      out.state = { value: csz[2].toUpperCase(), confidence: CONFIDENCE.HIGH };
      out.postalCode = { value: csz[3], confidence: CONFIDENCE.HIGH };
    }
    return out;
  }

  function extractLegalName(text, fileName) {
    // A line labelled as W-9 line 1 is definitive when present.
    const labelled = text.match(/name\s*(?:\(as shown[^)]*\))?\s*[:\n]\s*([A-Za-z0-9 .,'&\-]{3,80})/i);
    if (labelled && !/^\s*(business|trade|doing)/i.test(labelled[1])) {
      return { value: labelled[1].trim(), confidence: CONFIDENCE.HIGH };
    }
    // A line carrying a legal entity suffix is very likely the entity name.
    const entity = text.match(/\b([A-Z][A-Za-z0-9 .,'&\-]{2,70}(?:LLC|L\.L\.C\.|Inc\.?|Corp\.?|Corporation|Ltd\.?|LLP|LP|Company|Co\.))\b/);
    if (entity) return { value: entity[1].trim(), confidence: CONFIDENCE.GOOD };

    const fromName = nameFromFileName(fileName);
    if (fromName.length >= 3) return { value: fromName, confidence: CONFIDENCE.FAIR };
    return null;
  }

  function extractDbaName(text) {
    // The label on W-9 line 2 is itself "Business name/disregarded entity
    // name", so a loose separator match happily captures the rest of the
    // label as the value. Require a real separator (colon or dash) and allow
    // the full label to be consumed first.
    const dba = text.match(
      /(?:business name(?:\s*\/\s*disregarded entity name)?|d\/?b\/?a|doing business as|trade name)\s*[:\-]\s*([A-Za-z0-9 .,'&\-]{2,70})/i
    );
    if (!dba) return null;
    const value = dba[1].trim();
    // A capture that is still label text is not a value.
    if (/^(disregarded|entity|name\b)/i.test(value)) return null;
    return { value, confidence: CONFIDENCE.GOOD };
  }

  function extractEmail(text) {
    const email = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
    return email ? { value: email[0], confidence: CONFIDENCE.HIGH } : null;
  }

  function extractPhone(text) {
    // No leading \b: a word boundary cannot match immediately before "(", so
    // anchoring that way silently drops the opening parenthesis of (713) 555-0142.
    const phone = text.match(/(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}\b/);
    return phone ? { value: phone[0].trim(), confidence: CONFIDENCE.GOOD } : null;
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */

  /** Human-readable label for each field the bot can propose. */
  const FIELD_LABELS = {
    legalName: "Legal name (W-9 line 1)",
    dbaName: "Business / DBA name (line 2)",
    taxClassification: "Federal tax classification (line 3)",
    taxIdType: "Tax ID type",
    taxId: "Taxpayer Identification Number",
    addressLine1: "Address (line 5)",
    city: "City",
    state: "State",
    postalCode: "ZIP code",
    contactEmail: "Contact email",
    contactPhone: "Contact phone",
  };

  function confidenceLabel(score) {
    if (score >= CONFIDENCE.HIGH) return "High";
    if (score >= CONFIDENCE.GOOD) return "Good";
    if (score >= CONFIDENCE.FAIR) return "Fair";
    return "Low";
  }

  /**
   * Read a W-9 and return field proposals for human review.
   *
   * Resolves to { fileName, sizeBytes, textRecovered, proposals[], warnings[] }
   * where each proposal is { field, label, value, confidence, source, accepted }.
   * `accepted` starts true only for high-confidence fields — anything the bot
   * inferred rather than read arrives switched off, so a reviewer has to make a
   * positive decision about it.
   */
  async function analyze(file) {
    const buffer = await file.arrayBuffer();
    const text = recoverText(buffer);
    const warnings = [];

    const isPdf = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name);
    const textRecovered = text.replace(/\s+/g, " ").trim().length;

    if (textRecovered < 40) {
      warnings.push(
        isPdf
          ? "This PDF has little recoverable text — it is probably a scan, or its text streams are compressed. Fields below are inferred from the filename and need checking against the document."
          : "Image files carry no readable text in the browser, so fields below are inferred from the filename only. Check every value against the document."
      );
    }

    const proposals = [];
    const push = (field, extracted, source) => {
      if (!extracted) return;
      proposals.push({
        field,
        label: FIELD_LABELS[field] || field,
        value: extracted.value,
        confidence: extracted.confidence,
        confidenceLabel: confidenceLabel(extracted.confidence),
        source,
        // Only verbatim reads are pre-accepted; everything else needs a human.
        accepted: extracted.confidence >= CONFIDENCE.HIGH,
      });
    };

    const legalName = extractLegalName(text, file.name);
    push("legalName", legalName, legalName && legalName.confidence >= CONFIDENCE.GOOD ? "Read from document" : "Inferred from filename");
    push("dbaName", extractDbaName(text), "Read from document");

    const classification = detectTaxClassification(text + " " + file.name);
    push(
      "taxClassification",
      classification,
      classification.confidence >= CONFIDENCE.HIGH ? "Checkbox on line 3" : "Inferred from entity suffix"
    );

    const taxId = extractTaxId(text);
    if (taxId) {
      push("taxIdType", { value: taxId.type, confidence: taxId.confidence }, "Read from document");
      push("taxId", { value: taxId.digits, confidence: taxId.confidence }, "Read from document");
      warnings.push("A taxpayer identification number was found. Confirm it against the document — only the last 4 digits are ever stored.");
    }

    const address = extractAddress(text);
    push("addressLine1", address.addressLine1, "Read from document");
    push("city", address.city, "Read from document");
    push("state", address.state, "Read from document");
    push("postalCode", address.postalCode, "Read from document");

    push("contactEmail", extractEmail(text), "Read from document");
    push("contactPhone", extractPhone(text), "Read from document");

    if (proposals.length === 0) {
      warnings.push("The bot could not propose any field from this file. Enter the supplier details manually.");
    }

    return {
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      textRecovered,
      proposals,
      warnings,
      analyzedAt: new Date().toISOString(),
    };
  }

  SAINT.w9Bot = { analyze, FIELD_LABELS, CONFIDENCE, confidenceLabel, TAX_CLASSIFICATIONS };
})(window);
