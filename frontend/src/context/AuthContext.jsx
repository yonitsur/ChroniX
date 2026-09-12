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

    // 1. Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // 2. Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    return () => {
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
    const { error } = await supabase.auth.linkIdentity({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
  };

  const logout = async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const deleteAccount = async () => {
    // 1. Call deleteUserAccount API
    await deleteUserAccount();

    // 2. Sign out locally and clear user/session state
    if (supabase) {
      try {
        await supabase.auth.signOut();
      } catch (err) {
        console.warn('Supabase local signOut after delete account failed:', err);
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
