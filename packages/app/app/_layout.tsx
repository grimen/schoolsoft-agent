import { Stack } from "expo-router";
import { ConnectionProvider } from "../src/connection/context";

export default function Layout() {
  return (
    <ConnectionProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </ConnectionProvider>
  );
}
