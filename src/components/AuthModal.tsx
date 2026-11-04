import { useEffect, useState } from "react";
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

  // Popup Modal Alert State for "Account not created before -> Popup -> Route to Signup"
  const [popupAlert, setPopupAlert] = useState<{
    show: boolean;
    title: string;
    message: string;
    targetIdentifier?: string;
  } | null>(null);

  // The modal stays mounted while closed, so useState(initialMode) alone keeps
  // the previous tab when it is opened again from a different auth button.
  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setError(null);
      setPopupAlert(null);
    }
  }, [isOpen, initialMode]);

  if (!isOpen) return null;

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      // Requirement 1: If account has not been created before, show error popup and route to signup
      if (
        apiErr.code === "USER_NOT_FOUND" ||
        apiErr.status === 404 ||
        (apiErr.message && /not exist|create an account|not found/i.test(apiErr.message))
      ) {
        const idVal = loginIdentifier.trim();
        setPopupAlert({
          show: true,
          title: "Account Not Found",
          message: `No account exists with username or email "${idVal}". You need to create an account first. We are routing you to the Sign Up page now!`,
          targetIdentifier: idVal,
        });

        // Pre-fill signup fields from login attempt
        if (idVal.includes("@")) {
          setSignupEmail(idVal);
          setSignupUsername(idVal.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "_"));
        } else {
          setSignupUsername(idVal);
        }

        // Switch to signup tab
        setMode("signup");
      } else if (apiErr.code === "INVALID_PASSWORD" || (apiErr.message && /password/i.test(apiErr.message))) {
        setError(apiErr.message || "Incorrect password. Please verify your credentials and try again.");
      } else {
        setError(apiErr.message || "Failed to log in. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signupUsername.trim() || !signupEmail.trim() || !signupPassword) {
      setError("Please fill in username, email, and password.");
      return;
    }
    if (signupPassword.length < 6) {
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

  const dismissPopup = () => {
    setPopupAlert(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      {/* Account Not Found Popup Dialog */}
      {popupAlert && popupAlert.show && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/90 p-4 animate-in fade-in zoom-in-95">
          <div className="w-full max-w-md rounded-xl border-2 border-red-600 bg-neutral-950 p-6 shadow-2xl text-red-100 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-950 border border-red-700 text-2xl">
                ⚠️
              </div>
              <div>
                <h3 className="font-heading text-lg font-bold text-red-400">
                  {popupAlert.title}
                </h3>
                <p className="text-xs text-neutral-400">
                  Authentication & Registration Notice
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-red-900/60 bg-red-950/40 p-3.5 text-xs text-red-200 leading-relaxed">
              {popupAlert.message}
            </div>

            <p className="text-[11px] text-neutral-400 italic">
              Your details have been pre-filled in the Sign Up form below. Complete the form to establish your ancestral Idoma identity.
            </p>

            <button
              onClick={dismissPopup}
              className="w-full rounded-lg bg-red-800 py-2.5 text-xs font-bold uppercase tracking-wider text-red-100 hover:bg-red-700 shadow transition-all"
            >
              Proceed to Sign Up →
            </button>
          </div>
        </div>
      )}

      {/* Main Authentication Box */}
      <div className="relative w-full max-w-lg rounded-2xl border border-red-900/60 bg-neutral-950 p-6 sm:p-8 text-red-100 shadow-2xl max-h-[92vh] overflow-y-auto card-glow">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 rounded-lg p-1 text-red-400 hover:bg-red-900/30 hover:text-red-200 transition-colors"
          title="Close modal"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Modal Header */}
        <div className="text-center pb-5 border-b border-red-900/40">
          <span className="text-[10px] font-bold uppercase tracking-widest text-red-500">
            Idlang Identity & Heritage Network
          </span>
          <h2 className="font-heading text-2xl font-bold tracking-wide text-red-100 mt-1">
            {mode === "login" ? "Welcome Back, Custodian" : "Join the Guardians of History"}
          </h2>
          <p className="text-xs text-neutral-400 mt-1">
            {mode === "login"
              ? "Sign in with your verified Idlang account credentials"
              : "Create your real ancestral profile to connect with peers and access the archives"}
          </p>

          {/* Mode Tabs */}
          <div className="mt-5 flex rounded-lg border border-red-900/40 bg-neutral-900/80 p-1">
            <button
              type="button"
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
          <div className="mt-4 rounded-lg border border-red-600 bg-red-950/60 p-3 text-xs text-red-200 flex items-start gap-2">
            <span className="font-bold text-red-400 shrink-0">⚠️ Error:</span>
            <span>{error}</span>
          </div>
        )}

        {/* LOGIN FORM */}
        {mode === "login" && (
          <form onSubmit={handleLoginSubmit} className="mt-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-red-300 mb-1">
                Username or Email Address
              </label>
              <input
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
              <label className="block text-xs font-semibold uppercase tracking-wider text-red-300 mb-1">
                Password
              </label>
              <input
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
                <label className="block text-xs font-semibold uppercase tracking-wider text-red-300 mb-1">
                  Username *
                </label>
                <input
                  type="text"
                  value={signupUsername}
                  onChange={(e) => setSignupUsername(e.target.value)}
                  placeholder="e.g. oche_odeh"
                  className="w-full rounded-lg border border-red-900/50 bg-neutral-900 px-3 py-2 text-xs text-red-100 placeholder-neutral-500 focus:border-red-500 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-red-300 mb-1">
                  Display Name
                </label>
                <input
                  type="text"
                  value={signupDisplayName}
                  onChange={(e) => setSignupDisplayName(e.target.value)}
                  placeholder="e.g. Oche Odeh"
                  className="w-full rounded-lg border border-red-900/50 bg-neutral-900 px-3 py-2 text-xs text-red-100 placeholder-neutral-500 focus:border-red-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Native Name Requirement Field */}
            <div className="rounded-lg border border-red-900/60 bg-red-950/20 p-3">
              <label className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-red-300 mb-1">
                <span className="flex items-center gap-1.5">
                  <span>🪘</span>
                  <span>Native Idoma Name</span>
                </span>
                <span className="text-[10px] text-red-400 lowercase font-normal italic">
                  ancestral identity
                </span>
              </label>
              <input
                type="text"
                value={signupNativeName}
                onChange={(e) => setSignupNativeName(e.target.value)}
                placeholder="e.g. Onyilo, Onyeche, Agbo, Ochanya, Alechenu..."
                className="w-full rounded-lg border border-red-900/50 bg-neutral-900 px-3 py-2 text-xs text-red-100 placeholder-neutral-500 focus:border-red-500 focus:outline-none"
              />
              <p className="mt-1 text-[10px] text-neutral-400">
                Your traditional or indigenous ancestral name. Displayed with honor on your profile badge.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-red-300 mb-1">
                Email Address *
              </label>
              <input
                type="email"
                value={signupEmail}
                onChange={(e) => setSignupEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full rounded-lg border border-red-900/50 bg-neutral-900 px-3 py-2 text-xs text-red-100 placeholder-neutral-500 focus:border-red-500 focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-red-300 mb-1">
                Password * (min. 6 chars)
              </label>
              <input
                type="password"
                value={signupPassword}
                onChange={(e) => setSignupPassword(e.target.value)}
                placeholder="Choose a secure password"
                className="w-full rounded-lg border border-red-900/50 bg-neutral-900 px-3 py-2 text-xs text-red-100 placeholder-neutral-500 focus:border-red-500 focus:outline-none"
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-red-300 mb-1">
                  Dialect Region
                </label>
                <select
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
    </div>
  );
}
