# src/http — reserved

The remote transport (streamable HTTP MCP with per-user encrypted storage
and a hosted BankID callback) lives here in a later spec. It must follow
the same rules as the other adapters: import core only via
`../core/index.js`, never import `src/mcp` or `src/cli`.
