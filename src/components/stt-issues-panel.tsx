"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ScanSearch,
  Settings2,
  Sparkles,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label, Textarea } from "@/components/ui/input";
import { ListSearch } from "@/components/ui/list-search";
import { ListPagination } from "@/components/ui/list-pagination";
import { formatDate } from "@/lib/utils";
import { matchesListSearch } from "@/lib/list-search";
import { DEFAULT_PAGE_SIZE, type PaginationMeta } from "@/lib/pagination";

type SttIssue = {
  category: string;
  severity: "low" | "medium" | "high";
  excerpt: string;
  description: string;
  suggestion?: string;
};

type AnalysisInfo = {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  summary: string | null;
  qualityScore: number | null;
  issues: SttIssue[];
  llmModel: string | null;
  errorMessage: string | null;
  processingMs: number | null;
};

type AnalysisItem = {
  jobId: string;
  originalFilename: string;
  provider: string;
  model: string;
  source: "transcribe" | "benchmark";
  benchmarkRunId: string | null;
  slotIndex: number | null;
  createdAt: string;
  analysis: AnalysisInfo | null;
};

type AnalysisResponse = {
  configured: boolean;
  llmModel: string;
  items: AnalysisItem[];
  stats: {
    analyzed: number;
    pending: number;
    totalIssues: number;
    highSeverity: number;
  };
};

const severityVariant = {
  low: "pending",
  medium: "processing",
  high: "failed",
} as const;

const categoryLabels: Record<string, string> = {
  mishearing: "Mishearing",
  proper_noun: "Proper noun",
  diarization: "Diarization",
  punctuation: "Punctuation",
  omission: "Omission",
  hallucination: "Hallucination",
  accent_clarity: "Accent / clarity",
  background_noise: "Background noise",
  formatting: "Formatting",
  domain_term: "Domain term",
  other: "Other",
};

export function SttIssuesPanel() {
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<"all" | "high" | "medium" | "low">("all");
  const [transcriptSearch, setTranscriptSearch] = useState("");
  const [listPagination, setListPagination] = useState<PaginationMeta | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [defaultPrompt, setDefaultPrompt] = useState("");
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [promptSaved, setPromptSaved] = useState(false);
  const itemsLengthRef = useRef(0);

  itemsLengthRef.current = data?.items.length ?? 0;

  const loadPrompt = useCallback(async () => {
    const res = await fetch("/api/settings/stt-prompt");
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Failed to load prompt");
    setSystemPrompt(json.prompt ?? "");
    setDefaultPrompt(json.defaultPrompt ?? "");
  }, []);

  const load = useCallback(async (append = false) => {
    if (append) setLoadingMore(true);
    try {
      const offset = append ? itemsLengthRef.current : 0;
      const res = await fetch(`/api/stt-analysis?limit=${DEFAULT_PAGE_SIZE}&offset=${offset}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setData((prev) => {
        if (!append || !prev) return json;
        return {
          ...json,
          items: [...prev.items, ...(json.items ?? [])],
        };
      });
      setListPagination(json.pagination ?? null);
    } finally {
      if (append) setLoadingMore(false);
    }
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.all([load(), loadPrompt()]);
  }, [load, loadPrompt]);

  useEffect(() => {
    void loadAll().catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [loadAll]);

  const hasActive = data?.items.some(
    (item) =>
      item.analysis?.status === "pending" || item.analysis?.status === "processing",
  );

  useEffect(() => {
    if (!hasActive) return;
    const interval = setInterval(() => {
      void load().catch(() => undefined);
    }, 3000);
    return () => clearInterval(interval);
  }, [hasActive, load]);

  const filteredItems = useMemo(() => {
    if (!data) return [];
    return data.items.filter((item) => {
      const analysisStatus = item.analysis?.status ?? "not analyzed";
      return matchesListSearch(transcriptSearch, [
        item.originalFilename,
        item.provider,
        item.model,
        item.source,
        analysisStatus,
        item.source === "benchmark" ? "benchmark" : "transcribe",
      ]);
    });
  }, [data, transcriptSearch]);

  const activeItem = useMemo(
    () => filteredItems.find((i) => i.jobId === activeJobId) ?? filteredItems[0] ?? null,
    [filteredItems, activeJobId],
  );

  useEffect(() => {
    if (!filteredItems.length) return;
    if (activeJobId && filteredItems.some((item) => item.jobId === activeJobId)) return;
    setActiveJobId(filteredItems[0]!.jobId);
  }, [filteredItems, activeJobId]);

  const flatIssues = useMemo(() => {
    if (!data) return [];
    return data.items.flatMap((item) => {
      if (item.analysis?.status !== "completed") return [];
      return item.analysis.issues.map((issue) => ({
        ...issue,
        jobId: item.jobId,
        filename: item.originalFilename,
        provider: item.provider,
        model: item.model,
        analysisId: item.analysis!.id,
        qualityScore: item.analysis!.qualityScore,
      }));
    });
  }, [data]);

  const filteredIssues = useMemo(() => {
    const bySeverity =
      severityFilter === "all" ? flatIssues : flatIssues.filter((i) => i.severity === severityFilter);
    if (!transcriptSearch.trim()) return bySeverity;
    return bySeverity.filter((issue) =>
      matchesListSearch(transcriptSearch, [
        issue.filename,
        issue.provider,
        issue.model,
        issue.category,
        issue.severity,
        issue.description,
        issue.excerpt,
      ]),
    );
  }, [flatIssues, severityFilter, transcriptSearch]);

  const toggleSelect = (jobId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  const selectUnanalyzed = () => {
    const ids = data?.items.filter((i) => !i.analysis || i.analysis.status === "failed").map((i) => i.jobId) ?? [];
    setSelected(new Set(ids));
  };

  const runAnalysis = async (jobIds: string[]) => {
    if (!jobIds.length) {
      setError("Select at least one transcript");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/stt-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobIds }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Analysis failed");
      setSelected(new Set());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setRunning(false);
    }
  };

  const retryAnalysis = async (analysisId: string) => {
    await fetch(`/api/stt-analysis/${analysisId}/retry`, { method: "POST" });
    await load();
  };

  const savePrompt = async () => {
    setSavingPrompt(true);
    setPromptSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/settings/stt-prompt", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: systemPrompt }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save prompt");
      setSystemPrompt(json.prompt);
      setPromptSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save prompt");
    } finally {
      setSavingPrompt(false);
    }
  };

  const resetPrompt = () => {
    if (defaultPrompt) {
      setSystemPrompt(defaultPrompt);
      setPromptSaved(false);
    }
  };

  if (!data) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!data.configured && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Set OPENAI_API_KEY in .env to enable LLM-based STT issue detection.
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <XCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings2 className="h-5 w-5 text-violet-400" />
              LLM analysis prompt
            </CardTitle>
            <CardDescription>
              System instructions for STT issue detection. Stored in the database.
            </CardDescription>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowPromptEditor((open) => !open)}
          >
            {showPromptEditor ? "Hide" : "Edit prompt"}
          </Button>
        </CardHeader>

        {showPromptEditor && (
          <div className="space-y-3 border-t border-white/5 pt-4">
            <div className="space-y-2">
              <Label>System prompt</Label>
              <Textarea
                value={systemPrompt}
                onChange={(e) => {
                  setSystemPrompt(e.target.value);
                  setPromptSaved(false);
                }}
                className="min-h-[220px] font-mono text-xs leading-relaxed"
                placeholder="Instructions for the LLM..."
              />
              <p className="text-xs text-zinc-500">
                Keep JSON output format with summary, qualityScore, and issues so results parse correctly.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => void savePrompt()} disabled={savingPrompt || !systemPrompt.trim()}>
                {savingPrompt ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save prompt
              </Button>
              <Button variant="secondary" size="sm" onClick={resetPrompt} disabled={!defaultPrompt}>
                Reset to default
              </Button>
              {promptSaved && (
                <span className="flex items-center gap-1 text-xs text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Saved
                </span>
              )}
            </div>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ScanSearch className="h-5 w-5 text-violet-400" />
              Transcripts
            </CardTitle>
            <CardDescription>
              Completed transcripts from Transcribe and Benchmark tabs.
            </CardDescription>
          </CardHeader>

          <div className="mb-3 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={selectUnanalyzed}>
              Select unanalyzed
            </Button>
            <Button
              size="sm"
              disabled={running || !data.configured || selected.size === 0}
              onClick={() => void runAnalysis([...selected])}
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Analyze ({selected.size})
            </Button>
          </div>

          <ListSearch
            value={transcriptSearch}
            onChange={setTranscriptSearch}
            className="mb-3 px-4"
          />

          <div className="max-h-[520px] space-y-2 overflow-y-auto px-4 pb-4">
            {!data || data.items.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-500">No completed transcripts yet</p>
            ) : filteredItems.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-500">No transcripts match your search</p>
            ) : (
              filteredItems.map((item) => {
                const isSelected = selected.has(item.jobId);
                const analysis = item.analysis;
                return (
                  <button
                    key={item.jobId}
                    type="button"
                    onClick={() => setActiveJobId(item.jobId)}
                    className={`w-full rounded-lg p-3 text-left ring-1 transition-colors ${
                      activeItem?.jobId === item.jobId
                        ? "bg-violet-500/15 ring-violet-500/30"
                        : "bg-white/[0.02] ring-white/5 hover:ring-white/10"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleSelect(item.jobId);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-zinc-200">
                          {item.originalFilename}
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          {item.source === "benchmark" ? (
                            <>
                              Benchmark · slot {(item.slotIndex ?? 0) + 1} · {item.provider} / {item.model}
                            </>
                          ) : (
                            <>
                              Transcribe · {item.provider} / {item.model}
                            </>
                          )}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          {item.source === "benchmark" && (
                            <Badge variant="processing">Benchmark</Badge>
                          )}
                          {!analysis && (
                            <Badge variant="pending">Not analyzed</Badge>
                          )}
                          {analysis?.status === "processing" || analysis?.status === "pending" ? (
                            <Badge variant="processing">
                              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              Analyzing
                            </Badge>
                          ) : null}
                          {analysis?.status === "completed" && (
                            <>
                              <Badge variant="completed">{analysis.qualityScore ?? "—"}%</Badge>
                              <span className="text-xs text-zinc-500">
                                {analysis.issues.length} issue{analysis.issues.length !== 1 ? "s" : ""}
                              </span>
                            </>
                          )}
                          {analysis?.status === "failed" && (
                            <Badge variant="failed">Failed</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
          <div className="px-4 pb-4">
            <ListPagination
              pagination={listPagination}
              loading={loadingMore}
              onLoadMore={() => void load(true)}
            />
          </div>
        </Card>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Card className="px-4 py-3 text-center">
              <div className="text-2xl font-bold text-white">{data.stats.analyzed}</div>
              <div className="text-xs text-zinc-500">Analyzed</div>
            </Card>
            <Card className="px-4 py-3 text-center">
              <div className="text-2xl font-bold text-sky-300">{data.stats.totalIssues}</div>
              <div className="text-xs text-zinc-500">Total issues</div>
            </Card>
            <Card className="px-4 py-3 text-center">
              <div className="text-2xl font-bold text-rose-300">{data.stats.highSeverity}</div>
              <div className="text-xs text-zinc-500">High severity</div>
            </Card>
            <Card className="px-4 py-3 text-center">
              <div className="text-2xl font-bold text-violet-300">{data.stats.pending}</div>
              <div className="text-xs text-zinc-500">In progress</div>
            </Card>
          </div>

          {activeItem?.analysis?.status === "completed" && (
            <Card className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-white">{activeItem.originalFilename}</p>
                  <p className="mt-1 text-sm text-zinc-400">{activeItem.analysis.summary}</p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-2xl font-bold text-emerald-300">
                    {activeItem.analysis.qualityScore}%
                  </div>
                  <div className="text-xs text-zinc-500">STT quality</div>
                </div>
              </div>
            </Card>
          )}

          {activeItem?.analysis?.status === "failed" && (
            <Card className="p-4">
              <p className="text-sm text-rose-300">{activeItem.analysis.errorMessage}</p>
              <Button
                className="mt-3"
                size="sm"
                variant="secondary"
                onClick={() => void retryAnalysis(activeItem.analysis!.id)}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry analysis
              </Button>
            </Card>
          )}

          <Card className="min-h-[480px]">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>STT issues</CardTitle>
                <CardDescription>
                  {filteredIssues.length} issue{filteredIssues.length !== 1 ? "s" : ""} across analyzed calls
                </CardDescription>
              </div>
              <div className="flex gap-2">
                {(["all", "high", "medium", "low"] as const).map((level) => (
                  <Button
                    key={level}
                    size="sm"
                    variant={severityFilter === level ? "default" : "secondary"}
                    onClick={() => setSeverityFilter(level)}
                  >
                    {level}
                  </Button>
                ))}
                <Button variant="ghost" size="icon" onClick={() => void load()}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>

            {filteredIssues.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                {data.stats.analyzed > 0 ? (
                  <>
                    <CheckCircle2 className="mb-3 h-10 w-10 text-emerald-400" />
                    <p className="text-zinc-400">No issues match this filter</p>
                  </>
                ) : (
                  <>
                    <Sparkles className="mb-3 h-10 w-10 text-zinc-600" />
                    <p className="text-zinc-400">Select transcripts and run analysis</p>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {filteredIssues.map((issue, index) => (
                  <div
                    key={`${issue.jobId}-${index}`}
                    className="rounded-xl border border-white/5 bg-white/[0.02] p-4"
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge variant={severityVariant[issue.severity]}>{issue.severity}</Badge>
                      <Badge variant="pending">
                        {categoryLabels[issue.category] ?? issue.category}
                      </Badge>
                      <span className="truncate text-xs text-zinc-500">
                        {issue.filename}
                        {data.items.find((i) => i.jobId === issue.jobId)?.source === "benchmark"
                          ? " · benchmark"
                          : ""}
                      </span>
                    </div>
                    {issue.excerpt && (
                      <p className="mb-2 rounded-lg bg-black/30 px-3 py-2 text-sm italic text-zinc-300">
                        &ldquo;{issue.excerpt}&rdquo;
                      </p>
                    )}
                    <p className="text-sm text-zinc-300">{issue.description}</p>
                    {issue.suggestion && (
                      <p className="mt-2 text-sm text-emerald-300/90">
                        Suggestion: {issue.suggestion}
                      </p>
                    )}
                    <p className="mt-2 text-xs text-zinc-600">
                      {issue.provider} / {issue.model} · {formatDate(
                        data.items.find((i) => i.jobId === issue.jobId)?.createdAt ?? "",
                      )}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
