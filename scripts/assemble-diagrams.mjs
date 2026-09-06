// Assembles docs/diagrams/README.md from the per-diagram sources in
// docs/diagrams/src/*.mmd. The .mmd files are canonical (editable /
// individually renderable); the combined page embeds the pre-rendered
// docs/diagrams/dist/*.svg (rendered by `make diagrams` via mermaid-cli) so
// it loads instantly on GitHub instead of booting mermaid iframes.
// Run `make diagrams` after editing a source. CI fails on drift
// (scripts/ci/diagrams-check.sh); a missing SVG fails the assembly here.
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "diagrams");

export const SECTIONS = [
  {
    file: "system-overview.mmd",
    title: "System overview",
    outro:
      "One vendor-neutral core, two surfaces, many hosts. Everything SchoolSoft-specific sits\n" +
      "behind the SchoolProvider seam in src/providers/schoolsoft; the surfaces know how agents\n" +
      "talk; the hosts are somebody else's software.",
  },
  {
    file: "operation-registry.mmd",
    title: "One definition per capability",
    outro:
      "An operation is written once; the MCP tool, the CLI command and the reference\n" +
      "docs are derived from it, and a drift test fails when the docs go stale.",
  },
  {
    file: "login-flow.mmd",
    title: "Login, step by step",
    outro:
      "Two logins, both BankID in the user's own browser. The app session (top) is what every\n" +
      "API call uses; SchoolSoft stamps the user type into the token from the OAuth client id\n" +
      "(`vApp` = guardian) and the cookie exchange binds it to one child. The web session\n" +
      "(bottom) exists only because SchoolSoft's GDPR gate refuses app sessions on grades,\n" +
      "documents, absence and criteria.",
  },
  {
    file: "cold-start-refresh.mmd",
    title: "Cold start, refresh and the one retry",
    outro: "The retry exists because the alternative is a BankID round for the user.",
  },
  {
    file: "session-states.mmd",
    title: "Session states",
    outro:
      "Two independent lifecycles. The app session refreshes itself; the web session is\n" +
      "captured once and dies on SchoolSoft's inactivity timeout, so its errors name `login --web`.",
  },
  {
    file: "portal-adapter.mmd",
    title: "Portal adapter: API first, browser where no API exists",
    outro:
      "Dashed parts are optional: Playwright is an optional dependency, installed once with\n" +
      "`schoolsoft-agent browser install`; the engine behind it is Chromium or any CDP endpoint.",
  },
];

const blocks = SECTIONS.map(({ file, title, outro }) => {
  const svg = `dist/${file.replace(/\.mmd$/, "")}.svg`;
  if (!existsSync(join(here, svg))) {
    console.error(`missing ${svg} - run \`make diagrams\` to render it`);
    process.exit(1);
  }
  return `## ${title}\n\n[![${title}](${svg})](src/${file})\n${outro ? `\n${outro}\n` : ""}`;
});

const out = `<!-- GENERATED FILE - do not edit. Sources: src/*.mmd; run \`make diagrams\`. -->

# Diagrams

Pre-rendered SVGs for instant loading; click a diagram to open its editable
Mermaid source in [src/](src/) (which renders natively on GitHub, in VS Code,
and in Obsidian). Regenerate with \`make diagrams\`.

---

${blocks.join("\n---\n\n")}`;

writeFileSync(join(here, "README.md"), `${out.trim()}\n`);
console.log(`assembled docs/diagrams/README.md from ${SECTIONS.length} sources`);
