/** Parent-owned session lifecycle and serialized, consent-scoped read operations. */
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  AgentError,
  InputError,
  createSessionManager,
  createPortal,
  resolveProvider,
  getOperation,
  type Config,
  type SessionStore,
  type SessionDeps,
} from "../core/index.js";

export const CONNECTOR_OPERATIONS = ["list_children", "get_schedule", "get_lunch_menu"] as const;
export interface ConnectorRuntimeOptions {
  config: Config;
  store: SessionStore;
  identityStore: { read(): string | undefined; write(id: string): void };
  redirectUri: string;
  deps?: SessionDeps;
  now?: () => number;
  loginTimeoutMs?: number;
}
export type LoginFailure = "expired" | "cancelled" | "different_guardian" | "upstream";
export interface ExecutionAuthorization {
  check?: () => void;
  signal?: AbortSignal;
}
interface Pending {
  cancelled: boolean;
  state?: string;
  expires?: number;
  accept?: (code: string) => void;
  reject?: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}
function loginError(reason: string): AgentError {
  return new AgentError({
    kind: "not_authenticated",
    key: "not_authenticated",
    params: { reason },
    hint: "login",
  });
}

export class ConnectorRuntime {
  private readonly manager;
  private readonly now;
  private queue: Promise<unknown> = Promise.resolve();
  private pending?: Pending;
  private closed = false;
  private outstanding = 0;
  private lastLoginError?: LoginFailure;

  constructor(private readonly options: ConnectorRuntimeOptions) {
    this.now = options.now ?? Date.now;
    this.manager = createSessionManager(options.config, {
      ...options.deps,
      store: options.store,
      redirectUri: options.redirectUri,
      browserAuthorization: ({ url, state }) => this.authorize(url, state),
    });
  }

  private publishUrl?: (value: { url: string }) => void;
  private authorize(url: string, state: string): Promise<string> {
    const pending = this.pending!;
    return new Promise((resolve, reject) => {
      pending.state = state;
      pending.expires = this.now() + (this.options.loginTimeoutMs ?? 300_000);
      pending.accept = resolve;
      pending.reject = reject;
      pending.timer = setTimeout(
        () => this.cancelLogin("expired"),
        this.options.loginTimeoutMs ?? 300_000,
      );
      this.publishUrl!({ url });
    });
  }

  private serialized<T>(run: () => Promise<T>): Promise<T> {
    const result = this.queue.then(run);
    this.queue = result.catch(() => {});
    return result;
  }

  beginLogin(): Promise<{ url: string }> {
    if (this.closed) return Promise.reject(new InputError("Connector is closed."));
    if (this.pending) return Promise.reject(new InputError("A login is already in progress."));
    const pending: Pending = { cancelled: false };
    this.pending = pending;
    this.lastLoginError = undefined;
    return new Promise((resolve, reject) => {
      this.publishUrl = resolve;
      void this.serialized(async () => {
        try {
          if (pending.cancelled) throw loginError("Login cancelled.");
          await this.manager.login();
          if (pending.cancelled) throw loginError("Login cancelled.");
          this.checkIdentity();
        } catch (error) {
          this.lastLoginError ??= "upstream";
          this.manager.logout();
          reject(error);
        } finally {
          clearTimeout(pending.timer);
          this.pending = undefined;
          this.publishUrl = undefined;
        }
      });
    });
  }

  callback(state: string, code: string): boolean {
    const pending = this.pending;
    if (!pending?.state || !pending.accept || pending.cancelled) return false;
    if (this.now() >= pending.expires!) {
      this.cancelLogin("expired");
      return false;
    }
    const received = Buffer.from(state);
    const expected = Buffer.from(pending.state);
    if (received.length !== expected.length || !timingSafeEqual(received, expected) || !code)
      return false;
    const accept = pending.accept;
    pending.accept = undefined;
    clearTimeout(pending.timer);
    accept(code);
    return true;
  }

  private cancelLogin(reason: "expired" | "cancelled" = "cancelled"): void {
    if (!this.pending || this.pending.cancelled) return;
    this.lastLoginError = reason;
    this.pending.cancelled = true;
    this.pending.reject?.(loginError("Login cancelled or expired. Start again."));
  }

  private checkIdentity(): void {
    const { config, identityStore } = this.options;
    const identity = `${config.provider}:${config.school}:${this.manager.guardian().userId}`;
    const pinned = identityStore.read();
    if (pinned !== undefined && pinned !== identity) {
      this.lastLoginError = "different_guardian";
      this.manager.logout();
      throw loginError("This connector belongs to a different guardian. Use its original account.");
    }
    if (pinned === undefined) identityStore.write(identity);
  }

  async status(): Promise<{
    authenticated: boolean;
    loginInProgress: boolean;
    children: { id: number; name: string }[];
    loginError?: LoginFailure;
  }> {
    if (this.pending) return { authenticated: false, loginInProgress: true, children: [] };
    return this.serialized(async () => {
      if (this.closed)
        return {
          authenticated: false,
          loginInProgress: false,
          children: [],
          ...(this.lastLoginError ? { loginError: this.lastLoginError } : {}),
        };
      try {
        await this.manager.ensureSession();
        this.checkIdentity();
        return {
          authenticated: true,
          loginInProgress: false,
          children: this.manager
            .guardian()
            .children.map((c) => ({ id: c.studentId, name: c.firstName })),
        };
      } catch {
        return {
          authenticated: false,
          loginInProgress: false,
          children: [],
          ...(this.lastLoginError ? { loginError: this.lastLoginError } : {}),
        };
      }
    });
  }

  execute(
    name: string,
    args: Record<string, unknown>,
    allowedChildIds: readonly number[],
    authorization: ExecutionAuthorization = {},
  ): Promise<unknown> {
    if (this.outstanding >= 16)
      return Promise.reject(new InputError("Connector is busy. Try again shortly."));
    this.outstanding++;
    const check = () => {
      if (this.closed) throw new InputError("Connector is closed.");
      if (authorization.signal?.aborted) throw new InputError("Request cancelled.");
      authorization.check?.();
    };
    return this.serialized(async () => {
      check();
      if (!CONNECTOR_OPERATIONS.some((value) => value === name))
        throw new InputError("This operation is not available through the connector.");
      const operation = getOperation(name)!;
      const parsed = z.object(operation.input).strict().safeParse(args);
      if (!parsed.success) throw new InputError("Check the operation arguments.");
      await this.manager.ensureSession();
      this.checkIdentity();
      const guardian = this.manager.guardian();
      const permitted = guardian.children.filter((child) =>
        allowedChildIds.includes(child.studentId),
      );
      if (!permitted.length)
        throw new InputError("No permitted children. Reconnect and choose a child.");
      if (name === "list_children") {
        check();
        return {
          children: permitted.map((child) => ({
            studentId: child.studentId,
            firstName: child.firstName,
          })),
          childInFocus: permitted.some((child) => child.studentId === guardian.childInFocus)
            ? guardian.childInFocus
            : null,
        };
      }
      const childId = (parsed.data.child_id as number | undefined) ?? guardian.childInFocus;
      if (!permitted.some((child) => child.studentId === childId))
        throw new InputError("This child was not permitted for this connection.");
      const validateChild = () => {
        check();
        this.checkIdentity();
        if (
          !allowedChildIds.includes(childId) ||
          !this.manager.guardian().children.some((child) => child.studentId === childId)
        )
          throw new InputError(
            "This child is no longer permitted or available. Reconnect and choose a child.",
          );
      };
      const validateFocus = () => {
        validateChild();
        if (this.manager.guardian().childInFocus !== childId)
          throw new InputError("The child's session changed. Try again.");
      };
      validateChild();
      await this.manager.focusChild(childId);
      const portal = createPortal(this.manager, {
        fetchImpl: this.options.deps?.fetchImpl,
        browser: null,
        beforeRecovery: check,
        afterRecovery: async () => {
          validateChild();
          await this.manager.focusChild(childId);
          validateFocus();
        },
      });
      const result = await operation.run(
        {
          config: this.options.config,
          manager: this.manager,
          provider: resolveProvider(this.options.config),
          portal: {
            ...portal,
            getScheduleWeek: async (week) => {
              validateFocus();
              return portal.getScheduleWeek(week);
            },
            getLunchWeek: async (orgId, week) => {
              validateFocus();
              return portal.getLunchWeek(orgId, week);
            },
          },
          log: () => {},
        },
        { ...parsed.data, child_id: childId },
      );
      validateFocus();
      return result;
    }).finally(() => {
      this.outstanding--;
    });
  }

  logout(): Promise<void> {
    this.cancelLogin();
    return this.serialized(async () => {
      this.manager.logout();
    });
  }

  close(): Promise<void> {
    this.closed = true;
    this.cancelLogin();
    return this.serialized(async () => {});
  }
}
