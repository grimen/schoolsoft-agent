import { useCallback, useEffect, useState } from "react";
import type { Children, ConnectorClient } from "schoolsoft-agent/client";

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
    if (!client) return;
    let current = true;
    // oxlint-disable-next-line react/set-state-in-effect -- resets to "loading" for each new client/generation/attempt, synchronizing with the fetch started below.
    setState({ status: "loading" });
    client.children().then(
      (answer) => {
        if (!current) return;
        setState(
          answer.children.length === 0
            ? { status: "empty" }
            : { status: "list", children: answer.children },
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
