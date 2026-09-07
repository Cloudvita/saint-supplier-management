import { findPair, normalizeLabel, type KeyValuePair } from "@/core/documents";

/** Field set we map a W-9 onto. */
export type W9Fields = {
  legalName?: string;
  dbaName?: string;
  taxClassification?: string;
  taxIdType?: "EIN" | "SSN";
  taxId?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
};

/**
 * Map Textract key/value pairs onto W-9 fields.
 *
 * Pure and dependency-free on purpose — the OCR call lives in `core/documents`,
 * so this rule set can be unit-tested against recorded pairs without AWS.
 */
export function mapToW9Fields(pairs: KeyValuePair[], rawText: string): W9Fields {
  const fields: W9Fields = {};

  fields.legalName = findPair(pairs, [
    "name as shown on your income tax return",
    "name is required on this line",
    "1 name",
    "name",
  ]);

  fields.dbaName = findPair(pairs, [
    "business name disregarded entity name",
    "business name",
    "disregarded entity",
    "2 business name",
  ]);

  // --- Tax ID: prefer labelled fields, fall back to a regex over raw text ---
  const ein = findPair(pairs, ["employer identification number", "ein"]);
  const ssn = findPair(pairs, ["social security number", "ssn"]);
  const digits = (s?: string) => s?.replace(/[^0-9]/g, "") ?? "";

  if (digits(ein).length === 9) {
    fields.taxIdType = "EIN";
    fields.taxId = digits(ein);
  } else if (digits(ssn).length === 9) {
    fields.taxIdType = "SSN";
    fields.taxId = digits(ssn);
  } else {
    const einMatch = rawText.match(/\b(\d{2})\s*[-–]\s*(\d{7})\b/);
    const ssnMatch = rawText.match(/\b(\d{3})\s*[-–]\s*(\d{2})\s*[-–]\s*(\d{4})\b/);
    if (einMatch) {
      fields.taxIdType = "EIN";
      fields.taxId = einMatch[1] + einMatch[2];
    } else if (ssnMatch) {
      fields.taxIdType = "SSN";
      fields.taxId = ssnMatch[1] + ssnMatch[2] + ssnMatch[3];
    }
  }

  // --- Address ---
  fields.addressLine1 = findPair(pairs, [
    "address number street and apt or suite no",
    "address number street",
    "5 address",
    "address",
  ]);

  const cityStateZip = findPair(pairs, ["city state and zip code", "city state zip", "6 city"]);
  if (cityStateZip) {
    const m = cityStateZip.match(/^(.*?),?\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/);
    if (m) {
      fields.city = m[1].trim();
      fields.state = m[2].toUpperCase();
      fields.postalCode = m[3];
    } else {
      fields.city = cityStateZip;
    }
  }

  fields.taxClassification = detectTaxClassification(pairs, rawText);

  // strip empty keys
  (Object.keys(fields) as (keyof W9Fields)[]).forEach((k) => {
    if (!fields[k]) delete fields[k];
  });
  return fields;
}

/**
 * W-9 line 3 is a set of checkboxes. Textract emits them as SELECTION_ELEMENTs;
 * we look for the selected one whose key text matches a known classification.
 */
export function detectTaxClassification(pairs: KeyValuePair[], rawText: string): string {
  const selected = pairs.filter((p) => p.value.includes("[X]")).map((p) => normalizeLabel(p.key));
  const text = normalizeLabel(rawText);

  const rules: Array<[RegExp, string]> = [
    [/individual sole proprietor|single member llc/, "INDIVIDUAL_SOLE_PROPRIETOR"],
    [/c corporation|^c corp/, "C_CORPORATION"],
    [/s corporation|^s corp/, "S_CORPORATION"],
    [/partnership/, "PARTNERSHIP"],
    [/trust estate|trust\/estate/, "TRUST_ESTATE"],
    [/limited liability company|llc/, "LLC"],
    [/other/, "OTHER"],
  ];

  for (const label of selected) {
    for (const [re, val] of rules) if (re.test(label)) return val;
  }
  // Fallback: infer from the entity suffix in the raw text
  if (/\bllc\b/.test(text)) return "LLC";
  if (/\binc\b|\bcorp\b|\bcorporation\b/.test(text)) return "C_CORPORATION";
  if (/\blp\b|\bllp\b|partnership/.test(text)) return "PARTNERSHIP";
  return "UNKNOWN";
}
