import { createClient } from '@supabase/supabase-js';
import { createSingleFlight } from './utils/requestCoalescing';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

/**
 * Returns the current session, signing in anonymously only when there is none. Concurrent callers
 * (AuthContext's first-visit sign-in and `getHeaders()` in api.js) share ONE in-flight sign-in, so
 * a first visit never mints two guest users. Resolves to `{ data: { session }, error }` like
 * `signInAnonymously()`.
 */
export const ensureAnonymousSession = createSingleFlight(async () => {
  if (!supabase) return { data: { session: null }, error: null };
  const { data } = await supabase.auth.getSession();
  if (data?.session) return { data: { session: data.session }, error: null };
  return supabase.auth.signInAnonymously();
});
