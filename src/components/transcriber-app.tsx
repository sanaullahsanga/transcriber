"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Copy,
  FileAudio,
  Loader2,
  Mic,
  RefreshCw,
  ScanSearch,
  Settings2,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { BenchmarkPanel } from "@/components/benchmark-panel";
import { ReviewPanel } from "@/components/review-panel";
import { AudioPlayer } from "@/components/audio-player";
import { SttIssuesPanel } from "@/components/stt-issues-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { ListSearch } from "@/components/ui/list-search";
import { ListPagination } from "@/components/ui/list-pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { providerConfigError } from "@/lib/providers";
import { DEFAULT_PAGE_SIZE, type PaginationMeta } from "@/lib/pagination";
import { formatBytes, formatDate, formatDuration } from "@/lib/utils";
import { matchesListSearch } from "@/lib/list-search";

type ProviderInfo = {
  id: string;
  name: string;
  description: string;
  envKey: string;
  configured: boolean;
  defaultModel: string;
  models: Array<{ id: string; label: string; description?: string }>;
};

type AppSettings = {
  defaultProvider: string;
  defaultModel: string;
  normalizeAudio: boolean;
  speakerDiarization: boolean;
  keyterms: string[];
  language: string;
};

type Job = {
  id: string;
  originalFilename: string;
  fileSizeBytes: number;
  provider: string;
  model: string;
  status: "pending" | "processing" | "completed" | "failed";
  transcript: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: string;
  completedAt: string | null;
};

const statusVariant = {
  pending: "pending",
  processing: "processing",
  completed: "completed",
  failed: "failed",
} as const;

export function TranscriberApp() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobSearch, setJobSearch] = useState("");
  const [jobPagination, setJobPagination] = useState<PaginationMeta | null>(null);
  const [loadingMoreJobs, setLoadingMoreJobs] = useState(false);
  const jobsLengthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  jobsLengthRef.current = jobs.length;

  const resetFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const activeProvider = useMemo(
    () => providers.find((p) => p.id === settings?.defaultProvider),
    [providers, settings?.defaultProvider],
  );

  const hasActiveJobs = jobs.some((j) => j.status === "pending" || j.status === "processing");

  const filteredJobs = useMemo(
    () =>
      jobs.filter((job) =>
        matchesListSearch(jobSearch, [
          job.originalFilename,
          job.provider,
          job.model,
          job.status,
          job.errorMessage,
        ]),
      ),
    [jobs, jobSearch],
  );

  const loadProviders = useCallback(async () => {
    const res = await fetch("/api/providers");
    const data = await res.json();
    setProviders(data.providers ?? []);
  }, []);

  const loadSettings = useCallback(async () => {
    const res = await fetch("/api/settings");
    const data = await res.json();
    setSettings(data.settings);
  }, []);

  const loadJobs = useCallback(async (append = false) => {
    if (append) setLoadingMoreJobs(true);
    try {
      const offset = append ? jobsLengthRef.current : 0;
      const res = await fetch(`/api/jobs?limit=${DEFAULT_PAGE_SIZE}&offset=${offset}`);
      const data = await res.json();
      setJobs((prev) => (append ? [...prev, ...(data.jobs ?? [])] : (data.jobs ?? [])));
      setJobPagination(data.pagination ?? null);
    } finally {
      if (append) setLoadingMoreJobs(false);
    }
  }, []);

  useEffect(() => {
    void loadProviders();
    void loadSettings();
    void loadJobs();
  }, [loadProviders, loadSettings, loadJobs]);

  useEffect(() => {
    if (!hasActiveJobs) return;
    const interval = setInterval(() => {
      void loadJobs();
    }, 2500);
    return () => clearInterval(interval);
  }, [hasActiveJobs, loadJobs]);

  const handleFiles = (files: FileList | File[]) => {
    const audioFiles = Array.from(files).filter(
      (f) => f.type.startsWith("audio/") || /\.(mp3|wav|m4a|flac|ogg|webm|aac)$/i.test(f.name),
    );
    if (!audioFiles.length) {
      setError("Please select valid audio files (mp3, wav, m4a, flac, ogg, webm)");
      return;
    }
    setError(null);
    setSelectedFiles((prev) => [...prev, ...audioFiles]);
  };

  const saveSettings = async () => {
    if (!settings) return;
    setSavingSettings(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error("Failed to save settings");
      const data = await res.json();
      setSettings(data.settings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSavingSettings(false);
    }
  };

  const uploadFiles = async () => {
    if (!selectedFiles.length || !settings) return;

    const provider = providers.find((p) => p.id === settings.defaultProvider);
    if (!provider?.configured) {
      setError(provider ? providerConfigError(provider) : "Provider is not configured");
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      for (const file of selectedFiles) {
        formData.append("files", file);
      }
      formData.append("provider", settings.defaultProvider);
      formData.append("model", settings.defaultModel);
      formData.append("normalize", String(settings.normalizeAudio));
      formData.append("speakerDiarization", String(settings.speakerDiarization));
      formData.append("language", settings.language);
      formData.append("keyterms", settings.keyterms.join(","));

      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");

      setSelectedFiles([]);
      resetFileInput();
      await loadJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const retryJob = async (id: string) => {
    await fetch(`/api/jobs/${id}/retry`, { method: "POST" });
    await loadJobs();
  };

  const deleteJob = async (id: string) => {
    await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    if (expandedJob === id) setExpandedJob(null);
    await loadJobs();
  };

  const copyTranscript = async (text: string) => {
    await navigator.clipboard.writeText(text);
  };

  const stats = useMemo(() => {
    return {
      total: jobs.length,
      completed: jobs.filter((j) => j.status === "completed").length,
      processing: jobs.filter((j) => j.status === "processing" || j.status === "pending").length,
      failed: jobs.filter((j) => j.status === "failed").length,
    };
  }, [jobs]);

  if (!settings) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto w-full max-w-[1800px] px-3 py-6 sm:px-4">
        <header className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-300 ring-1 ring-violet-500/20">
              <Mic className="h-3.5 w-3.5" />
              Multi-provider STT
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
              Transcriber
            </h1>
            <p className="mt-2 max-w-2xl text-zinc-400">
              Upload single or multiple audio files. Transcription runs in the background with your
              chosen provider and model.
            </p>
          </div>
          <div className="flex gap-3">
            <Card className="min-w-[100px] px-4 py-3 text-center">
              <div className="text-2xl font-bold text-white">{stats.completed}</div>
              <div className="text-xs text-zinc-500">Done</div>
            </Card>
            <Card className="min-w-[100px] px-4 py-3 text-center">
              <div className="text-2xl font-bold text-sky-300">{stats.processing}</div>
              <div className="text-xs text-zinc-500">In progress</div>
            </Card>
          </div>
        </header>

        <Tabs defaultValue="transcribe" className="w-full">
          <TabsList>
            <TabsTrigger value="transcribe">
              <Mic className="h-4 w-4" />
              Transcribe
            </TabsTrigger>
            <TabsTrigger value="benchmark">
              <BarChart3 className="h-4 w-4" />
              Benchmark
            </TabsTrigger>
            <TabsTrigger value="stt-issues">
              <ScanSearch className="h-4 w-4" />
              STT Issues
            </TabsTrigger>
            <TabsTrigger value="review">
              <ClipboardList className="h-4 w-4" />
              WER Review
            </TabsTrigger>
          </TabsList>

          <TabsContent value="transcribe">
            {error && (
              <div className="mb-6 flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                <XCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings2 className="h-5 w-5 text-violet-400" />
                  Controls
                </CardTitle>
                <CardDescription>Configure provider, model, and transcription options.</CardDescription>
              </CardHeader>

              <div className="space-y-5">
                <div className="space-y-2">
                  <Label>Provider</Label>
                  <Select
                    value={settings.defaultProvider}
                    onValueChange={(value) => {
                      const provider = providers.find((p) => p.id === value);
                      setSettings({
                        ...settings,
                        defaultProvider: value,
                        defaultModel: provider?.defaultModel ?? settings.defaultModel,
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {providers.map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>
                          {provider.name}
                          {!provider.configured ? " (not configured)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {activeProvider && (
                    <p className="text-xs text-zinc-500">{activeProvider.description}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Model</Label>
                  <Select
                    value={settings.defaultModel}
                    onValueChange={(value) => setSettings({ ...settings, defaultModel: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {activeProvider?.models.map((model) => (
                        <SelectItem key={model.id} value={model.id}>
                          {model.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Language</Label>
                  <Input
                    value={settings.language}
                    onChange={(e) => setSettings({ ...settings, language: e.target.value })}
                    placeholder="en"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Keyterms (comma-separated)</Label>
                  <Textarea
                    value={settings.keyterms.join(", ")}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        keyterms: e.target.value
                          .split(/[,\n]/)
                          .map((t) => t.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="product names, jargon, proper nouns..."
                    className="min-h-[80px]"
                  />
                </div>

                <div className="flex items-center justify-between rounded-xl bg-white/[0.02] px-3 py-3 ring-1 ring-white/5">
                  <div>
                    <Label>Normalize audio</Label>
                    <p className="text-xs text-zinc-500">Convert to 16kHz mono for compatibility</p>
                  </div>
                  <Switch
                    checked={settings.normalizeAudio}
                    onCheckedChange={(checked) =>
                      setSettings({ ...settings, normalizeAudio: checked })
                    }
                  />
                </div>

                <div className="flex items-center justify-between rounded-xl bg-white/[0.02] px-3 py-3 ring-1 ring-white/5">
                  <div>
                    <Label>Speaker diarization</Label>
                    <p className="text-xs text-zinc-500">Format as Agent/Caller dialogue</p>
                  </div>
                  <Switch
                    checked={settings.speakerDiarization}
                    onCheckedChange={(checked) =>
                      setSettings({ ...settings, speakerDiarization: checked })
                    }
                  />
                </div>

                <Button className="w-full" onClick={saveSettings} disabled={savingSettings}>
                  {savingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Save defaults
                </Button>
              </div>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="h-5 w-5 text-violet-400" />
                  Upload audio
                </CardTitle>
                <CardDescription>Drop files here or browse. Multiple files supported.</CardDescription>
              </CardHeader>

              <div
                className={`rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
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
                <FileAudio className="mx-auto mb-3 h-10 w-10 text-zinc-500" />
                <p className="text-sm text-zinc-300">Drag & drop audio files</p>
                <p className="mt-1 text-xs text-zinc-500">mp3, wav, m4a, flac, ogg, webm</p>
                <Button
                  variant="secondary"
                  className="mt-4"
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

              {selectedFiles.length > 0 && (
                <div className="mt-4 space-y-2">
                  {selectedFiles.map((file, i) => (
                    <div
                      key={`${file.name}-${i}`}
                      className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-sm"
                    >
                      <span className="truncate text-zinc-300">{file.name}</span>
                      <span className="shrink-0 text-xs text-zinc-500">{formatBytes(file.size)}</span>
                    </div>
                  ))}
                  <Button className="w-full" onClick={uploadFiles} disabled={uploading}>
                    {uploading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4" />
                        Transcribe {selectedFiles.length} file{selectedFiles.length > 1 ? "s" : ""}
                      </>
                    )}
                  </Button>
                </div>
              )}
            </Card>
          </div>

          <Card className="min-h-[600px]">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Transcriptions</CardTitle>
                <CardDescription>
                  {hasActiveJobs ? "Processing in background — auto-refreshing..." : "All jobs and results"}
                </CardDescription>
              </div>
              <Button variant="ghost" size="icon" onClick={() => void loadJobs()}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </CardHeader>

            {jobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <FileAudio className="mb-4 h-12 w-12 text-zinc-600" />
                <p className="text-zinc-400">No transcriptions yet</p>
                <p className="mt-1 text-sm text-zinc-600">Upload audio to get started</p>
              </div>
            ) : (
              <div className="space-y-3 px-4 pb-4">
                <ListSearch value={jobSearch} onChange={setJobSearch} />
                {filteredJobs.length === 0 ? (
                  <p className="py-12 text-center text-sm text-zinc-500">No transcriptions match your search</p>
                ) : (
                  filteredJobs.map((job) => (
                  <div
                    key={job.id}
                    className="rounded-xl border border-white/5 bg-white/[0.02] transition-colors hover:border-white/10"
                  >
                    <button
                      className="flex w-full items-start gap-4 p-4 text-left"
                      onClick={() => setExpandedJob(expandedJob === job.id ? null : job.id)}
                    >
                      <div className="mt-0.5">
                        {job.status === "completed" && (
                          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                        )}
                        {job.status === "failed" && <XCircle className="h-5 w-5 text-rose-400" />}
                        {(job.status === "pending" || job.status === "processing") && (
                          <Loader2 className="h-5 w-5 animate-spin text-sky-400" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium text-white">{job.originalFilename}</span>
                          <Badge variant={statusVariant[job.status]}>{job.status}</Badge>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-3 text-xs text-zinc-500">
                          <span>{job.provider} / {job.model}</span>
                          <span>{formatBytes(job.fileSizeBytes)}</span>
                          <span>{formatDate(job.createdAt)}</span>
                          {job.durationMs && <span>Audio: {formatDuration(job.durationMs)}</span>}
                        </div>
                        {job.status === "failed" && job.errorMessage && (
                          <p className="mt-2 text-xs text-rose-300">{job.errorMessage}</p>
                        )}
                      </div>
                    </button>

                    {expandedJob === job.id && (
                      <div className="border-t border-white/5 px-4 pb-4">
                        <div className="pt-3">
                          <AudioPlayer jobId={job.id} filename={job.originalFilename} />
                        </div>

                        {(job.transcript || job.status === "completed" || job.status === "failed") && (
                          <div className="mb-2 mt-3 flex justify-end gap-2">
                            {(job.transcript || job.status === "completed") && (
                              <>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => void retryJob(job.id)}
                                >
                                  <RefreshCw className="h-3.5 w-3.5" />
                                  Retranscribe
                                </Button>
                                {job.transcript && (
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => void copyTranscript(job.transcript!)}
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                    Copy
                                  </Button>
                                )}
                              </>
                            )}
                            {job.status === "failed" && !job.transcript && (
                              <Button variant="secondary" size="sm" onClick={() => void retryJob(job.id)}>
                                <RefreshCw className="h-3.5 w-3.5" />
                                Retry
                              </Button>
                            )}
                            <Button variant="danger" size="sm" onClick={() => void deleteJob(job.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete
                            </Button>
                          </div>
                        )}

                        {job.transcript && (
                          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-black/30 p-4 text-sm leading-relaxed text-zinc-200">
                            {job.transcript}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                ))
                )}
                <ListPagination
                  pagination={jobPagination}
                  loading={loadingMoreJobs}
                  onLoadMore={() => void loadJobs(true)}
                />
              </div>
            )}
          </Card>
            </div>
          </TabsContent>

          <TabsContent value="benchmark">
            <BenchmarkPanel
              providers={providers}
              settings={{
                normalizeAudio: settings.normalizeAudio,
                speakerDiarization: settings.speakerDiarization,
                keyterms: settings.keyterms,
                language: settings.language,
              }}
            />
          </TabsContent>

          <TabsContent value="stt-issues">
            <SttIssuesPanel />
          </TabsContent>

          <TabsContent value="review">
            <ReviewPanel />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
