import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// Supabase returns this exact message when a user tries to sign in with
// an email that hasn't been verified yet. Detected so the UI can surface
// a "check your inbox / resend" panel instead of a raw error string.
const EMAIL_NOT_CONFIRMED = /email not confirmed/i;

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // If getSession() rejects (network meltdown, supabase outage at boot),
    // we still need to drop out of `loading` — otherwise the app is stuck
    // on the splash forever. Treat a rejection as "no session" so the
    // user lands on the auth screen and can retry by signing in.
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setUser(session?.user ?? null);
        setLoading(false);
      })
      .catch(() => {
        setUser(null);
        setLoading(false);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Force-refresh the React user state from the server. Used after
  // supabase.auth.updateUser() because supabase-js 2.x doesn't
  // consistently emit USER_UPDATED through onAuthStateChange when
  // only user_metadata changes — without this, components bound to
  // `user` (Settings avatar card, Drawer header) render stale.
  async function refreshUser() {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) return null;
      if (data?.user) setUser(data.user);
      return data?.user ?? null;
    } catch (_) {
      return null;
    }
  }

  async function signUp({ email, password, name }) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    });
    if (error) return { error: error.message };
    // With email verification on (mailer_autoconfirm=false), signUp returns
    // no session. Don't attempt a silent signInWithPassword — it would fail
    // with "Email not confirmed" and mask the real next step. Surface a
    // verification signal so the UI can show the "check your inbox" panel.
    if (!data.session) return { pendingVerification: true, email };
    return { data };
  }

  async function signIn({ email, password }) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (EMAIL_NOT_CONFIRMED.test(error.message)) {
        return { pendingVerification: true, email };
      }
      return { error: error.message };
    }
    return { data };
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  // OAuth providers (Google, Apple) use a full-page redirect to the provider
  // and back to the app. Supabase handles the session exchange on return;
  // the onAuthStateChange listener above picks it up automatically.
  async function signInWithProvider(provider) {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (error) return { error: error.message };
    return {};
  }

  return { user, loading, signUp, signIn, signOut, signInWithProvider, refreshUser };
}
