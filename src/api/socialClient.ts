import type {
  Post,
  User,
  ProfileResponse,
  DirectMessage,
  Book,
  LearningTrack,
  LearningProfile,
  ConnectionsResponse,
  ConnectionUserItem,
} from "../types";
import {
  mockUsers,
  mockPosts,
  mockBooks,
  mockCurriculumTracks,
} from "../data/mockData";

const API_BASE = "";

// In-memory / localStorage state for fallback mode
const STORAGE_PREFIX = "idlang_";

function getStorage<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw ? JSON.parse(raw) : defaultValue;
  } catch {
    return defaultValue;
  }
}

function setStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Ignore storage quota or SSR issues
  }
}

// Fallback state
const fallbackUsers: User[] = getStorage("users", [...mockUsers]);
const fallbackPosts: Post[] = getStorage("posts", [...mockPosts]);
const fallbackBooks: Book[] = [...mockBooks];
const fallbackTracks: LearningTrack[] = [...mockCurriculumTracks];
const fallbackMessages: DirectMessage[] = getStorage("messages", [
  {
    id: "m1",
    sender_id: "user_oche",
    receiver_id: "user_ada",
    body: "Aôlô! Have you recorded the pronunciation for the wedding proverbs?",
    is_read: true,
    created_at: new Date(Date.now() - 30 * 60000).toISOString(),
  },
  {
    id: "m2",
    sender_id: "user_ada",
    receiver_id: "user_oche",
    body: "Ee, Oche. I just uploaded the native audio clip to the cultural feed!",
    is_read: true,
    created_at: new Date(Date.now() - 25 * 60000).toISOString(),
  },
  {
    id: "m3",
    sender_id: "user_oche",
    receiver_id: "user_ada",
    body: "Nmaochi! The elders will be proud of this work.",
    is_read: true,
    created_at: new Date(Date.now() - 10 * 60000).toISOString(),
  },
]);

// Connections in fallback: stores pair relationships with requester and status
// status: 'pending' | 'connected' | 'blocked'
interface FallbackConnectionRecord {
  id: string;
  requester_id: string;
  receiver_id: string;
  status: "pending" | "connected" | "blocked";
  created_at: string;
  updated_at: string;
}

const fallbackConnectionsMap: Record<string, FallbackConnectionRecord> = getStorage("connections", {
  "user_oche:user_ada": {
    id: "c1",
    requester_id: "user_oche",
    receiver_id: "user_ada",
    status: "connected",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  "user_idoko:user_oche": {
    id: "c2",
    requester_id: "user_idoko",
    receiver_id: "user_oche",
    status: "pending",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
});

function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

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

  const data = await res.json().catch(() => ({}));
  if (res.ok && data.user) {
    setStorage("current_user", data.user);
    return data.user;
  }

  if (res.status === 404 || data.code === "USER_NOT_FOUND" || (data.error && /not exist|sign up/i.test(data.error))) {
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

  const data = await res.json().catch(() => ({}));
  if (res.ok && data.user) {
    setStorage("current_user", data.user);
    return data.user;
  }

  throw new Error(data.error || "Failed to create account. Please try again.");
}

export async function logoutUser(): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch (err) {
    console.warn("Backend logout error:", err);
  } finally {
    try {
      localStorage.removeItem(STORAGE_PREFIX + "current_user");
    } catch {
      // Ignore
    }
  }
}

export async function fetchCurrentUser(): Promise<User | null> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, {
      credentials: "include",
    });
    if (res.ok) {
      const data = await res.json();
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
  try {
    const res = await fetch(`${API_BASE}/api/profile/update`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      const resData = await res.json();
      if (resData.user) {
        setStorage("current_user", resData.user);
        return resData.user;
      }
    }
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || "Could not update your profile.");
  } catch (err) {
    if (err instanceof Error && !(err instanceof TypeError)) throw err;
    console.warn("Backend profile update unavailable, updating locally:", err);
  }

  // Fallback update
  const current = getStorage<User | null>("current_user", null) || fallbackUsers[0];
  const updated: User = {
    ...current,
    ...(data.display_name !== undefined && { display_name: data.display_name }),
    ...(data.native_name !== undefined && { native_name: data.native_name }),
    ...(data.bio !== undefined && { bio: data.bio }),
    ...(data.dialect !== undefined && { dialect: data.dialect }),
    ...(data.native_speaker !== undefined && { native_speaker: data.native_speaker }),
  };
  setStorage("current_user", updated);

  const idx = fallbackUsers.findIndex((u) => u.id === updated.id);
  if (idx !== -1) {
    fallbackUsers[idx] = updated;
    setStorage("users", fallbackUsers);
  }

  return updated;
}

export async function uploadUserAvatar(file: File): Promise<string> {
  const form = new FormData();
  form.append("avatar", file);

  try {
    const res = await fetch(`${API_BASE}/api/profile/avatar`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
    if (res.ok) {
      const data = await res.json();
      if (data.avatar_url) {
        const current = getStorage<User | null>("current_user", null);
        if (current) {
          current.avatar_url = data.avatar_url;
          setStorage("current_user", current);
        }
        return data.avatar_url;
      }
    }
  } catch (err) {
    console.warn("Backend avatar upload unavailable, using blob URL locally:", err);
  }

  const url = URL.createObjectURL(file);
  const current = getStorage<User | null>("current_user", null);
  if (current) {
    current.avatar_url = url;
    setStorage("current_user", current);
  }
  return url;
}

// ==========================================
// CONNECTIONS & FRIEND REQUESTS APIs
// ==========================================

export async function fetchConnectionsList(): Promise<ConnectionsResponse> {
  try {
    const res = await fetch(`${API_BASE}/api/connections`, {
      credentials: "include",
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn("Backend connections list unavailable, building from local state:", err);
  }

  // Fallback computation
  const current = getStorage<User | null>("current_user", null) || fallbackUsers[0];
  const connected: ConnectionUserItem[] = [];
  const incoming: ConnectionUserItem[] = [];
  const outgoing: ConnectionUserItem[] = [];

  for (const record of Object.values(fallbackConnectionsMap)) {
    if (record.status === "connected") {
      if (record.requester_id === current.id || record.receiver_id === current.id) {
        const peerId = record.requester_id === current.id ? record.receiver_id : record.requester_id;
        const peer = fallbackUsers.find((u) => u.id === peerId);
        if (peer) {
          connected.push({ user: peer, connection_id: record.id, created_at: record.updated_at });
        }
      }
    } else if (record.status === "pending") {
      if (record.receiver_id === current.id) {
        const peer = fallbackUsers.find((u) => u.id === record.requester_id);
        if (peer) {
          incoming.push({ user: peer, connection_id: record.id, created_at: record.created_at });
        }
      } else if (record.requester_id === current.id) {
        const peer = fallbackUsers.find((u) => u.id === record.receiver_id);
        if (peer) {
          outgoing.push({ user: peer, connection_id: record.id, created_at: record.created_at });
        }
      }
    }
  }

  return { connected, incoming, outgoing };
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
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Could not update this connection. Please try again.");
  }
  return data;
}

export async function searchRealUsers(query: string): Promise<User[]> {
  try {
    const res = await fetch(`${API_BASE}/api/users/search?q=${encodeURIComponent(query)}`, {
      credentials: "include",
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.users)) {
        return data.users;
      }
    }
  } catch (err) {
    console.warn("Backend user search unavailable:", err);
  }

  // Fallback search
  const q = query.trim().toLowerCase();
  if (!q) return fallbackUsers;
  return fallbackUsers.filter(
    (u) =>
      u.username.toLowerCase().includes(q) ||
      u.display_name.toLowerCase().includes(q) ||
      u.native_name?.toLowerCase().includes(q)
  );
}

// ==========================================
// FEED & POSTS APIs
// ==========================================

export async function fetchPosts(page = 1, limit = 10): Promise<{ posts: Post[]; total: number }> {
  try {
    const res = await fetch(`${API_BASE}/api/posts?page=${page}&limit=${limit}`, {
      credentials: "include",
    });
    if (res.ok) {
      const data = await res.json();
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
  try {
    let res: Response;
    if (post.media_file) {
      const form = new FormData();
      form.append("content", post.content);
      form.append("media_type", post.media_type);
      if (post.media_url) form.append("media_url", post.media_url);
      form.append("media_file", post.media_file);
      res = await fetch(`${API_BASE}/api/posts`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
    } else {
      res = await fetch(`${API_BASE}/api/posts`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: post.content,
          media_type: post.media_type,
          media_url: post.media_url,
        }),
      });
    }
    if (res.ok) {
      return await res.json();
    }
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || "Could not publish this post.");
  } catch (err) {
    if (err instanceof Error && !(err instanceof TypeError)) throw err;
    console.warn("Backend unavailable, storing post locally:", err);
  }

  const author = fallbackUsers.find((u) => u.id === post.user_id) || {
    id: post.user_id,
    username: post.user_id,
    display_name: post.user_id,
  };

  const newPost: Post = {
    id: "post_" + Date.now(),
    user_id: post.user_id,
    author,
    content: post.content,
    media_type: (["text", "image", "audio", "video"].includes(post.media_type)
      ? post.media_type
      : "text") as Post["media_type"],
    media_url: post.media_url || "",
    created_at: new Date().toISOString(),
  };
  fallbackPosts.unshift(newPost);
  setStorage("posts", fallbackPosts);
  return newPost;
}

// ==========================================
// PROFILE API
// ==========================================

export async function fetchProfile(targetId: string, viewerId: string): Promise<ProfileResponse> {
  try {
    const res = await fetch(`${API_BASE}/api/profile?id=${targetId}`, {
      credentials: "include",
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn("Backend unavailable, using mock profile:", err);
  }

  const user = fallbackUsers.find((u) => u.id === targetId) || {
    id: targetId,
    username: targetId,
    display_name: targetId,
    native_name: "Idoma Descendant",
  };

  const pKey = pairKey(viewerId, targetId);
  const conn = fallbackConnectionsMap[pKey];
  let status: "none" | "pending" | "connected" | "blocked" = "none";
  let direction = "";

  if (conn) {
    status = conn.status;
    direction = conn.requester_id === viewerId ? "outgoing" : "incoming";
  }

  return {
    user,
    is_owner: viewerId === targetId,
    connection_status: status,
    connection_direction: direction,
    learning_profile: {
      user_id: targetId,
      completed_tracks: ["track_1_greetings", "track_2_numbers"],
      xp_points: 740,
      fluency_tier: "intermediate",
    },
    posts: fallbackPosts.filter((p) => p.user_id === targetId),
    connection_count: status === "connected" ? 1 : 0,
  };
}

// ==========================================
// MESSAGING APIs
// ==========================================

export async function fetchMessages(userId: string, peerId: string): Promise<DirectMessage[]> {
  try {
    const res = await fetch(`${API_BASE}/api/messages?peer_id=${peerId}`, {
      credentials: "include",
    });
    if (res.ok) {
      return await res.json();
    } else if (res.status === 403) {
      throw new Error("Forbidden: You must be connected with this user to view or send direct messages.");
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("Forbidden")) throw err;
    console.warn("Backend unavailable, returning local messages:", err);
  }

  // Check connection in fallback
  const pKey = pairKey(userId, peerId);
  const conn = fallbackConnectionsMap[pKey];
  if (!conn || conn.status !== "connected") {
    throw new Error("Forbidden: You must be connected with this user to view or send direct messages.");
  }

  return fallbackMessages.filter(
    (m) =>
      (m.sender_id === userId && m.receiver_id === peerId) ||
      (m.sender_id === peerId && m.receiver_id === userId)
  );
}

export async function sendMessage(senderId: string, receiverId: string, body: string): Promise<DirectMessage> {
  try {
    const res = await fetch(`${API_BASE}/api/messages`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receiver_id: receiverId, body }),
    });

    if (res.ok) {
      return await res.json();
    }

    const errData = await res.json().catch(() => ({}));
    if (res.status === 403) {
      throw new Error(errData.error || "Forbidden: Direct messaging is strictly restricted to active connected peers.");
    }
    throw new Error(errData.error || "Failed to send message");
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("Forbidden")) throw err;
    console.warn("Backend send message unavailable, saving locally:", err);
  }

  // Check connection in fallback
  const pKey = pairKey(senderId, receiverId);
  const conn = fallbackConnectionsMap[pKey];
  if (!conn || conn.status !== "connected") {
    throw new Error("Forbidden: Direct messaging is strictly restricted to active connected peers.");
  }

  const msg: DirectMessage = {
    id: "m_" + Date.now(),
    sender_id: senderId,
    receiver_id: receiverId,
    body,
    is_read: false,
    created_at: new Date().toISOString(),
  };
  fallbackMessages.push(msg);
  setStorage("messages", fallbackMessages);
  return msg;
}

// ==========================================
// E-LIBRARY APIs
// ==========================================

export async function fetchBooks(): Promise<Book[]> {
  try {
    const res = await fetch(`${API_BASE}/api/library`, { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
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
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Could not upload this library item.");
  }
  return data;
}

export async function fetchLibraryItem(id: string): Promise<Book> {
  const res = await fetch(`${API_BASE}/api/library/${encodeURIComponent(id)}`, {
    credentials: "include",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Could not load this library item.");
  }
  return data;
}

export function libraryFileURL(book: Book, inline = false): string {
  if (book.file_url) return book.file_url;
  const path = `${API_BASE}/api/library/${encodeURIComponent(book.id)}/file`;
  return inline ? `${path}?inline=1` : path;
}

// ==========================================
// LEARNING TRACKS APIs
// ==========================================

export async function fetchLearningTracks(userId: string): Promise<{ profile: LearningProfile; tracks: LearningTrack[] }> {
  try {
    const res = await fetch(`${API_BASE}/api/learning/tracks`, {
      credentials: "include",
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn("Backend learning tracks unavailable, using mock:", err);
  }

  return {
    profile: {
      user_id: userId,
      completed_tracks: ["track_1_greetings", "track_2_numbers"],
      xp_points: 740,
      fluency_tier: "intermediate",
    },
    tracks: fallbackTracks,
  };
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
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || "Failed to complete track");
  }

  return await res.json();
}

export async function fetchUsers(): Promise<User[]> {
  try {
    const res = await fetch(`${API_BASE}/api/users/search?q=`, { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.users) && data.users.length > 0) {
        return data.users;
      }
    }
  } catch (err) {
    console.warn("Backend users unavailable, using fallback:", err);
  }
  return fallbackUsers;
}
