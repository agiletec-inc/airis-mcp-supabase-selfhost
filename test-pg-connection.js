import pg from 'pg'
const { Pool } = pg

const testConnections = async () => {
  const configs = [
    {
      name: 'postgres via .orb.local',
      connectionString: 'postgres://postgres:your-super-secret-and-long-postgres-password@agiletec-supabase-db.orb.local:5432/postgres'
    },
    {
      name: 'postgres via .orb.local with options',
      connectionString: 'postgres://postgres:your-super-secret-and-long-postgres-password@agiletec-supabase-db.orb.local:5432/postgres?options=-c%20search_path=public,extensions'
    },
    {
      name: 'postgres via localhost (if port mapped)',
      connectionString: 'postgres://postgres:your-super-secret-and-long-postgres-password@localhost:5432/postgres'
    }
  ]

  for (const config of configs) {
    console.log(`\n\n=== Testing: ${config.name} ===`)
    const pool = new Pool({ connectionString: config.connectionString })

    try {
      const client = await pool.connect()
      console.log('✅ Connection successful')

      const result = await client.query('SELECT current_database(), current_user, version()')
      console.log('Database:', result.rows[0].current_database)
      console.log('User:', result.rows[0].current_user)
      console.log('Version:', result.rows[0].version.split('\n')[0])

      const tables = await client.query(`
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        LIMIT 5
      `)
      console.log(`Tables in public schema: ${tables.rowCount}`)
      if (tables.rows.length > 0) {
        console.log('Sample tables:', tables.rows.map(r => r.table_name).join(', '))
      }

      client.release()
    } catch (error) {
      console.error('❌ Connection failed:', error.message)
      console.error('Error code:', error.code)
    } finally {
      await pool.end()
    }
  }
}

testConnections().catch(console.error)
