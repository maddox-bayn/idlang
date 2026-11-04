import type {
  Post,
  User,
  ProfileResponse,
  DirectMessage,
  Book,
  LearningTrack,
  LearningProfile,
  ConnectionsResponse,
} from "../types";
import {
  mockPosts,
  mockBooks,
  mockCurriculumTracks,
} from "../data/mockData";

// Vite proxies /api locally; split deployments use the configured Go backend.
const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");
const STORAGE_PREFIX = "idlang_";

function setStorage<T>(key: string, value: T): void {
  try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); }
  catch { /* Storage is optional; the HttpOnly session cookie is authoritative. */ }
}

export function apiAssetURL(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") ? `${API_BASE}${value}` : value;
}

// Uploaded media URLs are relative to the API, not the frontend deployment.
function resolveMediaURLs<T>(value: T): T {
  if (Array.isArray(value)) return value.map(resolveMediaURLs) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      ["avatar_url", "media_url", "file_url"].includes(key) && typeof item === "string"
        ? apiAssetURL(item) : resolveMediaURLs(item),
    ])) as T;
  }
  return value;
}

async function readJSON(res: Response) {
  return resolveMediaURLs(await res.json());
}

async function requestJSON<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { ...init, credentials: "include" });
  const data = await readJSON(res).catch(() => {
    if (res.ok) throw new Error("The service returned an invalid response. Please try again.");
    return {};
  });
  if (!res.ok) {
    const error: ApiError = new Error(data.error || `Request failed (HTTP ${res.status}). Please try again.`);
    error.status = res.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

const fallbackPosts = [...mockPosts];
const fallbackBooks = [...mockBooks];
const fallbackTracks = [...mockCurriculumTracks];

// Custom error for auth actions
export interface ApiError extends Error {
  code?: string;
  status?: number;
}

// ==========================================
// AUTHENTICATION APIs
// ==========================================

export async function loginUser(identifier: string, password: string): Promise<User> {
  const trimmed = identifier.trim();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: trimmed, password }),
    });
  } catch {
    const err: ApiError = new Error("Sign-in service is unavailable. Please try again.");
    err.code = "SERVICE_UNAVAILABLE";
    err.status = 503;
    throw err;
  }

  const data = await readJSON(res).catch(() => ({}));
  if (res.ok && data.user) {
    setStorage("current_user", data.user);
    return data.user;
  }

  if (data.code === "USER_NOT_FOUND") {
    const err: ApiError = new Error(data.error || "Account does not exist. Please create an account first.");
    err.code = "USER_NOT_FOUND";
    err.status = 404;
    throw err;
  }

  if (res.status === 401 || data.code === "INVALID_PASSWORD" || (data.error && /invalid credentials|incorrect password/i.test(data.error))) {
    const err: ApiError = new Error(data.error || "Incorrect password. Please verify your password.");
    err.code = "INVALID_PASSWORD";
    err.status = 401;
    throw err;
  }

  throw new Error(data.error || "Login failed. Please try again.");
}

export async function signupUser(userData: {
  username: string;
  display_name: string;
  native_name?: string;
  email: string;
  password: string;
  native_speaker?: boolean;
  dialect?: string;
}): Promise<User> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/auth/signup`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(userData),
    });

  } catch {
    const err: ApiError = new Error("Sign-up service is unavailable. Please try again.");
    err.code = "SERVICE_UNAVAILABLE";
    err.status = 503;
    throw err;
  }

  const data = await readJSON(res).catch(() => ({}));
  if (res.ok && data.user) {
    setStorage("current_user", data.user);
    return data.user;
  }

  throw new Error(data.error || "Failed to create account. Please try again.");
}

export async function logoutUser(): Promise<void> {
  await requestJSON("/api/auth/logout", { method: "POST" });
  try { localStorage.removeItem(STORAGE_PREFIX + "current_user"); }
  catch { /* Ignore unavailable storage. */ }
}

export async function fetchCurrentUser(): Promise<User | null> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, {
      credentials: "include",
    });
    if (res.ok) {
      const data = await readJSON(res);
      if (data.user) {
        setStorage("current_user", data.user);
        return data.user;
      }
    }
  } catch {
    // A cached profile is not proof of an active authenticated session.
  }

  try {
    localStorage.removeItem(STORAGE_PREFIX + "current_user");
  } catch {
    // Ignore storage errors.
  }

  return null;
}

export async function updateUserProfile(data: {
  display_name?: string;
  native_name?: string;
  bio?: string;
  dialect?: string;
  region?: string;
  native_speaker?: boolean;
}): Promise<User> {
  const result = await requestJSON<{ user: User }>("/api/profile/update", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  });
  if (!result.user) throw new Error("Profile update returned no user.");
  setStorage("current_user", result.user);
  return result.user;
}

export async function uploadUserAvatar(file: File): Promise<string> {
  const form = new FormData();
  form.append("avatar", file);
  const data = await requestJSON<{ avatar_url: string }>("/api/profile/avatar", { method: "POST", body: form });
  if (!data.avatar_url) throw new Error("Avatar upload returned no URL.");
  return data.avatar_url;
}

export async function fetchConnectionsList(): Promise<ConnectionsResponse> {
  return requestJSON("/api/connections");
}

export async function updateConnection(
  targetId: string,
  action: "connect" | "accept" | "reject" | "disconnect" | "block" | "unblock"
): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE}/api/connections`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_id: targetId, action }),
  });
  const data = await readJSON(res).catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Could not update this connection. Please try again.");
  }
  return data;
}

export async function searchRealUsers(query: string): Promise<User[]> {
  const data = await requestJSON<{ users: User[] }>(`/api/users/search?q=${encodeURIComponent(query)}`);
  return data.users || [];
}

export async function fetchPosts(page = 1, limit = 10): Promise<{ posts: Post[]; total: number }> {
  try {
    const res = await fetch(`${API_BASE}/api/posts?page=${page}&limit=${limit}`, {
      credentials: "include",
    });
    if (res.ok) {
      const data = await readJSON(res);
      return { posts: data.posts || [], total: data.total || 0 };
    }
  } catch (err) {
    console.warn("Backend unavailable, using mock posts:", err);
  }
  return { posts: fallbackPosts, total: fallbackPosts.length };
}

export async function createPost(post: {
  user_id: string;
  content: string;
  media_type: string;
  media_url?: string;
  media_file?: File;
}): Promise<Post> {
  if (post.media_file) {
    const form = new FormData();
    form.append("content", post.content);
    form.append("media_type", post.media_type);
    if (post.media_url) form.append("media_url", post.media_url);
    form.append("media_file", post.media_file);
    return requestJSON("/api/posts", { method: "POST", body: form });
  }
  return requestJSON("/api/posts", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: post.content, media_type: post.media_type, media_url: post.media_url }),
  });
}

export async function fetchProfile(targetId: string, _viewerId: string): Promise<ProfileResponse> {
  return requestJSON(`/api/profile?id=${encodeURIComponent(targetId)}`);
}

export async function fetchMessages(_userId: string, peerId: string): Promise<DirectMessage[]> {
  return requestJSON(`/api/messages?peer_id=${encodeURIComponent(peerId)}`);
}

export async function sendMessage(_senderId: string, receiverId: string, body: string): Promise<DirectMessage> {
  return requestJSON("/api/messages", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ receiver_id: receiverId, body }),
  });
}

export async function fetchBooks(): Promise<Book[]> {
  try {
    const res = await fetch(`${API_BASE}/api/library`, { credentials: "include" });
    if (res.ok) {
      const data = await readJSON(res);
      if (Array.isArray(data)) return data;
      if (Array.isArray(data.items)) return data.items;
    }
  } catch (err) {
    console.warn("Backend library unavailable, using fallback:", err);
  }
  return fallbackBooks;
}

export async function createBook(book: {
  title: string;
  author: string;
  description?: string;
  book_file?: File;
  license: string;
  kind?: string;
  language?: string;
  dialect?: string;
  source_url?: string;
  consent_note?: string;
}): Promise<Book> {
  if (!book.book_file) {
    throw new Error("Choose a document to upload.");
  }

  const form = new FormData();
  form.append("title", book.title);
  form.append("author", book.author);
  form.append("description", book.description || "");
  form.append("kind", book.kind || "book");
  form.append("language", book.language || "idoma");
  form.append("license", book.license);
  if (book.dialect) form.append("dialect", book.dialect);
  if (book.source_url) form.append("source_url", book.source_url);
  if (book.consent_note) form.append("consent_note", book.consent_note);
  form.append("file", book.book_file);

  const res = await fetch(`${API_BASE}/api/library`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  const data = await readJSON(res).catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Could not upload this library item.");
  }
  return data;
}

export async function fetchLibraryItem(id: string): Promise<Book> {
  const res = await fetch(`${API_BASE}/api/library/${encodeURIComponent(id)}`, {
    credentials: "include",
  });
  const data = await readJSON(res).catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Could not load this library item.");
  }
  return data;
}

export function libraryFileURL(book: Book, inline = false): string {
  const endpoint = `${API_BASE}/api/library/${encodeURIComponent(book.id)}/file`;
  const path = book.file_url ? apiAssetURL(book.file_url) : endpoint;
  return inline && path === endpoint ? `${path}?inline=1` : path;
}

// ==========================================
// LEARNING TRACKS APIs
// ==========================================

export async function fetchLearningTracks(userId: string): Promise<{ profile: LearningProfile; tracks: LearningTrack[] }> {
  if (userId === "guest") return {
    profile: { user_id: userId, completed_tracks: [], xp_points: 0, fluency_tier: "beginner" },
    tracks: fallbackTracks,
  };
  return requestJSON("/api/learning/tracks");
}

export async function completeLearningTrack(
  trackId: string
): Promise<{ success: boolean; message: string; learning_profile: LearningProfile; tracks: LearningTrack[] }> {
  const res = await fetch(`${API_BASE}/api/learning/complete-track`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ track_id: trackId }),
  });

  if (!res.ok) {
    const errData = await readJSON(res).catch(() => ({}));
    throw new Error(errData.error || "Failed to complete track");
  }

  return await readJSON(res);
}

export async function fetchUsers(): Promise<User[]> {
  return searchRealUsers("");
}
