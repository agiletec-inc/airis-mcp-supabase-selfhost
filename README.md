# Supabase Self-hosted MCP Server

MCP (Model Context Protocol) server for self-hosted Supabase with RLS-aware PostgreSQL + PostgREST layers.

---

## 🌟 Part of the AIRIS Ecosystem

This MCP server is designed to work with the **AIRIS Suite** - accessible via **airis-mcp-gateway** for token-efficient integration.

### The AIRIS Suite

| Component | Purpose | For Who |
|-----------|---------|---------|
| **[airis-agent](https://github.com/agiletec-inc/airis-agent)** | 🧠 Intelligence layer for all editors (confidence checks, deep research, self-review) | All developers using Claude Code, Cursor, Windsurf, Codex, Gemini CLI |
| **[airis-mcp-gateway](https://github.com/agiletec-inc/airis-mcp-gateway)** | 🚪 Unified MCP proxy with 90% token reduction via lazy loading | Claude Code users who want faster startup |
| **[mindbase](https://github.com/kazukinakai/mindbase)** | 💾 Local cross-session memory with semantic search | Developers who want persistent conversation history |
| **[airis-workspace](https://github.com/agiletec-inc/airis-workspace)** | 🏗️ Docker-first monorepo manager | Teams building monorepos |
| **[airiscode](https://github.com/agiletec-inc/airiscode)** | 🖥️ Terminal-first autonomous coding agent | CLI-first developers |

### MCP Servers (Included via Gateway)

- **airis-mcp-supabase-selfhost** (this repo) - Self-hosted Supabase MCP with RLS support
- **mindbase** - Memory search & storage tools (`mindbase_search`, `mindbase_store`)

### Recommended: Install via AIRIS MCP Gateway

This MCP server comes **pre-configured** with AIRIS MCP Gateway. No additional setup required.

```bash
# Install the Gateway (includes this server)
brew install agiletec-inc/tap/airis-mcp-gateway

# Start the gateway
airis-mcp-gateway up

# Add to Claude Code
claude mcp add --transport http airis-mcp-gateway http://api.gateway.localhost:9400/api/v1/mcp
```

### Alternative: Standalone Installation

If you need to run this server independently:

```bash
git clone https://github.com/agiletec-inc/airis-mcp-supabase-selfhost.git
cd airis-mcp-supabase-selfhost && pnpm install
```

**What you get with the full suite:**
- ✅ Confidence-gated workflows (prevents wrong-direction coding)
- ✅ Deep research with evidence synthesis
- ✅ 94% token reduction via repository indexing
- ✅ Cross-session memory across all editors
- ✅ Self-review and post-implementation validation

---

## ✨ Features

- **2-Layer Backend**: PostgREST (RLS-respected) + Direct PostgreSQL (schema introspection & diagnostics)
- **Token-Optimized**: Lazy advertise, schema digest, minimal tool descriptions
- **Safety-First**: READ_ONLY mode by default, DML/DDL/DCL blocked, SQL validation
- **Feature Flags**: Selective tool activation (database, docs, postgrest, functions, storage)
- **RLS Awareness**: PostgREST layer respects Row Level Security policies
- **Supabase Compatible**: Works with official Supabase self-hosted deployments

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│  LLM (Claude, GPT, etc.)               │
└───────────────┬─────────────────────────┘
                │ MCP Protocol (JSON-RPC)
┌───────────────▼─────────────────────────┐
│  Supabase Self-hosted MCP Server       │
│  ┌─────────────────────────────────┐   │
│  │  Feature Flags & Safety Guards  │   │
│  └─────────────────────────────────┘   │
│         │                    │          │
│  ┌──────▼──────┐      ┌─────▼──────┐   │
│  │  PostgREST  │      │   Direct   │   │
│  │   Layer     │      │    PG      │   │
│  │ (RLS aware) │      │ (read-only)│   │
│  └──────┬──────┘      └─────┬──────┘   │
└─────────┼──────────────────┼───────────┘
          │                  │
          ▼                  ▼
    ┌─────────────────────────────┐
    │   Supabase Self-hosted      │
    │   (PostgreSQL + PostgREST)  │
    └─────────────────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- Node.js >= 20.0.0
- Self-hosted Supabase instance running (localhost:54321 or remote)
- PostgreSQL read-only user (recommended)

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your Supabase credentials
```

**Key Configuration:**

```env
# PostgreSQL (use read-only role for safety)
PG_DSN=postgres://mcp_ro:password@127.0.0.1:5432/postgres

# PostgREST endpoint
POSTGREST_URL=http://127.0.0.1:54321/rest/v1

# PostgREST JWT (anon key or service_role key)
POSTGREST_JWT=your_anon_key_here

# Safety mode (recommended: true)
READ_ONLY=true

# Feature flags
FEATURES=database,docs,postgrest
```

### 3. Create Read-Only PostgreSQL User (Recommended)

```sql
-- Connect to your Supabase PostgreSQL as superuser
CREATE ROLE mcp_ro WITH LOGIN PASSWORD 'secure_password';
GRANT pg_read_all_data TO mcp_ro;
GRANT USAGE ON SCHEMA public TO mcp_ro;
GRANT USAGE ON SCHEMA information_schema TO mcp_ro;
```

### 4. Start Server

```bash
# Development mode (with auto-reload)
pnpm dev

# Production mode
pnpm build
pnpm start
```

Server starts on `http://localhost:3100`

## 🛠️ Available Tools

### MVP Tools (Current Implementation)

**Tool Prefix**: All tools use `sbsh_` prefix to avoid collision with official Supabase MCP and PostgreSQL MCP servers.

#### 1. `sbsh_introspect_schema`

Get token-optimized schema summary for specified schemas.

```json
{
  "name": "sbsh_introspect_schema",
  "arguments": {
    "schemas": ["public"]
  }
}
```

**Output**: Digest format with table names, column types, index/constraint counts, RLS status.

#### 2. `sbsh_execute_sql`

Execute SELECT queries or EXPLAIN plans safely.

```json
{
  "name": "sbsh_execute_sql",
  "arguments": {
    "sql": "SELECT * FROM users WHERE created_at > '2024-01-01' LIMIT 10",
    "limit": 100
  }
}
```

**Safety**: In READ_ONLY mode, DML/DDL/DCL are blocked.

#### 3. `sbsh_postgrest_get`

GET request via PostgREST with RLS respected.

```json
{
  "name": "sbsh_postgrest_get",
  "arguments": {
    "table": "users",
    "query": {
      "select": "id,email,created_at",
      "eq": "status:active",
      "order": "created_at.desc",
      "limit": 10
    }
  }
}
```

**Security**: Uses provided JWT, respects RLS policies.

#### 4. `sbsh_get_table_doc`

Get detailed documentation for a specific table.

```json
{
  "name": "sbsh_get_table_doc",
  "arguments": {
    "table": "public.users"
  }
}
```

**Output**: Columns, constraints, RLS policies, comments.

## 🔐 Security Features

### READ_ONLY Mode (Default)

- **Enabled by default** for safety
- Blocks all DML/DDL/DCL operations
- Only allows SELECT and EXPLAIN queries
- Recommended for production use

### SQL Validation

- Regex-based detection of mutating operations
- Blocks: INSERT, UPDATE, DELETE, TRUNCATE, ALTER, DROP, CREATE, GRANT, REVOKE, etc.
- Allows: SELECT, EXPLAIN

### RLS Respect

- PostgREST layer automatically enforces Row Level Security
- Direct PostgreSQL layer uses read-only role (no write permissions)
- JWT-based authentication for user-scoped access

### Feature Flags

Control tool availability via `FEATURES` environment variable:

- `database`: Schema introspection and SQL execution
- `docs`: Table documentation
- `postgrest`: PostgREST API wrapper
- `functions`: Edge Functions (not yet implemented)
- `storage`: Storage API (not yet implemented)

## 📊 Token Optimization

### Lazy Advertise

- Only advertise enabled features
- Minimal tool descriptions (detailed help on demand)
- Feature flags reduce initial token load

### Schema Digest

- `introspect_schema` returns compressed summary
- Full details via `docs.get_table_doc` on demand
- Column format: `name:type!` (! = NOT NULL)

### Result Sampling

- Configurable row limits (max 1000)
- Field metadata included for context
- Truncation warnings

## 🔧 Development Roadmap

### Phase 1: MVP (Current)
- [x] Project setup
- [x] Core tools: introspect_schema, execute_sql, postgrest.get, docs
- [x] READ_ONLY mode
- [x] Feature flags
- [x] Token optimization

### Phase 2: Enhanced Safety
- [ ] Dry-run mode for DML operations
- [ ] Audit logging
- [ ] Rate limiting
- [ ] Query cost estimation

### Phase 3: Extended Features
- [ ] Edge Functions support
- [ ] Storage API integration
- [ ] Real-time subscriptions
- [ ] Multi-project support

### Phase 4: Advanced Optimization
- [ ] Schema caching with invalidation
- [ ] Result pagination
- [ ] Streaming responses
- [ ] Connection pooling optimization

## 🤝 Integration

### With airis-mcp-gateway

This server is designed to work with dynamic MCP gateway patterns:

```typescript
// Load only when Supabase tools are needed
await gateway.loadServer('airis-mcp-supabase-selfhost', {
  url: 'http://localhost:3100/mcp',
  features: 'database,docs'
})

// Use tools
await gateway.call('airis-mcp-supabase-selfhost', 'sbsh_introspect_schema', {})

// Unload after use
await gateway.unloadServer('airis-mcp-supabase-selfhost')
```

### With Claude Desktop

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

---

## 🔗 Related Projects

Explore other tools in the AIRIS ecosystem:

- **[airis-mcp-gateway](https://github.com/agiletec-inc/airis-mcp-gateway)** - Unified MCP hub with 90% token reduction
- **[airis-agent](https://github.com/agiletec-inc/airis-agent)** - Intelligence layer for AI coding
- **[mindbase](https://github.com/agiletec-inc/mindbase)** - Local cross-session memory with semantic search
- **[airis-workspace](https://github.com/agiletec-inc/airis-workspace)** - Docker-first monorepo manager
- **[cmd-ime](https://github.com/agiletec-inc/cmd-ime)** - macOS IME switcher
- **[neural](https://github.com/agiletec-inc/neural)** - Local LLM translation tool
- **[airiscode](https://github.com/agiletec-inc/airiscode)** - Terminal-first autonomous coding agent

---

## 💖 Support This Project

If you find this project helpful, consider supporting its development:

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-yellow?style=for-the-badge&logo=buy-me-a-coffee)](https://buymeacoffee.com/kazukinakai)
[![GitHub Sponsors](https://img.shields.io/badge/GitHub%20Sponsors-sponsor-pink?style=for-the-badge&logo=github)](https://github.com/sponsors/kazukinakai)

Your support helps maintain and improve all AIRIS projects!

---

## 🤝 Contributing

We welcome contributions! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📝 License

MIT

---

## 🙏 Acknowledgments

- Inspired by [Supabase official MCP](https://supabase.com/docs/guides/ai/mcp)
- Built on [Model Context Protocol](https://modelcontextprotocol.io/)
- PostgreSQL introspection patterns from community MCP servers

---

**Built with ❤️ by the [Agiletec](https://github.com/agiletec-inc) team**

**[Agiletec Inc.](https://github.com/agiletec-inc)** | **[Documentation](docs/)** | **[Issues](https://github.com/agiletec-inc/airis-mcp-supabase-selfhost/issues)** | **[Discussions](https://github.com/agiletec-inc/airis-mcp-supabase-selfhost/discussions)**
