import { Redirect } from "expo-router";
import { Text, View } from "react-native";
import { useConnection } from "../src/connection/context";
import { t } from "../src/messages";
import { ErrorView } from "../src/ui/ErrorView";
import { useChildren } from "../src/use-children";

export default function Index() {
  const { client, connected, persistent, language, generation, forget } = useConnection();
  const { state, reload } = useChildren(client, generation);

  if (!connected) {
    return __DEV__ ? <Redirect href="/dev-connect" /> : <Text>{t(language, "signInLater")}</Text>;
  }
  return (
    <View>
      <Text accessibilityRole="header">{t(language, "children")}</Text>
      {persistent ? null : <Text>{t(language, "notPersistent")}</Text>}
      {state.status === "loading" ? <Text>{t(language, "loading")}</Text> : null}
      {state.status === "empty" ? <Text>{t(language, "empty")}</Text> : null}
      {state.status === "list"
        ? state.children.map((child) => <Text key={child.id}>{child.firstName}</Text>)
        : null}
      {state.status === "error" ? (
        <ErrorView error={state.error} language={language} onRetry={reload} onForget={forget} />
      ) : null}
    </View>
  );
}
