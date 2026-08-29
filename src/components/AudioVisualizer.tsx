import { useRef, useEffect } from "react";

interface AudioVisualizerProps {
  audioUrl?: string;
  audioContext?: AudioContext;
  className?: string;
  mode?: "recording" | "playing" | "static";
  color?: string;
}

export default function AudioVisualizer({
  audioUrl,
  audioContext,
  className = "",
  mode = "static",
  color = "#dc2626",
}: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | MediaElementAudioSourceNode | MediaStreamAudioSourceNode | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const setupCanvas = () => {
      const ctx = audioContext || new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const draw = () => {
        if (!canvas || !analyserRef.current) return;

        const width = canvas.width;
        const height = canvas.height;
        const cCtx = canvas.getContext("2d");
        if (!cCtx) return;

        cCtx.clearRect(0, 0, width, height);

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);

        const barWidth = width / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const barHeight = (dataArray[i] / 255) * height;

          const gradient = cCtx.createLinearGradient(0, height - barHeight, 0, height);
          gradient.addColorStop(0, color);
          gradient.addColorStop(1, `${color}40`);

          cCtx.fillStyle = gradient;
          cCtx.fillRect(x, height - barHeight, barWidth - 1, barHeight);

          x += barWidth;
        }

        animationRef.current = requestAnimationFrame(draw);
      };

      if (mode === "static" && audioUrl) {
        // Static mode: Analyze audio file
        const fetchAndAnalyze = async () => {
          try {
            const response = await fetch(audioUrl);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

            if (sourceRef.current) {
              try {
                (sourceRef.current as any).stop();
              } catch (e) {
                // Ignore
              }
            }

            sourceRef.current = ctx.createBufferSource();
            sourceRef.current.buffer = audioBuffer;
            sourceRef.current.connect(analyser);
            sourceRef.current.start(0);

            draw();
          } catch (err) {
            console.error("Error analyzing audio:", err);
          }
        };

        fetchAndAnalyze();
      } else if (mode === "playing" && audioUrl) {
        // Playing mode: Connect to audio element
        const audio = new Audio(audioUrl);
        audio.crossOrigin = "anonymous";

        const createSource = async () => {
          try {
            await audio.play();
            const source = ctx.createMediaElementSource(audio);
            source.connect(analyser);
            analyser.connect(ctx.destination);
            sourceRef.current = source;
            draw();
          } catch (err) {
            console.error("Error connecting audio:", err);
          }
        };

        createSource();

        // Stop visualization when audio ends
        audio.addEventListener("ended", () => {
          if (animationRef.current) {
            cancelAnimationFrame(animationRef.current);
          }
        });
      } else if (mode === "recording") {
        // Recording mode: Analyze microphone input
        const setupRecording = async () => {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const source = ctx.createMediaStreamSource(stream);
            source.connect(analyser);
            analyser.connect(ctx.destination);
            sourceRef.current = source;
            draw();
          } catch (err) {
            console.error("Error accessing microphone:", err);
          }
        };
        setupRecording();
      }

      return () => {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
        if (sourceRef.current) {
          try {
            if ("stop" in sourceRef.current) {
              (sourceRef.current as any).stop();
            }
          } catch (e) {
            // Ignore errors
          }
        }
      };
    };

    return setupCanvas();
  }, [audioUrl, mode, color, audioContext]);

  return (
    <canvas
      ref={canvasRef}
      width={300}
      height={100}
      className={`rounded-lg bg-neutral-900 ${className}`}
    />
  );
}
