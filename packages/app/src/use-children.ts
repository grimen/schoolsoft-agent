import { useCallback, useEffect, useState } from "react";
import { ConnectorError, type Children, type ConnectorClient } from "schoolsoft-agent/client";

export type ChildrenState =
  | { status: "loading" }
  | { status: "list"; children: Children["children"] }
  | { status: "empty" }
  | { status: "error"; error: unknown };

/** `generation` changes on connect/forget: an answer that started before it is ignored. */
export function useChildren(client: ConnectorClient | undefined, generation: number) {
  const [state, setState] = useState<ChildrenState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!client) {
      // oxlint-disable-next-line react/set-state-in-effect -- never keeps a previous connection's children on screen once it is gone.
      setState({ status: "loading" });
      return;
    }
    let current = true;
    // oxlint-disable-next-line react/set-state-in-effect -- resets to "loading" for each new client/generation/attempt, synchronizing with the fetch started below.
    setState({ status: "loading" });
    // Reads /session, not /children: a grant's scopes (e.g. the reference page's
    // get_schedule/get_lunch_menu/get_calendar) may never include list_children, but
    // the session's own `children` field is readable with any grant.
    client.session().then(
      (session) => {
        if (!current) return;
        if (!session.schoolsoft.signedIn) {
          setState({
            status: "error",
            error: new ConnectorError({
              kind: "not_authenticated",
              problem: "schoolsoft-session",
              retryable: true,
              status: null,
              message: "The connector needs a new SchoolSoft sign-in.",
            }),
          });
          return;
        }
        setState(
          session.children.length === 0
            ? { status: "empty" }
            : { status: "list", children: session.children },
        );
      },
      (error: unknown) => {
        if (current) setState({ status: "error", error });
      },
    );
    return () => {
      current = false;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `generation` and `attempt` are not read in the body; they only force a refetch on connect/forget/reload.
  }, [client, generation, attempt]);

  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  return { state, reload };
}
