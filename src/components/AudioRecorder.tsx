import { useState, useRef, useCallback, useEffect } from "react";

interface AudioRecorderProps {
  onAudioRecorded: (audioBlob: Blob) => void;
  maxDuration?: number;
  className?: string;
}

export default function AudioRecorder({
  onAudioRecorded,
  maxDuration = 30,
  className = "",
}: AudioRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  const startRecording = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/wav" });
        onAudioRecorded(audioBlob);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorderRef.current.start(1000);
      setIsRecording(true);
      setRecordingTime(0);

      // Start timer
      timerRef.current = window.setInterval(() => {
        setRecordingTime((prev) => {
          if (prev >= maxDuration) {
            stopRecording();
            return maxDuration;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      setError("Could not access microphone. Please check permissions.");
    }
  };

  const stopRecording = useCallback(() => {
    if (isRecording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [isRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* Visual Feedback */}
      <div className="flex items-center justify-center gap-2">
        <div
          className={`h-3 w-3 rounded-full transition-colors ${
            isRecording ? "bg-red-600 animate-pulse" : "bg-neutral-600"
          }`}
        />
        <span className="text-xs font-mono text-red-400">
          {isRecording ? `Recording ${formatTime(recordingTime)}/${maxDuration}s` : "Ready to record"}
        </span>
      </div>

      {/* Recording Controls */}
      <div className="flex items-center gap-4">
        <button
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isRecording && recordingTime >= maxDuration}
          className={`flex items-center justify-center gap-2 rounded-lg px-6 py-3 font-semibold transition-all ${
            isRecording
              ? "bg-red-900 text-red-100 hover:bg-red-800"
              : "bg-red-900 text-red-100 hover:bg-red-800 disabled:opacity-40"
          }`}
        >
          {isRecording ? (
            <>
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" />
              </svg>
              Stop
            </>
          ) : (
            <>
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
              </svg>
              Record
            </>
          )}
        </button>

        {isRecording && (
          <button
            onClick={() => {
              if (mediaRecorderRef.current) {
                mediaRecorderRef.current.stop();
                mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
                setIsRecording(false);
                audioChunksRef.current = [];
                setRecordingTime(0);
              }
            }}
            className="rounded-lg px-4 py-2 text-xs font-medium text-red-400 hover:text-red-300"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="rounded-lg border border-red-800/50 bg-red-900/20 px-4 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Visualizer Simulation */}
      {isRecording && (
        <div className="flex h-8 items-center justify-center gap-1">
          {Array.from({ length: 20 }).map((_, i) => (
            <div
              key={i}
              className="w-1 rounded-full bg-red-500"
              style={{
                height: `${20 + Math.random() * 60}%`,
                transition: "height 0.1s ease",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
