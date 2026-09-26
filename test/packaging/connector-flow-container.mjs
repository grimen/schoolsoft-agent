/** Explicit Docker artifact smoke: node test/packaging/connector-flow-container.mjs [image].
 * Replays the owner + OAuth + MCP + REST flow (connector-smoke/flow.mjs) inside the built image
 * with --network none. The portal is connector-smoke/fake-upstream.mjs, mounted read-only
 * next to a test-only entry; the image itself is unchanged. No SchoolSoft or AI calls are
 * possible. The production entrypoint, privilege drop and persistence are covered by the
 * sibling connector-container.mjs.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const image = process.argv[2] ?? "schoolsoft-connector:review";
const name = "schoolsoft-flow-" + randomUUID();
const harness = join(dirname(fileURLToPath(import.meta.url)), "connector-smoke");
const docker = (...args) =>
  execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
try {
  docker(
    "run",
    "-d",
    "--name",
    name,
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--user",
    "1000:1000",
    "--tmpfs",
    "/data:rw,noexec,nosuid,uid=1000,gid=1000,mode=0700",
    "--mount",
    `type=bind,src=${harness},dst=/smoke,readonly`,
    "-e",
    "SCHOOLSOFT_PUBLIC_URL=https://connector.example.com",
    "-e",
    "SCHOOLSOFT_SCHOOL=synthetic-fixture",
    "-e",
    "SCHOOLSOFT_PROXY_HOPS=1",
    "-e",
    "SCHOOLSOFT_ADMIN_PASSWORD=synthetic-admin-password-for-container-test",
    "-e",
    "SCHOOLSOFT_STORAGE_KEY=" + "ab".repeat(32),
    image,
    "node",
    "/smoke/server.mjs",
  );
  const inside = (...command) =>
    docker("exec", "-e", "CONNECTOR_BASE=http://127.0.0.1:3000", name, ...command);
  let healthy = false;
  for (let attempt = 0; attempt < 50 && !healthy; attempt++) {
    try {
      healthy =
        inside(
          "node",
          "-e",
          "fetch('http://127.0.0.1:3000/healthz').then(r=>console.log(r.status))",
        ) === "200";
    } catch {
      /* The container may still be starting. */
    }
    if (!healthy) await delay(100);
  }
  assert.ok(healthy, "Container did not become healthy: " + docker("logs", name));
  assert.equal(docker("inspect", "--format", "{{.HostConfig.NetworkMode}}", name), "none");
  let output;
  try {
    output = inside("node", "/smoke/flow.mjs");
  } catch (error) {
    throw new Error(
      `Flow failed inside the container:\n${error.stdout ?? ""}${error.stderr ?? ""}`,
    );
  }
  console.log(output);
  assert.match(output, /Connector flow passed: 13 stages\./);
  docker("stop", "--timeout", "5", name);
  assert.equal(
    docker("inspect", "--format", "{{.State.ExitCode}}", name),
    "0",
    docker("logs", name),
  );
  console.log(
    "Container flow smoke passed: full owner, OAuth, MCP and REST flow inside the image; no network.",
  );
} finally {
  try {
    docker("rm", "-f", name);
  } catch {
    /* Nothing to remove when the container never started. */
  }
}
