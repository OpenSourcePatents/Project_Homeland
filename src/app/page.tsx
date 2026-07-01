import CommandView from "@/components/CommandView";
import { getPublicSuspects, getDataFreshness } from "@/lib/queries";
import { getNtasStatus } from "@/lib/ntas";

// Live dashboard: fetch on every request rather than baking data at build time.
export const dynamic = "force-dynamic";

/**
 * Server Component (async). Runs only on the server: it calls getPublicSuspects()
 * — which enforces the official/analytical wall (WHERE data_class='official') and
 * touches the db client (DATABASE_URL) — then hands the plain, serializable result
 * to the client view. DATABASE_URL never reaches the browser bundle.
 *
 * The DHS NTAS status is fetched here too (hourly-cached fetch, see lib/ntas.ts)
 * so the client banner only ever renders a server-verified state.
 */
export default async function Home() {
  const [suspects, ntas, syncedAt] = await Promise.all([
    getPublicSuspects(),
    getNtasStatus(),
    getDataFreshness(),
  ]);
  return <CommandView suspects={suspects} ntas={ntas} syncedAt={syncedAt} />;
}
