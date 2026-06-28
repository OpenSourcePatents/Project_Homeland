import CommandView from "@/components/CommandView";
import { getPublicSuspects } from "@/lib/queries";

// Live dashboard: fetch on every request rather than baking data at build time.
export const dynamic = "force-dynamic";

/**
 * Server Component (async). Runs only on the server: it calls getPublicSuspects()
 * — which enforces the official/analytical wall (WHERE data_class='official') and
 * touches the db client (DATABASE_URL) — then hands the plain, serializable result
 * to the client view. DATABASE_URL never reaches the browser bundle.
 */
export default async function Home() {
  const suspects = await getPublicSuspects();
  return <CommandView suspects={suspects} />;
}
