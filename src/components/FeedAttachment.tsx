import { useState } from "react";
import type { Post } from "../types";
import { restorePostAttachment } from "../api/socialClient";

export default function FeedAttachment({ post, isOwner, onRestored }: {
  post: Post; isOwner: boolean; onRestored: (url: string) => void;
}) {
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const image = post.media_type === "image";
  const legacy = /\/uploads\/media\/(?!db-)[\w-]+\.\w+$/.test(post.media_url || "");

  async function restore(file?: File) {
    if (!file) return;
    setSaving(true);
    setError("");
    try {
      const result = await restorePostAttachment(post.id, file);
      onRestored(result.media_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore the attachment.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="mt-4 overflow-hidden rounded-lg border border-red-900/40 bg-black">
    {failed ? <div className="space-y-3 p-4 text-sm text-neutral-300">
      <p>This {image ? "image" : "video"} could not be loaded. <button className="underline" onClick={() => setFailed(false)}>Retry</button></p>
      {isOwner && legacy && <label className="block">Restore the original {image ? "image" : "video"}
        <input type="file" className="mt-2 block" disabled={saving}
          accept={image ? "image/jpeg,image/png,image/webp" : "video/mp4,video/webm"}
          onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void restore(file); }} />
      </label>}
      {saving && <p role="status">Restoring attachment…</p>}
      {error && <p role="alert">{error}</p>}
    </div> : image
      ? <img src={post.media_url} alt="Post attachment" loading="lazy" className="max-h-96 w-full object-cover" onError={() => setFailed(true)} />
      : <video controls playsInline preload="metadata" src={post.media_url} className="max-h-96 w-full" onError={() => setFailed(true)} />}
  </div>;
}
