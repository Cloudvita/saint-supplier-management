import { and, eq, ne } from "drizzle-orm";
import { db } from "@/core/db";
import { AppError } from "@/core/errors";
import { createLogger } from "@/core/logger";
import { marketNewsItems, riskAlerts, suppliers } from "../schema";
import { getNewsProvider } from "./news-providers";
import { buildDigest, classifyArticle, isAlertable } from "../domain/classifier";
import { raiseAlert } from "./alert.service";
import type { ClassifiedArticle } from "../domain/news-types";

const log = createLogger("suppliers.news");

export type RefreshResult = {
  supplierId: string;
  companyName: string;
  provider: string;
  fetched: number;
  stored: number;
  alertsCreated: number;
  digest: string;
  items: ClassifiedArticle[];
};

/**
 * Pull market news for one supplier, classify it, persist articles, refresh the
 * on-screen digest, and raise alerts for M&A / bankruptcy / dispute events.
 */
export async function refreshSupplierNews(supplierId: string): Promise<RefreshResult> {
  const supplier = await db.query.suppliers.findFirst({ where: eq(suppliers.id, supplierId) });
  if (!supplier) throw AppError.notFound(`Supplier ${supplierId}`);

  const provider = getNewsProvider();
  const raw = await provider.fetchNews({
    companyName: supplier.legalName,
    ticker: supplier.tickerSymbol,
    keywords: supplier.newsKeywords,
    cadence: supplier.newsCadence,
  });

  const classified = raw
    .map(classifyArticle)
    .sort((a, b) => b.score - a.score || b.publishedAt.getTime() - a.publishedAt.getTime());

  // --- persist articles (idempotent on supplierId + url) ---
  let stored = 0;
  for (const item of classified) {
    if (!item.url) continue;
    await db
      .insert(marketNewsItems)
      .values({
        supplierId,
        headline: item.headline,
        summary: item.summary,
        url: item.url,
        source: item.source,
        publishedAt: item.publishedAt,
        eventType: item.eventType,
        severity: item.severity,
        score: item.score,
      })
      .onConflictDoUpdate({
        target: [marketNewsItems.supplierId, marketNewsItems.url],
        set: {
          fetchedAt: new Date(),
          eventType: item.eventType,
          severity: item.severity,
          score: item.score,
        },
      });
    stored++;
  }

  // --- digest into the visible text field ---
  const digest = buildDigest(supplier.legalName, classified, supplier.newsCadence);
  await db
    .update(suppliers)
    .set({ marketNews: digest, marketNewsUpdated: new Date() })
    .where(eq(suppliers.id, supplierId));

  // --- alerts ---
  let alertsCreated = 0;
  if (supplier.alertsEnabled) {
    for (const item of classified.filter(isAlertable)) {
      const existing = await db.query.riskAlerts.findFirst({
        where: and(
          eq(riskAlerts.supplierId, supplierId),
          eq(riskAlerts.eventType, item.eventType),
          item.url ? eq(riskAlerts.sourceUrl, item.url) : undefined
        ),
      });
      if (existing) continue;

      await raiseAlert({
        supplierId,
        supplierName: supplier.legalName,
        supplierCode: supplier.supplierCode,
        eventType: item.eventType,
        severity: item.severity,
        title: item.headline,
        detail: item.summary,
        sourceUrl: item.url,
        managerEmail: supplier.procurementManagerEmail,
      });
      alertsCreated++;
    }
  }

  return {
    supplierId,
    companyName: supplier.legalName,
    provider: provider.name,
    fetched: raw.length,
    stored,
    alertsCreated,
    digest,
    items: classified,
  };
}

async function refreshMany(ids: { id: string }[]): Promise<RefreshResult[]> {
  const results: RefreshResult[] = [];
  for (const s of ids) {
    try {
      results.push(await refreshSupplierNews(s.id));
    } catch (e) {
      log.error("news refresh failed", {
        supplierId: s.id,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}

/** Batch entry point for the scheduled refresh (EventBridge -> /api/news/refresh). */
export async function refreshDueSuppliers(cadence: "DAILY" | "WEEKLY" | "MONTHLY") {
  const due = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.newsCadence, cadence), ne(suppliers.status, "BLOCKED")));
  return refreshMany(due);
}

/** "AI Genie" scan-all entry point — every non-blocked supplier, regardless of cadence. */
export async function refreshAllSuppliers() {
  const all = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(ne(suppliers.status, "BLOCKED"));
  return refreshMany(all);
}

/** Provider-only preview: classify without persisting. Used by the news preview route. */
export async function previewNews(query: {
  companyName: string;
  ticker?: string | null;
  keywords?: string | null;
  cadence: "DAILY" | "WEEKLY" | "MONTHLY";
}) {
  const provider = getNewsProvider();
  const raw = await provider.fetchNews(query);
  const items = raw.map(classifyArticle).sort((a, b) => b.score - a.score);
  return {
    provider: provider.name,
    fetched: raw.length,
    items,
    digest: buildDigest(query.companyName, items, query.cadence),
  };
}
