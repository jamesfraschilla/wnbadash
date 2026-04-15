import { createContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient.js";
import { ACCOUNTS_ENABLED, buildAuthRedirectUrl, isAllowedAccountEmail, normalizeAccountEmail } from "../authConfig.js";
import { fetchProfile, touchProfileLastLogin } from "../accountData.js";

export const AuthContext = createContext(null);

async function exchangeUrlSession() {
  if (!supabase || typeof window === "undefined") return;
  const search = window.location.search || "";
  if (!search.includes("code=")) return;
  const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
  if (error) throw error;
  const nextUrl = `${window.location.pathname}${window.location.hash || ""}`;
  window.history.replaceState({}, "", nextUrl);
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(ACCOUNTS_ENABLED && Boolean(supabase));
  const [error, setError] = useState("");
  const [emailSentTo, setEmailSentTo] = useState("");
  const [requiresPasswordReset, setRequiresPasswordReset] = useState(false);

  useEffect(() => {
    if (!ACCOUNTS_ENABLED || !supabase) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;

    const loadProfile = async (user) => {
      if (!user?.id) {
        if (!cancelled) setProfile(null);
        return;
      }
      try {
        const nextProfile = await fetchProfile(user.id);
        if (cancelled) return;
        setProfile(nextProfile || null);
        setError("");
        if (nextProfile?.status === "active") {
          touchProfileLastLogin(user.id).catch(() => {});
        }
      } catch (profileError) {
        if (!cancelled) {
          setProfile(null);
          setError(profileError?.message || "Unable to load account profile.");
        }
      }
    };

    const initialize = async () => {
      try {
        if (typeof window !== "undefined" && window.location.search.includes("type=recovery")) {
          setRequiresPasswordReset(true);
        }
        await exchangeUrlSession();
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        setSession(data.session || null);
        setError("");
        loadProfile(data.session?.user || null);
      } catch (sessionError) {
        if (!cancelled) {
          setError(sessionError?.message || "Unable to initialize account session.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    initialize();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      if (cancelled) return;
      if (_event === "PASSWORD_RECOVERY") {
        setRequiresPasswordReset(true);
      } else if (_event === "SIGNED_OUT") {
        setRequiresPasswordReset(false);
      }
      setSession(nextSession || null);
      setEmailSentTo("");
      loadProfile(nextSession?.user || null);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const featureFlags = profile?.feature_flags || [];
  const isAdmin = profile?.role === "admin";
  const isCoach = profile?.role === "coach" || isAdmin;
  const canUseMatchUps = isAdmin || featureFlags.includes("match_ups");

  const value = useMemo(() => ({
    accountsEnabled: ACCOUNTS_ENABLED && Boolean(supabase),
    session,
    user: session?.user || null,
    profile,
    loading,
    error,
    emailSentTo,
    requiresPasswordReset,
    featureFlags,
    clearError() {
      setError("");
    },
    async signInWithPassword(email, password) {
      if (!supabase) throw new Error("Supabase is not configured.");
      const normalized = normalizeAccountEmail(email);
      if (!isAllowedAccountEmail(normalized)) {
        throw new Error("Use your Monumental Sports email address.");
      }
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: normalized,
        password: String(password || ""),
      });
      if (signInError) throw signInError;
    },
    async sendMagicLink(email) {
      if (!supabase) throw new Error("Supabase is not configured.");
      const normalized = normalizeAccountEmail(email);
      if (!isAllowedAccountEmail(normalized)) {
        throw new Error("Use your Monumental Sports email address.");
      }
      const { error: signInError } = await supabase.auth.signInWithOtp({
        email: normalized,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: buildAuthRedirectUrl(),
        },
      });
      if (signInError) throw signInError;
      setEmailSentTo(normalized);
    },
    async sendPasswordReset(email) {
      if (!supabase) throw new Error("Supabase is not configured.");
      const normalized = normalizeAccountEmail(email);
      if (!isAllowedAccountEmail(normalized)) {
        throw new Error("Use your Monumental Sports email address.");
      }
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalized, {
        redirectTo: buildAuthRedirectUrl(),
      });
      if (resetError) throw resetError;
      setEmailSentTo(normalized);
    },
    async signOut() {
      if (!supabase) return;
      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
      if (signOutError) throw signOutError;
      setProfile(null);
      setSession(null);
      setRequiresPasswordReset(false);
    },
    async completePasswordReset(nextPassword) {
      if (!supabase) throw new Error("Supabase is not configured.");
      const password = String(nextPassword || "");
      if (password.length < 8) {
        throw new Error("Use a password with at least 8 characters.");
      }
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setRequiresPasswordReset(false);
    },
    hasFeature(flag) {
      return isAdmin || featureFlags.includes(flag);
    },
    canUseMatchUps,
    isAdmin,
    isCoach,
  }), [canUseMatchUps, emailSentTo, error, featureFlags, isAdmin, isCoach, loading, profile, requiresPasswordReset, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
