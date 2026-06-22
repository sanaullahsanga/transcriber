import { normalizeNumberTokens, prepareTextForWer } from "./wer-normalize";

export type WerBreakdown = {
  substitutions: number;
  deletions: number;
  insertions: number;
  refWordCount: number;
  errorCount: number;
  wer: number;
  werPercent: number;
};

export function tokenizeForWer(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function computeWordErrorRate(reference: string, hypothesis: string): WerBreakdown {
  const ref = normalizeNumberTokens(tokenizeForWer(prepareTextForWer(reference)));
  const hyp = normalizeNumberTokens(tokenizeForWer(prepareTextForWer(hypothesis)));

  if (ref.length === 0) {
    return {
      substitutions: 0,
      deletions: 0,
      insertions: hyp.length,
      refWordCount: 0,
      errorCount: hyp.length,
      wer: hyp.length > 0 ? 1 : 0,
      werPercent: hyp.length > 0 ? 100 : 0,
    };
  }

  const rows = ref.length + 1;
  const cols = hyp.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  const ops: ("=" | "S" | "D" | "I")[][] = Array.from({ length: rows }, () =>
    Array(cols).fill("=" as const),
  );

  for (let i = 1; i < rows; i++) {
    dp[i][0] = i;
    ops[i][0] = "D";
  }
  for (let j = 1; j < cols; j++) {
    dp[0][j] = j;
    ops[0][j] = "I";
  }

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      if (ref[i - 1] === hyp[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
        ops[i][j] = "=";
      } else {
        const sub = dp[i - 1][j - 1] + 1;
        const del = dp[i - 1][j] + 1;
        const ins = dp[i][j - 1] + 1;
        const min = Math.min(sub, del, ins);
        dp[i][j] = min;
        if (min === sub) ops[i][j] = "S";
        else if (min === del) ops[i][j] = "D";
        else ops[i][j] = "I";
      }
    }
  }

  let i = ref.length;
  let j = hyp.length;
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;

  while (i > 0 || j > 0) {
    const op = ops[i][j];
    if (op === "=") {
      i--;
      j--;
    } else if (op === "S") {
      substitutions++;
      i--;
      j--;
    } else if (op === "D") {
      deletions++;
      i--;
    } else {
      insertions++;
      j--;
    }
  }

  const errorCount = substitutions + deletions + insertions;
  const wer = errorCount / ref.length;

  return {
    substitutions,
    deletions,
    insertions,
    refWordCount: ref.length,
    errorCount,
    wer,
    werPercent: Math.round(wer * 1000) / 10,
  };
}
