import { getLocales } from "expo-localization";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { ConnectorClient } from "schoolsoft-agent/client";
import { deviceLanguage, type Language } from "../messages";
import { clientFor } from "./client";
import {
  forgetConnection,
  openStorage,
  readConnection,
  saveConnection,
  type DevConnection,
  type KeyValue,
} from "./store";

interface ConnectionValue {
  client: ConnectorClient | undefined;
  connected: boolean;
  persistent: boolean;
  language: Language;
  /** Changes on every connect or forget, so hooks drop answers from an earlier connection. */
  generation: number;
  connect(connection: DevConnection): void;
  forget(): void;
}

const Context = createContext<ConnectionValue | undefined>(undefined);

export function ConnectionProvider(props: {
  children: ReactNode;
  storage?: { storage: KeyValue; persistent: boolean };
  origin?: string;
  language?: Language;
  fetch?: typeof fetch;
}) {
  const [{ storage, persistent }] = useState(() => props.storage ?? openStorage());
  const [language] = useState(() => props.language ?? deviceLanguage(getLocales()));
  const origin = props.origin ?? globalThis.location.origin;
  const [generation, setGeneration] = useState(0);
  const [connection, setConnection] = useState(() => readConnection(storage));

  const connect = useCallback(
    (next: DevConnection) => {
      saveConnection(storage, next);
      setConnection(next);
      setGeneration((g) => g + 1);
    },
    [storage],
  );
  const forget = useCallback(() => {
    forgetConnection(storage);
    setConnection(undefined);
    setGeneration((g) => g + 1);
  }, [storage]);

  const client = useMemo(
    () =>
      connection
        ? clientFor(connection, storage, { origin, language, fetch: props.fetch })
        : undefined,
    // A new client per connection; token rotation is kept in storage, not in React state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [generation, connection?.clientId],
  );

  const value = useMemo<ConnectionValue>(
    () => ({
      client,
      connected: client !== undefined,
      persistent,
      language,
      generation,
      connect,
      forget,
    }),
    [client, persistent, language, generation, connect, forget],
  );
  return <Context.Provider value={value}>{props.children}</Context.Provider>;
}

export function useConnection(): ConnectionValue {
  const value = useContext(Context);
  if (!value) throw new Error("useConnection needs a ConnectionProvider");
  return value;
}
