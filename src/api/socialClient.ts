import type {
  Post,
  User,
  ProfileResponse,
  DirectMessage,
  Book,
  LearningTrack,
  LearningProfile,
} from "../types";
import {
  mockUsers,
  mockPosts,
  mockBooks,
  mockCurriculumTracks,
} from "../data/mockData";

const API_BASE = "";

// In-memory state for fallback mode
const fallbackPosts: Post[] = [...mockPosts];
const fallbackBooks: Book[] = [...mockBooks];
const fallbackTracks: LearningTrack[] = [...mockCurriculumTracks];
const fallbackMessages: DirectMessage[] = [
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
];
const fallbackConnections: Record<string, "none" | "pending" | "connected" | "blocked"> = {
  "user_oche:user_ada": "connected",
  "user_ada:user_oche": "connected",
  "user_idoko:user_oche": "pending",
};

export async function fetchPosts(page = 1, limit = 10): Promise<{ posts: Post[]; total: number }> {
  try {
    const res = await fetch(`${API_BASE}/api/posts?page=${page}&limit=${limit}`);
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
      form.append("user_id", post.user_id);
      form.append("content", post.content);
      form.append("media_type", post.media_type);
      if (post.media_url) form.append("media_url", post.media_url);
      form.append("media_file", post.media_file);
      res = await fetch(`${API_BASE}/api/posts`, {
        method: "POST",
        body: form,
      });
    } else {
      res = await fetch(`${API_BASE}/api/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(post),
      });
    }
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn("Backend unavailable, storing post locally:", err);
  }

  const author = mockUsers.find((u) => u.id === post.user_id) || {
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
  return newPost;
}

export async function fetchProfile(targetId: string, viewerId: string): Promise<ProfileResponse> {
  try {
    const res = await fetch(`${API_BASE}/api/profile?id=${targetId}`, {
      headers: { "X-Viewer-ID": viewerId },
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn("Backend unavailable, using mock profile:", err);
  }

  const user = mockUsers.find((u) => u.id === targetId) || {
    id: targetId,
    username: targetId,
    display_name: targetId,
  };

  const connKey = `${viewerId}:${targetId}`;
  const reverseKey = `${targetId}:${viewerId}`;
  const status = fallbackConnections[connKey] || fallbackConnections[reverseKey] || "none";

  return {
    user,
    is_owner: viewerId === targetId,
    connection_status: status,
    learning_profile: {
      user_id: targetId,
      completed_tracks: ["track_1_greetings", "track_2_numbers"],
      xp_points: 740,
      fluency_tier: "intermediate",
    },
    posts: fallbackPosts.filter((p) => p.user_id === targetId),
    connection_count: 1,
  };
}

export async function updateConnection(
  requesterId: string,
  receiverId: string,
  action: "connect" | "accept" | "reject" | "block"
): Promise<{ status: string; message: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/connections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requester_id: requesterId, receiver_id: receiverId, action }),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn("Backend unavailable, updating connection locally:", err);
  }

  const key = `${requesterId}:${receiverId}`;
  if (action === "connect") fallbackConnections[key] = "pending";
  else if (action === "accept") fallbackConnections[key] = "connected";
  else if (action === "block") fallbackConnections[key] = "blocked";
  else delete fallbackConnections[key];

  return { status: fallbackConnections[key] || "none", message: "Updated" };
}

export async function fetchMessages(userId: string, peerId: string): Promise<DirectMessage[]> {
  try {
    const res = await fetch(`${API_BASE}/api/messages?user_id=${userId}&peer_id=${peerId}`);
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
  const connKey = `${userId}:${peerId}`;
  const reverseKey = `${peerId}:${userId}`;
  if (fallbackConnections[connKey] !== "connected" && fallbackConnections[reverseKey] !== "connected") {
    throw new Error("Forbidden: You must be connected with this user to view or send direct messages.");
  }

  return fallbackMessages.filter(
    (m) =>
      (m.sender_id === userId && m.receiver_id === peerId) ||
      (m.sender_id === peerId && m.receiver_id === userId)
  );
}

export async function sendMessage(senderId: string, receiverId: string, body: string): Promise<DirectMessage> {
  const res = await fetch(`${API_BASE}/api/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender_id: senderId, receiver_id: receiverId, body }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    if (res.status === 403) {
      throw new Error(errData.error || "Forbidden: Direct messaging is strictly restricted to active connected peers.");
    }
    throw new Error(errData.error || "Failed to send message");
  }

  return await res.json();
}

export async function fetchBooks(): Promise<Book[]> {
  try {
    const res = await fetch(`${API_BASE}/api/books`);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn("Backend unavailable, using mock books:", err);
  }
  return fallbackBooks;
}

export async function createBook(book: {
  title: string;
  author: string;
  uploaded_by: string;
  description?: string;
  file_url?: string;
  book_file?: File;
}): Promise<Book> {
  try {
    let res: Response;
    if (book.book_file) {
      const form = new FormData();
      form.append("title", book.title);
      form.append("author", book.author);
      form.append("uploaded_by", book.uploaded_by);
      if (book.description) form.append("description", book.description);
      form.append("book_file", book.book_file);
      res = await fetch(`${API_BASE}/api/books`, { method: "POST", body: form });
    } else {
      res = await fetch(`${API_BASE}/api/books`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(book),
      });
    }
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn("Backend unavailable, saving book locally:", err);
  }

  const newBook: Book = {
    id: "book_" + Date.now(),
    title: book.title,
    author: book.author,
    uploaded_by: book.uploaded_by,
    description: book.description || "",
    file_url: book.file_url || "/api/books/sample/idoma_orthography.txt",
    created_at: new Date().toISOString(),
  };
  fallbackBooks.unshift(newBook);
  return newBook;
}

export async function fetchLearningTracks(userId: string): Promise<{ profile: LearningProfile; tracks: LearningTrack[] }> {
  try {
    const res = await fetch(`${API_BASE}/api/learning/tracks?user_id=${userId}`);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn("Backend unavailable, using mock tracks:", err);
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
  userId: string,
  trackId: string
): Promise<{ success: boolean; message: string; learning_profile: LearningProfile; tracks: LearningTrack[] }> {
  const res = await fetch(`${API_BASE}/api/learning/complete-track`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, track_id: trackId }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || "Failed to complete track");
  }

  return await res.json();
}

export async function fetchUsers(): Promise<User[]> {
  try {
    const res = await fetch(`${API_BASE}/api/users`);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn("Backend unavailable, using mock users:", err);
  }
  return mockUsers;
}
