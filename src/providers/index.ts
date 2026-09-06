/**
 * Registry of school portal providers. Adding a vendor = one directory
 * implementing SchoolProvider + one line here; core and the adapters never
 * name a vendor anywhere else.
 */
import type { SchoolProvider } from "../core/provider/types.js";
import { schoolsoftProvider } from "./schoolsoft/index.js";

const providers: Record<string, SchoolProvider> = {
  [schoolsoftProvider.id]: schoolsoftProvider as unknown as SchoolProvider,
};

export const providerIds: readonly string[] = Object.keys(providers);

export function getProvider(id: string): SchoolProvider {
  const p = providers[id];
  if (!p) {
    throw new Error(
      `Unknown school portal provider "${id}". Available: ${providerIds.join(", ")}.`,
    );
  }
  return p;
}
