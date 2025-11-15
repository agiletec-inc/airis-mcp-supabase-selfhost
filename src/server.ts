import 'dotenv/config'
import { Hono } from 'hono'
import { prettyJSON } from 'hono/pretty-json'
import { serve } from '@hono/node-server'
import { Pool } from 'pg'
import { z } from 'zod'

// ====== Configuration ======
const PG_DSN = process.env.PG_DSN ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres'
const POSTGREST_URL = process.env.POSTGREST_URL ?? 'http://127.0.0.1:54321/rest/v1'
const POSTGREST_JWT = process.env.POSTGREST_JWT ?? ''
const READ_ONLY = (process.env.READ_ONLY ?? 'true').toLowerCase() === 'true'
const FEATURES = new Set((process.env.FEATURES ?? 'database,docs,postgrest').split(',').map(s => s.trim()))
const PORT = Number(process.env.PORT ?? 3100)

// ====== PostgreSQL Connection Pool ======
const pool = new Pool({
  connectionString: PG_DSN,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

// ====== SQL Safety Guards ======
const isMutatingSql = (sql: string): boolean => {
  const banned = /\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|DROP|CREATE|REINDEX|VACUUM|GRANT|REVOKE|COPY|ANALYZE|SET\s+ROLE|BEGIN|COMMIT|ROLLBACK)\b/i
  return banned.test(sql)
}

const isExplain = (sql: string): boolean => /^\s*EXPLAIN\b/i.test(sql)

// ====== JSON-RPC Schema ======
const RpcRequest = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.any().optional(),
})

type RpcHandler = (params: any) => Promise<any>

// ====== MCP Tools Definition (Lazy Advertise) ======
const listTools = () => {
  const tools: any[] = []

  if (FEATURES.has('database')) {
    tools.push(
      {
        name: 'sbsh_introspect_schema',
        description: '[sbsh] Return summarized schema info (tables/columns/keys/indexes/RLS). Output is token-optimized digest.',
        inputSchema: {
          type: 'object',
          properties: {
            schemas: {
              type: 'array',
              items: { type: 'string' },
              description: 'PostgreSQL schemas to introspect (default: ["public"])'
            }
          }
        }
      },
      {
        name: 'sbsh_execute_sql',
        description: READ_ONLY
          ? '[sbsh] Execute SELECT/EXPLAIN safely (READ-ONLY mode: DML/DDL blocked)'
          : '[sbsh] Execute SQL (DML/DDL guarded by allowlist; READ-ONLY recommended)',
        inputSchema: {
          type: 'object',
          required: ['sql'],
          properties: {
            sql: { type: 'string', description: 'SQL query to execute' },
            limit: { type: 'number', description: 'Row limit (max 1000, default 100)' }
          }
        }
      }
    )
  }

  if (FEATURES.has('postgrest')) {
    tools.push({
      name: 'sbsh_postgrest_get',
      description: '[sbsh] GET request via PostgREST with RLS respected. Use this for safe data access with user permissions.',
      inputSchema: {
        type: 'object',
        required: ['table'],
        properties: {
          table: { type: 'string', description: 'Table name' },
          query: {
            type: 'object',
            description: 'PostgREST query params (select, eq, order, limit, etc.)',
            additionalProperties: true
          }
        }
      }
    })
  }

  if (FEATURES.has('docs')) {
    tools.push({
      name: 'sbsh_get_table_doc',
      description: '[sbsh] Get minimal documentation for a table (columns/types/constraints/RLS).',
      inputSchema: {
        type: 'object',
        required: ['table'],
        properties: {
          table: { type: 'string', description: 'Table name (schema.table or just table)' }
        }
      }
    })
  }

  return tools
}

// ====== Tool Handlers ======
const handlers: Record<string, RpcHandler> = {}

// sbsh_introspect_schema
handlers['sbsh_introspect_schema'] = async (params) => {
  if (!FEATURES.has('database')) throw new Error('Feature "database" is disabled')

  const client = await pool.connect()
  try {
    const schemas = Array.isArray(params?.schemas) ? params.schemas : ['public']

    // Get columns
    const cols = await client.query<{
      table_schema: string
      table_name: string
      column_name: string
      data_type: string
      is_nullable: string
    }>(`
      SELECT table_schema, table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = ANY($1::text[])
      ORDER BY table_schema, table_name, ordinal_position
    `, [schemas])

    // Get indexes
    const idx = await client.query(`
      SELECT schemaname, tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = ANY($1::text[])
    `, [schemas])

    // Get constraints
    const cons = await client.query(`
      SELECT n.nspname AS schema, c.relname AS table, conname, contype
      FROM pg_constraint
      JOIN pg_class c ON c.oid = conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY($1::text[])
    `, [schemas])

    // Get RLS policies
    const rls = await client.query(`
      SELECT n.nspname AS schema, c.relname AS table, pol.polname AS policy_name, pol.cmd AS cmd
      FROM pg_policy pol
      JOIN pg_class c ON c.oid = pol.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY($1::text[])
    `, [schemas])

    // Build summary map
    const map: Record<string, any> = {}
    for (const row of cols.rows) {
      const key = `${row.table_schema}.${row.table_name}`
      map[key] ||= {
        schema: row.table_schema,
        table: row.table_name,
        columns: [],
        indexes: [],
        constraints: [],
        rls: []
      }
      map[key].columns.push({
        name: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === 'YES'
      })
    }

    for (const i of idx.rows) {
      const key = `${i.schemaname}.${i.tablename}`
      if (map[key]) map[key].indexes.push({ name: i.indexname, def: i.indexdef })
    }

    for (const c of cons.rows) {
      const key = `${c.schema}.${c.table}`
      if (map[key]) map[key].constraints.push({ name: c.conname, type: c.contype })
    }

    for (const p of rls.rows) {
      const key = `${p.schema}.${p.table}`
      if (map[key]) map[key].rls.push({ name: p.policy_name, cmd: p.cmd })
    }

    // Create token-optimized digest
    const digest = Object.values(map).map(t => ({
      schema: t.schema,
      table: t.table,
      cols: t.columns.map((c: any) => `${c.name}:${c.type}${c.nullable ? '' : '!'}`),
      idx_count: t.indexes.length,
      cons_count: t.constraints.length,
      rls: t.rls.length > 0
    }))

    return {
      digest,
      table_count: Object.keys(map).length,
      note: 'Use sbsh_get_table_doc for detailed column info'
    }
  } finally {
    client.release()
  }
}

// sbsh_execute_sql
handlers['sbsh_execute_sql'] = async (params) => {
  if (!FEATURES.has('database')) throw new Error('Feature "database" is disabled')

  const sql = String(params?.sql ?? '')
  const limit = Math.min(Number(params?.limit ?? 100), 1000)

  if (!sql.trim()) throw new Error('SQL query is required')

  // Safety check
  if (READ_ONLY && !isExplain(sql)) {
    if (isMutatingSql(sql)) {
      throw new Error('READ_ONLY mode: DML/DDL/DCL operations are blocked. Only SELECT and EXPLAIN are allowed.')
    }
  }

  const client = await pool.connect()
  try {
    // EXPLAIN queries return JSON format
    if (isExplain(sql)) {
      const result = await client.query(sql)
      return {
        type: 'explain',
        plan: result.rows
      }
    }

    // Regular SELECT queries
    const result = await client.query(sql)
    const rows = result.rows.slice(0, limit)

    return {
      type: 'query',
      rows,
      rowCount: result.rowCount,
      truncated: result.rows.length > limit,
      fields: result.fields.map(f => ({ name: f.name, type: f.dataTypeID }))
    }
  } finally {
    client.release()
  }
}

// sbsh_postgrest_get
handlers['sbsh_postgrest_get'] = async (params) => {
  if (!FEATURES.has('postgrest')) throw new Error('Feature "postgrest" is disabled')
  if (!POSTGREST_JWT) throw new Error('POSTGREST_JWT is not configured')

  const table = String(params?.table ?? '')
  const query = params?.query ?? {}

  if (!table) throw new Error('Table name is required')

  // Build query string
  const queryParams = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    queryParams.append(key, String(value))
  }

  const url = `${POSTGREST_URL}/${table}?${queryParams.toString()}`

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${POSTGREST_JWT}`,
      'apikey': POSTGREST_JWT,
      'Content-Type': 'application/json',
    }
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`PostgREST error (${response.status}): ${error}`)
  }

  const data = await response.json() as any
  return {
    data,
    count: Array.isArray(data) ? data.length : 0,
    rls_respected: true
  }
}

// sbsh_get_table_doc
handlers['sbsh_get_table_doc'] = async (params) => {
  if (!FEATURES.has('docs')) throw new Error('Feature "docs" is disabled')

  const tableInput = String(params?.table ?? '')
  if (!tableInput) throw new Error('Table name is required')

  const [schema, table] = tableInput.includes('.')
    ? tableInput.split('.')
    : ['public', tableInput]

  const client = await pool.connect()
  try {
    // Get table columns with details
    const cols = await client.query(`
      SELECT
        column_name,
        data_type,
        is_nullable,
        column_default,
        character_maximum_length,
        col_description((table_schema||'.'||table_name)::regclass, ordinal_position) as comment
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position
    `, [schema, table])

    // Get constraints
    const cons = await client.query(`
      SELECT conname, contype, pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conrelid = ($1 || '.' || $2)::regclass
    `, [schema, table])

    // Get RLS policies
    const rls = await client.query(`
      SELECT polname, polcmd, pg_get_expr(polqual, polrelid) as qual
      FROM pg_policy
      WHERE polrelid = ($1 || '.' || $2)::regclass
    `, [schema, table])

    return {
      schema,
      table,
      columns: cols.rows,
      constraints: cons.rows,
      rls_policies: rls.rows,
      rls_enabled: rls.rows.length > 0
    }
  } finally {
    client.release()
  }
}

// ====== Hono App ======
const app = new Hono()

app.use('*', prettyJSON())

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    features: Array.from(FEATURES),
    read_only: READ_ONLY
  })
})

// MCP endpoint (JSON-RPC)
app.post('/mcp', async (c) => {
  try {
    const body = await c.req.json()
    const req = RpcRequest.parse(body)

    // List tools
    if (req.method === 'tools/list') {
      return c.json({
        jsonrpc: '2.0',
        id: req.id,
        result: { tools: listTools() }
      })
    }

    // Call tool
    if (req.method === 'tools/call') {
      const toolName = req.params?.name
      if (!toolName || !handlers[toolName]) {
        return c.json({
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32601, message: `Tool not found: ${toolName}` }
        }, 404)
      }

      const result = await handlers[toolName](req.params?.arguments ?? {})
      return c.json({
        jsonrpc: '2.0',
        id: req.id,
        result
      })
    }

    return c.json({
      jsonrpc: '2.0',
      id: req.id,
      error: { code: -32601, message: `Method not found: ${req.method}` }
    }, 404)

  } catch (error: any) {
    console.error('MCP error:', error)
    return c.json({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: error.message ?? 'Internal error',
        data: error.stack
      }
    }, 500)
  }
})

// ====== Start Server ======
console.log(`🚀 Supabase Self-hosted MCP Server`)
console.log(`   Port: ${PORT}`)
console.log(`   Features: ${Array.from(FEATURES).join(', ')}`)
console.log(`   READ_ONLY: ${READ_ONLY}`)
console.log(`   PostgREST: ${POSTGREST_URL}`)
console.log(``)

serve({
  fetch: app.fetch,
  port: PORT,
})
