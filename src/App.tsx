import { lazy, Suspense, useState, useEffect } from "react";
import TranslateView from "./components/TranslateView";
import { MenuIcon, MobileTabBar, SidebarNav, loadNavState, navLabel, saveNavState, type Tab } from "./components/Navigation";
const LearnView = lazy(() => import("./components/LearnView"));
const FeedView = lazy(() => import("./components/FeedView"));
const LibraryView = lazy(() => import("./components/LibraryView"));
const MessagesView = lazy(() => import("./components/MessagesView"));
const ProfileModal = lazy(() => import("./components/ProfileModal"));
import AuthModal from "./components/AuthModal";
const ConnectionsModal = lazy(() => import("./components/ConnectionsModal"));
import type { User } from "./types";
import {
  fetchCurrentUser,
  logoutUser,
  fetchConnectionsList,
} from "./api/socialClient";

function requestedTab(): Tab {
  const view = new URLSearchParams(window.location.search).get("view");
  return view === "feed" || view === "library" || view === "learn" || view === "messages" ? view : "translate";
}

export default function App() {
  const [requestedView, setRequestedView] = useState<Tab>(requestedTab);
  function selectTab(view: Tab) {
    const url = new URL(window.location.href);
    if (view === "translate") url.searchParams.delete("view");
    else url.searchParams.set("view", view);
    if (url.href !== window.location.href) window.history.pushState(null, "", url);
    setRequestedView(view);
  }
  useEffect(() => {
    const onBack = () => setRequestedView(requestedTab());
    window.addEventListener("popstate", onBack);
    return () => window.removeEventListener("popstate", onBack);
  }, []);

  // Desktop sidebar layout (hidden / expanded / icon rail), persisted across visits
  const [navState, setNavState] = useState(loadNavState);
  useEffect(() => {
    saveNavState(navState);
  }, [navState]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const activeTab = currentUser || requestedView === "library" ? requestedView : "translate";
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
      selectTab("translate");
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
    <div
      className={`flex min-h-screen flex-col bg-black text-red-100 ${
        currentUser && navState.open ? (navState.collapsed ? "lg:pl-16" : "lg:pl-64") : ""
      }`}
    >
      <a href="#main-content" className="skip-link">Skip to content</a>
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-red-900/30 bg-black/95 backdrop-blur-md px-4 sm:px-6 py-3.5">
        <div className="mx-auto flex max-w-6xl flex-col md:flex-row items-center justify-between gap-3">
          {/* Menu toggle & active section label */}
          <div className="flex items-center gap-3">
            {/* Menu Toggle (desktop only — mobile uses the bottom icon bar) */}
            {currentUser && (
              <button
                type="button"
                onClick={() => setNavState((state) => ({ ...state, open: !state.open }))}
                aria-expanded={navState.open}
                aria-controls="app-sidebar"
                aria-label="Toggle navigation menu"
                title="Toggle navigation menu"
                className="hidden rounded-lg border border-red-900/50 bg-neutral-950 p-2 text-red-400 transition-all hover:bg-red-900/40 hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 lg:block"
              >
                <MenuIcon className="h-5 w-5" />
              </button>
            )}
            {/* Keep the product name visible alongside the rendered section. */}
            <h1
              aria-live="polite"
              className="border-l-2 border-red-700 pl-3 font-heading text-lg font-bold uppercase tracking-widest text-red-100 sm:text-xl"
            >
              Idlang · {navLabel(activeTab)}
            </h1>
          </div>

          {/* Navigation lives in the desktop sidebar / mobile bottom bar */}

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
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button className="px-2 text-xs text-red-200 underline" onClick={() => selectTab(activeTab === "library" ? "translate" : "library")}>{activeTab === "library" ? "Translate" : "E-Library"}</button>
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

      {/* Desktop: collapsible left sidebar */}
      {currentUser && navState.open && (
        <SidebarNav
          activeTab={activeTab}
          onSelect={selectTab}
          collapsed={navState.collapsed}
          onToggleCollapse={() => setNavState((state) => ({ ...state, collapsed: !state.collapsed }))}
        />
      )}

      {/* Mobile: fixed bottom icon bar */}
      {currentUser && <MobileTabBar activeTab={activeTab} onSelect={selectTab} />}

      {/* Decorative divider */}
      <div className="mx-auto h-px w-32 bg-gradient-to-r from-transparent via-red-800 to-transparent" />

      {/* Main Content */}
      <main id="main-content" tabIndex={-1} className="flex-1 pt-8 pb-28 lg:pb-8">
        <Suspense fallback={<p role="status" className="p-6 text-center text-neutral-300">Loading section…</p>}>
        {currentUser && activeTab === "feed" && <FeedView currentUser={effectiveUser} />}
        {activeTab === "library" && <LibraryView key={effectiveUser.id} currentUser={effectiveUser} />}
        {currentUser && activeTab === "learn" && <LearnView currentUser={effectiveUser} />}
        {currentUser && activeTab === "messages" && <MessagesView currentUser={effectiveUser} />}
        {activeTab === "translate" && <TranslateView isAuthenticated={!!currentUser} authLoading={loadingAuth} onRequireAuth={() => openAuth("login")} />}
        </Suspense>
      </main>

      {/* Footer */}
      <footer className="border-t border-red-900/20 bg-neutral-950/80 px-6 pt-5 pb-24 text-center lg:pb-5">
        <p className="text-xs text-neutral-300 font-medium">
          Preserving Idoma — the sacred language and oral history of our ancestors
        </p>
        <p className="text-[10px] text-neutral-400 mt-1">
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

      <Suspense fallback={<p role="status" className="p-4 text-neutral-300">Loading profile…</p>}>
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
      </Suspense>
    </div>
  );
}
