"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  RefreshCw,
  Save,
  XCircle,
} from "lucide-react";
import { AudioPlayer } from "@/components/audio-player";
import { ProviderDisagreements } from "@/components/provider-disagreements";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { Label, Textarea } from "@/components/ui/input";
import { ListSearch } from "@/components/ui/list-search";
import { ListPagination } from "@/components/ui/list-pagination";
import { formatDate } from "@/lib/utils";
import { matchesListSearch } from "@/lib/list-search";
import { DEFAULT_PAGE_SIZE, type PaginationMeta } from "@/lib/pagination";
import { computeWordErrorRate } from "@/lib/wer";

type WerMetrics = {
  substitutions: number;
  deletions: number;
  insertions: number;
  refWordCount: number;
  errorCount: number;
  wer: number;
  werPercent: number;
};

type JobMetric = {
  jobId: string;
  provider: string;
  model: string;
  status: string;
  transcript: string | null;
  metrics: WerMetrics | null;
};

type CallItem = {
  reviewId: string | null;
  benchmarkRunId: string | null;
  transcriptionJobId: string | null;
  originalFilename: string;
  reviewStatus: "draft" | "finalized" | null;
  referenceTranscript: string;
  referenceSourceProvider: string | null;
  audioJobId: string | null;
  jobs: JobMetric[];
  createdAt: string | null;
};

type ProviderStat = {
  provider: string;
  model: string;
  callCount: number;
  finalizedReviewCount: number;
  missingReviewCount: number;
  scoredFilenames: string[];
  avgWerPercent: number;
  cumulativeWerPercent: number;
  totalErrors: number;
  totalRefWords: number;
};

type Dashboard = {
  totalCalls: number;
  finalizedCount: number;
  draftCount: number;
  pendingCount: number;
  avgFinalizedWerPercent: number;
  providerStats: ProviderStat[];
};

function callKey(call: CallItem) {
  return call.benchmarkRunId ?? call.transcriptionJobId ?? "";
}

export function ReviewPanel() {
  const [calls, setCalls] = useState<CallItem[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [referenceText, setReferenceText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [callSearch, setCallSearch] = useState("");
  const [callPagination, setCallPagination] = useState<PaginationMeta | null>(null);
  const [loadingMoreCalls, setLoadingMoreCalls] = useState(false);
  const callsLengthRef = useRef(0);

  callsLengthRef.current = calls.length;

  const load = useCallback(async (append = false) => {
    if (append) setLoadingMoreCalls(true);
    try {
      const offset = append ? callsLengthRef.current : 0;
      const res = await fetch(`/api/reviews?limit=${DEFAULT_PAGE_SIZE}&offset=${offset}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load reviews");
      setCalls((prev) => (append ? [...prev, ...(json.calls ?? [])] : (json.calls ?? [])));
      setDashboard(json.dashboard ?? null);
      setCallPagination(json.pagination ?? null);
    } finally {
      if (append) setLoadingMoreCalls(false);
    }
  }, []);

  const refreshDashboard = useCallback(async () => {
    const res = await fetch("/api/reviews?view=dashboard", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Failed to load dashboard");
    setDashboard(json);
  }, []);

  useEffect(() => {
    void load()
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [load]);

  const filteredCalls = useMemo(
    () =>
      calls.filter((call) =>
        matchesListSearch(callSearch, [
          call.originalFilename,
          call.benchmarkRunId ? "benchmark" : "transcribe",
          call.reviewStatus ?? "not reviewed",
          ...call.jobs.flatMap((job) => [job.provider, job.model]),
        ]),
      ),
    [calls, callSearch],
  );

  const activeCall = useMemo(() => {
    if (!filteredCalls.length) return null;
    if (activeKey && filteredCalls.some((call) => callKey(call) === activeKey)) {
      return filteredCalls.find((call) => callKey(call) === activeKey) ?? filteredCalls[0]!;
    }
    return filteredCalls[0]!;
  }, [filteredCalls, activeKey]);

  useEffect(() => {
    if (calls.length && !activeKey) {
      setActiveKey(callKey(calls[0]!));
    }
  }, [calls, activeKey]);

  useEffect(() => {
    if (!activeCall) return;
    const key = callKey(activeCall);
    if (activeKey !== key) {
      setActiveKey(key);
    }
  }, [activeCall, activeKey]);

  useEffect(() => {
    if (activeCall) {
      setReferenceText(activeCall.referenceTranscript);
      setSaved(false);
    }
  }, [activeCall]);

  const previewJobs = useMemo(() => {
    if (!activeCall) return [];
    const ref = referenceText.trim();
    if (!ref) return activeCall.jobs;
    return activeCall.jobs.map((job) => ({
      ...job,
      metrics: job.transcript?.trim()
        ? computeWordErrorRate(ref, job.transcript)
        : null,
    }));
  }, [activeCall, referenceText]);

  const saveReview = async (status: "draft" | "finalized") => {
    if (!activeCall || !referenceText.trim()) {
      setError("Reference transcript is required");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/reviews", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          benchmarkRunId: activeCall.benchmarkRunId,
          transcriptionJobId: activeCall.transcriptionJobId,
          referenceTranscript: referenceText,
          status,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save");

      setSaved(true);
      if (json.dashboard) {
        setDashboard(json.dashboard);
      } else {
        await refreshDashboard();
      }
      await load();
      setActiveKey(callKey(json));
      setReferenceText(json.referenceTranscript);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <XCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {dashboard && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Card className="px-4 py-3 text-center">
              <div className="text-2xl font-bold text-white">{dashboard.totalCalls}</div>
              <div className="text-xs text-zinc-500">Reviewable calls</div>
            </Card>
            <Card className="px-4 py-3 text-center">
              <div className="text-2xl font-bold text-emerald-300">{dashboard.finalizedCount}</div>
              <div className="text-xs text-zinc-500">Finalized</div>
            </Card>
            <Card className="px-4 py-3 text-center">
              <div className="text-2xl font-bold text-amber-300">{dashboard.draftCount}</div>
              <div className="text-xs text-zinc-500">Drafts</div>
            </Card>
            <Card className="px-4 py-3 text-center">
              <div className="text-2xl font-bold text-zinc-300">{dashboard.pendingCount}</div>
              <div className="text-xs text-zinc-500">Not reviewed</div>
            </Card>
            <Card className="px-4 py-3 text-center">
              <div className="text-2xl font-bold text-violet-300">
                {dashboard.avgFinalizedWerPercent}%
              </div>
              <div className="text-xs text-zinc-500">Avg WER (finalized)</div>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="h-5 w-5 text-violet-400" />
                Cumulative WER by provider
              </CardTitle>
              <CardDescription>
                Word Error Rate against reviewer reference ({dashboard.finalizedCount} finalized
                {dashboard.finalizedCount === 1 ? "" : " reviews"}).
              </CardDescription>
            </CardHeader>
            {dashboard.providerStats.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-zinc-500">
                Finalize at least one review to see cumulative provider stats.
              </p>
            ) : (
              <div className="overflow-x-auto px-4 pb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-zinc-500">
                      <th className="pb-2 pr-4">Provider</th>
                      <th className="pb-2 pr-4">Model</th>
                      <th className="pb-2 pr-4">
                        <span className="inline-flex items-center gap-1">
                          Calls
                          <InfoTooltip content="Reviews where this provider has a scored WER. Shows scored / total finalized when the provider was not run on every review (e.g. Transcribe-only Deepgram jobs)." />
                        </span>
                      </th>
                      <th className="pb-2 pr-4">
                        <span className="inline-flex items-center gap-1">
                          Avg WER
                          <InfoTooltip content="Average of each call's WER for this provider. Every finalized call counts equally, whether short or long." />
                        </span>
                      </th>
                      <th className="pb-2 pr-4">
                        <span className="inline-flex items-center gap-1">
                          Cumulative WER
                          <InfoTooltip content="Total errors divided by total reference words across all finalized calls. Longer calls contribute more words and carry more weight." />
                        </span>
                      </th>
                      <th className="pb-2">
                        <span className="inline-flex items-center gap-1">
                          Errors / words
                          <InfoTooltip content="Raw counts behind Cumulative WER: total edit-distance errors over total reference words." />
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.providerStats.map((row) => (
                      <tr key={`${row.provider}-${row.model}`} className="border-b border-white/5">
                        <td className="py-2.5 pr-4 text-zinc-200">{row.provider}</td>
                        <td className="py-2.5 pr-4 text-zinc-400">{row.model}</td>
                        <td className="py-2.5 pr-4">
                          <span className="inline-flex items-center gap-1.5">
                            <span>
                              {row.callCount}
                              {row.missingReviewCount > 0 ? (
                                <span className="text-zinc-500"> / {row.finalizedReviewCount}</span>
                              ) : null}
                            </span>
                            {row.missingReviewCount > 0 ? (
                              <InfoTooltip
                                content={`Scored in: ${row.scoredFilenames.join(", ") || "none"}. Not scored on ${row.missingReviewCount} other finalized review${row.missingReviewCount === 1 ? "" : "s"} — provider not run, failed, or missing transcript.`}
                              />
                            ) : null}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4 font-medium text-violet-200">
                          {row.avgWerPercent}%
                        </td>
                        <td className="py-2.5 pr-4 font-medium text-sky-200">
                          {row.cumulativeWerPercent}%
                        </td>
                        <td className="py-2.5 text-zinc-500">
                          {row.totalErrors} / {row.totalRefWords}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-base">Calls</CardTitle>
              <CardDescription>Benchmark and transcribe results</CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </CardHeader>
          <div className="px-4 pb-3">
            <ListSearch value={callSearch} onChange={setCallSearch} />
          </div>
          <div className="max-h-[600px] space-y-2 overflow-y-auto px-4 pb-4">
            {calls.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-500">No completed transcripts yet</p>
            ) : filteredCalls.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-500">No calls match your search</p>
            ) : (
              filteredCalls.map((call) => (
                <button
                  key={callKey(call)}
                  type="button"
                  onClick={() => setActiveKey(callKey(call))}
                  className={`w-full rounded-lg p-3 text-left ring-1 transition-colors ${
                    activeCall !== null && callKey(activeCall) === callKey(call)
                      ? "bg-violet-500/15 ring-violet-500/30"
                      : "bg-white/[0.02] ring-white/5 hover:ring-white/10"
                  }`}
                >
                  <p className="truncate text-sm font-medium text-zinc-200">
                    {call.originalFilename}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {call.benchmarkRunId ? "Benchmark" : "Transcribe"} · {call.jobs.length} slot
                    {call.jobs.length !== 1 ? "s" : ""}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {call.jobs.map((job) => (
                      <Badge key={job.jobId} variant={job.status === "failed" ? "failed" : "pending"}>
                        {job.provider}/{job.model}
                      </Badge>
                    ))}
                  </div>
                  <div className="mt-1.5">
                    {!call.reviewStatus && <Badge variant="pending">Not reviewed</Badge>}
                    {call.reviewStatus === "draft" && <Badge variant="processing">Draft</Badge>}
                    {call.reviewStatus === "finalized" && (
                      <Badge variant="completed">Finalized</Badge>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
          <div className="px-4 pb-4">
            <ListPagination
              pagination={callPagination}
              loading={loadingMoreCalls}
              onLoadMore={() => void load(true)}
            />
          </div>
        </Card>

        <div className="space-y-4">
          {activeCall ? (
            <>
              <Card className="p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-medium text-white">{activeCall.originalFilename}</h3>
                    <p className="text-xs text-zinc-500">
                      {activeCall.createdAt ? formatDate(activeCall.createdAt) : ""}
                      {activeCall.referenceSourceProvider && (
                        <span> · Reference prefill: {activeCall.referenceSourceProvider}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={saving}
                      onClick={() => void saveReview("draft")}
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Save draft
                    </Button>
                    <Button size="sm" disabled={saving} onClick={() => void saveReview("finalized")}>
                      <CheckCircle2 className="h-4 w-4" />
                      Finalize
                    </Button>
                    {saved && (
                      <span className="flex items-center gap-1 text-xs text-emerald-300">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Saved
                      </span>
                    )}
                  </div>
                </div>

                {activeCall.audioJobId && (
                  <AudioPlayer jobId={activeCall.audioJobId} filename={activeCall.originalFilename} />
                )}

                <div className="mt-4">
                  <ProviderDisagreements jobs={activeCall.jobs} referenceText={referenceText} />
                </div>

                <div className="mt-4 space-y-2">
                  <Label>
                    Reviewer reference transcript
                    {activeCall.referenceSourceProvider === "deepgram" && (
                      <span className="ml-2 text-xs font-normal text-zinc-500">
                        (auto-filled from Deepgram — edit as needed)
                      </span>
                    )}
                  </Label>
                  <Textarea
                    value={referenceText}
                    onChange={(e) => {
                      setReferenceText(e.target.value);
                      setSaved(false);
                    }}
                    className="min-h-[200px] font-mono text-sm leading-relaxed"
                    placeholder="Corrected reference transcript..."
                  />
                </div>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ClipboardCheck className="h-5 w-5 text-violet-400" />
                    Word Error Rate per provider
                  </CardTitle>
                  <CardDescription>
                    {activeCall.reviewStatus
                      ? "WER vs saved reference"
                      : "Save a reference to calculate WER"}
                  </CardDescription>
                </CardHeader>
                <div className="space-y-3 px-4 pb-4">
                  {previewJobs.map((job) => (
                    <div
                      key={job.jobId}
                      className="rounded-xl border border-white/5 bg-white/[0.02] p-4"
                    >
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-medium text-white">
                            {job.provider} / {job.model}
                          </p>
                          {job.metrics ? (
                            <p className="text-sm text-violet-300">
                              WER: {job.metrics.werPercent}% · {job.metrics.errorCount} errors /{" "}
                              {job.metrics.refWordCount} words
                            </p>
                          ) : job.status === "failed" ? (
                            <p className="text-sm text-rose-300">Transcription failed — not scored</p>
                          ) : job.status !== "completed" ? (
                            <p className="text-sm text-zinc-500">Transcription {job.status}</p>
                          ) : !job.transcript?.trim() ? (
                            <p className="text-sm text-zinc-500">No transcript — not scored</p>
                          ) : (
                            <p className="text-sm text-zinc-500">Save reference to compute WER</p>
                          )}
                        </div>
                        {job.metrics && (
                          <div className="text-xs text-zinc-500">
                            S:{job.metrics.substitutions} D:{job.metrics.deletions} I:
                            {job.metrics.insertions}
                          </div>
                        )}
                      </div>
                      {job.transcript && (
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-3 text-xs text-zinc-300">
                          {job.transcript}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            </>
          ) : (
            <Card className="flex min-h-[400px] items-center justify-center">
              <p className="text-zinc-500">Select a call to review</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
