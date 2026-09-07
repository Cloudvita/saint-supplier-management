import { listAlerts, listSuppliers } from "@/modules/suppliers";
import SupplierTabs from "@/modules/suppliers/ui/SupplierTabs";
import { type SupplierRow } from "@/modules/suppliers/ui/SupplierTable";

export const dynamic = "force-dynamic";

/**
 * The dashboard reads through the suppliers module's service API rather than
 * querying tables directly, so the page and the REST surface can never drift
 * apart — and tax IDs are masked once, inside the module.
 */
export default async function Home() {
  const [page, openAlerts] = await Promise.all([
    listSuppliers({ limit: 10 }),
    listAlerts({ limit: 5 }),
  ]);

  // Server Components can only pass plain JSON across the boundary.
  const supplierRows = JSON.parse(JSON.stringify(page.items)) as SupplierRow[];
  const alerts = JSON.parse(JSON.stringify(openAlerts));

  return <SupplierTabs alerts={alerts} supplierRows={supplierRows} totalCount={page.total} />;
}
