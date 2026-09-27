import { Redirect } from "expo-router";
import type { ComponentType } from "react";

// In a production build __DEV__ is false, so the minifier drops the require and DevConnect with it.
const DevConnect: ComponentType | null = __DEV__
  ? (require("../src/dev/DevConnect") as { DevConnect: ComponentType }).DevConnect
  : null;

export default function DevConnectRoute() {
  return DevConnect ? <DevConnect /> : <Redirect href="/" />;
}
