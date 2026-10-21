import { useState, useEffect } from "react";
import type { Post, User } from "../types";
import { fetchPosts, createPost, updateConnection } from "../api/socialClient";
import NativeAudioPlayer from "./NativeAudioPlayer";
import ProfileModal from "./ProfileModal";

interface FeedViewProps {
  currentUser: User;
}

export default function FeedView({ currentUser }: FeedViewProps) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAuthorId, setSelectedAuthorId] = useState<string | null>(null);

  // New post modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [mediaType, setMediaType] = useState<"text" | "image" | "audio" | "video">("text");
  const [mediaUrl, setMediaUrl] = useState("");
  const [creating, setCreating] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  const loadFeed = async () => {
    setLoading(true);
    try {
      const data = await fetchPosts(1, 20);
      setPosts(data.posts);
    } catch (err) {
      console.error("Feed loading error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFeed();
  }, []);

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContent.trim()) return;

    setCreating(true);
    setPostError(null);
    try {
      const created = await createPost({
        user_id: currentUser.id,
        content: newContent.trim(),
        media_type: mediaType,
        media_url: mediaUrl.trim() || undefined,
      });
      setPosts((prev) => [created, ...prev]);
      setNewContent("");
      setMediaUrl("");
      setMediaType("text");
      setShowCreateModal(false);
    } catch (err: unknown) {
      setPostError(err instanceof Error ? err.message : "Failed to submit post");
    } finally {
      setCreating(false);
    }
  };

  const handleQuickConnect = async (targetId: string) => {
    try {
      await updateConnection(currentUser.id, targetId, "connect");
      setSelectedAuthorId(targetId);
    } catch (err) {
      console.error("Quick connect error:", err);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 space-y-6">
      {/* Top Banner & Post Creator Action */}
      <div className="card-glow flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl border border-red-900/40 bg-neutral-950 p-5 shadow-lg">
        <div>
          <h2 className="font-heading text-lg font-bold text-red-100">
            Cultural Preservation Feed
          </h2>
          <p className="text-xs text-red-500">
            Oral traditions, native pronunciations, historical folklore, and textile lore.
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 rounded-lg bg-red-800 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-red-100 shadow transition-all hover:bg-red-700 active:scale-95"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Share Cultural Post
        </button>
      </div>

      {/* Posts Stream */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-red-600 border-t-transparent" />
          <p className="mt-3 text-xs text-red-400">Loading ancestral feed...</p>
        </div>
      ) : posts.length === 0 ? (
        <div className="rounded-xl border border-red-900/30 bg-neutral-950 p-8 text-center text-red-400">
          <p className="text-sm">No cultural posts yet. Be the first to share an ancestral story!</p>
        </div>
      ) : (
        <div className="space-y-6">
          {posts.map((post) => {
            const author = post.author || {
              id: post.user_id,
              username: post.user_id,
              display_name: post.user_id,
            };
            const isSelf = author.id === currentUser.id;

            return (
              <article
                key={post.id}
                className="card-glow rounded-xl border border-red-900/40 bg-neutral-950 p-5 shadow-md transition-all hover:border-red-800/80"
              >
                {/* Author Card Header */}
                <div className="flex items-center justify-between border-b border-red-900/20 pb-3">
                  <div
                    onClick={() => setSelectedAuthorId(author.id)}
                    className="flex items-center gap-3 cursor-pointer group"
                  >
                    <img
                      src={
                        author.avatar_url ||
                        "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150"
                      }
                      alt={author.display_name}
                      className="h-10 w-10 rounded-full border border-red-700 object-cover transition-transform group-hover:scale-105"
                    />
                    <div>
                      <h4 className="text-sm font-bold text-red-100 group-hover:text-red-400 transition-colors">
                        {author.display_name}
                      </h4>
                      <p className="text-[11px] text-red-500">@{author.username}</p>
                    </div>
                  </div>

                  {/* Actions / View Profile */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedAuthorId(author.id)}
                      className="rounded border border-red-900/60 bg-neutral-900 px-3 py-1 text-xs font-medium text-red-300 hover:bg-red-900/40 hover:text-red-100 transition-all"
                    >
                      {isSelf ? "My Profile" : "View Profile"}
                    </button>
                    {!isSelf && (
                      <button
                        onClick={() => handleQuickConnect(author.id)}
                        className="rounded bg-red-950 border border-red-800 px-2.5 py-1 text-xs font-semibold text-red-300 hover:bg-red-900 transition-all"
                        title="Connect or message this author"
                      >
                        ✉ Connect / DM
                      </button>
                    )}
                  </div>
                </div>

                {/* Text Content */}
                <div className="mt-3 text-sm leading-relaxed text-red-200">
                  <p className="whitespace-pre-wrap">{post.content}</p>
                </div>

                {/* Dynamic Multimedia Display */}
                {post.media_type === "image" && post.media_url && (
                  <div className="mt-4 overflow-hidden rounded-lg border border-red-900/40 bg-black">
                    <img
                      src={post.media_url}
                      alt="Cultural media"
                      className="max-h-96 w-full object-cover"
                      loading="lazy"
                    />
                  </div>
                )}

                {post.media_type === "audio" && (
                  <div className="mt-4">
                    <NativeAudioPlayer
                      audioUrl={post.media_url}
                      title="Native Idoma Audio Recording"
                    />
                  </div>
                )}

                {post.media_type === "video" && post.media_url && (
                  <div className="mt-4 overflow-hidden rounded-lg border border-red-900/40 bg-black">
                    <video
                      controls
                      src={post.media_url}
                      className="max-h-96 w-full"
                    >
                      Your browser does not support HTML5 video streaming.
                    </video>
                  </div>
                )}

                {/* Timestamp & Tag Footer */}
                <div className="mt-4 flex items-center justify-between text-[11px] text-neutral-500 border-t border-red-900/20 pt-2">
                  <span className="capitalize text-red-600 font-semibold">
                    🏷️ {post.media_type} record
                  </span>
                  <span>
                    {new Date(post.created_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Create Post Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="card-glow w-full max-w-lg rounded-xl border border-red-900/60 bg-neutral-950 p-6 text-red-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-red-900/40 pb-3">
              <h3 className="font-heading text-lg font-bold text-red-100">
                Share Cultural Lore
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-neutral-400 hover:text-red-300"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreatePost} className="mt-4 space-y-4">
              {postError && (
                <div className="rounded border border-red-800 bg-red-950/40 p-2 text-xs text-red-400">
                  {postError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-red-400 mb-1">
                  Text / Oral Context (Markdown Supported)
                </label>
                <textarea
                  rows={4}
                  required
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder="Record ancestral idioms, traditional wedding salutations, or pronunciation notes..."
                  className="w-full rounded-lg border border-red-900/50 bg-neutral-900 p-3 text-xs text-red-100 placeholder-neutral-500 focus:border-red-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-red-400 mb-1">
                    Resource Type
                  </label>
                  <select
                    value={mediaType}
                    onChange={(e) => setMediaType(e.target.value as "text" | "image" | "audio" | "video")}
                    className="w-full rounded-lg border border-red-900/50 bg-neutral-900 px-3 py-2 text-xs text-red-200 focus:border-red-500 focus:outline-none"
                  >
                    <option value="text">Text / Quote</option>
                    <option value="audio">Native Audio Wave</option>
                    <option value="image">Traditional Image</option>
                    <option value="video">Archival Video</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-red-400 mb-1">
                    Media Resource URL (Optional)
                  </label>
                  <input
                    type="url"
                    value={mediaUrl}
                    onChange={(e) => setMediaUrl(e.target.value)}
                    placeholder={
                      mediaType === "audio"
                        ? "https://...audio.mp3"
                        : mediaType === "image"
                        ? "https://...image.jpg"
                        : "https://..."
                    }
                    className="w-full rounded-lg border border-red-900/50 bg-neutral-900 px-3 py-2 text-xs text-red-100 placeholder-neutral-500 focus:border-red-500 focus:outline-none"
                  />
                </div>
              </div>

              {mediaType === "audio" && !mediaUrl && (
                <div className="rounded border border-red-900/30 bg-neutral-900/60 p-2.5 text-[11px] text-red-400">
                  💡 Tip: Leave empty to attach the default native greeting sample, or paste an MP3/OGG URL.
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-lg border border-red-900/60 px-4 py-2 text-xs text-red-400 hover:bg-neutral-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !newContent.trim()}
                  className="rounded-lg bg-red-800 px-5 py-2 text-xs font-semibold uppercase tracking-wider text-red-100 shadow hover:bg-red-700 disabled:opacity-50"
                >
                  {creating ? "Publishing..." : "Publish to Feed"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dynamic User Card Explorer Modal */}
      {selectedAuthorId && (
        <ProfileModal
          targetUserId={selectedAuthorId}
          viewerUserId={currentUser.id}
          onClose={() => setSelectedAuthorId(null)}
          onConnectionChange={loadFeed}
        />
      )}
    </div>
  );
}
