import { useState, useRef, useCallback, useEffect } from "react";
import { useTranslationStore } from "../store/useTranslationStore";

interface AudioRecorderProps {
  onAudioRecorded: (audioBlob: Blob) => void;
  maxDuration?: number;
  className?: string;
  disabled?: boolean;
}

export default function AudioRecorder({ onAudioRecorded, maxDuration = 30, className = "", disabled = false }: AudioRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);
  const requesting = useRef(false);
  const discard = useRef(false);
  const callback = useRef(onAudioRecorded);
  callback.current = onAudioRecorded;

  const stop = useCallback((cancel = false) => {
    discard.current = cancel;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (recorder.current?.state !== "inactive") recorder.current?.stop();
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    useTranslationStore.getState().setIsRecording(false);
    if (mounted.current) setRecording(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stop(true); };
  }, [stop]);

  async function start() {
    if (disabled || requesting.current || recorder.current?.state === "recording") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Audio recording is not supported in this browser. Use text translation instead."); return;
    }
    requesting.current = true;
    setPending(true);
    setError(null);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(type => MediaRecorder.isTypeSupported(type));
      const active = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      recorder.current = active;
      const chunks: Blob[] = [];
      discard.current = false;
      active.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      active.onerror = () => { stop(true); if (mounted.current) setError("Recording failed. Please try again."); };
      active.onstop = () => {
        if (!mounted.current || discard.current) return;
        const blob = new Blob(chunks, { type: active.mimeType || chunks[0]?.type || "audio/webm" });
        if (blob.size) callback.current(blob);
        else setError("No audio was captured. Please record again.");
      };
      active.start(250);
      setRecording(true);
      useTranslationStore.getState().setIsRecording(true);
      setSeconds(0);
      const startedAt = performance.now();
      timer.current = setInterval(() => {
        const elapsed = Math.floor((performance.now() - startedAt) / 1000);
        setSeconds(Math.min(elapsed, maxDuration));
        if (elapsed >= maxDuration) stop();
      }, 250);
    } catch {
      stop(true);
      if (mounted.current) setError("Could not access the microphone. Check permission or use text translation.");
    } finally {
      requesting.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return <div className={`flex flex-col gap-3 ${className}`}>
    <p role="status" className="text-sm text-neutral-300">{pending ? "Waiting for microphone permission…" : recording ? `Recording: ${seconds} / ${maxDuration} seconds` : `Ready to record · maximum ${maxDuration} seconds`}</p>
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={() => recording ? stop() : void start()} disabled={disabled || pending}
        className="min-h-11 rounded-lg bg-red-900 px-6 py-3 font-semibold text-red-100 hover:bg-red-800 disabled:opacity-50">
        {recording ? "Stop recording" : "Record audio"}
      </button>
      {recording && <button type="button" onClick={() => stop(true)} className="min-h-11 rounded-lg px-4 py-2 text-sm text-red-300">Cancel recording</button>}
    </div>
    {error && <p role="alert" className="rounded-lg border border-red-800 bg-red-950 p-3 text-sm text-red-200">{error}</p>}
  </div>;
}
