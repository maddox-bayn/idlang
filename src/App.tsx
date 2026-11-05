import { useState, useEffect } from "react";
import TranslateView from "./components/TranslateView";
import LearnView from "./components/LearnView";
import FeedView from "./components/FeedView";
import LibraryView from "./components/LibraryView";
import ProfileModal from "./components/ProfileModal";
import AuthModal from "./components/AuthModal";
import ConnectionsModal from "./components/ConnectionsModal";
import type { User } from "./types";
import {
  fetchCurrentUser,
  logoutUser,
  fetchConnectionsList,
} from "./api/socialClient";

type Tab = "feed" | "library" | "learn" | "translate";

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("translate");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  // Modals state
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authInitialMode, setAuthInitialMode] = useState<"login" | "signup">("login");
  const [selectedProfileUserId, setSelectedProfileUserId] = useState<string | null>(null);
  const [showConnectionsModal, setShowConnectionsModal] = useState(false);
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);

  const refreshCurrentUser = async () => {
    try {
      const u = await fetchCurrentUser();
      setCurrentUser(u);
      if (u) {
        refreshConnectionsCount();
      }
    } catch (err) {
      console.warn("Failed to load authenticated user:", err);
    } finally {
      setLoadingAuth(false);
    }
  };

  const refreshConnectionsCount = async () => {
    try {
      const connData = await fetchConnectionsList();
      setPendingRequestsCount((connData.incoming || []).length);
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    refreshCurrentUser();
  }, []);

  const handleLogout = async () => {
    try {
      await logoutUser();
      setCurrentUser(null);
      setPendingRequestsCount(0);
      setActiveTab("translate");
      setSelectedProfileUserId(null);
      setShowConnectionsModal(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not sign out. Please try again.");
    }
  };

  const openAuth = (mode: "login" | "signup") => {
    setAuthInitialMode(mode);
    setShowAuthModal(true);
  };

  // Safe fallback user for read-only / guest views of components that expect a User object
  const effectiveUser: User = currentUser || {
    id: "guest",
    username: "guest",
    display_name: "Guest Explorer",
    native_name: "Visitor",
    avatar_url: "https://api.dicebear.com/7.x/bottts/svg?seed=guest",
    bio: "Exploring Idoma cultural heritage.",
  };

  return (
    <div className="flex min-h-screen flex-col bg-black text-red-100">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-red-900/30 bg-black/95 backdrop-blur-md px-4 sm:px-6 py-3.5">
        <div className="mx-auto flex max-w-6xl flex-col md:flex-row items-center justify-between gap-3">
          {/* Logo & Slogan */}
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-900/80 border border-red-700 shadow-md">
              <span className="text-lg">🪘</span>
            </div>
            <div>
              <h1 className="font-heading text-xl font-bold tracking-wide text-red-100 flex items-center gap-2">
                Idlang
                <span className="text-[10px] font-sans font-medium px-2 py-0.5 rounded-full bg-red-950 border border-red-800 text-red-300">
                  Otukpo Archive
                </span>
              </h1>
              <p className="text-[11px] italic text-red-500">
                The Guardian of History & Idoma Heritage
              </p>
            </div>
          </div>

          {/* Navigation Tabs */}
          {currentUser && <nav className="flex flex-wrap justify-center gap-1 rounded-lg border border-red-900/30 bg-neutral-950 p-1">
            <button
              onClick={() => setActiveTab("feed")}
              className={`rounded-md px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider transition-all ${
                activeTab === "feed"
                  ? "bg-red-900 text-red-100 shadow"
                  : "text-red-500 hover:text-red-300"
              }`}
            >
              Feed
            </button>
            <button
              onClick={() => setActiveTab("library")}
              className={`rounded-md px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider transition-all ${
                activeTab === "library"
                  ? "bg-red-900 text-red-100 shadow"
                  : "text-red-500 hover:text-red-300"
              }`}
            >
              E-Library
            </button>
            <button
              onClick={() => setActiveTab("learn")}
              className={`rounded-md px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider transition-all ${
                activeTab === "learn"
                  ? "bg-red-900 text-red-100 shadow"
                  : "text-red-500 hover:text-red-300"
              }`}
            >
              Learn & Tracks
            </button>
            <button
              onClick={() => setActiveTab("translate")}
              className={`rounded-md px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider transition-all ${
                activeTab === "translate"
                  ? "bg-red-900 text-red-100 shadow"
                  : "text-red-500 hover:text-red-300"
              }`}
            >
              Translate
            </button>
          </nav>}

          {/* Authentication & User Identity Bar */}
          <div className="flex items-center gap-2">
            {loadingAuth ? (
              <div className="h-6 w-6 animate-spin rounded-full border border-red-600 border-t-transparent" />
            ) : currentUser ? (
              /* REAL LOGGED IN USER PILL */
              <div className="flex items-center gap-2 rounded-xl border border-red-900/50 bg-neutral-950 p-1.5 text-xs shadow-md">
                {/* User Avatar & Profile Click */}
                <div
                  onClick={() => setSelectedProfileUserId(currentUser.id)}
                  className="flex items-center gap-2.5 cursor-pointer group pr-1"
                  title="View / Edit your profile"
                >
                  <img
                    src={
                      currentUser.avatar_url ||
                      `https://api.dicebear.com/7.x/bottts/svg?seed=${currentUser.username}`
                    }
                    alt={currentUser.display_name}
                    className="h-8 w-8 rounded-full border border-red-600 object-cover group-hover:scale-105 transition-transform"
                  />
                  <div className="text-left hidden sm:block">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-red-100 group-hover:text-red-300 transition-colors">
                        {currentUser.display_name}
                      </span>
                      {currentUser.native_name && (
                        <span className="rounded bg-red-950 px-1 py-0.2 text-[10px] font-semibold text-red-300 border border-red-900">
                          🪘 {currentUser.native_name}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-red-500">@{currentUser.username}</p>
                  </div>
                </div>

                {/* Friends & Connections Button (with incoming requests badge) */}
                <button
                  onClick={() => setShowConnectionsModal(true)}
                  className="relative flex items-center gap-1.5 rounded-lg bg-neutral-900 border border-red-900/60 px-2.5 py-1 text-xs text-red-300 hover:bg-red-900/40 hover:text-red-100 transition-all"
                  title="Manage friends and connection requests"
                >
                  <span>🤝 Friends</span>
                  {pendingRequestsCount > 0 && (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white animate-pulse">
                      {pendingRequestsCount}
                    </span>
                  )}
                </button>

                {/* Profile Modal Button */}
                <button
                  onClick={() => setSelectedProfileUserId(currentUser.id)}
                  className="rounded-lg bg-red-900/40 p-1.5 text-red-300 hover:bg-red-800 hover:text-white transition-all"
                  title="My Profile"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </button>

                {/* Log Out Button */}
                <button
                  onClick={handleLogout}
                  className="rounded-lg border border-red-950 bg-neutral-900 px-2 py-1 text-[11px] text-red-400 hover:bg-red-950 hover:text-red-200 transition-all"
                  title="Sign out"
                >
                  Log Out
                </button>
              </div>
            ) : (
              /* REAL SIGN IN & REGISTER BUTTONS FOR GUESTS */
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openAuth("login")}
                  className="rounded-lg border border-red-900/60 bg-neutral-950 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-red-300 hover:bg-red-900/40 hover:text-red-100 transition-all shadow"
                >
                  Sign In
                </button>
                <button
                  onClick={() => openAuth("signup")}
                  className="rounded-lg bg-red-800 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-red-100 hover:bg-red-700 shadow transition-all active:scale-95"
                >
                  Create Account
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Decorative divider */}
      <div className="mx-auto h-px w-32 bg-gradient-to-r from-transparent via-red-800 to-transparent" />

      {/* Main Content */}
      <main className="flex-1 py-8">
        {currentUser && activeTab === "feed" && <FeedView currentUser={effectiveUser} />}
        {currentUser && activeTab === "library" && <LibraryView currentUser={effectiveUser} />}
        {currentUser && activeTab === "learn" && <LearnView currentUser={effectiveUser} />}
        {(!currentUser || activeTab === "translate") && <TranslateView isAuthenticated={!!currentUser} authLoading={loadingAuth} onRequireAuth={() => openAuth("login")} />}
      </main>

      {/* Footer */}
      <footer className="border-t border-red-900/20 bg-neutral-950/80 px-6 py-5 text-center">
        <p className="text-xs text-red-600 font-medium">
          Preserving Idoma — the sacred language and oral history of our ancestors
        </p>
        <p className="text-[10px] text-neutral-600 mt-1">
          Idlang Heritage Preservation System • Benue Valley
        </p>
      </footer>

      {/* AUTH MODAL (Login & Signup with auto-route on missing account) */}
      {showAuthModal && <AuthModal
        key={authInitialMode}
        isOpen={true}
        initialMode={authInitialMode}
        onClose={() => setShowAuthModal(false)}
        onSuccess={(user) => {
          setCurrentUser(user);
          refreshConnectionsCount();
        }}
      />}

      {/* FRIENDS & CONNECTIONS MODAL (Incoming requests, accepted mutual friends, discover) */}
      {showConnectionsModal && currentUser && (
        <ConnectionsModal
          currentUser={currentUser}
          onClose={() => setShowConnectionsModal(false)}
          onOpenProfile={(uid) => {
            setShowConnectionsModal(false);
            setSelectedProfileUserId(uid);
          }}
          onConnectionsUpdated={refreshConnectionsCount}
        />
      )}

      {/* USER PROFILE MODAL (View/edit profile picture, native name, user name, bio, messaging) */}
      {selectedProfileUserId && (
        <ProfileModal
          targetUserId={selectedProfileUserId}
          viewerUserId={currentUser ? currentUser.id : "guest"}
          onClose={() => setSelectedProfileUserId(null)}
          onConnectionChange={refreshConnectionsCount}
          onProfileUpdated={refreshCurrentUser}
        />
      )}
    </div>
  );
}
