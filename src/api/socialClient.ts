import { fetchResponse } from "./request";
import type {
  Post,
  PostComment,
  SavedItem,
  User,
  ProfileResponse,
  DirectMessage,
  Book,
  LearningTrack,
  LearningProfile,
  ConnectionsResponse,
} from "../types";
import {
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
  const res = await fetchResponse(`${API_BASE}${path}`, { ...init, credentials: "include" });
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
    res = await fetchResponse(`${API_BASE}/api/auth/login`, {
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
    res = await fetchResponse(`${API_BASE}/api/auth/signup`, {
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
    const res = await fetchResponse(`${API_BASE}/api/auth/me`, {
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
  const res = await fetchResponse(`${API_BASE}/api/connections`, {
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

export async function fetchPosts(page = 1, limit = 10, topic = ""): Promise<{ posts: Post[]; total: number }> {
  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (topic) query.set("topic", topic);
  const res = await fetchResponse(`${API_BASE}/api/posts?${query}`, {
    credentials: "include",
  });
  const data = await readJSON(res).catch(() => {
    if (res.ok) throw new Error("The feed returned an invalid response. Please try again.");
    return {};
  });
  if (!res.ok) {
    const error: ApiError = new Error(data.error || `Could not load the feed (HTTP ${res.status}). Please try again.`);
    error.status = res.status;
    error.code = data.code;
    throw error;
  }
  if (!Array.isArray(data.posts) || typeof data.total !== "number") {
    throw new Error("The feed returned an invalid response. Please try again.");
  }
  return { posts: resolveMediaURLs(data.posts), total: data.total };
}

export async function createPost(post: {
  user_id: string;
  content: string;
  media_type: string;
  media_url?: string;
  media_file?: File;
  tags?: string[];
}): Promise<Post> {
  if (post.media_file) {
    const form = new FormData();
    form.append("content", post.content);
    form.append("media_type", post.media_type);
    if (post.tags?.length) form.append("tags", JSON.stringify(post.tags));
    if (post.media_url) form.append("media_url", post.media_url);
    form.append("media_file", post.media_file);
    return requestJSON("/api/posts", { method: "POST", body: form });
  }
  return requestJSON("/api/posts", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: post.content, media_type: post.media_type, media_url: post.media_url, tags: post.tags || [] }),
  });
}

export async function deletePost(postId: string): Promise<void> {
  await requestJSON(`/api/posts/${encodeURIComponent(postId)}`, { method: "DELETE" });
}

export async function setPostLike(postId: string, liked: boolean): Promise<{ liked: boolean; like_count: number }> {
  return requestJSON(`/api/posts/${encodeURIComponent(postId)}/likes`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ liked }),
  });
}

export async function fetchPostComments(postId: string): Promise<PostComment[]> {
  const data = await requestJSON<{ comments: PostComment[] }>(`/api/posts/${encodeURIComponent(postId)}/comments`);
  return data.comments || [];
}

export async function addPostComment(postId: string, body: string): Promise<PostComment> {
  const data = await requestJSON<{ comment: PostComment }>(`/api/posts/${encodeURIComponent(postId)}/comments`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }),
  });
  return data.comment;
}

export async function fetchFeedPrompt(): Promise<string> {
  const data = await requestJSON<{ prompt: string }>("/api/feed/prompt");
  return data.prompt;
}

export async function fetchSavedItems(): Promise<SavedItem[]> {
  const data = await requestJSON<{ items: SavedItem[] }>("/api/saved");
  return data.items || [];
}

export async function saveItem(item: Omit<SavedItem, "created_at">): Promise<void> {
  await requestJSON("/api/saved", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) });
}

export async function unsaveItem(type: SavedItem["item_type"], id: string): Promise<void> {
  const query = new URLSearchParams({ item_type: type, item_id: id });
  await requestJSON(`/api/saved?${query}`, { method: "DELETE" });
}

export async function fetchProfile(targetId: string, _viewerId: string): Promise<ProfileResponse> {
  return requestJSON(`/api/profile?id=${encodeURIComponent(targetId)}`);
}

export async function fetchMessages(
  _userId: string,
  peerId: string,
  cursor: { afterId?: string; beforeId?: string; signal?: AbortSignal } = {},
): Promise<DirectMessage[]> {
  const params = new URLSearchParams({ peer_id: peerId });
  if (cursor.afterId) params.set("after_id", cursor.afterId);
  if (cursor.beforeId) params.set("before_id", cursor.beforeId);
  return requestJSON(`/api/messages?${params}`, { signal: cursor.signal });
}

export async function markMessagesRead(peerId: string): Promise<void> {
  await requestJSON("/api/messages/read", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ peer_id: peerId }),
  });
}

export async function sendMessage(_senderId: string, receiverId: string, body: string): Promise<DirectMessage> {
  return requestJSON("/api/messages", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ receiver_id: receiverId, body }),
  });
}

export async function fetchBooks(query = "", kind = ""): Promise<Book[]> {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  if (kind) params.set("kind", kind);
  const suffix = params.size ? `?${params}` : "";
  const data = await requestJSON<{ items?: Book[] }>(`/api/library${suffix}`);
  return data.items || [];
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

  const res = await fetchResponse(`${API_BASE}/api/library`, {
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
  const res = await fetchResponse(`${API_BASE}/api/library/${encodeURIComponent(id)}`, {
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
  trackId: string,
  answers: Record<string, string>,
): Promise<{ success: boolean; message: string; learning_profile: LearningProfile; tracks: LearningTrack[] }> {
  const res = await fetchResponse(`${API_BASE}/api/learning/complete-track`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ track_id: trackId, answers }),
  });

  if (!res.ok) {
    const errData = await readJSON(res).catch(() => ({}));
    throw new Error(errData.error || "Failed to complete track");
  }

  return await readJSON(res);
}

export interface DailyPractice {
  date: string;
  category: string;
  prompt: string;
  answer: string;
  example?: string;
  completed: boolean;
  streak: number;
}

export function fetchDailyPractice(): Promise<DailyPractice> {
  return requestJSON("/api/learning/daily");
}

export function completeDailyPractice(date: string, answer: string): Promise<{ completed: boolean; streak: number }> {
  return requestJSON("/api/learning/practice", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date, answer }),
  });
}

export async function fetchUsers(): Promise<User[]> {
  return searchRealUsers("");
}

export interface AdminOverview { users: number; posts: number; drafts: number; database: string }
export interface AdminAccount { id: string; username: string; display_name: string; role: string; status: string; created_at: string }
export function fetchAdminOverview(): Promise<AdminOverview> { return requestJSON("/api/admin/overview"); }
export function fetchAdminUsers(page = 1): Promise<{ users: AdminAccount[]; total: number; page: number; limit: number }> {
  return requestJSON(`/api/admin/users?page=${page}`);
}
export function fetchAdminLibrary(page = 1): Promise<{ items: Book[]; total: number; page: number; limit: number }> {
  return requestJSON(`/api/admin/library?page=${page}`);
}
export function reviewLibraryItem(id: string, status: "published" | "rejected"): Promise<unknown> {
  return requestJSON(`/api/library/${encodeURIComponent(id)}/status`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
  });
}
