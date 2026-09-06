/**
 * Host-integration E2E, hermetic: no SchoolSoft, no API keys, no model.
 *
 * For every host we ship packaging for, launch the integration exactly the
 * way that host's manifest or documented snippet says, inside a sandbox
 * (temp HOME, temp config dir, the packed tarball installed into a temp npm
 * prefix so the manifests' bin names resolve without a registry), then:
 *   - MCP hosts: speak MCP over stdio to what the manifest launched
 *     (initialize, tools/list, an offline tool call, an auth-status call)
 *   - skill hosts: run the generated per-host skill folder's wrapper script
 *     the way the host's shell would, and check exit codes
 *   - Claude Code, when the `claude` CLI is on PATH: `claude plugin validate`
 *     and `claude plugin details` on both plugins (no model call)
 *
 * Requires `make build skills mcpb-stage` first (scripts/e2e/artifact-smoke.sh
 * does that). Runs in CI's E2E stage.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = process.cwd();
const built =
  existsSync(join(root, "dist", "mcp", "index.js")) && existsSync(join(root, "dist", "skills"));
const skip = built ? false : "run `make build skills mcpb-stage` first";

interface Sandbox {
  home: string;
  configDir: string;
  prefixBin: string;
  env: Record<string, string>;
}
let sb: Sandbox;

const SCHOOLS_FIXTURE = {
  fetchedAt: Date.now(),
  schools: [{ name: "Täby kommun - Rösjöskolan", slug: "taby", orgId: 20 }],
};

before(() => {
  if (!built) return;
  const dir = mkdtempSync(join(tmpdir(), "hosts-e2e-"));
  const home = join(dir, "home");
  const configDir = join(dir, "config");
  const prefix = join(dir, "prefix");
  mkdirSync(home, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "schools.json"), JSON.stringify(SCHOOLS_FIXTURE));

  // Pack the repo and install the tarball into a private npm prefix: this is
  // what `npm install -g schoolsoft-agent` gives a user, minus the registry.
  const pack = spawnSync("npm", ["pack", "--pack-destination", dir, "--silent"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(pack.status, 0, pack.stderr);
  const tarball = readdirSync(dir).find((f) => f.endsWith(".tgz"));
  assert.ok(tarball, "npm pack produced no tarball");
  const install = spawnSync(
    "npm",
    [
      "install",
      "-g",
      "--prefix",
      prefix,
      "--no-audit",
      "--no-fund",
      "--silent",
      join(dir, tarball),
    ],
    { encoding: "utf8" },
  );
  assert.equal(install.status, 0, install.stderr);
  const prefixBin = join(prefix, "bin");
  assert.ok(
    existsSync(join(prefixBin, "schoolsoft-agent")),
    "bin schoolsoft-agent missing from the installed package",
  );
  assert.ok(
    existsSync(join(prefixBin, "schoolsoft-agent-mcp")),
    "bin schoolsoft-agent-mcp missing from the installed package",
  );

  sb = {
    home,
    configDir,
    prefixBin,
    env: {
      PATH: `${prefixBin}${delimiter}${process.env.PATH ?? ""}`,
      HOME: home,
      SCHOOLSOFT_CONFIG_DIR: configDir,
      SCHOOLSOFT_SCHOOL: "",
      SCHOOLSOFT_AGENT_BIN: "",
    },
  };
});

after(() => {
  if (sb) rmSync(join(sb.home, ".."), { recursive: true, force: true });
});

/** Launch spec derived from a host manifest. */
interface Launch {
  host: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * Manifests reference `npx -y -p schoolsoft-agent@X schoolsoft-agent-mcp`;
 * in the sandbox the package is installed into the prefix, so run the bin
 * the manifest names (last arg) from PATH. Anything else runs verbatim.
 */
function resolveNpx(command: string, args: string[]): { command: string; args: string[] } {
  if (command === "npx") {
    const bin = args[args.length - 1];
    assert.match(bin, /^schoolsoft-agent(-mcp)?$/, `npx must name a shipped bin, got ${bin}`);
    return { command: join(sb.prefixBin, bin), args: [] };
  }
  return { command, args };
}

function substitute(v: string, vars: Record<string, string>): string {
  return v.replace(
    /\$\{([^}:]+)(?::-([^}]*))?\}/g,
    (_, name: string, def = "") => vars[name] ?? def,
  );
}

function launches(): Launch[] {
  const out: Launch[] = [];
  // Claude Code plugin
  const cc = JSON.parse(
    readFileSync(join(root, "plugins/claude/schoolsoft-mcp/.mcp.json"), "utf8"),
  );
  const s = cc.mcpServers.schoolsoft;
  out.push({
    host: "claude-code",
    ...resolveNpx(s.command, s.args),
    env: Object.fromEntries(
      Object.entries(s.env as Record<string, string>).map(([k, v]) => [
        k,
        substitute(v, { "user_config.school": "taby" }),
      ]),
    ),
  });
  // Claude Desktop (mcpb) — the staged bundle
  const mb = JSON.parse(readFileSync(join(root, "plugins/mcpb/manifest.json"), "utf8"));
  const mc = mb.server.mcp_config;
  const bundleDir = join(root, "dist", "mcpb");
  out.push({
    host: "claude-desktop",
    command: mc.command,
    args: (mc.args as string[]).map((a) => substitute(a, { __dirname: bundleDir })),
    env: Object.fromEntries(
      Object.entries(mc.env as Record<string, string>).map(([k, v]) => [
        k,
        substitute(v, { "user_config.school": "taby", "user_config.config_dir": sb.configDir }),
      ]),
    ),
  });
  // OpenCode
  const oc = JSON.parse(readFileSync(join(root, "plugins/opencode/opencode.json"), "utf8"));
  const [cmd, ...rest] = oc.mcp.schoolsoft.command as string[];
  out.push({
    host: "opencode",
    ...resolveNpx(cmd, rest),
    env: { ...oc.mcp.schoolsoft.environment },
  });
  // Hermes + OpenClaw: the documented snippet
  for (const host of ["hermes", "openclaw"]) {
    const doc = readFileSync(join(root, "docs/hosts", `${host}.md`), "utf8");
    assert.ok(
      /npx/.test(doc) && /schoolsoft-agent-mcp/.test(doc),
      `${host} guide must document the npx launch of schoolsoft-agent-mcp`,
    );
    out.push({
      host,
      ...resolveNpx("npx", ["-y", "-p", "schoolsoft-agent", "schoolsoft-agent-mcp"]),
      env: { SCHOOLSOFT_SCHOOL: "taby" },
    });
  }
  return out;
}

async function withMcp<T>(l: Launch, fn: (c: Client) => Promise<T>): Promise<T> {
  const transport = new StdioClientTransport({
    command: l.command,
    args: l.args,
    env: { ...sb.env, ...l.env },
    stderr: "pipe",
  });
  const client = new Client({ name: `hosts-e2e-${l.host}`, version: "1.0" });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

test(
  "MCP hosts: each manifest launches a server that lists 17 tools, answers offline, and reports no session",
  { skip },
  async () => {
    for (const l of launches()) {
      await withMcp(l, async (client) => {
        const { tools } = await client.listTools();
        assert.equal(tools.length, 17, `${l.host}: tools/list`);
        const found = await client.callTool({
          name: "schoolsoft_find_school",
          arguments: { query: "rösjö" },
        });
        assert.notEqual(
          found.isError,
          true,
          `${l.host}: find_school ${(found.content as { text: string }[])[0]?.text}`,
        );
        assert.equal(
          (found.structuredContent as { schools: { slug: string }[] }).schools[0].slug,
          "taby",
        );
        const status = await client.callTool({ name: "schoolsoft_auth_status", arguments: {} });
        assert.notEqual(
          status.isError,
          true,
          `${l.host}: auth_status ${(status.content as { text: string }[])[0]?.text}`,
        );
        assert.equal(
          (status.structuredContent as { authenticated: boolean; school: string }).authenticated,
          false,
        );
        assert.equal(
          (status.structuredContent as { school: string }).school,
          "taby",
          `${l.host}: env plumbing of the school`,
        );
      });
    }
  },
);

test(
  "skill hosts: each generated skill folder's wrapper runs the CLI with the right exit codes",
  { skip },
  () => {
    const hosts = readdirSync(join(root, "dist", "skills"));
    assert.ok(hosts.length >= 5, "expected one skill folder per host");
    for (const host of hosts) {
      const dir = join(root, "dist", "skills", host, "schoolsoft");
      const script = join(dir, "scripts", "schoolsoft.sh");
      assert.ok(existsSync(script), `${host}: wrapper missing`);
      const run = (args: string[], extra: Record<string, string> = {}) =>
        spawnSync("bash", [script, ...args], { encoding: "utf8", env: { ...sb.env, ...extra } });
      const v = run(["--version"]);
      assert.equal(v.status, 0, `${host}: ${v.stderr}`);
      assert.match(v.stdout, /^\d+\.\d+\.\d+/);
      assert.equal(run(["auth-status"]).status, 3, `${host}: no config → exit 3`);
      const st = run(["auth-status"], { SCHOOLSOFT_SCHOOL: "taby" });
      assert.equal(st.status, 0, `${host}: ${st.stderr}`);
      assert.equal(JSON.parse(st.stdout).authenticated, false);
      assert.equal(
        run(["list-children"], { SCHOOLSOFT_SCHOOL: "taby" }).status,
        2,
        `${host}: not authenticated → exit 2`,
      );
      const fs = run(["find-school", "--query", "rösjö"], { SCHOOLSOFT_SCHOOL: "taby" });
      assert.equal(fs.status, 0, `${host}: ${fs.stderr}`);
      assert.equal(JSON.parse(fs.stdout).schools[0].orgId, 20);
      // SCHOOLSOFT_AGENT_BIN override wins over PATH
      const ov = run(["--version"], { SCHOOLSOFT_AGENT_BIN: "/nonexistent/bin" });
      assert.notEqual(ov.status, 0, `${host}: explicit bin path must be honoured`);
    }
  },
);

test("Pi: package.json declares the skill folder that ships in the tarball", { skip }, () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  for (const rel of pkg.pi.skills as string[]) {
    assert.ok(existsSync(join(root, rel, "SKILL.md")), `${rel} missing`);
    assert.ok(
      pkg.files.some((f: string) => rel.startsWith(f)),
      `${rel} must be inside package.json "files"`,
    );
  }
});

test(
  "Claude Code CLI (when installed): plugin validate + details for both plugins",
  {
    skip:
      skip || (spawnSync("claude", ["--version"]).status === 0 ? false : "claude CLI not on PATH"),
  },
  () => {
    for (const p of ["schoolsoft-mcp", "schoolsoft-skill"]) {
      const dir = join(root, "plugins", "claude", p);
      const v = spawnSync("claude", ["plugin", "validate", dir], { encoding: "utf8" });
      assert.equal(v.status, 0, `${p}: ${v.stdout}${v.stderr}`);
      const d = spawnSync("claude", ["--plugin-dir", dir, "plugin", "details", p], {
        encoding: "utf8",
      });
      assert.equal(d.status, 0, `${p}: ${d.stdout}${d.stderr}`);
      assert.match(d.stdout + d.stderr, /schoolsoft/i);
    }
  },
);
