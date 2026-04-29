import { createClient } from '@supabase/supabase-js'

// Fallback prevents build-time crash when env vars are absent (preview builds).
// Supabase is only used client-side inside useEffect/event handlers, so this is safe.
export const supabase = createClient(
  (process.env.NEXT_PUBLIC_SUPABASE_URL    || 'https://placeholder.supabase.co').trim(),
  (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder').trim()
)
