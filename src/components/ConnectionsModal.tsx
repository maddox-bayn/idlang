import { useState, useEffect } from "react";
import type { User, ConnectionUserItem } from "../types";
import {
  fetchConnectionsList,
  updateConnection,
  searchRealUsers,
} from "../api/socialClient";

interface ConnectionsModalProps {
  currentUser: User;
  onClose: () => void;
  onOpenProfile: (targetUserId: string) => void;
  onConnectionsUpdated?: () => void;
}

export default function ConnectionsModal({
  currentUser,
  onClose,
  onOpenProfile,
  onConnectionsUpdated,
}: ConnectionsModalProps) {
  const [tab, setTab] = useState<"incoming" | "connected" | "outgoing" | "discover">("incoming");
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [connected, setConnected] = useState<ConnectionUserItem[]>([]);
  const [incoming, setIncoming] = useState<ConnectionUserItem[]>([]);
  const [outgoing, setOutgoing] = useState<ConnectionUserItem[]>([]);

  // Discover / Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [discoveredUsers, setDiscoveredUsers] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);

  const loadConnections = async () => {
    setLoading(true);
    try {
      const data = await fetchConnectionsList();
      setConnected(data.connected || []);
      setIncoming(data.incoming || []);
      setOutgoing(data.outgoing || []);

      // If no incoming requests, default to connected tab
      if ((data.incoming || []).length === 0 && tab === "incoming") {
        setTab("connected");
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not load connections.");
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    setSearching(true);
    try {
      const results = await searchRealUsers(query);
      // Filter out self
      setDiscoveredUsers(results.filter((u) => u.id !== currentUser.id));
    } catch (err) {
      setDiscoveredUsers([]);
      setActionError(err instanceof Error ? err.message : "Could not search users.");
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    loadConnections();
    handleSearch("");
  }, [currentUser.id]);

  const handleAction = async (targetId: string, action: "accept" | "reject" | "connect" | "disconnect") => {
    setActionLoadingId(targetId);
    setActionError(null);
    try {
      await updateConnection(targetId, action);
      await loadConnections();
      if (tab === "discover") {
        handleSearch(searchQuery);
      }
      if (onConnectionsUpdated) onConnectionsUpdated();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not update this connection.");
    } finally {
      setActionLoadingId(null);
    }
  };

  const isConnected = (userId: string) => connected.some((c) => c.user.id === userId);
  const isIncoming = (userId: string) => incoming.some((c) => c.user.id === userId);
  const isOutgoing = (userId: string) => outgoing.some((c) => c.user.id === userId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div className="card-glow relative w-full max-w-2xl rounded-2xl border border-red-900/60 bg-neutral-950 p-6 text-red-100 shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-red-900/40 pb-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">🤝</span>
            <div>
              <h2 className="font-heading text-lg font-bold text-red-100">
                Friends & Cultural Connections
              </h2>
              <p className="text-xs text-neutral-400">
                Mutual peer connections for direct messaging and dialect collaboration
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-red-400 hover:bg-red-900/30 hover:text-red-200 transition-colors"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="mt-4 flex flex-wrap gap-1 rounded-lg border border-red-900/40 bg-neutral-900/80 p-1">
          <button
            onClick={() => setTab("incoming")}
            className={`relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-all ${
              tab === "incoming" ? "bg-red-900 text-red-100 shadow" : "text-red-400 hover:text-red-200"
            }`}
          >
            <span>Friend Requests</span>
            {incoming.length > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                {incoming.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setTab("connected")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-all ${
              tab === "connected" ? "bg-red-900 text-red-100 shadow" : "text-red-400 hover:text-red-200"
            }`}
          >
            <span>Connected Friends ({connected.length})</span>
          </button>

          <button
            onClick={() => setTab("outgoing")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-all ${
              tab === "outgoing" ? "bg-red-900 text-red-100 shadow" : "text-red-400 hover:text-red-200"
            }`}
          >
            <span>Sent ({outgoing.length})</span>
          </button>

          <button
            onClick={() => setTab("discover")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-all ${
              tab === "discover" ? "bg-red-900 text-red-100 shadow" : "text-red-400 hover:text-red-200"
            }`}
          >
            <span>🔍 Discover People</span>
          </button>
        </div>

        {actionError && (
          <div role="alert" className="mt-3 rounded-lg border border-red-700 bg-red-950/50 px-3 py-2 text-xs text-red-200">
            {actionError}
          </div>
        )}

        {/* Essential Rule Banner */}
        <div className="mt-3 rounded-lg border border-red-900/50 bg-red-950/30 px-3.5 py-2 text-[11px] text-red-300 flex items-center gap-2">
          <span className="text-base shrink-0">🛡️</span>
          <span>
            <strong>Connection Protocol:</strong> In Idlang, users can connect with each other only after the friend request has been accepted. Direct messaging is unlocked once connected.
          </span>
        </div>

        {/* Content Body */}
        <div className="mt-4 flex-1 overflow-y-auto space-y-3 pr-1 min-h-[300px]">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-red-600 border-t-transparent" />
              <p className="mt-2 text-xs text-red-400">Loading connections...</p>
            </div>
          ) : (
            <>
              {/* TAB 1: INCOMING REQUESTS */}
              {tab === "incoming" && (
                <div>
                  {incoming.length === 0 ? (
                    <div className="rounded-xl border border-red-900/30 bg-neutral-900/40 p-8 text-center text-neutral-400">
                      <p className="text-xs">No pending friend requests.</p>
                      <button
                        onClick={() => setTab("discover")}
                        className="mt-3 rounded-lg bg-red-900/40 border border-red-800 px-3 py-1 text-xs text-red-300 hover:bg-red-900"
                      >
                        Find people to connect with →
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {incoming.map(({ user }) => (
                        <div
                          key={user.id}
                          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-red-900/40 bg-neutral-900/70 p-3.5 transition-all hover:border-red-700"
                        >
                          <div
                            onClick={() => onOpenProfile(user.id)}
                            className="flex items-center gap-3 cursor-pointer group"
                          >
                            <img
                              src={
                                user.avatar_url ||
                                `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`
                              }
                              alt={user.display_name}
                              className="h-11 w-11 rounded-full border border-red-600 object-cover"
                            />
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="text-sm font-bold text-red-100 group-hover:text-red-400 transition-colors">
                                  {user.display_name}
                                </h4>
                                {user.native_name && (
                                  <span className="rounded bg-red-950 px-1.5 py-0.5 text-[10px] font-semibold text-red-300 border border-red-900">
                                    🪘 {user.native_name}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-red-500">@{user.username}</p>
                              {user.bio && (
                                <p className="text-[11px] text-neutral-400 line-clamp-1 max-w-sm mt-0.5">
                                  {user.bio}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                            <button
                              onClick={() => handleAction(user.id, "accept")}
                              disabled={actionLoadingId === user.id}
                              className="rounded-lg bg-red-700 px-3.5 py-1.5 text-xs font-semibold text-white shadow hover:bg-red-600 transition-all disabled:opacity-50"
                            >
                              {actionLoadingId === user.id ? "..." : "Accept Request"}
                            </button>
                            <button
                              onClick={() => handleAction(user.id, "reject")}
                              disabled={actionLoadingId === user.id}
                              className="rounded-lg border border-red-900 bg-neutral-900 px-2.5 py-1.5 text-xs text-red-400 hover:bg-neutral-800 transition-all disabled:opacity-50"
                            >
                              Decline
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: CONNECTED FRIENDS */}
              {tab === "connected" && (
                <div>
                  {connected.length === 0 ? (
                    <div className="rounded-xl border border-red-900/30 bg-neutral-900/40 p-8 text-center text-neutral-400">
                      <p className="text-xs">You have not connected with any peers yet.</p>
                      <button
                        onClick={() => setTab("discover")}
                        className="mt-3 rounded-lg bg-red-900/40 border border-red-800 px-3 py-1 text-xs text-red-300 hover:bg-red-900"
                      >
                        Discover people to connect with →
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {connected.map(({ user }) => (
                        <div
                          key={user.id}
                          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-green-950/60 bg-neutral-900/70 p-3.5 transition-all hover:border-green-800"
                        >
                          <div
                            onClick={() => onOpenProfile(user.id)}
                            className="flex items-center gap-3 cursor-pointer group"
                          >
                            <img
                              src={
                                user.avatar_url ||
                                `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`
                              }
                              alt={user.display_name}
                              className="h-11 w-11 rounded-full border border-green-700 object-cover"
                            />
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="text-sm font-bold text-red-100 group-hover:text-red-400 transition-colors">
                                  {user.display_name}
                                </h4>
                                {user.native_name && (
                                  <span className="rounded bg-red-950 px-1.5 py-0.5 text-[10px] font-semibold text-red-300 border border-red-900">
                                    🪘 {user.native_name}
                                  </span>
                                )}
                                <span className="rounded-full bg-green-950 px-2 py-0.5 text-[10px] font-semibold text-green-400 border border-green-800">
                                  ✓ Connected Friend
                                </span>
                              </div>
                              <p className="text-xs text-red-500">@{user.username}</p>
                              {user.bio && (
                                <p className="text-[11px] text-neutral-400 line-clamp-1 max-w-sm mt-0.5">
                                  {user.bio}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                            <button
                              onClick={() => onOpenProfile(user.id)}
                              className="rounded-lg bg-red-800 px-3 py-1.5 text-xs font-semibold text-red-100 hover:bg-red-700 transition-all"
                            >
                              💬 Chat / DM
                            </button>
                            <button
                              onClick={() => handleAction(user.id, "disconnect")}
                              disabled={actionLoadingId === user.id}
                              className="rounded-lg border border-red-900/50 bg-neutral-900 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-900/30 transition-all"
                            >
                              Disconnect
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: OUTGOING REQUESTS */}
              {tab === "outgoing" && (
                <div>
                  {outgoing.length === 0 ? (
                    <div className="rounded-xl border border-red-900/30 bg-neutral-900/40 p-8 text-center text-neutral-400">
                      <p className="text-xs">No pending outgoing friend requests.</p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {outgoing.map(({ user }) => (
                        <div
                          key={user.id}
                          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-amber-950/60 bg-neutral-900/70 p-3.5 transition-all hover:border-amber-800"
                        >
                          <div
                            onClick={() => onOpenProfile(user.id)}
                            className="flex items-center gap-3 cursor-pointer group"
                          >
                            <img
                              src={
                                user.avatar_url ||
                                `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`
                              }
                              alt={user.display_name}
                              className="h-11 w-11 rounded-full border border-amber-700 object-cover"
                            />
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="text-sm font-bold text-red-100 group-hover:text-red-400 transition-colors">
                                  {user.display_name}
                                </h4>
                                {user.native_name && (
                                  <span className="rounded bg-red-950 px-1.5 py-0.5 text-[10px] font-semibold text-red-300 border border-red-900">
                                    🪘 {user.native_name}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-red-500">@{user.username}</p>
                              <span className="inline-block mt-0.5 text-[11px] text-amber-400">
                                ⏳ Pending peer's acceptance...
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                            <button
                              onClick={() => handleAction(user.id, "reject")}
                              disabled={actionLoadingId === user.id}
                              className="rounded-lg border border-red-900 bg-neutral-900 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/30 transition-all"
                            >
                              Cancel Request
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 4: DISCOVER PEOPLE */}
              {tab === "discover" && (
                <div className="space-y-3">
                  <div className="relative">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => handleSearch(e.target.value)}
                      placeholder="Search people by username, display name, or native name..."
                      className="w-full rounded-lg border border-red-900/60 bg-neutral-900 px-3.5 py-2.5 text-xs text-red-100 placeholder-neutral-500 focus:border-red-500 focus:outline-none"
                    />
                    {searching && (
                      <div className="absolute right-3 top-3 h-4 w-4 animate-spin rounded-full border border-red-500 border-t-transparent" />
                    )}
                  </div>

                  {discoveredUsers.length === 0 ? (
                    <div className="rounded-xl border border-red-900/30 bg-neutral-900/40 p-8 text-center text-neutral-400">
                      <p className="text-xs">No users found matching "{searchQuery}".</p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {discoveredUsers.map((user) => {
                        const connectedPeer = isConnected(user.id);
                        const incomingRequest = isIncoming(user.id);
                        const outgoingRequest = isOutgoing(user.id);

                        return (
                          <div
                            key={user.id}
                            className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-red-900/40 bg-neutral-900/70 p-3.5 transition-all hover:border-red-700"
                          >
                            <div
                              onClick={() => onOpenProfile(user.id)}
                              className="flex items-center gap-3 cursor-pointer group"
                            >
                              <img
                                src={
                                  user.avatar_url ||
                                  `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`
                                }
                                alt={user.display_name}
                                className="h-11 w-11 rounded-full border border-red-700 object-cover"
                              />
                              <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h4 className="text-sm font-bold text-red-100 group-hover:text-red-400 transition-colors">
                                    {user.display_name}
                                  </h4>
                                  {user.native_name && (
                                    <span className="rounded bg-red-950 px-1.5 py-0.5 text-[10px] font-semibold text-red-300 border border-red-900">
                                      🪘 {user.native_name}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-red-500">@{user.username}</p>
                                {user.bio && (
                                  <p className="text-[11px] text-neutral-400 line-clamp-1 max-w-sm mt-0.5">
                                    {user.bio}
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                              {connectedPeer ? (
                                <button
                                  onClick={() => onOpenProfile(user.id)}
                                  className="rounded-lg bg-green-950 border border-green-800 px-3 py-1.5 text-xs font-semibold text-green-300"
                                >
                                  ✓ Friends / Chat
                                </button>
                              ) : incomingRequest ? (
                                <button
                                  onClick={() => handleAction(user.id, "accept")}
                                  disabled={actionLoadingId === user.id}
                                  className="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600"
                                >
                                  Accept Request
                                </button>
                              ) : outgoingRequest ? (
                                <span className="rounded-lg border border-amber-800 bg-amber-950/40 px-3 py-1.5 text-xs text-amber-300">
                                  ⏳ Request Sent
                                </span>
                              ) : (
                                <button
                                  onClick={() => handleAction(user.id, "connect")}
                                  disabled={actionLoadingId === user.id}
                                  className="rounded-lg bg-red-800 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-red-100 hover:bg-red-700 active:scale-95 transition-all"
                                >
                                  + Send Request
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
