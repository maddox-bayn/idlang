import { useEffect, useRef, useState } from "react";
import type { User } from "../types";
import { loginUser, signupUser, type ApiError } from "../api/socialClient";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: User) => void;
  initialMode?: "login" | "signup";
}

export default function AuthModal({
  isOpen,
  onClose,
  onSuccess,
  initialMode = "login",
}: AuthModalProps) {
  const [mode, setMode] = useState<"login" | "signup">(initialMode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Login form state
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Signup form state
  const [signupUsername, setSignupUsername] = useState("");
  const [signupDisplayName, setSignupDisplayName] = useState("");
  const [signupNativeName, setSignupNativeName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupDialect, setSignupDialect] = useState("Central Otukpo");
  const [signupNativeSpeaker, setSignupNativeSpeaker] = useState(false);

  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!loginIdentifier.trim() || !loginPassword) {
      setError("Please enter your username/email and password.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const user = await loginUser(loginIdentifier.trim(), loginPassword);
      onSuccess(user);
      onClose();
    } catch (err: unknown) {
      const apiErr = err as ApiError;
      setError(apiErr.message || "Sign-in failed. Check your details and try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!signupUsername.trim() || !signupEmail.trim() || !signupPassword) {
      setError("Please fill in username, email, and password.");
      return;
    }
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(signupUsername.trim())) {
      setError("Username must be 3–24 letters, numbers or underscores."); return;
    }
    const passwordBytes = new TextEncoder().encode(signupPassword).length;
    if (passwordBytes > 72) { setError("Password must be 72 bytes or fewer."); return; }
    if (passwordBytes < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const user = await signupUser({
        username: signupUsername.trim(),
        display_name: signupDisplayName.trim() || signupUsername.trim(),
        native_name: signupNativeName.trim(),
        email: signupEmail.trim(),
        password: signupPassword,
        dialect: signupDialect,
        native_speaker: signupNativeSpeaker,
      });
      onSuccess(user);
      onClose();
    } catch (err: unknown) {
      const apiErr = err as ApiError;
      setError(apiErr.message || "Could not complete registration. Please try another username/email.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <dialog ref={dialog} onKeyDown={event => {
      if (event.key !== "Tab") return;
      const elements = [...event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]'
      )].filter(element => element.getClientRects().length > 0);
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }} aria-labelledby="auth-title" aria-describedby="auth-description"
      onCancel={event => { event.preventDefault(); if (!loading) onClose(); }}
      className="m-auto w-[calc(100%_-_2rem)] max-w-lg max-h-[92dvh] rounded-2xl border border-red-900 bg-neutral-950 p-0 text-red-100 backdrop:bg-black/80">
      {/* Main Authentication Box */}
      <div className="relative w-full p-6 sm:p-8">
        {/* Close Button */}
        <button
          onClick={onClose}
          disabled={loading}
          aria-label="Close sign-in dialog"
          className="absolute top-4 right-4 rounded-lg p-3 text-red-300 hover:bg-red-900/30 hover:text-red-200 transition-colors"
          title="Close modal"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Modal Header */}
        <div className="text-center pt-9 pb-5 border-b border-red-900/40">
          <span className="text-[10px] font-bold uppercase tracking-widest text-red-500">
            Idlang Identity & Heritage Network
          </span>
          <h2 id="auth-title" className="font-heading text-2xl font-bold tracking-wide text-red-100 mt-1">
            {mode === "login" ? "Welcome Back, Custodian" : "Join the Guardians of History"}
          </h2>
          <p id="auth-description" className="text-sm text-neutral-300 mt-1">
            {mode === "login"
              ? "Sign in to continue translating and access the community."
              : "Create an account to translate and explore Idoma heritage."}
          </p>

          {/* Mode Tabs */}
          <div className="mt-5 flex rounded-lg border border-red-900/40 bg-neutral-900/80 p-1">
            <button
              type="button"
              disabled={loading}
              aria-pressed={mode === "login"}
              onClick={() => {
                setMode("login");
                setError(null);
              }}
              className={`flex-1 rounded-md py-1.5 text-xs font-semibold uppercase tracking-wider transition-all ${
                mode === "login"
                  ? "bg-red-900 text-red-100 shadow"
                  : "text-red-400 hover:text-red-200"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              disabled={loading}
              aria-pressed={mode === "signup"}
              onClick={() => {
                setMode("signup");
                setError(null);
              }}
              className={`flex-1 rounded-md py-1.5 text-xs font-semibold uppercase tracking-wider transition-all ${
                mode === "signup"
                  ? "bg-red-900 text-red-100 shadow"
                  : "text-red-400 hover:text-red-200"
              }`}
            >
              Create Account
            </button>
          </div>
        </div>

        {/* Error Alert Banner */}
        {error && (
          <div role="alert" className="mt-4 rounded-lg border border-red-600 bg-red-950/60 p-3 text-xs text-red-200 flex items-start gap-2">
            <span className="font-bold text-red-400 shrink-0">⚠️ Error:</span>
            <span>{error}</span>
          </div>
        )}

        {/* LOGIN FORM */}
        {mode === "login" && (
          <form onSubmit={handleLoginSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="login-identifier" className="block text-xs font-semibold uppercase tracking-wider text-red-300 mb-1">
                Username or Email Address
              </label>
              <input id="login-identifier" name="login-identifier" autoComplete="username" disabled={loading}
                type="text"
                value={loginIdentifier}
                onChange={(e) => setLoginIdentifier(e.target.value)}
                placeholder="e.g. oche_odeh or oche@idlang.org"
                className="w-full rounded-lg border border-red-900/50 bg-neutral-900 px-3.5 py-2.5 text-sm text-red-100 placeholder-neutral-500 focus:border-red-500 focus:outline-none"
                required
                autoFocus
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-xs font-semibold uppercase tracking-wider text-red-300 mb-1">
                Password
              </label>
              <input id="login-password" name="login-password" autoComplete="current-password" disabled={loading}
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Enter your account password"
                className="w-full rounded-lg border border-red-900/50 bg-neutral-900 px-3.5 py-2.5 text-sm text-red-100 placeholder-neutral-500 focus:border-red-500 focus:outline-none"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full rounded-lg bg-red-800 py-2.5 text-xs font-bold uppercase tracking-wider text-red-100 shadow transition-all hover:bg-red-700 active:scale-95 disabled:opacity-50"
            >
              {loading ? "Authenticating Account..." : "Sign In to Idlang"}
            </button>

            <div className="pt-2 text-center text-xs text-neutral-400">
              Don't have an account yet?{" "}
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  setMode("signup");
                  setError(null);
                }}
                className="font-semibold text-red-400 hover:text-red-300 underline underline-offset-2"
              >
                Create one now
              </button>
            </div>
          </form>
        )}

        {/* SIGNUP FORM */}
        {mode === "signup" && (
          <form onSubmit={handleSignupSubmit} className="mt-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="signup-username" className="block text-xs font-semibold uppercase tracking-wider text-red-300 mb-1">
                  Username *
                </label>
                <input id="signup-username" name="signup-username" autoComplete="username" disabled={loading}
                  type="text"
                  minLength={3} maxLength={24} pattern="[a-zA-Z0-9_]{3,24}"
                  value={signupUsername}
                  onChange={(e) => setSignupUsername(e.target.value)}
                  placeholder="e.g. oche_odeh"
                  className="w-full rounded-lg border border-red-900/50 bg-neutral-900 px-3 py-2 text-sm text-red-100 placeholder-neutral-400 focus:border-red-500 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label htmlFor="signup-display-name" className="block text-xs font-semibold uppercase tracking-wider text-red-300 mb-1">
                  Display Name
                </label>
                <input id="signup-display-name" name="signup-display-name" autoComplete="name" disabled={loading}
                  type="text"
                  value={signupDisplayName}
                  onChange={(e) => setSignupDisplayName(e.target.value)}
                  placeholder="e.g. Oche Odeh"
                  className="w-full rounded-lg border border-red-900/50 bg-neutral-900 px-3 py-2 text-sm text-red-100 placeholder-neutral-400 focus:border-red-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Native Name Requirement Field */}
            <div className="rounded-lg border border-red-900/60 bg-red-950/20 p-3">
              <label htmlFor="signup-native-name" className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-red-300 mb-1">
                <span className="flex items-center gap-1.5">
                  <span>🪘</span>
                  <span>Native Idoma Name</span>
                </span>
                <span className="text-[10px] text-red-400 lowercase font-normal italic">
                  ancestral identity
                </span>
              </label>
              <input id="signup-native-name" name="signup-native-name" autoComplete="nickname" disabled={loading}
                type="text"
                value={signupNativeName}
                onChange={(e) => setSignupNativeName(e.target.value)}
                placeholder="e.g. Onyilo, Onyeche, Agbo, Ochanya, Alechenu..."
                className="w-full rounded-lg border border-red-900/50 bg-neutral-900 px-3 py-2 text-sm text-red-100 placeholder-neutral-400 focus:border-red-500 focus:outline-none"
              />
              <p className="mt-1 text-[10px] text-neutral-400">
                Your traditional or indigenous ancestral name. Displayed with honor on your profile badge.
              </p>
            </div>

            <div>
              <label htmlFor="signup-email" className="block text-xs font-semibold uppercase tracking-wider text-red-300 mb-1">
                Email Address *
              </label>
              <input id="signup-email" name="signup-email" autoComplete="email" disabled={loading}
                type="email"
                value={signupEmail}
                onChange={(e) => setSignupEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full rounded-lg border border-red-900/50 bg-neutral-900 px-3 py-2 text-sm text-red-100 placeholder-neutral-400 focus:border-red-500 focus:outline-none"
                required
              />
            </div>

            <div>
              <label htmlFor="signup-password" className="block text-xs font-semibold uppercase tracking-wider text-red-300 mb-1">
                Password * (min. 6 chars)
              </label>
              <input id="signup-password" name="signup-password" autoComplete="new-password" disabled={loading}
                type="password"
                minLength={6}
                value={signupPassword}
                onChange={(e) => setSignupPassword(e.target.value)}
                placeholder="Choose a secure password"
                className="w-full rounded-lg border border-red-900/50 bg-neutral-900 px-3 py-2 text-sm text-red-100 placeholder-neutral-400 focus:border-red-500 focus:outline-none"
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="signup-dialect" className="block text-xs font-semibold uppercase tracking-wider text-red-300 mb-1">
                  Dialect Region
                </label>
                <select id="signup-dialect" name="signup-dialect" autoComplete="off" disabled={loading}
                  value={signupDialect}
                  onChange={(e) => setSignupDialect(e.target.value)}
                  className="w-full rounded-lg border border-red-900/50 bg-neutral-900 px-3 py-2 text-xs text-red-100 focus:border-red-500 focus:outline-none"
                >
                  <option value="Central Otukpo">Central Otukpo</option>
                  <option value="Okpokwu">Okpokwu</option>
                  <option value="Adoka">Adoka</option>
                  <option value="Agatu">Agatu</option>
                  <option value="Orokam">Orokam</option>
                  <option value="General Idoma">General Idoma</option>
                </select>
              </div>

              <div className="flex items-center pt-5">
                <label className="flex items-center gap-2 cursor-pointer text-xs text-neutral-300">
                  <input
                    type="checkbox"
                    checked={signupNativeSpeaker}
                    onChange={(e) => setSignupNativeSpeaker(e.target.checked)}
                    className="h-4 w-4 rounded border-red-900 bg-neutral-900 text-red-600 focus:ring-0"
                  />
                  <span>I am a native speaker</span>
                </label>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full rounded-lg bg-red-800 py-2.5 text-xs font-bold uppercase tracking-wider text-red-100 shadow transition-all hover:bg-red-700 active:scale-95 disabled:opacity-50"
            >
              {loading ? "Registering Profile..." : "Create Ancestral Profile"}
            </button>

            <div className="pt-2 text-center text-xs text-neutral-400">
              Already have an account?{" "}
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  setMode("login");
                  setError(null);
                }}
                className="font-semibold text-red-400 hover:text-red-300 underline underline-offset-2"
              >
                Sign in here
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}
