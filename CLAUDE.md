# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is an MCP (Model Context Protocol) server for self-hosted Supabase deployments. It provides a 2-layer backend architecture:
- **PostgREST Layer**: RLS-aware data access respecting Row Level Security policies
- **Direct PostgreSQL Layer**: Schema introspection and diagnostics (read-only by default)

All tools use the `sbsh_` prefix to avoid collision with official Supabase MCP and PostgreSQL MCP servers.

## Development Commands

### Docker-First Development (Recommended)

This project follows a Docker-First workflow. All build artifacts (node_modules, dist) should live in Docker volumes, NOT on the Mac host.

```bash
# Start workspace for development
make up-workspace

# Enter workspace shell
make workspace

# Inside workspace: install dependencies
pnpm install

# Inside workspace: run dev mode with auto-reload
pnpm dev

# Inside workspace: build TypeScript
pnpm build

# Start MCP server (production mode)
make up

# View logs
make logs

# Stop all services
make down

# Full restart
make restart

# Health check
make health

# List available MCP tools
make list-tools
```

### Local Development (Without Docker)

```bash
# Install dependencies
pnpm install

# Development mode (auto-reload)
pnpm dev

# Build TypeScript
pnpm build

# Start server
pnpm start

# Type checking
pnpm typecheck
```

Server runs on port 3100 by default (configurable via PORT env var).

## Architecture & Code Structure

### Single-File Server Design

The entire MCP server is implemented in `src/server.ts` (~435 lines). This is intentional for simplicity and clarity.

**Key components:**

1. **Configuration** (lines 8-14): Environment variable loading with defaults
   - `PG_DSN`: PostgreSQL connection string
   - `POSTGREST_URL`: PostgREST endpoint
   - `POSTGREST_JWT`: JWT token for PostgREST auth
   - `READ_ONLY`: Safety mode (default: true)
   - `FEATURES`: Feature flags (database, docs, postgrest, functions, storage)

2. **PostgreSQL Pool** (lines 16-22): Connection pooling for direct DB access

3. **SQL Safety Guards** (lines 24-30):
   - `isMutatingSql()`: Blocks DML/DDL/DCL in READ_ONLY mode
   - `isExplain()`: Allows EXPLAIN queries

4. **MCP Tools** (lines 42-113): Lazy advertise pattern - only enabled features are exposed

5. **Tool Handlers** (lines 115-354): Four core handlers
   - `sbsh_introspect_schema`: Token-optimized schema digest
   - `sbsh_execute_sql`: Safe SQL execution with READ_ONLY guards
   - `sbsh_postgrest_get`: RLS-aware GET requests via PostgREST
   - `sbsh_get_table_doc`: Detailed table documentation

6. **Hono App** (lines 356-434): HTTP server with JSON-RPC endpoints
   - `/health`: Health check
   - `/mcp`: MCP JSON-RPC endpoint (tools/list, tools/call)

### Two-Layer Data Access Pattern

**Layer 1: PostgREST** (RLS-aware)
- Used by `sbsh_postgrest_get` handler
- Respects Row Level Security policies
- Requires JWT authentication
- User-scoped access to data

**Layer 2: Direct PostgreSQL** (Read-only)
- Used by `sbsh_introspect_schema`, `sbsh_execute_sql`, `sbsh_get_table_doc`
- Schema introspection and diagnostics
- Recommended to use read-only role (`mcp_ro`)
- Blocked DML/DDL/DCL in READ_ONLY mode

### Token Optimization Strategy

The server minimizes token usage through:
- **Lazy advertise**: Only enabled features are exposed in tools/list
- **Schema digest**: `introspect_schema` returns compressed format (e.g., `name:type!` where `!` = NOT NULL)
- **Minimal descriptions**: Tool descriptions are concise; full details available via `get_table_doc`
- **Row limits**: Configurable limits (max 1000) with truncation warnings

## Configuration

### Environment Setup

1. Copy `.env.example` to `.env`
2. Configure PostgreSQL connection (use read-only role for safety)
3. Configure PostgREST endpoint and JWT
4. Enable desired features via `FEATURES` flag

### Docker vs Local Development

**Docker** (uses `host.docker.internal`):
```env
PG_DSN=postgres://mcp_ro:password@host.docker.internal:5432/postgres
POSTGREST_URL=http://host.docker.internal:54321/rest/v1
```

**Local** (uses `127.0.0.1` or `localhost`):
```env
PG_DSN=postgres://mcp_ro:password@127.0.0.1:5432/postgres
POSTGREST_URL=http://127.0.0.1:54321/rest/v1
```

### Creating Read-Only PostgreSQL User

For safety, create a dedicated read-only role:

```sql
CREATE ROLE mcp_ro WITH LOGIN PASSWORD 'secure_password';
GRANT pg_read_all_data TO mcp_ro;
GRANT USAGE ON SCHEMA public TO mcp_ro;
GRANT USAGE ON SCHEMA information_schema TO mcp_ro;
```

## Security & Safety

### READ_ONLY Mode (Default: true)

When enabled:
- Blocks all DML/DDL/DCL operations (INSERT, UPDATE, DELETE, ALTER, DROP, CREATE, etc.)
- Only allows SELECT and EXPLAIN queries
- Enforced via regex-based SQL validation in `isMutatingSql()`

### Feature Flags

Control which tools are exposed via `FEATURES` env var:
- `database`: Schema introspection + SQL execution
- `docs`: Table documentation
- `postgrest`: PostgREST API wrapper
- `functions`: Edge Functions (not yet implemented)
- `storage`: Storage API (not yet implemented)

### RLS Awareness

PostgREST layer automatically enforces Row Level Security:
- Uses provided JWT for authentication
- Respects user-scoped RLS policies
- Direct PostgreSQL layer uses read-only role (no write permissions)

## Testing MCP Server

```bash
# Health check
curl http://localhost:3100/health

# List tools (JSON-RPC)
curl http://localhost:3100/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Call tool (example: introspect_schema)
curl http://localhost:3100/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":1,
    "method":"tools/call",
    "params":{
      "name":"sbsh_introspect_schema",
      "arguments":{"schemas":["public"]}
    }
  }'
```

## Integration with MCP Clients

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "airis-mcp-supabase-selfhost": {
      "command": "node",
      "args": ["/path/to/dist/server.js"],
      "env": {
        "PG_DSN": "postgres://mcp_ro:pass@localhost:5432/postgres",
        "POSTGREST_URL": "http://localhost:54321/rest/v1",
        "POSTGREST_JWT": "your_jwt_here",
        "READ_ONLY": "true",
        "FEATURES": "database,docs,postgrest"
      }
    }
  }
}
```

### airis-mcp-gateway (Dynamic Loading)

```typescript
// Load only when needed
await gateway.loadServer('airis-mcp-supabase-selfhost', {
  url: 'http://localhost:3100/mcp',
  features: 'database,docs'
})

// Unload after use
await gateway.unloadServer('airis-mcp-supabase-selfhost')
```

## Important Notes

- All build artifacts should be in Docker volumes, not on Mac host (see Makefile's `clean` target)
- Use `make workspace` to enter Docker shell for development commands
- The server uses Hono (lightweight web framework) instead of Express for better performance
- PostgreSQL queries use parameterized queries to prevent SQL injection
- Schema introspection queries target `information_schema` and `pg_catalog` system tables
- PostgREST queries support standard query parameters (select, eq, order, limit, etc.)
