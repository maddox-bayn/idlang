import { useState, useEffect, useRef } from "react";
import type { Post, PostComment, User } from "../types";
import { fetchPosts, createPost, deletePost, updateConnection, setPostLike, fetchPostComments, addPostComment, fetchFeedPrompt, fetchSavedItems, saveItem, unsaveItem } from "../api/socialClient";
import NativeAudioPlayer from "./NativeAudioPlayer";
import ProfileModal from "./ProfileModal";

interface FeedViewProps {
  currentUser: User;
}

export default function FeedView({ currentUser }: FeedViewProps) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [totalPosts, setTotalPosts] = useState(0);
  const [nextPage, setNextPage] = useState(2);
  const [loadingMore, setLoadingMore] = useState(false);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
  const [selectedAuthorId, setSelectedAuthorId] = useState<string | null>(null);
  const [selectedTopic, setSelectedTopic] = useState("");
  const [prompt, setPrompt] = useState("");
  const [expandedComments, setExpandedComments] = useState<string | null>(null);
  const [commentsByPost, setCommentsByPost] = useState<Record<string, PostComment[]>>({});
  const [commentDraft, setCommentDraft] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [savingComment, setSavingComment] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [savedPostIds, setSavedPostIds] = useState<Set<string>>(new Set());
  const [savedFeedback, setSavedFeedback] = useState<string | null>(null);

  // New post modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [mediaType, setMediaType] = useState<"text" | "image" | "audio" | "video">("text");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (showCreateModal && dialog && !dialog.open) {
      const previous = document.activeElement as HTMLElement | null;
      dialog.showModal();
      const overflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        dialog.close();
        document.body.style.overflow = overflow;
        (previous || createButtonRef.current)?.focus();
      };
    }
  }, [showCreateModal]);

  const loadFeed = async (page = 1, append = false) => {
    setFeedError(null);
    if (append) setLoadingMore(true);
    else {
      setLoading(true);
    }
    try {
      const data = await fetchPosts(page, 20, selectedTopic);
      setPosts((prev) => append ? [...prev, ...data.posts] : data.posts);
      setTotalPosts(data.total);
      setNextPage(page + 1);
    } catch (err) {
      setFeedError(err instanceof Error ? err.message : "Could not load the feed.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => { void loadFeed(); }, [selectedTopic]);

  useEffect(() => { fetchFeedPrompt().then(setPrompt).catch(() => setPrompt("Share a word, phrase, or memory from your Idoma community.")); }, []);
  useEffect(() => { fetchSavedItems().then(items => setSavedPostIds(new Set(items.filter(item => item.item_type === "post").map(item => item.item_id)))).catch(() => {}); }, []);

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContent.trim()) return;
    if (mediaType !== "text" && !mediaFile && !mediaUrl.trim()) {
      setPostError("Add a media URL or upload a file for this resource type.");
      return;
    }

    setCreating(true);
    setPostError(null);
    try {
      const created = await createPost({
        user_id: currentUser.id,
        content: newContent.trim(),
        media_type: mediaType,
        media_url: mediaUrl.trim() || undefined,
        media_file: mediaFile || undefined,
        tags: selectedTags,
      });
      if (!selectedTopic || selectedTags.includes(selectedTopic)) {
        setPosts((prev) => [created, ...prev].slice(0, 20));
        setTotalPosts((count) => count + 1);
      }
      setNewContent("");
      setMediaUrl("");
      setMediaFile(null);
      setMediaType("text");
      setSelectedTags([]);
      setShowCreateModal(false);
    } catch (err: unknown) {
      setPostError(err instanceof Error ? err.message : "Failed to submit post");
    } finally {
      setCreating(false);
    }
  };

  const handleLike = async (post: Post) => {
    try {
      const result = await setPostLike(post.id, !post.liked);
      setPosts((prev) => prev.map((item) => item.id === post.id ? { ...item, liked: result.liked, like_count: result.like_count } : item));
    } catch (err) { setActionError(err instanceof Error ? err.message : "Could not update reaction."); }
  };

  const handleSavePost = async (post: Post) => {
    const saved = savedPostIds.has(post.id);
    try {
      if (saved) await unsaveItem("post", post.id);
      else await saveItem({ item_type: "post", item_id: post.id, title: `Post by ${post.author?.display_name || "Idlang member"}`, body: post.content });
      setSavedPostIds((previous) => { const next = new Set(previous); if (saved) next.delete(post.id); else next.add(post.id); return next; });
      setSavedFeedback(saved ? "Post removed from saved items." : "Post saved for review.");
      window.setTimeout(() => setSavedFeedback(null), 2500);
    } catch (err) { setActionError(err instanceof Error ? err.message : "Could not save this post."); }
  };

  const toggleComments = async (postId: string) => {
    setCommentError(null);
    if (expandedComments === postId) { setExpandedComments(null); return; }
    setExpandedComments(postId);
    if (commentsByPost[postId]) return;
    try { const comments = await fetchPostComments(postId); setCommentsByPost((prev) => ({ ...prev, [postId]: comments })); }
    catch (err) { setCommentError(err instanceof Error ? err.message : "Could not load comments."); }
  };

  const submitComment = async (postId: string) => {
    if (!commentDraft.trim() || savingComment) return;
    setSavingComment(true); setCommentError(null);
    try {
      const comment = await addPostComment(postId, commentDraft.trim());
      setCommentsByPost((prev) => ({ ...prev, [postId]: [...(prev[postId] || []), comment] }));
      setPosts((prev) => prev.map((post) => post.id === postId ? { ...post, comment_count: (post.comment_count || 0) + 1 } : post));
      setCommentDraft("");
    } catch (err) { setCommentError(err instanceof Error ? err.message : "Could not add comment."); }
    finally { setSavingComment(false); }
  };

  const toggleTag = (tag: string) => setSelectedTags((prev) => prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag].slice(0, 3));

  const handleDeletePost = async (post: Post) => {
    if (!window.confirm("Delete this post? This action cannot be undone.")) return;
    setActionError(null);
    setDeletingPostId(post.id);
    try {
      await deletePost(post.id);
      setPosts((prev) => prev.filter((item) => item.id !== post.id));
      setTotalPosts((count) => Math.max(0, count - 1));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not delete this post.");
    } finally {
      setDeletingPostId(null);
    }
  };

  const handleQuickConnect = async (targetId: string) => {
    setConnectError(null);
    try {
      await updateConnection(targetId, "connect");
      setSelectedAuthorId(targetId);
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Could not send the connection request.");
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
          ref={createButtonRef}
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 rounded-lg bg-red-800 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-red-100 shadow transition-all hover:bg-red-700 active:scale-95"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Share Cultural Post
        </button>
      </div>

      <section className="rounded-xl border border-red-900/40 bg-red-950/20 px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-red-400">Community prompt</p>
        <p className="mt-1 text-sm text-red-100">{prompt || "Share a word, phrase, or memory from your Idoma community."}</p>
      </section>

      <div className="flex flex-wrap gap-2" aria-label="Filter feed by topic">
        {[ ["", "All topics"], ["greetings", "Greetings"], ["dialects", "Dialects"], ["proverbs", "Proverbs"], ["music", "Music"], ["oral-history", "Oral history"], ["culture", "Culture"] ].map(([topic, label]) => (
          <button key={topic} onClick={() => setSelectedTopic(topic)} aria-pressed={selectedTopic === topic} className={`rounded-full border px-3 py-1.5 text-xs ${selectedTopic === topic ? "border-red-600 bg-red-900 text-red-100" : "border-red-900/50 bg-neutral-950 text-neutral-300 hover:border-red-700"}`}>{label}</button>
        ))}
      </div>

      {connectError && (
        <div role="alert" className="rounded-lg border border-red-700 bg-red-950/50 px-3 py-2 text-xs text-red-200">
          {connectError}
        </div>
      )}
      {actionError && <div role="alert" className="rounded-lg border border-red-700 bg-red-950/50 px-3 py-2 text-xs text-red-200">{actionError}</div>}
      {savedFeedback && <p role="status" className="text-xs text-green-300">{savedFeedback}</p>}

      {/* Posts Stream */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-red-600 border-t-transparent" />
          <p className="mt-3 text-xs text-red-400">Loading ancestral feed...</p>
        </div>
      ) : feedError && posts.length === 0 ? (
        <div role="alert" className="rounded-xl border border-red-700 bg-red-950/40 p-6 text-center">
          <p className="text-sm text-red-200">{feedError}</p>
          <button onClick={() => void loadFeed()} className="mt-3 rounded-lg border border-red-700 px-4 py-2 text-xs font-semibold text-red-100 hover:bg-red-900/50">Retry</button>
        </div>
      ) : posts.length === 0 ? (
        <div className="rounded-xl border border-red-900/30 bg-neutral-950 p-8 text-center text-red-400">
          <p className="text-sm">No cultural posts yet. Be the first to share an ancestral story!</p>
        </div>
      ) : (
        <div className="space-y-6">
          {feedError && <div role="alert" className="rounded-xl border border-red-700 bg-red-950/40 p-4 text-center text-sm text-red-200">{feedError}<button onClick={() => void loadFeed(nextPage, true)} className="ml-3 underline">Retry</button></div>}
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
                  <button type="button" onClick={() => setSelectedAuthorId(author.id)} aria-label={`View ${author.display_name}'s profile`} className="flex items-center gap-3 cursor-pointer group text-left">
                    <img
                      src={
                        author.avatar_url ||
                        "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150"
                      }
                      alt={author.display_name}
                      className="h-10 w-10 rounded-full border border-red-700 object-cover transition-transform group-hover:scale-105"
                    />
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h4 className="text-sm font-bold text-red-100 group-hover:text-red-400 transition-colors">
                          {author.display_name}
                        </h4>
                        {author.native_name && (
                          <span className="rounded bg-red-950 px-1.5 py-0.5 text-[10px] font-semibold text-red-300 border border-red-900">
                            🪘 {author.native_name}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-red-500">@{author.username}</p>
                    </div>
                  </button>

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
                    {isSelf && (
                      <button
                        onClick={() => void handleDeletePost(post)}
                        disabled={deletingPostId === post.id}
                        className="rounded border border-red-900/60 px-2.5 py-1 text-xs text-red-400 hover:bg-red-950 disabled:opacity-50"
                      >
                        {deletingPostId === post.id ? "Deleting…" : "Delete"}
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

                {post.tags?.length ? <div className="mt-3 flex flex-wrap gap-1.5">{post.tags.map((tag) => <button key={tag} onClick={() => setSelectedTopic(tag)} className="rounded-full border border-red-900/50 px-2 py-0.5 text-[10px] text-red-300">#{tag}</button>)}</div> : null}

                <div className="mt-4 flex items-center gap-4 border-t border-red-900/20 pt-3">
                  <button onClick={() => void handleLike(post)} aria-pressed={!!post.liked} className={`text-xs font-semibold ${post.liked ? "text-red-300" : "text-neutral-400 hover:text-red-300"}`}>{post.liked ? "♥ Liked" : "♡ Like"} · {post.like_count || 0}</button>
                  <button onClick={() => void handleSavePost(post)} aria-pressed={savedPostIds.has(post.id)} className="text-xs font-semibold text-neutral-400 hover:text-red-300">{savedPostIds.has(post.id) ? "★ Saved" : "☆ Save"}</button>
                  <button onClick={() => void toggleComments(post.id)} aria-expanded={expandedComments === post.id} className="text-xs font-semibold text-neutral-400 hover:text-red-300">💬 Comments · {post.comment_count || 0}</button>
                </div>

                {expandedComments === post.id && <section className="mt-3 rounded-lg border border-neutral-800 bg-black/40 p-3" aria-label="Post comments">
                  {commentError && <p role="alert" className="mb-2 text-xs text-red-300">{commentError}</p>}
                  <div className="max-h-52 space-y-3 overflow-y-auto">{(commentsByPost[post.id] || []).map((comment) => <div key={comment.id} className="border-b border-neutral-800 pb-2 last:border-0"><p className="text-xs font-semibold text-red-200">{comment.author}</p><p className="mt-0.5 whitespace-pre-wrap text-sm text-neutral-200">{comment.body}</p></div>)}{commentsByPost[post.id]?.length === 0 && <p className="text-xs text-neutral-400">No comments yet. Start the conversation.</p>}</div>
                  <form onSubmit={(event) => { event.preventDefault(); void submitComment(post.id); }} className="mt-3 flex gap-2"><label className="sr-only" htmlFor={`comment-${post.id}`}>Write a comment</label><input id={`comment-${post.id}`} value={commentDraft} maxLength={1000} onChange={(event) => setCommentDraft(event.target.value)} placeholder="Add a thoughtful comment…" className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-red-100" /><button disabled={savingComment || !commentDraft.trim()} className="rounded-lg bg-red-900 px-3 py-2 text-xs font-semibold text-red-100 disabled:opacity-50">{savingComment ? "Posting…" : "Reply"}</button></form>
                </section>}

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
          {posts.length < totalPosts && (
            <div className="text-center">
              <button onClick={() => void loadFeed(nextPage, true)} disabled={loadingMore} className="rounded-lg border border-red-800 px-4 py-2 text-xs font-semibold text-red-200 hover:bg-red-950 disabled:opacity-50">
                {loadingMore ? "Loading…" : "Load more posts"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Create Post Modal */}
      {showCreateModal && (
        <dialog ref={dialogRef} aria-labelledby="create-post-title" onCancel={(event) => { event.preventDefault(); if (!creating) setShowCreateModal(false); }} onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const elements = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')].filter((el) => el.getClientRects().length > 0);
          const first = elements[0]; const last = elements[elements.length - 1];
          if (!first) { event.preventDefault(); return; }
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }} className="m-auto w-[calc(100%_-_2rem)] max-w-lg max-h-[92dvh] overflow-y-auto rounded-xl border border-red-900/60 bg-neutral-950 p-0 text-red-100 backdrop:bg-black/80">
          <div className="card-glow p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-red-900/40 pb-3">
                <h3 id="create-post-title" className="font-heading text-lg font-bold text-red-100">
                Share Cultural Lore
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                disabled={creating}
                aria-label="Close create post dialog"
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
                <label htmlFor="post-content" className="block text-xs font-semibold uppercase tracking-wider text-red-400 mb-1">
                  Text / Oral Context (plain text)
                </label>
                <textarea
                  id="post-content"
                  rows={4}
                  required
                  value={newContent}
                  autoFocus
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder="Record ancestral idioms, traditional wedding salutations, or pronunciation notes..."
                  className="w-full rounded-lg border border-red-900/50 bg-neutral-900 p-3 text-xs text-red-100 placeholder-neutral-500 focus:border-red-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                    <label htmlFor="post-media-type" className="block text-xs font-semibold uppercase tracking-wider text-red-400 mb-1">
                    Resource Type
                  </label>
                  <select
                    id="post-media-type"
                    value={mediaType}
                    onChange={(e) => { setMediaType(e.target.value as "text" | "image" | "audio" | "video"); setMediaFile(null); setMediaUrl(""); }}
                    className="w-full rounded-lg border border-red-900/50 bg-neutral-900 px-3 py-2 text-xs text-red-200 focus:border-red-500 focus:outline-none"
                  >
                    <option value="text">Text / Quote</option>
                    <option value="audio">Native Audio Wave</option>
                    <option value="image">Traditional Image</option>
                    <option value="video">Archival Video</option>
                  </select>
                </div>

                {mediaType !== "text" && <div>
                  <label htmlFor="post-media-url" className="block text-xs font-semibold uppercase tracking-wider text-red-400 mb-1">Media URL (optional)</label>
                  <input
                    id="post-media-url"
                    type="url"
                    value={mediaUrl}
                    disabled={!!mediaFile}
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
                </div>}
              </div>

              <fieldset>
                <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-red-400">Topics (choose up to 3)</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-2">{["greetings", "dialects", "proverbs", "music", "oral-history", "culture"].map((tag) => <label key={tag} className="flex items-center gap-1.5 text-xs text-neutral-300"><input type="checkbox" checked={selectedTags.includes(tag)} disabled={!selectedTags.includes(tag) && selectedTags.length >= 3} onChange={() => toggleTag(tag)} />{tag}</label>)}</div>
              </fieldset>

              {mediaType !== "text" && <div>
                <label htmlFor="post-media-file" className="block text-xs font-semibold uppercase tracking-wider text-red-400 mb-1">Upload a {mediaType} file (optional, max 25 MB)</label>
                <input id="post-media-file" type="file" accept={mediaType === "image" ? "image/jpeg,image/png,image/webp" : mediaType === "audio" ? "audio/mpeg,audio/ogg,audio/wav,audio/mp4" : "video/mp4,video/webm"} onChange={(e) => { setMediaFile(e.target.files?.[0] || null); if (e.target.files?.[0]) setMediaUrl(""); }} className="block w-full text-xs text-neutral-300 file:mr-3 file:rounded file:border-0 file:bg-red-900 file:px-3 file:py-2 file:text-red-100" />
                {mediaFile && <p className="mt-1 text-xs text-neutral-400">Selected: {mediaFile.name}</p>}
              </div>}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  disabled={creating}
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
        </dialog>
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
