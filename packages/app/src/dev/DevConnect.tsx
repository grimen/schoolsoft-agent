import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useConnection } from "../connection/context";
import { newDevConnection } from "../connection/store";
import { devText } from "./words";

/** Marker for the production export check: this string must not ship in a production bundle. */
export const DEV_MARKER = "schoolsoft-app-dev-connect";
const CONSOLE = `JSON.parse(sessionStorage.getItem("schoolsoft-reference")) // client.id and refresh`;

export function DevConnect() {
  const { connect, language } = useConnection();
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [refresh, setRefresh] = useState("");
  const [invalid, setInvalid] = useState<"clientId" | "refreshToken" | undefined>();

  const submit = () => {
    const result = newDevConnection(clientId, refresh);
    if ("invalid" in result) return setInvalid(result.invalid);
    connect(result);
    router.replace("/");
  };

  return (
    <View testID={DEV_MARKER}>
      <Text accessibilityRole="header">{devText(language, "devTitle")}</Text>
      <Text>{devText(language, "devHowTo")}</Text>
      <Text selectable>{CONSOLE}</Text>
      <Text accessibilityRole="alert">{devText(language, "devWarning")}</Text>
      <TextInput
        accessibilityLabel={devText(language, "devClientId")}
        value={clientId}
        onChangeText={setClientId}
        autoCapitalize="none"
      />
      <TextInput
        accessibilityLabel={devText(language, "devRefresh")}
        value={refresh}
        onChangeText={setRefresh}
        autoCapitalize="none"
        secureTextEntry
      />
      {invalid === "clientId" ? <Text>{devText(language, "devInvalidClientId")}</Text> : null}
      {invalid === "refreshToken" ? <Text>{devText(language, "devInvalidRefresh")}</Text> : null}
      <Pressable accessibilityRole="button" onPress={submit}>
        <Text>{devText(language, "devConnect")}</Text>
      </Pressable>
    </View>
  );
}
