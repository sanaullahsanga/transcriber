"use client";

import { useMemo } from "react";
import { GitCompare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { REFERENCE_PROVIDER } from "@/lib/reference-provider";
import { PROVIDERS } from "@/lib/providers";
import {
  findDisagreementGroups,
  formatDisagreementGroup,
  referenceMatchesPhrase,
  type DisagreementGroup,
} from "@/lib/transcript-diff";
import { computeWordErrorRate } from "@/lib/wer";

type JobLike = {
  provider: string;
  model: string;
  status: string;
  transcript: string | null;
};

type ProviderDisagreementsProps = {
  jobs: JobLike[];
  referenceText: string;
  maxPerProvider?: number;
};

const baselineLabel = PROVIDERS[REFERENCE_PROVIDER]?.name ?? REFERENCE_PROVIDER;

function refPick(
  referenceText: string,
  group: DisagreementGroup,
  formatted: ReturnType<typeof formatDisagreementGroup>,
): "baseline" | "other" | "unclear" {
  const baselinePhrase = formatted.deepgram;
  const otherPhrase = formatted.other;
  const matchesBaseline =
    baselinePhrase !== "(missing)" && referenceMatchesPhrase(referenceText, baselinePhrase);
  const matchesOther =
    otherPhrase !== "(missing)" && referenceMatchesPhrase(referenceText, otherPhrase);

  if (matchesBaseline && !matchesOther) return "baseline";
  if (matchesOther && !matchesBaseline) return "other";
  if (matchesBaseline && matchesOther) return "unclear";

  const fullBaseline = group.deepgramWords.join(" ");
  const fullOther = group.otherWords.join(" ");
  if (fullBaseline && referenceMatchesPhrase(referenceText, fullBaseline)) return "baseline";
  if (fullOther && referenceMatchesPhrase(referenceText, fullOther)) return "other";
  return "unclear";
}

const kindLabel = {
  substitution: "sub",
  insertion: "ins",
  deletion: "del",
} as const;

export function ProviderDisagreements({
  jobs,
  referenceText,
  maxPerProvider = 20,
}: ProviderDisagreementsProps) {
  const comparisons = useMemo(() => {
    const baseline = jobs.find(
      (j) =>
        j.provider === REFERENCE_PROVIDER && j.status === "completed" && j.transcript?.trim(),
    );
    if (!baseline?.transcript) return [];

    const others = jobs.filter(
      (j) =>
        j.provider !== REFERENCE_PROVIDER && j.status === "completed" && j.transcript?.trim(),
    );

    return others.map((job) => {
      const groups = findDisagreementGroups(baseline.transcript!, job.transcript!);
      const wer = computeWordErrorRate(baseline.transcript!, job.transcript!);
      const items = groups.slice(0, maxPerProvider).map((group) => {
        const formatted = formatDisagreementGroup(group);
        const refChoice = referenceText.trim()
          ? refPick(referenceText, group, formatted)
          : "unclear";
        return { group, formatted, refChoice };
      });
      return {
        label: `${job.provider} / ${job.model}`,
        total: groups.length,
        werPercent: wer.werPercent,
        items,
      };
    });
  }, [jobs, referenceText, maxPerProvider]);

  if (!comparisons.length) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <GitCompare className="h-5 w-5 text-amber-400" />
          Provider disagreements
        </CardTitle>
        <CardDescription>
          Words where {baselineLabel} and another provider differ (same normalization as WER).
          Listen here first when editing your reference.
        </CardDescription>
      </CardHeader>
      <div className="space-y-4 px-4 pb-4">
        {comparisons.map((comparison) => (
          <div
            key={comparison.label}
            className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4"
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <p className="font-medium text-white">vs {comparison.label}</p>
              <Badge variant="processing">{comparison.total} disagreements</Badge>
              <Badge variant="pending">{comparison.werPercent}% word diff</Badge>
            </div>
            {comparison.items.length === 0 ? (
              <p className="text-sm text-zinc-500">No disagreements found.</p>
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {comparison.items.map((item, index) => (
                  <div
                    key={`${comparison.label}-${index}`}
                    className="rounded-lg border border-white/5 bg-black/20 px-3 py-2 text-sm"
                  >
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <Badge variant="pending">{kindLabel[item.formatted.kind]}</Badge>
                      {referenceText.trim() && (
                        <span
                          className={`text-xs ${
                            item.refChoice === "unclear"
                              ? "text-amber-300"
                              : item.refChoice === "baseline"
                                ? "text-sky-300"
                                : "text-violet-300"
                          }`}
                        >
                          {item.refChoice === "baseline"
                            ? `Your ref matches ${baselineLabel}`
                            : item.refChoice === "other"
                              ? `Your ref matches ${comparison.label.split("/")[0]?.trim()}`
                              : "Check audio — ref unclear here"}
                        </span>
                      )}
                    </div>
                    {item.formatted.context && (
                      <p className="mb-1 text-xs text-zinc-500">…{item.formatted.context}…</p>
                    )}
                    <p className="text-sky-200">
                      <span className="text-zinc-500">{baselineLabel}:</span>{" "}
                      {item.formatted.deepgram}
                    </p>
                    <p className="text-violet-200">
                      <span className="text-zinc-500">{comparison.label}:</span>{" "}
                      {item.formatted.other}
                    </p>
                  </div>
                ))}
                {comparison.total > comparison.items.length && (
                  <p className="text-xs text-zinc-500">
                    Showing first {comparison.items.length} of {comparison.total} disagreements.
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
