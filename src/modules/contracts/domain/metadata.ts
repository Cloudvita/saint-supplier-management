import { findPair, type KeyValuePair } from "@/core/documents";
import { auditClauses, type ClauseAudit } from "./clauses";

export type ContractMetadata = {
  title?: string;
  counterparty?: string;
  effectiveDate?: string;
  expiryDate?: string;
  totalValue?: number;
  currency?: string;
  paymentTerms?: string;
  noticePeriodDays?: number;
  autoRenew?: boolean;
};

export type ContractExtraction = ContractMetadata & { clauses: ClauseAudit };

const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december";

/** Parse the date formats that actually turn up in MSAs and SOWs. */
function parseDate(raw?: string): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.trim();

  const iso = cleaned.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const slash = cleaned.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (slash) {
    const [, m, d, y] = slash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const long = cleaned.match(new RegExp(`\\b(${MONTHS})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "i"));
  if (long) {
    const month = new Date(`${long[1]} 1, 2000`).getMonth() + 1;
    return `${long[3]}-${String(month).padStart(2, "0")}-${long[2].padStart(2, "0")}`;
  }
  return undefined;
}

function parseMoney(raw?: string): { amount?: number; currency?: string } {
  if (!raw) return {};
  const match = raw.match(/([$€£]|USD|EUR|GBP|INR)?\s*([\d,]+(?:\.\d{2})?)\s*(million|m\b|bn|billion)?/i);
  if (!match) return {};
  let amount = Number(match[2].replace(/,/g, ""));
  if (!Number.isFinite(amount)) return {};
  const scale = match[3]?.toLowerCase();
  if (scale?.startsWith("m")) amount *= 1_000_000;
  if (scale?.startsWith("b")) amount *= 1_000_000_000;

  const symbol = match[1]?.toUpperCase();
  const currency =
    symbol === "$" || symbol === "USD" ? "USD"
    : symbol === "€" || symbol === "EUR" ? "EUR"
    : symbol === "£" || symbol === "GBP" ? "GBP"
    : symbol === "INR" ? "INR"
    : undefined;
  return { amount, currency };
}

/**
 * Map an OCR'd contract onto structured metadata plus a clause audit.
 *
 * Same split as W-9 intake: `core/documents` does the OCR, this owns the
 * domain interpretation, so a new document type never means a second Textract
 * integration.
 */
export function extractContractMetadata(pairs: KeyValuePair[], rawText: string): ContractExtraction {
  const meta: ContractMetadata = {};

  meta.title =
    findPair(pairs, ["agreement title", "contract title", "title"]) ??
    rawText.split("\n").find((l) => l.trim().length > 10 && /agreement|contract|statement of work/i.test(l))?.trim();

  meta.counterparty = findPair(pairs, ["supplier", "vendor", "contractor", "counterparty", "between"]);

  meta.effectiveDate =
    parseDate(findPair(pairs, ["effective date", "commencement date", "start date"])) ??
    parseDate(rawText.match(new RegExp(`effective\\s+(?:as of\\s+)?(?:date[:\\s]+)?([^\\n.]{4,40})`, "i"))?.[1]);

  meta.expiryDate =
    parseDate(findPair(pairs, ["expiration date", "expiry date", "end date", "termination date"])) ??
    parseDate(rawText.match(/(?:expires?|expiration|until)\s+(?:on\s+)?([^\n.]{4,40})/i)?.[1]);

  const money = parseMoney(
    findPair(pairs, ["total value", "contract value", "total contract value", "not to exceed", "fees"]) ??
      rawText.match(/(?:total (?:contract )?value|not to exceed)[^\d$€£]{0,20}([$€£]?\s?[\d,]+(?:\.\d{2})?\s*(?:million|billion)?)/i)?.[1]
  );
  meta.totalValue = money.amount;
  meta.currency = money.currency;

  const terms = findPair(pairs, ["payment terms", "terms of payment"]) ?? rawText.match(/\bnet\s*\d{2,3}\b/i)?.[0];
  if (terms) meta.paymentTerms = terms.toUpperCase().replace(/\s+/g, "");

  const notice = rawText.match(/(\d{1,3})\s*days?[^.\n]{0,40}(?:prior\s+)?written notice/i);
  if (notice) meta.noticePeriodDays = Number(notice[1]);

  meta.autoRenew = /auto(matically)?[- ]renew/i.test(rawText);

  (Object.keys(meta) as (keyof ContractMetadata)[]).forEach((k) => {
    if (meta[k] === undefined || meta[k] === "") delete meta[k];
  });

  return { ...meta, clauses: auditClauses(rawText) };
}
