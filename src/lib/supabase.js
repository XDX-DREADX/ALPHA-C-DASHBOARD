import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// The actual IoT data table in Supabase
const TABLE_NAME = 'alpha-c'

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
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
})

/**
 * Fetch the latest N rows from the alpha-c table (newest first).
 * Returns { rows: array, error?: string }
 */
export async function fetchSensorData(limit = 50) {
  try {
    const { data, error } = await supabase
      .from(TABLE_NAME)
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
 * Subscribe to realtime INSERT events on the alpha-c table.
 * Returns the channel so the caller can remove it on cleanup.
 */
export function subscribeToSensorData({ onInsert, onStatusChange }) {
  const channel = supabase
    .channel('alpha-c-realtime', {
      config: {
        broadcast: { self: true },
      },
    })
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: TABLE_NAME },
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
