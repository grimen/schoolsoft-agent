import { Stack } from "expo-router";
import { ConnectionProvider } from "../src/connection/context";

// Expo Router's own error screen (with a retry) for an error thrown while rendering a route.
export { ErrorBoundary } from "expo-router";

export default function Layout() {
  return (
    <ConnectionProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </ConnectionProvider>
  );
}
