import { NextRequest, NextResponse } from "next/server";
import { Op, Sequelize } from "sequelize";
import {
  ensureAnalysisQueueRunning,
  enqueueAnalyses,
} from "@/lib/analysis-queue";
import { isLlmConfigured } from "@/lib/llm/analyze-stt";
import { initDb, SttAnalysis, TranscriptionJob } from "@/lib/models";
import { buildPaginationMeta, parsePaginationParams } from "@/lib/pagination";

export const runtime = "nodejs";

function serializeItem(job: TranscriptionJob, analysis: SttAnalysis | null) {
  return {
    jobId: job.id,
    originalFilename: job.originalFilename,
    provider: job.provider,
    model: job.model,
    source: job.benchmarkRunId ? ("benchmark" as const) : ("transcribe" as const),
    benchmarkRunId: job.benchmarkRunId,
    slotIndex: job.slotIndex,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    analysis: analysis
      ? {
          id: analysis.id,
          status: analysis.status,
          summary: analysis.summary,
          qualityScore: analysis.qualityScore,
          issues: analysis.issues,
          llmModel: analysis.llmModel,
          errorMessage: analysis.errorMessage,
          processingMs: analysis.processingMs,
          createdAt: analysis.createdAt,
          updatedAt: analysis.updatedAt,
        }
      : null,
  };
}

export async function GET(request: NextRequest) {
  try {
    await initDb();
    ensureAnalysisQueueRunning();
    const { limit, offset } = parsePaginationParams(new URL(request.url).searchParams);

    const jobWhere = {
      status: "completed" as const,
      [Op.and]: [
        Sequelize.where(
          Sequelize.fn("LENGTH", Sequelize.fn("TRIM", Sequelize.col("transcript"))),
          { [Op.gt]: 0 },
        ),
      ],
    };

    const total = await TranscriptionJob.count({ where: jobWhere });

    const jobs = await TranscriptionJob.findAll({
      where: jobWhere,
      order: [["createdAt", "DESC"]],
      limit,
      offset,
    });

    const analyses = await SttAnalysis.findAll({
      where: { jobId: jobs.map((j) => j.id) },
    });
    const analysisByJob = new Map(analyses.map((a) => [a.jobId, a]));

    const items = jobs.map((job) => serializeItem(job, analysisByJob.get(job.id) ?? null));

    const allAnalyses = await SttAnalysis.findAll();
    const allIssues = allAnalyses.flatMap((a) => (a.status === "completed" ? a.issues : []));

    return NextResponse.json({
      configured: isLlmConfigured(),
      llmModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      items,
      pagination: buildPaginationMeta(total, limit, offset, jobs.length),
      stats: {
        analyzed: allAnalyses.filter((a) => a.status === "completed").length,
        pending: allAnalyses.filter((a) => a.status === "pending" || a.status === "processing").length,
        totalIssues: allIssues.length,
        highSeverity: allIssues.filter((i) => i.severity === "high").length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch STT analysis";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await initDb();

    if (!isLlmConfigured()) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is not configured in environment" },
        { status: 400 },
      );
    }

    const body = (await request.json()) as { jobIds?: string[] };
    const jobIds = body.jobIds ?? [];

    if (!jobIds.length) {
      return NextResponse.json({ error: "No job IDs provided" }, { status: 400 });
    }

    const jobs = await TranscriptionJob.findAll({
      where: {
        id: jobIds,
        status: "completed",
        transcript: { [Op.ne]: null },
      },
    });

    if (!jobs.length) {
      return NextResponse.json(
        { error: "No completed transcripts found for the selected jobs" },
        { status: 400 },
      );
    }

    const analysisIds: string[] = [];

    for (const job of jobs) {
      const [analysis] = await SttAnalysis.upsert({
        jobId: job.id,
        status: "pending",
        summary: null,
        qualityScore: null,
        issues: [],
        llmModel: null,
        errorMessage: null,
        processingMs: null,
      });
      analysisIds.push(analysis.id);
    }

    enqueueAnalyses(analysisIds);
    ensureAnalysisQueueRunning();

    return NextResponse.json({
      queued: analysisIds.length,
      analysisIds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to queue STT analysis";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
