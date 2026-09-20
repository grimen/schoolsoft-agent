/** Composition root for one parent-owned connector process. */
import {
  resolveConfig,
  type KeepaliveDeps,
  type SessionDeps,
  type SessionHistory,
  type PersistedSession,
} from "../core/index.js";
import { connectorConfig } from "./config.js";
import { EncryptedRepository } from "./storage.js";
import { ConnectorOAuthProvider, type OAuthState } from "./oauth.js";
import { ConnectorRuntime, CONNECTOR_OPERATIONS } from "./runtime.js";
import { createConnectorApp } from "./server.js";
export function startConnector(
  env: Record<string, string | undefined>,
  deps?: SessionDeps,
  keepaliveDeps?: Pick<KeepaliveDeps, "timer" | "random" | "hourOf" | "fetchImpl" | "log">,
) {
  const config = connectorConfig(env);
  const session = new EncryptedRepository<PersistedSession>(
    config.stateDir,
    "session",
    config.storageKey,
  );
  const history = new EncryptedRepository<SessionHistory>(
    config.stateDir,
    "history",
    config.storageKey,
  );
  const identity = new EncryptedRepository<string>(config.stateDir, "identity", config.storageKey);
  const oauth = new ConnectorOAuthProvider({
    resourceUrl: config.publicUrl + "/mcp",
    scopes: [...CONNECTOR_OPERATIONS],
    repository: new EncryptedRepository<OAuthState>(config.stateDir, "oauth", config.storageKey),
  });
  const runtime = new ConnectorRuntime({
    config: resolveConfig(
      [
        {
          school: config.school,
          stateDir: config.stateDir,
          configDir: config.stateDir,
          keepalive: env.SCHOOLSOFT_KEEPALIVE || undefined,
          keepaliveWebMinutes: env.SCHOOLSOFT_KEEPALIVE_WEB_MINUTES || undefined,
          keepaliveQuietHours: env.SCHOOLSOFT_KEEPALIVE_QUIET_HOURS || undefined,
          cache: env.SCHOOLSOFT_CACHE || undefined,
        },
      ],
      { home: config.stateDir, platform: "linux" },
    ),
    store: {
      load: () => session.read() ?? null,
      save: (value) => session.write(value),
      clear: () => session.clear(),
    },
    identityStore: identity,
    deps: {
      history: { read: () => history.read() ?? null, write: (value) => history.write(value) },
      ...deps,
    },
    keepaliveDeps,
    redirectUri: config.publicUrl + "/schoolsoft/callback",
  });
  runtime.startKeepalive();
  const app = createConnectorApp({ config, oauth, runtime });
  const server = app.listen(config.port, "0.0.0.0");
  return { server, runtime };
}
