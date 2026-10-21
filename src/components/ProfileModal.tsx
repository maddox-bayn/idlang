import { useState, useEffect, useRef } from "react";
import type { ProfileResponse, DirectMessage } from "../types";
import {
  fetchProfile,
  updateConnection,
  fetchMessages,
  sendMessage,
} from "../api/socialClient";

interface ProfileModalProps {
  targetUserId: string;
  viewerUserId: string;
  onClose: () => void;
  onConnectionChange?: () => void;
}

export default function ProfileModal({
  targetUserId,
  viewerUserId,
  onClose,
  onConnectionChange,
}: ProfileModalProps) {
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [newMessageText, setNewMessageText] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadData = async () => {
    setLoading(true);
    setChatError(null);
    try {
      const p = await fetchProfile(targetUserId, viewerUserId);
      setProfile(p);

      if (p.connection_status === "connected") {
        try {
          const msgs = await fetchMessages(viewerUserId, targetUserId);
          setMessages(msgs);
        } catch (err: unknown) {
          setChatError(err instanceof Error ? err.message : "Failed to load messages");
        }
      }
    } catch (err) {
      console.error("Failed to load profile:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [targetUserId, viewerUserId]);

  const handleConnectionAction = async (action: "connect" | "accept" | "reject" | "block") => {
    if (!profile) return;
    setConnectionLoading(true);
    try {
      await updateConnection(viewerUserId, targetUserId, action);
      await loadData();
      if (onConnectionChange) onConnectionChange();
    } catch (err) {
      console.error("Connection update error:", err);
    } finally {
      setConnectionLoading(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessageText.trim() || sendingMessage) return;

    setSendingMessage(true);
    setChatError(null);
    try {
      const sent = await sendMessage(viewerUserId, targetUserId, newMessageText.trim());
      setMessages((prev) => [...prev, sent]);
      setNewMessageText("");
    } catch (err: unknown) {
      // Catches the explicit 403 Forbidden from DM Gateway Policy
      setChatError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSendingMessage(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="card-glow max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-red-900/60 bg-neutral-950 p-6 text-red-100 shadow-2xl">
        {/* Header with Close */}
        <div className="flex items-center justify-between border-b border-red-900/40 pb-4">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-widest text-red-500 font-bold">
              Linguistic Profile
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-red-400 hover:bg-red-900/30 hover:text-red-200"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-red-600 border-t-transparent" />
          </div>
        ) : profile ? (
          <div className="space-y-6 pt-4">
            {/* Top User Info Section */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <img
                  src={
                    profile.user.avatar_url ||
                    "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150"
                  }
                  alt={profile.user.display_name}
                  className="h-16 w-16 rounded-full border-2 border-red-600 object-cover shadow"
                />
                <div>
                  <h3 className="font-heading text-xl font-bold text-red-100">
                    {profile.user.display_name}
                  </h3>
                  <p className="text-xs text-red-500">@{profile.user.username}</p>
                  <p className="mt-1 text-xs text-neutral-400 max-w-sm">
                    {profile.user.bio || "Preserving ancestral Idoma lore and dialect heritage."}
                  </p>
                </div>
              </div>

              {/* Context-Aware Connection Button */}
              {!profile.is_owner && (
                <div className="flex items-center gap-2">
                  {profile.connection_status === "connected" ? (
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-green-800 bg-green-950/60 px-3 py-1 text-xs font-semibold text-green-300">
                        ✓ Connected
                      </span>
                      <button
                        onClick={() => handleConnectionAction("reject")}
                        disabled={connectionLoading}
                        className="rounded border border-red-900/50 bg-neutral-900 px-2.5 py-1 text-xs text-red-400 hover:bg-red-900/40"
                      >
                        Disconnect
                      </button>
                    </div>
                  ) : profile.connection_status === "pending" ? (
                    profile.connection_direction === "incoming" ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleConnectionAction("accept")}
                          disabled={connectionLoading}
                          className="rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600 shadow"
                        >
                          Accept Request
                        </button>
                        <button
                          onClick={() => handleConnectionAction("reject")}
                          disabled={connectionLoading}
                          className="rounded border border-red-900 px-2.5 py-1.5 text-xs text-red-400 hover:bg-neutral-900"
                        >
                          Decline
                        </button>
                      </div>
                    ) : (
                      <button
                        disabled
                        className="rounded border border-amber-800 bg-amber-950/40 px-3 py-1.5 text-xs font-medium text-amber-300 cursor-not-allowed"
                      >
                        ⏳ Pending Handshake
                      </button>
                    )
                  ) : (
                    <button
                      onClick={() => handleConnectionAction("connect")}
                      disabled={connectionLoading}
                      className="rounded bg-red-800 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-red-100 shadow transition-all hover:bg-red-700 active:scale-95"
                    >
                      + Connect
                    </button>
                  )}
                </div>
              )}

              {profile.is_owner && (
                <span className="rounded-full border border-red-700 bg-red-950/60 px-3 py-1 text-xs font-semibold text-red-300">
                  Your Account
                </span>
              )}
            </div>

            {/* Gamified Fluency & Educational Matrix Box */}
            <div className="rounded-lg border border-red-900/40 bg-neutral-900/70 p-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-red-900/30 pb-3">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-red-500">
                    Fluency Tier
                  </span>
                  <h4 className="font-heading text-base font-bold capitalize text-red-100">
                    {profile.learning_profile.fluency_tier} Speaker
                  </h4>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-red-500">
                    Progress Tracker
                  </span>
                  <p className="font-mono text-sm font-bold text-red-300">
                    {profile.learning_profile.xp_points} / 1000 XP
                  </p>
                </div>
              </div>

              {/* XP Progress Bar */}
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-neutral-800">
                <div
                  className="h-full bg-gradient-to-r from-red-800 to-red-600 transition-all duration-500"
                  style={{
                    width: `${Math.min(100, (profile.learning_profile.xp_points / 1000) * 100)}%`,
                  }}
                />
              </div>

              {/* Completed Track Milestones */}
              <div className="mt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-red-400">
                  Completed Track Milestones:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className={`flex items-center gap-2 rounded border p-2 ${
                    profile.learning_profile.completed_tracks.includes("track_1_greetings")
                      ? "border-green-800/60 bg-green-950/20 text-green-300"
                      : "border-neutral-800 bg-neutral-900/40 text-neutral-500"
                  }`}>
                    <span>{profile.learning_profile.completed_tracks.includes("track_1_greetings") ? "✅" : "🔒"}</span>
                    <span>1. Daily Greetings</span>
                  </div>

                  <div className={`flex items-center gap-2 rounded border p-2 ${
                    profile.learning_profile.completed_tracks.includes("track_2_numbers")
                      ? "border-green-800/60 bg-green-950/20 text-green-300"
                      : "border-neutral-800 bg-neutral-900/40 text-neutral-500"
                  }`}>
                    <span>{profile.learning_profile.completed_tracks.includes("track_2_numbers") ? "✅" : "🔒"}</span>
                    <span>2. Numerical Quantifiers</span>
                  </div>

                  <div className={`flex items-center gap-2 rounded border p-2 ${
                    profile.learning_profile.completed_tracks.includes("track_3_idioms")
                      ? "border-green-800/60 bg-green-950/20 text-green-300"
                      : "border-neutral-800 bg-neutral-900/40 text-neutral-500"
                  }`}>
                    <span>{profile.learning_profile.completed_tracks.includes("track_3_idioms") ? "✅" : "🔒"}</span>
                    <span>3. Proverbial Idioms</span>
                  </div>

                  <div className={`flex items-center gap-2 rounded border p-2 ${
                    profile.learning_profile.completed_tracks.includes("track_4_folktales")
                      ? "border-green-800/60 bg-green-950/20 text-green-300"
                      : "border-neutral-800 bg-neutral-900/40 text-neutral-500"
                  }`}>
                    <span>{profile.learning_profile.completed_tracks.includes("track_4_folktales") ? "✅" : "🔒"}</span>
                    <span>4. Cultural Folktales</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Direct Messaging Pane (Unlocked when Connected) */}
            {!profile.is_owner && (
              <div className="rounded-lg border border-red-900/40 bg-neutral-900/50 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-red-300">
                    <svg className="h-4 w-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    Direct Messaging Pane
                  </h4>
                  {profile.connection_status !== "connected" && (
                    <span className="rounded bg-red-950 px-2 py-0.5 text-[10px] font-semibold text-red-400 border border-red-900">
                      Connected Only
                    </span>
                  )}
                </div>

                {chatError && (
                  <div className="mb-3 rounded border border-red-600/60 bg-red-950/40 p-2.5 text-xs text-red-300 flex items-start gap-2">
                    <span className="text-red-500 font-bold shrink-0">🛡️ Policy:</span>
                    <span>{chatError}</span>
                  </div>
                )}

                {profile.connection_status === "connected" ? (
                  <div className="space-y-3">
                    {/* Chat messages list */}
                    <div className="max-h-48 overflow-y-auto rounded border border-red-950 bg-black/60 p-3 space-y-2">
                      {messages.length === 0 ? (
                        <p className="text-center text-xs italic text-neutral-500 py-4">
                          No messages yet. Send a greeting to begin connection chat!
                        </p>
                      ) : (
                        messages.map((m) => {
                          const isMe = m.sender_id === viewerUserId;
                          return (
                            <div
                              key={m.id}
                              className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
                            >
                              <div
                                className={`max-w-[80%] rounded-lg px-3 py-2 text-xs ${
                                  isMe
                                    ? "bg-red-900 text-red-100"
                                    : "bg-neutral-800 text-neutral-200"
                                }`}
                              >
                                {m.body}
                              </div>
                              <span className="text-[10px] text-neutral-500 px-1 mt-0.5">
                                {new Date(m.created_at).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </div>
                          );
                        })
                      )}
                      <div ref={messagesEndRef} />
                    </div>

                    {/* Instant active input chat pane */}
                    <form onSubmit={handleSendMessage} className="flex gap-2">
                      <input
                        type="text"
                        value={newMessageText}
                        onChange={(e) => setNewMessageText(e.target.value)}
                        placeholder="Write a direct message..."
                        className="flex-1 rounded-lg border border-red-900/50 bg-neutral-950 px-3 py-2 text-xs text-red-100 placeholder-neutral-500 focus:border-red-500 focus:outline-none"
                      />
                      <button
                        type="submit"
                        disabled={sendingMessage || !newMessageText.trim()}
                        className="rounded-lg bg-red-800 px-4 py-2 text-xs font-semibold text-red-100 hover:bg-red-700 disabled:opacity-50"
                      >
                        {sendingMessage ? "..." : "Send"}
                      </button>
                    </form>
                  </div>
                ) : (
                  <div className="rounded border border-neutral-800 bg-neutral-950/70 p-4 text-center">
                    <p className="text-xs text-neutral-400">
                      Direct messaging is locked. You must be mutually{" "}
                      <span className="font-semibold text-red-400">Connected</span> with @
                      {profile.user.username} to exchange direct messages.
                    </p>
                    {profile.connection_status === "pending" ? (
                      <p className="mt-1 text-[11px] text-amber-500">
                        Connection request is currently pending handshake.
                      </p>
                    ) : (
                      <button
                        onClick={() => handleConnectionAction("connect")}
                        className="mt-3 rounded bg-red-900/50 border border-red-800 px-3 py-1.5 text-xs text-red-200 hover:bg-red-800"
                      >
                        Send Connection Request to Unlock Chat
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
