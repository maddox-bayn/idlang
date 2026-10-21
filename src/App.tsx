import { useState, useEffect } from "react";
import TranslateView from "./components/TranslateView";
import LearnView from "./components/LearnView";
import FeedView from "./components/FeedView";
import LibraryView from "./components/LibraryView";
import ProfileModal from "./components/ProfileModal";
import type { User } from "./types";
import { mockUsers } from "./data/mockData";
import { fetchUsers } from "./api/socialClient";

type Tab = "translate" | "learn" | "feed" | "library";

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("feed");
  const [users, setUsers] = useState<User[]>(mockUsers);
  const [currentUser, setCurrentUser] = useState<User>(mockUsers[0]);
  const [showMyProfile, setShowMyProfile] = useState(false);

  useEffect(() => {
    fetchUsers().then((fetched) => {
      if (fetched && fetched.length > 0) {
        setUsers(fetched);
        if (!fetched.some((u) => u.id === currentUser.id)) {
          setCurrentUser(fetched[0]);
        }
      }
    });
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-black text-red-100">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-red-900/30 bg-black/90 backdrop-blur-md px-4 sm:px-6 py-4">
        <div className="mx-auto flex max-w-5xl flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="font-heading text-2xl font-bold tracking-wide text-red-100">
                Idlang
              </h1>
              <p className="text-[11px] italic text-red-500">
                The Guardian of History
              </p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex flex-wrap justify-center gap-1 rounded-lg border border-red-900/30 bg-neutral-950 p-1">
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
          </nav>

          {/* Active User Switcher Pill */}
          <div className="flex items-center gap-2 rounded-lg border border-red-900/40 bg-neutral-950 px-3 py-1 text-xs">
            <span className="text-[10px] uppercase font-bold text-neutral-500">
              Active User:
            </span>
            <select
              value={currentUser.id}
              onChange={(e) => {
                const found = users.find((u) => u.id === e.target.value);
                if (found) setCurrentUser(found);
              }}
              className="bg-transparent text-xs font-semibold text-red-300 focus:outline-none cursor-pointer"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id} className="bg-neutral-900 text-red-100">
                  {u.display_name} (@{u.username})
                </option>
              ))}
            </select>
            <button
              onClick={() => setShowMyProfile(true)}
              className="rounded bg-red-900/50 p-1 text-red-300 hover:bg-red-800 hover:text-white"
              title="View my profile"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Decorative divider */}
      <div className="mx-auto h-px w-24 bg-red-900/50" />

      {/* Main Content */}
      <main className="flex-1 py-8">
        {activeTab === "feed" && <FeedView currentUser={currentUser} />}
        {activeTab === "library" && <LibraryView currentUser={currentUser} />}
        {activeTab === "learn" && <LearnView currentUser={currentUser} />}
        {activeTab === "translate" && <TranslateView />}
      </main>

      {/* Footer */}
      <footer className="border-t border-red-900/20 px-6 py-4 text-center">
        <p className="text-xs text-red-700">
          Preserving Idoma — the language of our ancestors
        </p>
      </footer>

      {/* My Profile Modal */}
      {showMyProfile && (
        <ProfileModal
          targetUserId={currentUser.id}
          viewerUserId={currentUser.id}
          onClose={() => setShowMyProfile(false)}
        />
      )}
    </div>
  );
}
