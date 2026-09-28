import { Linking, Pressable, Text, View } from "react-native";
import { explain, t, type Language } from "../messages";

export function ErrorView(props: {
  error: unknown;
  language: Language;
  onRetry(): void;
  onForget(): void;
}) {
  const e = explain(props.error, props.language);
  return (
    <View accessibilityRole="alert">
      <Text>{e.title}</Text>
      <Text>{e.next}</Text>
      {e.action === "dashboard" && e.dashboard ? (
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(e.dashboard!)}>
          <Text>{e.dashboard}</Text>
        </Pressable>
      ) : null}
      {e.action === "reconnect" ? null : (
        <Pressable accessibilityRole="button" onPress={props.onRetry}>
          <Text>{t(props.language, "retry")}</Text>
        </Pressable>
      )}
      <Pressable accessibilityRole="button" onPress={props.onForget}>
        <Text>{t(props.language, "forget")}</Text>
      </Pressable>
    </View>
  );
}
