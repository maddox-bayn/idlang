import { useState, useEffect } from "react";
import type { Book, User } from "../types";
import { fetchBooks, createBook } from "../api/socialClient";

interface LibraryViewProps {
  currentUser: User;
}

export default function LibraryView({ currentUser }: LibraryViewProps) {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [viewingBook, setViewingBook] = useState<Book | null>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBooks = async () => {
    setLoading(true);
    try {
      const data = await fetchBooks();
      setBooks(data);
    } catch (err) {
      console.error("Failed to load books:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBooks();
  }, []);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !author.trim()) return;

    setUploading(true);
    setError(null);
    try {
      const newBook = await createBook({
        title: title.trim(),
        author: author.trim(),
        uploaded_by: currentUser.id,
        description: description.trim(),
        file_url: fileUrl.trim() || undefined,
      });
      setBooks((prev) => [newBook, ...prev]);
      setTitle("");
      setAuthor("");
      setDescription("");
      setFileUrl("");
      setShowUploadModal(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to catalog manuscript");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 space-y-8">
      {/* Header Banner */}
      <div className="card-glow flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl border border-red-900/40 bg-neutral-950 p-6 shadow-xl">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-widest text-red-500">
            Digital Reading Archive
          </span>
          <h2 className="font-heading text-2xl font-bold text-red-100">
            Idoma E-Library & Manuscript Store
          </h2>
          <p className="mt-1 text-xs text-red-400 max-w-lg">
            Preserving historical grammatical texts, Alekwu coronation dirges, and tonal dictionaries for scholars and descendants.
          </p>
        </div>
        <button
          onClick={() => setShowUploadModal(true)}
          className="flex items-center gap-2 rounded-lg bg-red-800 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-red-100 shadow hover:bg-red-700 active:scale-95"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          Catalog Document
        </button>
      </div>

      {/* Grid of Books */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-red-600 border-t-transparent" />
          <p className="mt-3 text-xs text-red-400">Loading cataloged texts...</p>
        </div>
      ) : books.length === 0 ? (
        <div className="rounded-xl border border-red-900/30 bg-neutral-950 p-12 text-center text-red-400">
          <p className="text-sm">No documents in the repository yet. Upload a manuscript to begin.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {books.map((book) => (
            <div
              key={book.id}
              className="card-glow flex flex-col justify-between rounded-xl border border-red-900/40 bg-neutral-950 p-5 shadow transition-all hover:border-red-700 hover:scale-[1.01]"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <span className="rounded bg-red-950/70 border border-red-900 px-2 py-0.5 text-[10px] font-semibold text-red-400">
                    📜 Language Manuscript
                  </span>
                  <span className="text-[10px] text-neutral-500">
                    {book.created_at ? new Date(book.created_at).toLocaleDateString() : "Archived"}
                  </span>
                </div>

                <h3 className="mt-3 font-heading text-base font-bold text-red-100 line-clamp-2">
                  {book.title}
                </h3>
                <p className="mt-1 text-xs font-medium text-red-400">
                  By {book.author}
                </p>

                <p className="mt-3 text-xs leading-relaxed text-neutral-400 line-clamp-3">
                  {book.description || "Historical textual documentation of ancestral Idoma terminology."}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="mt-6 flex items-center justify-between border-t border-red-900/20 pt-4">
                <span className="text-[11px] text-neutral-500">
                  By @{book.uploaded_by.replace("user_", "")}
                </span>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setViewingBook(book)}
                    className="rounded border border-red-900/60 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-900/40"
                  >
                    Read
                  </button>
                  <a
                    href={book.file_url}
                    download
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 rounded bg-red-900 px-3 py-1.5 text-xs font-semibold text-red-100 hover:bg-red-800"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reader Modal */}
      {viewingBook && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="card-glow max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-red-900/60 bg-neutral-950 p-6 text-red-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-red-900/40 pb-3">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-red-500">
                  Manuscript Reader
                </span>
                <h3 className="font-heading text-lg font-bold text-red-100">
                  {viewingBook.title}
                </h3>
                <p className="text-xs text-red-400">Author: {viewingBook.author}</p>
              </div>
              <button
                onClick={() => setViewingBook(null)}
                className="rounded p-1 text-neutral-400 hover:text-red-300"
              >
                ✕
              </button>
            </div>

            <div className="my-6 rounded-lg border border-red-950 bg-black/70 p-5 font-serif text-sm leading-relaxed text-red-200 whitespace-pre-wrap">
              {`[ ARCHIVAL RECORD — HISTORICAL IDOMA CORPUS ]

Title: ${viewingBook.title}
Author: ${viewingBook.author}
Archived Under: Idlang Guardian of History Repository

${viewingBook.description}

Section I: Orthographic Principles and Pronunciation Rules
1. High tone (é) signifies ascending pitch (e.g. Óché - King/Leader).
2. Low tone (è) represents descending reverence.
3. Mid tone remains unmarked.

Central Idioms:
• "Ékwù n'wà guide our path" — Ancestral guidance in daily choices.
• "Aôlô l'ohe o" — Dawn's salutation for peace.
• "Nmaochi" — Gratitude for fellowship.

This manuscript is preserved as an open heritage artifact for language revival.`}
            </div>

            <div className="flex justify-between items-center border-t border-red-900/30 pt-4">
              <span className="text-xs text-neutral-500">
                Resource URL: {viewingBook.file_url}
              </span>
              <button
                onClick={() => setViewingBook(null)}
                className="rounded-lg bg-red-900/60 border border-red-800 px-4 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-800"
              >
                Close Viewer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Book Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="card-glow w-full max-w-lg rounded-xl border border-red-900/60 bg-neutral-950 p-6 text-red-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-red-900/40 pb-3">
              <h3 className="font-heading text-lg font-bold text-red-100">
                Catalog Language Resource
              </h3>
              <button
                onClick={() => setShowUploadModal(false)}
                className="text-neutral-400 hover:text-red-300"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUpload} className="mt-4 space-y-4">
              {error && (
                <div className="rounded border border-red-800 bg-red-950/40 p-2 text-xs text-red-400">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-red-400 mb-1">
                  Document Title
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Central Idoma Phonics Compendium"
                  className="w-full rounded-lg border border-red-900/50 bg-neutral-900 px-3 py-2 text-xs text-red-100 placeholder-neutral-500 focus:border-red-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-red-400 mb-1">
                  Author / Organization
                </label>
                <input
                  type="text"
                  required
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder="e.g., Elder Ada Agada or Heritage Institute"
                  className="w-full rounded-lg border border-red-900/50 bg-neutral-900 px-3 py-2 text-xs text-red-100 placeholder-neutral-500 focus:border-red-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-red-400 mb-1">
                  Abstract / Linguistic Description
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief summary of dialect coverage, tonal notations, and historical era..."
                  className="w-full rounded-lg border border-red-900/50 bg-neutral-900 p-3 text-xs text-red-100 placeholder-neutral-500 focus:border-red-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-red-400 mb-1">
                  Document Resource URL (Optional)
                </label>
                <input
                  type="text"
                  value={fileUrl}
                  onChange={(e) => setFileUrl(e.target.value)}
                  placeholder="Leave blank for sample repository link"
                  className="w-full rounded-lg border border-red-900/50 bg-neutral-900 px-3 py-2 text-xs text-red-100 placeholder-neutral-500 focus:border-red-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="rounded-lg border border-red-900/60 px-4 py-2 text-xs text-red-400 hover:bg-neutral-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading || !title.trim() || !author.trim()}
                  className="rounded-lg bg-red-800 px-5 py-2 text-xs font-semibold uppercase tracking-wider text-red-100 shadow hover:bg-red-700 disabled:opacity-50"
                >
                  {uploading ? "Cataloging..." : "Catalog Document"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
