import React, { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';

/**
 * Generates a cryptographically secure random raw nonce and its SHA-256 hashed counterpart
 * for Google Identity Services / Supabase verification.
 */
async function generateNonce() {
  try {
    if (typeof window === 'undefined' || !window.crypto?.subtle) {
      return { rawNonce: undefined, hashedNonce: undefined };
    }
    const rawBytes = window.crypto.getRandomValues(new Uint8Array(32));
    const rawNonce = Array.from(rawBytes, (b) => b.toString(16).padStart(2, '0')).join('');
    const encoder = new TextEncoder();
    const encoded = encoder.encode(rawNonce);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', encoded);
    const hashedNonce = Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, '0')).join('');
    return { rawNonce, hashedNonce };
  } catch (err) {
    console.warn('Nonce generation failed, falling back without custom nonce:', err);
    return { rawNonce: undefined, hashedNonce: undefined };
  }
}

/**
 * Loads the Google Identity Services client script if not already present.
 */
function loadGoogleScript() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return resolve(false);
    if (window.google?.accounts?.id) return resolve(true);

    const existingScript = document.getElementById('google-gsi-client');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(true), { once: true });
      existingScript.addEventListener('error', (e) => reject(e), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = 'google-gsi-client';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(true);
    script.onerror = (err) => {
      console.warn('Failed to load Google Identity Services SDK:', err);
      reject(err);
    };
    document.head.appendChild(script);
  });
}

// Module-level singleton state to prevent duplicate initialize() calls across re-renders and StrictMode
let isGsiInitialized = false;
let globalRawNonce = null;
let globalHashedNonce = null;
let activeAuthHandler = null;
let isPromptOpen = false;
let notifyPromptDisplayed = null;

// Android Chrome (FedCM) can black out and freeze the page if a full RTL/LTR relayout happens under the open sheet.
export function dismissGoogleOneTap() {
  if (!isPromptOpen) return;
  try {
    window.google?.accounts?.id?.cancel();
  } catch {}
  isPromptOpen = false;
  notifyPromptDisplayed?.(false);
}

export default function GoogleOneTap({ disabled = false, onPromptDisplayed }) {
  const { user, isGuest, loginWithGoogleIdToken } = useAuth();
  const isPromptOpenRef = useRef(false);

  useEffect(() => {
    notifyPromptDisplayed = onPromptDisplayed;
    return () => {
      if (notifyPromptDisplayed === onPromptDisplayed) notifyPromptDisplayed = null;
    };
  }, [onPromptDisplayed]);

  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  // Keep activeAuthHandler updated with latest loginWithGoogleIdToken without triggering re-initialization
  useEffect(() => {
    activeAuthHandler = async (credential, nonce) => {
      try {
        await loginWithGoogleIdToken(credential, nonce);
        onPromptDisplayed?.(false);
      } catch (authErr) {
        console.error('Google One Tap sign in error:', authErr);
      }
    };
  }, [loginWithGoogleIdToken, onPromptDisplayed]);

  useEffect(() => {
    // Only show One Tap to guests or unauthenticated users, when not disabled and client ID is available
    const shouldShow = Boolean(googleClientId) && !disabled && (!user || isGuest);

    if (!shouldShow) {
      if (isPromptOpenRef.current) {
        try {
          window.google?.accounts?.id?.cancel();
        } catch {}
        isPromptOpenRef.current = false;
        isPromptOpen = false;
      }
      onPromptDisplayed?.(false);
      return;
    }

    let isCancelled = false;

    const setupOneTap = async () => {
      try {
        await loadGoogleScript();
        if (isCancelled || !window.google?.accounts?.id) return;

        // Ensure google.accounts.id.initialize is called only once per client ID lifecycle
        if (!isGsiInitialized) {
          const { rawNonce, hashedNonce } = await generateNonce();
          globalRawNonce = rawNonce;
          globalHashedNonce = hashedNonce;

          window.google.accounts.id.initialize({
            client_id: googleClientId,
            callback: async (response) => {
              if (response?.credential && activeAuthHandler) {
                await activeAuthHandler(response.credential, globalRawNonce);
              }
            },
            ...(globalHashedNonce ? { nonce: globalHashedNonce } : {}),
            auto_select: false,
            cancel_on_tap_outside: true,
            itp_support: true,
          });

          isGsiInitialized = true;
        }

        if (isCancelled) return;

        // In FedCM (Federated Credential Management), the browser manages prompt display natively.
        // Calling prompt() without passing deprecated UI moment status methods (isDisplayed, isNotDisplayed, etc.)
        // prevents GSI_LOGGER FedCM deprecation warnings and ensures compliance with mandatory FedCM standards.
        window.google.accounts.id.prompt();
        isPromptOpenRef.current = true;
        isPromptOpen = true;
        onPromptDisplayed?.(true);
      } catch (err) {
        console.warn('Google One Tap initialization error:', err);
        onPromptDisplayed?.(false);
      }
    };

    setupOneTap();

    return () => {
      isCancelled = true;
      if (isPromptOpenRef.current) {
        try {
          window.google?.accounts?.id?.cancel();
        } catch {}
        isPromptOpenRef.current = false;
        isPromptOpen = false;
      }
    };
  }, [googleClientId, disabled, user, isGuest, onPromptDisplayed]);

  // Google One Tap renders natively into its own browser-managed overlay
  return null;
}

