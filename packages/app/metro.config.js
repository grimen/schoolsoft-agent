// Metro for the live dev server (`make app-web`) and `expo export`.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// The typed client, straight from the root package's build output. The workspace links the
// root package into itself (node_modules/schoolsoft-agent -> ..); resolving through that
// link makes the dev server's file map fail with "Failed to collapse" (expo export is
// unaffected). `make app-check`'s dev-bundle smoke guards this.
const TYPED_CLIENT = path.resolve(__dirname, "../../dist/client/index.js");

config.resolver.resolveRequest = (context, moduleName, platform) =>
  moduleName === "schoolsoft-agent/client"
    ? { type: "sourceFile", filePath: TYPED_CLIENT }
    : context.resolveRequest(context, moduleName, platform);

module.exports = config;
