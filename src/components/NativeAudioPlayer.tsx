import { useState, useRef, useEffect } from "react";

interface NativeAudioPlayerProps {
  audioUrl?: string;
  title?: string;
  onErrorCallback?: (err: string) => void;
}

export default function NativeAudioPlayer({
  audioUrl,
  title = "Native Idoma Pronunciation",
  onErrorCallback,
}: NativeAudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Reset state on URL change
    setHasError(false);
    setErrorMessage("");
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    if (!audioUrl || audioUrl.trim() === "") {
      setHasError(true);
      setErrorMessage("No audio recording attached to this post.");
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => {
      if (Number.isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    };
    const onEnded = () => setIsPlaying(false);
    const onError = () => {
      // Graceful error fallback
      setIsPlaying(false);
      setHasError(true);
      const msg = "Audio resource temporarily unavailable. Native recording link could not be decoded.";
      setErrorMessage(msg);
      if (onErrorCallback) onErrorCallback(msg);
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, [audioUrl, onErrorCallback]);

  const togglePlay = () => {
    if (hasError || !audioUrl) return;
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().then(() => {
        setIsPlaying(true);
      }).catch((err) => {
        setIsPlaying(false);
        setHasError(true);
        const msg = "Playback blocked or audio source unavailable (" + (err.message || "Network Error") + ")";
        setErrorMessage(msg);
        if (onErrorCallback) onErrorCallback(msg);
      });
    }
  };

  const formatTime = (secs: number) => {
    if (!Number.isFinite(secs) || secs < 0) return "0:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  if (hasError) {
    return (
      <div className="rounded-lg border border-red-900/40 bg-neutral-950 p-4">
        <div className="flex items-center gap-3 text-red-400">
          <svg className="h-5 w-5 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div className="flex-1">
            <p className="text-xs font-semibold text-red-300">Audio Playback Notice</p>
            <p className="text-xs text-red-500/90">{errorMessage}</p>
          </div>
          <button
            onClick={() => {
              setHasError(false);
              setErrorMessage("");
              if (audioRef.current) audioRef.current.load();
            }}
            className="rounded border border-red-800 bg-red-950/60 px-2.5 py-1 text-[11px] font-medium text-red-300 hover:bg-red-900/50"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-red-900/50 bg-neutral-950/90 p-4">
      {/* Hidden audio tag */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="metadata"
          crossOrigin="anonymous"
        />
      )}

      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-xs font-semibold uppercase tracking-wider text-red-300">
            {title}
          </span>
        </div>
        <span className="font-mono text-xs text-red-400">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>

      <div className="flex items-center gap-4">
        {/* Play / Pause button */}
        <button
          type="button"
          onClick={togglePlay}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-900 text-red-100 shadow transition-all hover:bg-red-800 hover:scale-105 active:scale-95"
          title={isPlaying ? "Pause" : "Play native recording"}
        >
          {isPlaying ? (
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg className="h-5 w-5 pl-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Clear Sound Waves Visualization */}
        <div className="flex h-10 flex-1 items-center gap-1 overflow-hidden px-2 rounded bg-neutral-900/80 border border-red-950">
          {Array.from({ length: 36 }).map((_, i) => {
            // Dynamic bar height based on sine wave and play state
            const progress = duration > 0 ? currentTime / duration : 0;
            const barProgress = i / 36;
            const isPassed = barProgress <= progress;
            const activeWave = isPlaying ? Math.abs(Math.sin((i * 0.4) + (currentTime * 5))) : 0.3;
            const heightPercent = Math.max(15, Math.min(95, activeWave * 90));

            return (
              <div
                key={i}
                className={`flex-1 rounded-full transition-all duration-75 ${
                  isPassed
                    ? "bg-red-500"
                    : isPlaying
                    ? "bg-red-900/60"
                    : "bg-red-950/60"
                }`}
                style={{ height: `${heightPercent}%` }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
