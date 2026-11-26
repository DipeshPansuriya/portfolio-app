# MCP connection

**Date:** 2026-11-26  **Status:** None configured for this project

## Result

**This project configures and uses no MCP server.** Checked on 2026-11-26:

- no `.mcp.json` file in the repository;
- no `modelcontextprotocol` match in `src/`, `server/`, `scripts/`, `deploy/`, `tests/` or `shared/`;
- no MCP package in `package.json`.

A contributor's own AI tool may use MCP servers. That configuration belongs to the contributor's machine, not to
this repository.

## If one is added later

1. Ask the maintainer first: a new server is a new dependency.
2. Read secrets from environment variables by name. Never put a value in a config file in this repository.
3. Update this page with the server name, transport, purpose, tools used and the data it can reach.

## Related

[Integrations](Integrations.md), [contributor and agent guide](../AGENTS.md)
