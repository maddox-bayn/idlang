import { useState, useEffect, useRef } from "react";
import type { ProfileResponse } from "../types";
import {
  fetchProfile,
  updateConnection,
  updateUserProfile,
  uploadUserAvatar,
} from "../api/socialClient";

interface ProfileModalProps {
  targetUserId: string;
  viewerUserId: string;
  onClose: () => void;
  onConnectionChange?: () => void;
  onProfileUpdated?: () => void;
}

export default function ProfileModal({
  targetUserId,
  viewerUserId,
  onClose,
  onConnectionChange,
  onProfileUpdated,
}: ProfileModalProps) {
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Edit Profile mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editNativeName, setEditNativeName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editDialect, setEditDialect] = useState("");
  const [editNativeSpeaker, setEditNativeSpeaker] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Avatar upload state
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [avatarDownloadError, setAvatarDownloadError] = useState<string | null>(null);
  const [downloadingAvatar, setDownloadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadData = async () => {
    setLoading(true);
    setProfileError(null);
    setProfile(null);
    try {
      const p = await fetchProfile(targetUserId, viewerUserId);
      setProfile(p);
      setEditDisplayName(p.user.display_name || "");
      setEditNativeName(p.user.native_name || "");
      setEditBio(p.user.bio || "");
      setEditDialect(p.user.dialect || "Central Otukpo");
      setEditNativeSpeaker(p.user.native_speaker ?? false);

    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Could not load this profile.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [targetUserId, viewerUserId]);

  useEffect(() => {
    if (!avatarPreviewUrl) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAvatarPreviewUrl(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [avatarPreviewUrl]);

  const handleAvatarDownload = async () => {
    if (!avatarPreviewUrl || downloadingAvatar) return;
    setDownloadingAvatar(true);
    setAvatarDownloadError(null);
    let objectUrl: string | null = null;
    try {
      const response = await fetch(avatarPreviewUrl);
      if (!response.ok) throw new Error("The picture could not be downloaded.");
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) throw new Error("The file is not a supported image.");
      objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      const extension = ({
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/gif": "gif",
        "image/webp": "webp",
        "image/svg+xml": "svg",
      } as Record<string, string>)[blob.type] || "img";
      link.download = `idlang-${profile?.user.username ?? "profile"}-avatar.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      setAvatarDownloadError("Could not download this picture. Try opening it in a new tab and saving it.");
    } finally {
      if (objectUrl) window.setTimeout(() => URL.revokeObjectURL(objectUrl!), 1000);
      setDownloadingAvatar(false);
    }
  };

  const handleConnectionAction = async (action: "connect" | "accept" | "reject" | "block") => {
    if (!profile) return;
    setConnectionLoading(true);
    setConnectionError(null);
    try {
      await updateConnection(targetUserId, action);
      await loadData();
      if (onConnectionChange) onConnectionChange();
    } catch (err) {
      setConnectionError(err instanceof Error ? err.message : "Could not update this connection.");
    } finally {
      setConnectionLoading(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileError(null);
    try {
      const updatedUser = await updateUserProfile({
        display_name: editDisplayName.trim(),
        native_name: editNativeName.trim(),
        bio: editBio.trim(),
        dialect: editDialect,
        native_speaker: editNativeSpeaker,
      });

      if (profile) {
        setProfile({
          ...profile,
          user: {
            ...profile.user,
            ...updatedUser,
          },
        });
      }
      setIsEditing(false);
      if (onProfileUpdated) onProfileUpdated();
    } catch (err: unknown) {
      setProfileError(err instanceof Error ? err.message : "Could not save profile");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingAvatar(true);
    try {
      const newAvatarUrl = await uploadUserAvatar(file);
      if (profile) {
        setProfile({
          ...profile,
          user: {
            ...profile.user,
            avatar_url: newAvatarUrl,
          },
        });
      }
      if (onProfileUpdated) onProfileUpdated();
    } catch (err) {
      console.error("Failed to upload avatar:", err);
    } finally {
      setUploadingAvatar(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="card-glow max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-red-900/60 bg-neutral-950 p-6 text-red-100 shadow-2xl">
        {/* Header with Close */}
        <div className="flex items-center justify-between border-b border-red-900/40 pb-4">
          <div className="flex items-center gap-2">
            <span className="text-sm">🛡️</span>
            <span className="text-xs uppercase tracking-widest text-red-500 font-bold">
              Ancestral Cultural Profile
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-red-400 hover:bg-red-900/30 hover:text-red-200 transition-colors"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-red-600 border-t-transparent" />
          </div>
        ) : profile ? (
          <div className="space-y-6 pt-4">
            {/* Top User Profile Header: Picture, User Name, Native Name & Actions */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 bg-neutral-900/50 p-4 rounded-xl border border-red-900/40">
              <div className="flex items-start sm:items-center gap-4">
                {/* 1. Profile Picture Place with Interactive Upload */}
                <div className="relative group">
                  <button
                    type="button"
                    onClick={() => setAvatarPreviewUrl(profile.user.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${profile.user.username}`)}
                    className="block rounded-full focus:outline-none focus:ring-2 focus:ring-red-500"
                    aria-label={`Open ${profile.user.display_name}'s profile picture`}
                  >
                    <img
                      src={
                        profile.user.avatar_url ||
                        `https://api.dicebear.com/7.x/bottts/svg?seed=${profile.user.username}`
                      }
                      alt={profile.user.display_name}
                      className="h-20 w-20 rounded-full border-2 border-red-600 object-cover shadow-lg bg-neutral-900"
                    />
                  </button>
                  {profile.is_owner && (
                    <>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingAvatar}
                        className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full border border-red-300 bg-black/90 text-xs text-red-100 shadow transition-colors hover:bg-red-800 disabled:opacity-60"
                        title="Upload new profile picture"
                        aria-label="Upload a new profile picture"
                      >
                        {uploadingAvatar ? "…" : "📷"}
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png"
                        onChange={handleAvatarFileChange}
                        className="hidden"
                      />
                    </>
                  )}
                </div>

                {/* Profile Identity Details */}
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-heading text-xl font-bold text-red-100">
                      {profile.user.display_name}
                    </h3>
                    {profile.user.native_speaker && (
                      <span className="rounded bg-red-950 px-2 py-0.5 text-[10px] font-semibold text-red-300 border border-red-800">
                        Native Speaker
                      </span>
                    )}
                  </div>

                  {/* 2. User Name Feature */}
                  <p className="text-xs font-mono text-red-400">
                    @{profile.user.username}
                  </p>

                  {/* 3. Native Name Feature */}
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <span className="text-sm">🪘</span>
                    <span className="text-xs font-bold text-red-300">
                      Native Name:
                    </span>
                    <span className="text-xs font-semibold text-red-100 px-2 py-0.5 rounded bg-red-950 border border-red-900">
                      {profile.user.native_name || "(None registered)"}
                    </span>
                  </div>

                  {profile.user.dialect && (
                    <p className="text-[11px] text-neutral-400">
                      Dialect: <span className="text-neutral-200 font-medium">{profile.user.dialect}</span>
                    </p>
                  )}
                </div>
              </div>

              {/* Action Buttons: Friend Connect or Edit Profile */}
              <div className="flex flex-col sm:items-end gap-2 w-full sm:w-auto">
                {profile.is_owner ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setIsEditing(!isEditing)}
                      className="rounded-lg border border-red-700 bg-red-950/60 px-3.5 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-900 transition-all shadow"
                    >
                      {isEditing ? "Cancel Edit" : "✎ Edit Profile"}
                    </button>
                    <span className="rounded-full border border-red-700/60 bg-red-950/30 px-3 py-1 text-[11px] font-semibold text-red-400">
                      Your Account
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    {/* Requirement 2: Connect only when friend request is accepted */}
                    {profile.connection_status === "connected" ? (
                      <div className="flex items-center gap-2">
                        <span className="rounded-full border border-green-800 bg-green-950/80 px-3 py-1 text-xs font-semibold text-green-300">
                          ✓ Connected Friend
                        </span>
                        <button
                          onClick={() => handleConnectionAction("reject")}
                          disabled={connectionLoading}
                          className="rounded border border-red-900/50 bg-neutral-900 px-2.5 py-1 text-xs text-red-400 hover:bg-red-900/40"
                          title="Disconnect connection"
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
                            className="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600 shadow"
                          >
                            Accept Friend Request
                          </button>
                          <button
                            onClick={() => handleConnectionAction("reject")}
                            disabled={connectionLoading}
                            className="rounded-lg border border-red-900 px-2.5 py-1.5 text-xs text-red-400 hover:bg-neutral-900"
                          >
                            Decline
                          </button>
                        </div>
                      ) : (
                        <button
                          disabled
                          className="rounded-lg border border-amber-800 bg-amber-950/40 px-3 py-1.5 text-xs font-medium text-amber-300 cursor-not-allowed"
                        >
                          ⏳ Friend Request Sent (Pending)
                        </button>
                      )
                    ) : (
                      <button
                        onClick={() => handleConnectionAction("connect")}
                        disabled={connectionLoading}
                        className="rounded-lg bg-red-800 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-red-100 shadow transition-all hover:bg-red-700 active:scale-95"
                      >
                        + Add Friend / Connect
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {connectionError && (
              <div role="alert" className="rounded-lg border border-red-700 bg-red-950/50 px-3 py-2 text-xs text-red-200">
                {connectionError}
              </div>
            )}

            {/* EDIT PROFILE FORM (Toggled for Owner) */}
            {profile.is_owner && isEditing && (
              <form onSubmit={handleSaveProfile} className="rounded-xl border border-red-800 bg-neutral-900/80 p-5 space-y-4 animate-in fade-in">
                <div className="flex items-center justify-between border-b border-red-900/40 pb-2">
                  <h4 className="font-heading text-sm font-bold text-red-300">
                    Edit Your Linguistic & Cultural Profile
                  </h4>
                  <span className="text-[10px] text-neutral-400">Save to update live profile</span>
                </div>

                {profileError && (
                  <div className="rounded bg-red-950/80 border border-red-600 p-2 text-xs text-red-200">
                    {profileError}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-red-400 mb-1">
                      Display Name
                    </label>
                    <input
                      type="text"
                      value={editDisplayName}
                      onChange={(e) => setEditDisplayName(e.target.value)}
                      className="w-full rounded-lg border border-red-900/50 bg-neutral-950 px-3 py-2 text-xs text-red-100 focus:border-red-500 focus:outline-none"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-red-400 mb-1">
                      Native Idoma Name 🪘
                    </label>
                    <input
                      type="text"
                      value={editNativeName}
                      onChange={(e) => setEditNativeName(e.target.value)}
                      placeholder="e.g. Onyilo, Onyeche, Agbo, Ochanya"
                      className="w-full rounded-lg border border-red-900/50 bg-neutral-950 px-3 py-2 text-xs text-red-100 focus:border-red-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-red-400 mb-1">
                    Bio (Cultural Background & Heritage Focus)
                  </label>
                  <textarea
                    rows={3}
                    value={editBio}
                    onChange={(e) => setEditBio(e.target.value)}
                    placeholder="Tell other custodians about your linguistic background, ancestral lineage, or research interests."
                    className="w-full rounded-lg border border-red-900/50 bg-neutral-950 px-3 py-2 text-xs text-red-100 focus:border-red-500 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-red-400 mb-1">
                      Dialect
                    </label>
                    <select
                      value={editDialect}
                      onChange={(e) => setEditDialect(e.target.value)}
                      className="w-full rounded-lg border border-red-900/50 bg-neutral-950 px-3 py-2 text-xs text-red-100 focus:border-red-500 focus:outline-none"
                    >
                      <option value="Central Otukpo">Central Otukpo</option>
                      <option value="Okpokwu">Okpokwu</option>
                      <option value="Adoka">Adoka</option>
                      <option value="Agatu">Agatu</option>
                      <option value="Orokam">Orokam</option>
                      <option value="General Idoma">General Idoma</option>
                    </select>
                  </div>

                  <div className="flex items-center pt-5">
                    <label className="flex items-center gap-2 cursor-pointer text-xs text-neutral-300">
                      <input
                        type="checkbox"
                        checked={editNativeSpeaker}
                        onChange={(e) => setEditNativeSpeaker(e.target.checked)}
                        className="h-4 w-4 rounded border-red-900 bg-neutral-900 text-red-600 focus:ring-0"
                      />
                      <span>Native Idoma Speaker</span>
                    </label>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="rounded-lg border border-neutral-800 px-3 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingProfile}
                    className="rounded-lg bg-red-800 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-red-100 hover:bg-red-700 disabled:opacity-50"
                  >
                    {savingProfile ? "Saving..." : "Save Profile Changes"}
                  </button>
                </div>
              </form>
            )}

            {/* 4. Bio Feature Display */}
            <div className="rounded-xl border border-red-900/30 bg-neutral-900/40 p-4">
              <span className="text-[10px] font-bold uppercase tracking-widest text-red-500">
                Cultural Biography
              </span>
              <p className="mt-1.5 text-xs text-neutral-300 leading-relaxed italic">
                "{profile.user.bio || "Preserving ancestral Idoma lore, dialect heritage, and folklore."}"
              </p>
            </div>

            {/* Gamified Fluency & Educational Matrix Box */}
            <div className="rounded-xl border border-red-900/40 bg-neutral-900/70 p-4">
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
                  <div
                    className={`flex items-center gap-2 rounded border p-2 ${
                      profile.learning_profile.completed_tracks.includes("track_1_greetings")
                        ? "border-green-800/60 bg-green-950/20 text-green-300"
                        : "border-neutral-800 bg-neutral-900/40 text-neutral-500"
                    }`}
                  >
                    <span>{profile.learning_profile.completed_tracks.includes("track_1_greetings") ? "✅" : "🔒"}</span>
                    <span>1. Daily Greetings</span>
                  </div>

                  <div
                    className={`flex items-center gap-2 rounded border p-2 ${
                      profile.learning_profile.completed_tracks.includes("track_2_numbers")
                        ? "border-green-800/60 bg-green-950/20 text-green-300"
                        : "border-neutral-800 bg-neutral-900/40 text-neutral-500"
                    }`}
                  >
                    <span>{profile.learning_profile.completed_tracks.includes("track_2_numbers") ? "✅" : "🔒"}</span>
                    <span>2. Numerical Quantifiers</span>
                  </div>

                  <div
                    className={`flex items-center gap-2 rounded border p-2 ${
                      profile.learning_profile.completed_tracks.includes("track_3_idioms")
                        ? "border-green-800/60 bg-green-950/20 text-green-300"
                        : "border-neutral-800 bg-neutral-900/40 text-neutral-500"
                    }`}
                  >
                    <span>{profile.learning_profile.completed_tracks.includes("track_3_idioms") ? "✅" : "🔒"}</span>
                    <span>3. Proverbial Idioms</span>
                  </div>

                  <div
                    className={`flex items-center gap-2 rounded border p-2 ${
                      profile.learning_profile.completed_tracks.includes("track_4_folktales")
                        ? "border-green-800/60 bg-green-950/20 text-green-300"
                        : "border-neutral-800 bg-neutral-900/40 text-neutral-500"
                    }`}
                  >
                    <span>{profile.learning_profile.completed_tracks.includes("track_4_folktales") ? "✅" : "🔒"}</span>
                    <span>4. Cultural Folktales</span>
                  </div>
                </div>
              </div>
            </div>

          </div>
        ) : <p role="alert" className="py-6 text-red-300">{profileError || "Could not load this profile."}</p>}
      </div>
      {avatarPreviewUrl && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`${profile?.user.display_name ?? "User"}'s profile picture`}
          onClick={() => setAvatarPreviewUrl(null)}
        >
          <div className="relative flex max-h-[90vh] max-w-[90vw] items-center justify-center" onClick={(event) => event.stopPropagation()}>
            <img src={avatarPreviewUrl} alt={`${profile?.user.display_name ?? "User"}'s profile picture`} className="max-h-[85vh] max-w-[90vw] rounded-xl object-contain shadow-2xl" />
            <a
              href={avatarPreviewUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => { event.preventDefault(); void handleAvatarDownload(); }}
              aria-label="Download profile picture"
              title="Download picture"
              aria-busy={downloadingAvatar}
              className="absolute right-3 top-3 rounded-lg border border-white/20 bg-black/70 p-3 text-white hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-400"
            >
              {downloadingAvatar ? <span className="block h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V3" />
              </svg>}
            </a>
            <button type="button" onClick={() => setAvatarPreviewUrl(null)} aria-label="Close picture" className="absolute right-3 top-16 rounded-lg border border-white/20 bg-black/70 p-3 text-white hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-400">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            {avatarDownloadError && <p role="alert" className="absolute bottom-3 left-3 right-3 rounded-lg bg-black/80 px-3 py-2 text-center text-xs text-red-200">{avatarDownloadError} <a href={avatarPreviewUrl} target="_blank" rel="noreferrer" className="underline">Open picture</a></p>}
          </div>
        </div>
      )}
    </div>
  );
}
