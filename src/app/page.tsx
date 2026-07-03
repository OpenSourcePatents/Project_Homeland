import CommandView from "@/components/CommandView";
import { getPublicSuspects, getDataFreshness } from "@/lib/queries";
import { getNtasStatus } from "@/lib/ntas";
import { getDojWire } from "@/lib/doj";

// Live dashboard: fetch on every request rather than baking data at build time.
export const dynamic = "force-dynamic";

/**
 * Server Component (async). Runs only on the server: it calls getPublicSuspects()
 * — which enforces the official/analytical wall (WHERE data_class='official') and
 * touches the db client (DATABASE_URL) — then hands the plain, serializable result
 * to the client view. DATABASE_URL never reaches the browser bundle.
 *
 * The DHS NTAS status and DOJ enforcement wire are fetched here too (cached
 * fetches, see lib/ntas.ts and lib/doj.ts) so the client only ever renders
 * server-verified states.
 */
export default async function Home() {
  const [suspects, ntas, syncedAt, doj] = await Promise.all([
    getPublicSuspects(),
    getNtasStatus(),
    getDataFreshness(),
    getDojWire(),
  ]);
  return <CommandView suspects={suspects} ntas={ntas} syncedAt={syncedAt} doj={doj} />;
}
