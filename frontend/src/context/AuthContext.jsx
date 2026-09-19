import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../supabaseClient';
import { deleteUserAccount } from '../api';

const AuthContext = createContext({
  user: null,
  session: null,
  token: null,
  loading: true,
  isConfigured: false,
  isGuest: false,
  loginWithGoogle: async () => {},
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
