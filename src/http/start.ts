/** Composition root for one parent-owned connector process. */
import {
  HISTORY_FORMAT,
  SESSION_FORMAT,
  resolveConfig,
  type VersionedFormat,
  type KeepaliveDeps,
  type SessionDeps,
  type SessionHistory,
  type PersistedSession,
} from "../core/index.js";
import { connectorConfig, type ConnectorConfig } from "./config.js";
import { EncryptedRepository } from "./storage.js";
import { ConnectorOAuthProvider, OAUTH_STATE_FORMAT, type OAuthState } from "./oauth.js";
import { ConnectorRuntime, CONNECTOR_OPERATIONS } from "./runtime.js";
import { createConnectorApp } from "./server.js";
type ConnectorKeepaliveDeps = Pick<
  KeepaliveDeps,
  "timer" | "random" | "hourOf" | "fetchImpl" | "log"
>;
/** The pinned guardian (identity.enc). v0 stored the bare string; v1 wraps it so it can carry a version. */
export const IDENTITY_FORMAT: VersionedFormat = {
  migrations: [(pin: string) => ({ identity: pin })],
};
/**
 * The object graph without a listener, so callers choose where (and whether) to listen.
 * Nothing is started here: `startConnector` starts the keepalive.
 */
export function composeConnector(
  config: ConnectorConfig,
  deps?: SessionDeps,
  env: Record<string, string | undefined> = {},
  keepaliveDeps?: ConnectorKeepaliveDeps,
) {
  const session = new EncryptedRepository<PersistedSession>(
    config.stateDir,
    "session",
    config.storageKey,
    SESSION_FORMAT,
  );
  const history = new EncryptedRepository<SessionHistory>(
    config.stateDir,
    "history",
    config.storageKey,
    HISTORY_FORMAT,
  );
  const identity = new EncryptedRepository<{ identity: string }>(
    config.stateDir,
    "identity",
    config.storageKey,
    IDENTITY_FORMAT,
  );
  const oauth = new ConnectorOAuthProvider({
    resourceUrl: config.publicUrl + "/mcp",
    scopes: [...CONNECTOR_OPERATIONS],
    repository: new EncryptedRepository<OAuthState>(
      config.stateDir,
      "oauth",
      config.storageKey,
      OAUTH_STATE_FORMAT,
    ),
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
    identityStore: {
      read: () => identity.read()?.identity,
      write: (pin) => identity.write({ identity: pin }),
    },
    deps: {
      history: { read: () => history.read() ?? null, write: (value) => history.write(value) },
      ...deps,
    },
    keepaliveDeps,
    redirectUri: config.publicUrl + "/schoolsoft/callback",
  });
  return { app: createConnectorApp({ config, oauth, runtime }), runtime };
}
export function startConnector(
  env: Record<string, string | undefined>,
  deps?: SessionDeps,
  keepaliveDeps?: ConnectorKeepaliveDeps,
) {
  const config = connectorConfig(env);
  const { app, runtime } = composeConnector(config, deps, env, keepaliveDeps);
  runtime.startKeepalive();
  const server = app.listen(config.port, "0.0.0.0");
  return { server, runtime };
}
