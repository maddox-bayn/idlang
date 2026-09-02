import { useState, useRef, useEffect } from "react";

interface AudioPlayerProps {
  audioUrl: string;
  className?: string;
  showWaveform?: boolean;
}

export default function AudioPlayer({
  audioUrl,
  className = "",
  showWaveform = true,
}: AudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // Each handler must be a stable reference: passing a fresh arrow function to
    // removeEventListener (as this used to) never detaches anything, so listeners
    // pile up on every audioUrl change.
    const updateTimes = () => {
      setCurrentTime(audio.currentTime);
      setDuration(audio.duration || 0);
    };
    const handleEnded = () => setIsPlaying(false);
    const handleError = () => setError("Audio playback failed");
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    // New source: clear stale error/progress from the previous clip.
    setError(null);
    setCurrentTime(0);
    setDuration(audio.duration || 0);

    audio.addEventListener("timeupdate", updateTimes);
    audio.addEventListener("loadedmetadata", updateTimes);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);

    return () => {
      audio.removeEventListener("timeupdate", updateTimes);
      audio.removeEventListener("loadedmetadata", updateTimes);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
    };
  }, [audioUrl]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      // The play/pause listeners above own isPlaying, so a rejected play()
      // no longer leaves the button stuck showing "playing".
      audio.play().catch((err) => setError(err.message));
    } else {
      audio.pause();
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;

    const time = parseFloat(e.target.value);
    audio.currentTime = time;
    setCurrentTime(time);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const volume = parseFloat(e.target.value);
    setVolume(volume);
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  };

  const formatTime = (seconds: number) => {
    if (!isFinite(seconds) || seconds < 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleForward = () => {
    if (audioRef.current && audioRef.current.duration) {
      audioRef.current.currentTime = Math.min(
        audioRef.current.duration,
        audioRef.current.currentTime + 10
      );
    }
  };

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* Audio Element (Hidden) */}
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        crossOrigin="anonymous"
      />

      {/* Playback Controls */}
      <div className="flex items-center justify-between gap-4">
        {/* Play/Pause Button */}
        <button
          onClick={togglePlay}
          disabled={!audioUrl}
          className={`flex h-12 w-12 items-center justify-center rounded-full transition-all ${
            isPlaying
              ? "bg-red-900 text-red-100 hover:bg-red-800"
              : "bg-red-900 text-red-100 hover:bg-red-800 disabled:opacity-40"
          }`}
        >
          {isPlaying ? (
            <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg className="h-6 w-6 pl-1" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Time Display */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-red-400">
            {formatTime(currentTime)}
          </span>
          <span className="text-xs text-neutral-500">/</span>
          <span className="text-xs font-mono text-red-400">
            {formatTime(duration)}
          </span>
        </div>

        {/* Seek Forward */}
        <button
          onClick={handleForward}
          className="rounded-lg p-2 text-xs font-medium text-red-400 hover:bg-red-900/30 hover:text-red-300"
          title="Skip forward 10 seconds"
        >
          +10s
        </button>
      </div>

      {/* Seek Bar */}
      <div className="flex items-center gap-3">
        <svg className="h-4 w-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
        </svg>
        <input
          type="range"
          min="0"
          max={duration || 100}
          value={currentTime}
          onChange={handleSeek}
          disabled={!audioUrl}
          className="h-1 flex-1 appearance-none rounded-lg bg-neutral-800 accent-red-600 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-red-600 disabled:opacity-40"
        />
        <svg className="h-4 w-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      </div>

      {/* Volume Control */}
      <div className="flex items-center gap-3">
        <svg className="h-4 w-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
        </svg>
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={volume}
          onChange={handleVolumeChange}
          className="h-1 w-24 appearance-none rounded-lg bg-neutral-800 accent-red-600 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-red-600"
        />
        <svg className="h-4 w-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M18 10a6 6 0 010 8m-6-8a6 6 0 010 8m6-8a6 6 0 010 8m-6-8a6 6 0 010 8" />
        </svg>
      </div>

      {/* Error Message */}
      {error && (
        <div className="rounded-lg border border-red-800/50 bg-red-900/20 px-4 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Waveform Visualization */}
      {showWaveform && isPlaying && duration > 0 && (
        <div className="flex h-12 items-center justify-center gap-1 overflow-hidden">
          {Array.from({ length: 50 }).map((_, i) => (
            <div
              key={i}
              className="w-1 rounded-full bg-red-500/50 transition-all duration-75"
              style={{
                height: `${20 + Math.abs(Math.sin((i + currentTime) * 0.5)) * 60}%`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
