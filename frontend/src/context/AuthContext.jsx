import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../supabaseClient';
import { claimGuestWork, deleteUserAccount } from '../api';

// Signing into an existing account switches to a different user id, which would orphan
// everything saved as a guest. The last guest session is remembered here so the backend
// can move its timelines into the account once the sign-in completes (also across the
// OAuth redirect).
const GUEST_HANDOFF_KEY = 'chronix_guest_handoff';
export const GUEST_WORK_CLAIMED_EVENT = 'chronix:guest-work-claimed';
let guestClaimInFlight = null;

const readGuestHandoff = () => {
  try {
    return JSON.parse(localStorage.getItem(GUEST_HANDOFF_KEY) || 'null');
  } catch {
    return null;
  }
};

const clearGuestHandoff = (guestUserId) => {
  try {
    if (readGuestHandoff()?.userId === guestUserId) localStorage.removeItem(GUEST_HANDOFF_KEY);
  } catch { }
};

const syncGuestHandoff = (session) => {
  const sessionUser = session?.user;
  if (!sessionUser) return;

  if (sessionUser.is_anonymous) {
    try {
      localStorage.setItem(GUEST_HANDOFF_KEY, JSON.stringify({
        userId: sessionUser.id,
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
      }));
    } catch { }
    return;
  }

  const handoff = readGuestHandoff();
  if (!handoff?.userId) return;
  if (handoff.userId === sessionUser.id) {
    // Guest was upgraded in place (same id) - nothing to move.
    clearGuestHandoff(handoff.userId);
    return;
  }
  if (guestClaimInFlight) return;

  guestClaimInFlight = claimGuestWork(session.access_token, handoff.accessToken, handoff.refreshToken)
    .then((result) => {
      clearGuestHandoff(handoff.userId);
      if (result?.transferred > 0) {
        window.dispatchEvent(new CustomEvent(GUEST_WORK_CLAIMED_EVENT, { detail: result }));
      }
    })
    .catch((err) => {
      // Invalid/expired guest session can never succeed; keep it for network/server errors so the next load retries.
      if (err?.status === 400 || err?.status === 403) clearGuestHandoff(handoff.userId);
      console.warn('Could not move guest timelines into the signed-in account:', err);
    })
    .finally(() => {
      guestClaimInFlight = null;
    });
};

// Resolves once any in-flight guest -> account claim settles (never rejects). Callers that
// touch guest-owned server state after a sign-in (e.g. resuming a generation that was
// started as a guest) should await this first, since the claim is what transfers ownership.
export const waitForGuestClaim = () => guestClaimInFlight || Promise.resolve();

const AuthContext = createContext({
  user: null,
  session: null,
  token: null,
  loading: true,
  isConfigured: false,
  isGuest: false,
  loginWithGoogle: async () => {},
  loginWithGoogleIdToken: async () => {},
  loginWithFacebook: async () => {},
  loginWithEmail: async () => {},
  signUpWithEmail: async () => {},
  loginAsGuest: async () => {},
  upgradeGuestWithEmail: async () => {},
  upgradeGuestWithGoogle: async () => {},
  logout: async () => {},
  deleteAccount: async () => {},
});

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }

    let isMounted = true;

    // 1. Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!isMounted) return;
      if (!session) {
        // Automatically sign in as anonymous guest so visitors skip any login wall
        try {
          const { data, error } = await supabase.auth.signInAnonymously();
          if (!isMounted) return;
          if (!error && data?.session) {
            syncGuestHandoff(data.session);
            setSession(data.session);
            setUser(data.session.user ?? null);
            setLoading(false);
            return;
          }
        } catch (err) {
          console.warn('Auto guest login failed, continuing as unauthenticated visitor:', err);
        }
      }
      if (isMounted) {
        syncGuestHandoff(session);
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    }).catch((err) => {
      console.warn('Error fetching Supabase session:', err);
      if (isMounted) setLoading(false);
    });

    // 2. Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!isMounted) return;
        syncGuestHandoff(session);
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const loginWithGoogle = async () => {
    if (!supabase) throw new Error('Supabase is not configured');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (error) throw error;
  };

  const loginWithGoogleIdToken = async (idToken, nonce) => {
    if (!supabase) throw new Error('Supabase is not configured');
    const options = {
      provider: 'google',
      token: idToken,
    };
    if (nonce) {
      options.nonce = nonce;
    }
    const { data, error } = await supabase.auth.signInWithIdToken(options);
    if (error) throw error;
    return data;
  };

  const loginWithFacebook = async () => {
    if (!supabase) throw new Error('Supabase is not configured');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'facebook',
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (error) throw error;
  };

  const loginWithEmail = async (email, password) => {
    if (!supabase) throw new Error('Supabase is not configured');
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data;
  };

  const signUpWithEmail = async (email, password, displayName = '') => {
    if (!supabase) throw new Error('Supabase is not configured');
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: displayName,
        },
      },
    });
    if (error) throw error;
    return data;
  };

  const loginAsGuest = async () => {
    if (!supabase) throw new Error('Supabase is not configured');
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
    return data;
  };

  // Converts the current anonymous session into a permanent account, keeping the
  // same user id (and therefore all timelines already saved as a guest).
  const upgradeGuestWithEmail = async (email, password, displayName = '') => {
    if (!supabase) throw new Error('Supabase is not configured');
    const { data, error } = await supabase.auth.updateUser({
      email,
      password,
      data: displayName ? { full_name: displayName } : undefined,
    });
    if (error) throw error;
    return data;
  };

  const upgradeGuestWithGoogle = async () => {
    if (!supabase) throw new Error('Supabase is not configured');
    try {
      const { error } = await supabase.auth.linkIdentity({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (error) {
        // Fallback to standard Google OAuth if manual identity linking is disabled
        await loginWithGoogle();
      }
    } catch {
      await loginWithGoogle();
    }
  };

  const logout = async () => {
    if (!supabase) return;
    try {
      await supabase.auth.signOut();
      // Immediately start a fresh anonymous guest session so the user stays in the app as a guest
      const { data, error } = await supabase.auth.signInAnonymously();
      if (!error && data?.session) {
        setSession(data.session);
        setUser(data.session.user ?? null);
        return;
      }
    } catch (err) {
      console.warn('Error during logout / guest reset:', err);
    }
    setUser(null);
    setSession(null);
  };

  const deleteAccount = async () => {
    // 1. Call deleteUserAccount API
    await deleteUserAccount();

    // 2. Sign out locally and transition to a fresh guest session
    if (supabase) {
      try {
        await supabase.auth.signOut();
        const { data } = await supabase.auth.signInAnonymously();
        if (data?.session) {
          setSession(data.session);
          setUser(data.session.user ?? null);
          return;
        }
      } catch (err) {
        console.warn('Supabase local signOut/guest reset after delete account failed:', err);
      }
    }
    setUser(null);
    setSession(null);
  };

  const value = {
    user,
    session,
    token: session?.access_token || null,
    loading,
    isConfigured: isSupabaseConfigured,
    isGuest: Boolean(user?.is_anonymous),
    loginWithGoogle,
    loginWithGoogleIdToken,
    loginWithFacebook,
    loginWithEmail,
    signUpWithEmail,
    loginAsGuest,
    upgradeGuestWithEmail,
    upgradeGuestWithGoogle,
    logout,
    deleteAccount,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
