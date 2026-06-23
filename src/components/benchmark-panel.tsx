"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  CheckCircle2,
  Copy,
  FileAudio,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { AudioPlayer } from "@/components/audio-player";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { ListSearch } from "@/components/ui/list-search";
import { ListPagination } from "@/components/ui/list-pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { formatBytes, formatDate, formatDuration } from "@/lib/utils";
import { matchesListSearch } from "@/lib/list-search";
import { providerConfigError } from "@/lib/providers";
import { DEFAULT_PAGE_SIZE, type PaginationMeta } from "@/lib/pagination";

type ProviderInfo = {
  id: string;
  name: string;
  configured: boolean;
  defaultModel: string;
  models: Array<{ id: string; label: string }>;
};

type AppSettings = {
  normalizeAudio: boolean;
  speakerDiarization: boolean;
  keyterms: string[];
  language: string;
};

type SlotConfig = {
  provider: string;
  model: string;
};

type BenchmarkJob = {
  id: string;
  slotIndex: number | null;
  provider: string;
  model: string;
  status: "pending" | "processing" | "completed" | "failed";
  transcript: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  processingMs: number | null;
  completedAt: string | null;
  isReference?: boolean;
};

type BenchmarkRun = {
  id: string;
  originalFilename: string;
  fileSizeBytes: number;
  options: AppSettings;
  slots: SlotConfig[];
  createdAt: string;
  jobs: BenchmarkJob[];
};

const statusVariant = {
  pending: "pending",
  processing: "processing",
  completed: "completed",
  failed: "failed",
} as const;

function formatProcessingMs(ms: number | null | undefined): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

type BenchmarkPanelProps = {
  providers: ProviderInfo[];
  settings: AppSettings;
};

export function BenchmarkPanel({ providers, settings }: BenchmarkPanelProps) {
  const [runs, setRuns] = useState<BenchmarkRun[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [slots, setSlots] = useState<SlotConfig[]>(() => {
    const first = providers[0];
    const second = providers[1] ?? providers[0];
    return [
      { provider: first?.id ?? "soniox", model: first?.defaultModel ?? "" },
      { provider: second?.id ?? "deepgram", model: second?.defaultModel ?? "" },
    ];
  });
  const [normalize, setNormalize] = useState(settings.normalizeAudio);
  const [speakerDiarization, setSpeakerDiarization] = useState(settings.speakerDiarization);
  const [language, setLanguage] = useState(settings.language);
  const [keyterms, setKeyterms] = useState(settings.keyterms.join(", "));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runSearch, setRunSearch] = useState("");
  const [runPagination, setRunPagination] = useState<PaginationMeta | null>(null);
  const [loadingMoreRuns, setLoadingMoreRuns] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const runsLengthRef = useRef(0);

  runsLengthRef.current = runs.length;

  const configuredProviders = providers.filter((p) => p.configured);

  const loadRuns = useCallback(async (append = false) => {
    if (append) setLoadingMoreRuns(true);
    try {
      const offset = append ? runsLengthRef.current : 0;
      const res = await fetch(`/api/benchmark?limit=${DEFAULT_PAGE_SIZE}&offset=${offset}`);
      const data = await res.json();
      setRuns((prev) => (append ? [...prev, ...(data.runs ?? [])] : (data.runs ?? [])));
      setRunPagination(data.pagination ?? null);
    } finally {
      if (append) setLoadingMoreRuns(false);
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  const hasActiveJobs = runs.some((run) =>
    run.jobs.some((j) => j.status === "pending" || j.status === "processing"),
  );

  useEffect(() => {
    if (!hasActiveJobs) return;
    const interval = setInterval(() => {
      void loadRuns();
    }, 2500);
    return () => clearInterval(interval);
  }, [hasActiveJobs, loadRuns]);

  const filteredRuns = useMemo(
    () =>
      runs.filter((run) =>
        matchesListSearch(runSearch, [
          run.originalFilename,
          ...run.jobs.flatMap((job) => [job.provider, job.model, job.status]),
          ...run.slots.flatMap((slot) => [slot.provider, slot.model]),
        ]),
      ),
    [runs, runSearch],
  );

  const activeRun = useMemo(() => {
    if (!filteredRuns.length) return null;
    if (activeRunId && filteredRuns.some((run) => run.id === activeRunId)) {
      return filteredRuns.find((run) => run.id === activeRunId) ?? filteredRuns[0]!;
    }
    return filteredRuns[0]!;
  }, [filteredRuns, activeRunId]);

  useEffect(() => {
    if (!activeRun) return;
    if (activeRunId !== activeRun.id) {
      setActiveRunId(activeRun.id);
    }
  }, [activeRun, activeRunId]);

  useEffect(() => {
    if (runs.length && !activeRunId) {
      setActiveRunId(runs[0].id);
    }
  }, [runs, activeRunId]);

  const updateSlot = (index: number, patch: Partial<SlotConfig>) => {
    setSlots((prev) =>
      prev.map((slot, i) => {
        if (i !== index) return slot;
        const next = { ...slot, ...patch };
        if (patch.provider) {
          const provider = providers.find((p) => p.id === patch.provider);
          next.model = provider?.defaultModel ?? slot.model;
        }
        return next;
      }),
    );
  };

  const addSlot = () => {
    if (slots.length >= 3) return;
    const nextProvider = configuredProviders[slots.length % configuredProviders.length];
    setSlots((prev) => [
      ...prev,
      { provider: nextProvider?.id ?? "soniox", model: nextProvider?.defaultModel ?? "" },
    ]);
  };

  const removeSlot = (index: number) => {
    if (slots.length <= 1) return;
    setSlots((prev) => prev.filter((_, i) => i !== index));
  };

  const resetFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const isAudioFile = (file: File) =>
    file.type.startsWith("audio/") || /\.(mp3|wav|m4a|flac|ogg|webm|aac)$/i.test(file.name);

  const handleFiles = (files: FileList | File[]) => {
    const audioFiles = Array.from(files).filter(isAudioFile);
    if (!audioFiles.length) {
      setError("Please select valid audio files (mp3, wav, m4a, flac, ogg, webm)");
      return;
    }
    setError(null);
    setSelectedFiles((prev) => [...prev, ...audioFiles]);
  };

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const runBenchmark = async () => {
    if (!selectedFiles.length) {
      setError("Select at least one audio file");
      return;
    }

    const validSlots = slots.filter((s) => s.provider && s.model);
    if (!validSlots.length) {
      setError("Configure at least one provider slot");
      return;
    }

    for (const slot of validSlots) {
      const provider = providers.find((p) => p.id === slot.provider);
      if (!provider?.configured) {
        setError(provider ? providerConfigError(provider) : `${slot.provider} is not configured`);
        return;
      }
    }

    setRunning(true);
    setError(null);

    try {
      const formData = new FormData();
      for (const file of selectedFiles) {
        formData.append("files", file);
      }
      formData.append("slots", JSON.stringify(validSlots));
      formData.append("normalize", String(normalize));
      formData.append("speakerDiarization", String(speakerDiarization));
      formData.append("language", language);
      formData.append("keyterms", keyterms);

      const res = await fetch("/api/benchmark", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Benchmark failed");

      const firstRun = data.runs?.[0] ?? data;
      setSelectedFiles([]);
      resetFileInput();
      setActiveRunId(firstRun.id);
      await loadRuns();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Benchmark failed");
    } finally {
      setRunning(false);
    }
  };

  const retryJob = async (id: string) => {
    await fetch(`/api/jobs/${id}/retry`, { method: "POST" });
    await loadRuns();
  };

  const deleteRun = async (id: string) => {
    await fetch(`/api/benchmark/${id}`, { method: "DELETE" });
    if (activeRunId === id) setActiveRunId(null);
    await loadRuns();
  };

  const copyTranscript = async (text: string) => {
    await navigator.clipboard.writeText(text);
  };

  const columnCount = activeRun?.jobs.length ?? slots.length;

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <XCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="h-5 w-5 text-violet-400" />
            Audio files
          </CardTitle>
          <CardDescription>
            Upload one or more files — each is compared across all provider slots.
          </CardDescription>
        </CardHeader>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
          <div
            className={`flex min-h-[120px] flex-1 flex-col items-center justify-center rounded-2xl border-2 border-dashed p-4 text-center transition-colors lg:min-h-0 ${
              dragOver
                ? "border-violet-400 bg-violet-500/10"
                : "border-white/10 bg-white/[0.02] hover:border-white/20"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleFiles(e.dataTransfer.files);
            }}
          >
            <FileAudio className="mb-2 h-8 w-8 text-zinc-500" />
            <p className="text-sm text-zinc-300">Drag & drop audio files</p>
            <p className="mt-0.5 text-xs text-zinc-500">mp3, wav, m4a, flac, ogg, webm</p>
            <Button
              variant="secondary"
              className="mt-3"
              size="sm"
              onClick={() => {
                resetFileInput();
                fileInputRef.current?.click();
              }}
            >
              Browse files
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg,.webm,.aac"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) {
                  handleFiles(e.target.files);
                }
                resetFileInput();
              }}
            />
          </div>

          <div className="flex w-full flex-col gap-3 lg:w-72 lg:shrink-0">
            {selectedFiles.length > 0 ? (
              <div className="max-h-36 space-y-1.5 overflow-y-auto">
                {selectedFiles.map((file, i) => (
                  <div
                    key={`${file.name}-${i}`}
                    className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate text-zinc-300">{file.name}</span>
                    <span className="shrink-0 text-xs text-zinc-500">{formatBytes(file.size)}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="shrink-0 text-zinc-500 hover:text-zinc-200"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="flex flex-1 items-center text-sm text-zinc-500">No files selected</p>
            )}

            <Button className="w-full" onClick={runBenchmark} disabled={running || !selectedFiles.length}>
              {running ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <BarChart3 className="h-4 w-4" />
                  Run benchmark
                  {selectedFiles.length > 0
                    ? ` (${selectedFiles.length} file${selectedFiles.length > 1 ? "s" : ""})`
                    : ""}
                </>
              )}
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="h-5 w-5 text-violet-400" />
                Compare providers
              </CardTitle>
              <CardDescription>
                Up to 3 provider/model slots per file. ElevenLabs also runs automatically for
                reviewer reference when configured.
              </CardDescription>
            </CardHeader>

            <div className="space-y-4">
              {slots.map((slot, index) => {
                const provider = providers.find((p) => p.id === slot.provider);
                return (
                  <div
                    key={index}
                    className="rounded-xl bg-white/[0.02] p-3 ring-1 ring-white/5"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                        Slot {index + 1}
                      </span>
                      {slots.length > 1 && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeSlot(index)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Select
                        value={slot.provider}
                        onValueChange={(value) => updateSlot(index, { provider: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {providers.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                              {!p.configured ? " (not configured)" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={slot.model}
                        onValueChange={(value) => updateSlot(index, { model: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {provider?.models.map((model) => (
                            <SelectItem key={model.id} value={model.id}>
                              {model.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                );
              })}

              {slots.length < 3 && (
                <Button variant="secondary" className="w-full" onClick={addSlot}>
                  <Plus className="h-4 w-4" />
                  Add slot ({slots.length}/3)
                </Button>
              )}

              <div className="space-y-2">
                <Label>Language</Label>
                <Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="en" />
              </div>

              <div className="space-y-2">
                <Label>Keyterms</Label>
                <Textarea
                  value={keyterms}
                  onChange={(e) => setKeyterms(e.target.value)}
                  placeholder="comma-separated terms..."
                  className="min-h-[60px]"
                />
              </div>

              <div className="flex items-center justify-between rounded-xl bg-white/[0.02] px-3 py-3 ring-1 ring-white/5">
                <Label>Normalize audio</Label>
                <Switch checked={normalize} onCheckedChange={setNormalize} />
              </div>

              <div className="flex items-center justify-between rounded-xl bg-white/[0.02] px-3 py-2.5 ring-1 ring-white/5">
                <Label>Speaker diarization</Label>
                <Switch checked={speakerDiarization} onCheckedChange={setSpeakerDiarization} />
              </div>
            </div>
          </Card>
        </div>

        <Card className="min-h-[500px]">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Results</CardTitle>
              <CardDescription>
                {hasActiveJobs ? "Processing — auto-refreshing..." : "Side-by-side transcript comparison"}
              </CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={() => void loadRuns()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </CardHeader>

          {runs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <BarChart3 className="mb-4 h-12 w-12 text-zinc-600" />
              <p className="text-zinc-400">No benchmarks yet</p>
              <p className="mt-1 text-sm text-zinc-600">Upload audio and run a comparison</p>
            </div>
          ) : (
            <div className="space-y-4 px-4 pb-4">
              <ListSearch value={runSearch} onChange={setRunSearch} />
              {filteredRuns.length === 0 ? (
                <p className="py-12 text-center text-sm text-zinc-500">No benchmarks match your search</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                {filteredRuns.map((run) => {
                  const allDone = run.jobs.every((j) => j.status === "completed" || j.status === "failed");
                  const anyProcessing = run.jobs.some(
                    (j) => j.status === "pending" || j.status === "processing",
                  );
                  return (
                    <button
                      key={run.id}
                      onClick={() => setActiveRunId(run.id)}
                      className={`rounded-lg px-3 py-2 text-left text-sm ring-1 transition-colors ${
                        activeRun?.id === run.id
                          ? "bg-violet-500/15 ring-violet-500/30 text-violet-200"
                          : "bg-white/[0.02] ring-white/5 text-zinc-400 hover:ring-white/10"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {anyProcessing && <Loader2 className="h-3 w-3 animate-spin text-sky-400" />}
                        {allDone && !run.jobs.some((j) => j.status === "failed") && (
                          <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                        )}
                        <span className="max-w-[220px] truncate font-medium">{run.originalFilename}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-500">{formatDate(run.createdAt)}</div>
                    </button>
                  );
                })}
                </div>
              )}

              <ListPagination
                pagination={runPagination}
                loading={loadingMoreRuns}
                onLoadMore={() => void loadRuns(true)}
              />

              {activeRun && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-sm text-zinc-400">
                      <span className="text-zinc-200">{activeRun.originalFilename}</span>
                      <span className="mx-2">·</span>
                      {formatBytes(activeRun.fileSizeBytes)}
                    </div>
                    <Button variant="danger" size="sm" onClick={() => void deleteRun(activeRun.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>

                  {activeRun.jobs[0]?.id && (
                    <AudioPlayer
                      jobId={activeRun.jobs[0].id}
                      filename={activeRun.originalFilename}
                    />
                  )}

                  <div
                    className="grid gap-4"
                    style={{
                      gridTemplateColumns: `repeat(${Math.min(columnCount, 3)}, minmax(0, 1fr))`,
                    }}
                  >
                    {activeRun.jobs.map((job) => (
                      <div
                        key={job.id}
                        className="flex min-h-[400px] flex-col rounded-xl border border-white/5 bg-white/[0.02]"
                      >
                        <div className="border-b border-white/5 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-white">
                                {job.provider}
                                {job.isReference && (
                                  <span className="ml-1 text-xs font-normal text-amber-300">
                                    (reference)
                                  </span>
                                )}
                              </p>
                              <p className="truncate text-xs text-zinc-500">{job.model}</p>
                            </div>
                            <Badge variant={statusVariant[job.status]}>{job.status}</Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-500">
                            <span>Process: {formatProcessingMs(job.processingMs)}</span>
                            {job.durationMs && <span>Audio: {formatDuration(job.durationMs)}</span>}
                          </div>
                        </div>

                        <div className="flex flex-1 flex-col p-3">
                          {job.status === "pending" || job.status === "processing" ? (
                            <div className="flex flex-1 items-center justify-center">
                              <Loader2 className="h-6 w-6 animate-spin text-sky-400" />
                            </div>
                          ) : job.status === "failed" ? (
                            <div className="flex flex-1 flex-col">
                              <p className="text-sm text-rose-300">{job.errorMessage ?? "Failed"}</p>
                              <div className="mt-3">
                                <Button variant="secondary" size="sm" onClick={() => void retryJob(job.id)}>
                                  <RefreshCw className="h-3.5 w-3.5" />
                                  Retry
                                </Button>
                              </div>
                            </div>
                          ) : job.transcript ? (
                            <>
                              <div className="mb-2 flex justify-end gap-2">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => void retryJob(job.id)}
                                >
                                  <RefreshCw className="h-3.5 w-3.5" />
                                  Retranscribe
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => void copyTranscript(job.transcript!)}
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                  Copy
                                </Button>
                              </div>
                              <pre className="max-h-[480px] flex-1 overflow-auto whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
                                {job.transcript}
                              </pre>
                            </>
                          ) : (
                            <p className="text-sm text-zinc-500">No transcript</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
