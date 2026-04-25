import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Validate that environment variables are set
if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    '[ALPHA-C] Missing Supabase environment variables!\n' +
    'Make sure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set.\n' +
    'For Vercel deployments, add these in Project Settings > Environment Variables.'
  )
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '', {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
  // Ensure we handle reconnections gracefully
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
})

/**
 * Test if we can actually reach Supabase and query the sensor_data table.
 * Returns { connected: boolean, hasData: boolean, rowCount: number, error?: string }
 */
export async function testConnection() {
  try {
    if (!supabaseUrl || !supabaseAnonKey) {
      return { connected: false, hasData: false, rowCount: 0, error: 'Missing environment variables' }
    }

    const { data, error, count } = await supabase
      .from('sensor_data')
      .select('id', { count: 'exact', head: true })

    if (error) {
      console.error('[ALPHA-C] Connection test query error:', error.message)
      return { connected: false, hasData: false, rowCount: 0, error: error.message }
    }

    const rowCount = count ?? 0
    console.info(`[ALPHA-C] Connection test OK — ${rowCount} rows in sensor_data`)
    return { connected: true, hasData: rowCount > 0, rowCount }
  } catch (err) {
    console.error('[ALPHA-C] Connection test exception:', err.message)
    return { connected: false, hasData: false, rowCount: 0, error: err.message }
  }
}

/**
 * Fetch the latest N rows from sensor_data (newest first).
 * Returns { rows: array, error?: string }
 */
export async function fetchSensorData(limit = 50) {
  try {
    const { data, error } = await supabase
      .from('sensor_data')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('[ALPHA-C] fetchSensorData error:', error.message)
      return { rows: [], error: error.message }
    }

    return { rows: data || [] }
  } catch (err) {
    console.error('[ALPHA-C] fetchSensorData exception:', err.message)
    return { rows: [], error: err.message }
  }
}

/**
 * Subscribe to realtime INSERT events on sensor_data.
 * Returns the channel so the caller can remove it on cleanup.
 */
export function subscribeToSensorData({ onInsert, onStatusChange }) {
  const channel = supabase
    .channel('sensor_realtime', {
      config: {
        broadcast: { self: true },
      },
    })
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'sensor_data' },
      (payload) => {
        console.info('[ALPHA-C] Realtime INSERT received:', payload.new)
        onInsert?.(payload.new)
      }
    )
    .subscribe((status, err) => {
      console.info('[ALPHA-C] Realtime channel status:', status, err || '')
      onStatusChange?.(status, err)
    })

  return channel
}
