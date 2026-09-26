# Reference

- [MCP tools](tools.md): generated tool definitions for the full local integration.
- [CLI commands](commands.md): generated command reference.
- [REST API](rest-api.md): generated read routes, session endpoint and problem types of the parent-hosted connector.
- [OpenAPI document](openapi.json): the same REST API as OpenAPI 3.1, generated from the same schemas, for code generators and API tools; the typed JavaScript client is `schoolsoft-agent/client`.
- [SchoolSoft API](schoolsoft-api.md): upstream endpoints and observed behavior.

The parent-hosted connector exposes only its approved subset. See
[connector setup](../deployment/connector.md) for that scope and permissions.
Tool, command and REST references are generated from the operation registry; change
the source definitions and run `make docs` rather than editing generated files.
What of these contracts is stable between releases: [stability policy](../development/stability.md).

[All documentation](../README.md)
