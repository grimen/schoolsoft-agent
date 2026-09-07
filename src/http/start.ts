/** Composition root for one parent-owned connector process. */
import { resolveConfig, type SessionDeps, type PersistedSession } from "../core/index.js";
import { connectorConfig } from "./config.js";
import { EncryptedRepository } from "./storage.js";
import { ConnectorOAuthProvider, type OAuthState } from "./oauth.js";
import { ConnectorRuntime } from "./runtime.js";
import { createConnectorApp } from "./server.js";
export function startConnector(env: Record<string, string | undefined>, deps?: SessionDeps) {
  const config = connectorConfig(env);
  const session = new EncryptedRepository<PersistedSession>(
    config.stateDir,
    "session",
    config.storageKey,
  );
  const identity = new EncryptedRepository<string>(config.stateDir, "identity", config.storageKey);
  const oauth = new ConnectorOAuthProvider({
    resourceUrl: config.publicUrl + "/mcp",
    scopes: ["list_children", "get_schedule", "get_lunch_menu"],
    repository: new EncryptedRepository<OAuthState>(config.stateDir, "oauth", config.storageKey),
  });
  const runtime = new ConnectorRuntime({
    config: resolveConfig(
      [{ school: config.school, stateDir: config.stateDir, configDir: config.stateDir }],
      { home: config.stateDir, platform: "linux" },
    ),
    store: {
      load: () => session.read() ?? null,
      save: (value) => session.write(value),
      clear: () => session.clear(),
    },
    identityStore: identity,
    deps,
    redirectUri: config.publicUrl + "/schoolsoft/callback",
  });
  const app = createConnectorApp({ config, oauth, runtime });
  const server = app.listen(config.port, "0.0.0.0");
  return { server, runtime };
}
