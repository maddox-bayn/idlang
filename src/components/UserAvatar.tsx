import { useState } from "react";

export default function UserAvatar({ url, name, className }: { url?: string; name: string; className: string }) {
  const [failedURL, setFailedURL] = useState("");
  if (url && url !== failedURL) {
    return <img alt={name} src={url} className={className} onError={() => setFailedURL(url)} />;
  }
  const initials = name.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join("").toUpperCase();
  return <span aria-label={name} role="img" className={`inline-flex shrink-0 items-center justify-center bg-red-950 font-semibold text-red-100 ${className}`}>{initials || "?"}</span>;
}
