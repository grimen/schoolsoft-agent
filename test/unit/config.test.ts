import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveConfig,
  envSource,
  defaultConfigDir,
  NotConfiguredError,
} from "../../src/core/config.js";

const defaults = { home: "/home/u", platform: "linux" as const };

test("precedence: earlier sources win, defaults fill the rest", () => {
  const c = resolveConfig(
    [{ school: "flags" }, { school: "env", orgId: "20" }, { callbackPort: "5000" }],
    defaults,
  );
  assert.equal(c.school, "flags");
  assert.equal(c.orgId, "20");
  assert.equal(c.callbackPort, 5000);
  assert.equal(c.userType, "parent");
  assert.equal(c.clientId, "vApp", "parent default client id");
  assert.equal(c.configDir, "/home/u/.config/schoolsoft-agent");
  assert.equal(c.stateDir, "/home/u/.config/schoolsoft-agent/state");
});

test("student user type defaults to the eApp client id; explicit clientId wins", () => {
  assert.equal(resolveConfig([{ school: "s", userType: "student" }], defaults).clientId, "eApp");
  assert.equal(resolveConfig([{ school: "s", clientId: "custom" }], defaults).clientId, "custom");
});

test("missing school → NotConfiguredError naming configure", () => {
  assert.throws(() => resolveConfig([{}, { school: "" }], defaults), NotConfiguredError);
  assert.throws(() => resolveConfig([], defaults), /schoolsoft-agent configure/);
});

test("invalid user type and port are rejected", () => {
  assert.throws(
    () => resolveConfig([{ school: "s", userType: "alien" }], defaults),
    /Invalid userType/,
  );
  assert.throws(
    () => resolveConfig([{ school: "s", callbackPort: "abc" }], defaults),
    /Invalid callbackPort/,
  );
  assert.throws(
    () => resolveConfig([{ school: "s", callbackPort: 70000 }], defaults),
    /Invalid callbackPort/,
  );
});

test("envSource maps SCHOOLSOFT_* and ignores empty strings", () => {
  const s = envSource({
    SCHOOLSOFT_SCHOOL: "taby",
    SCHOOLSOFT_ORGID: "",
    SCHOOLSOFT_CALLBACK_PORT: "4000",
    OTHER: "x",
  });
  assert.deepEqual(s, {
    school: "taby",
    orgId: undefined,
    userType: undefined,
    clientId: undefined,
    callbackPort: "4000",
    stateDir: undefined,
    configDir: undefined,
  });
});

test("platform config dirs", () => {
  assert.equal(
    defaultConfigDir("/Users/j", "darwin"),
    "/Users/j/Library/Application Support/schoolsoft-agent",
  );
  assert.equal(
    defaultConfigDir("/home/j", "linux", { XDG_CONFIG_HOME: "/xdg" }),
    "/xdg/schoolsoft-agent",
  );
  assert.match(
    defaultConfigDir("C:\\Users\\j", "win32", { APPDATA: "C:\\Users\\j\\AppData\\Roaming" }),
    /Roaming[\\/]schoolsoft-agent$/,
  );
});

test("createSessionManager / createGuardianApi wire a working manager without touching disk", async () => {
  const { createSessionManager, createGuardianApi } = await import("../../src/core/config.js");
  const { MemorySessionStore } = await import("../../src/core/session/store.js");
  const config = resolveConfig([{ school: "taby", configDir: "/nowhere" }], defaults);
  const manager = createSessionManager(config, {
    store: new MemorySessionStore(),
    fetchImpl: async () => {
      throw new Error("no network in tests");
    },
    openBrowser: () => {},
  });
  const api = createGuardianApi(manager);
  await assert.rejects(api.getParent(), /No access token/);
  await assert.rejects(api.getScheduleWeek(1), /No session cookies/);
  await assert.rejects(manager.ensureSession(), /Not authenticated/);
});
