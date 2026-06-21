import { cn } from "@/lib/utils";

type AudioPlayerProps = {
  jobId: string;
  filename?: string;
  className?: string;
};

export function AudioPlayer({ jobId, filename, className }: AudioPlayerProps) {
  return (
    <div className={cn("rounded-xl bg-black/30 p-3 ring-1 ring-white/5", className)}>
      <audio
        controls
        preload="metadata"
        className="h-10 w-full accent-violet-400"
        src={`/api/jobs/${jobId}/audio`}
      >
        Your browser does not support audio playback.
      </audio>
      {filename && <p className="mt-1.5 truncate text-xs text-zinc-500">{filename}</p>}
    </div>
  );
}
