import { tokenizeForWer } from "./wer";
import { normalizeNumberTokens, prepareTextForWer } from "./wer-normalize";

export type DisagreementKind = "substitution" | "insertion" | "deletion";

export type DisagreementGroup = {
  kind: DisagreementKind;
  deepgramWords: string[];
  otherWords: string[];
  contextBefore: string[];
  contextAfter: string[];
};

function getWerTokens(text: string): string[] {
  return normalizeNumberTokens(tokenizeForWer(prepareTextForWer(text)));
}

type EditOp =
  | { kind: "="; a: string; b: string }
  | { kind: "S"; a: string; b: string }
  | { kind: "D"; a: string }
  | { kind: "I"; b: string };

function alignEdits(tokensA: string[], tokensB: string[]): EditOp[] {
  const rows = tokensA.length + 1;
  const cols = tokensB.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  const ops: ("=" | "S" | "D" | "I")[][] = Array.from({ length: rows }, () =>
    Array(cols).fill("=" as const),
  );

  for (let i = 1; i < rows; i++) {
    dp[i]![0] = i;
    ops[i]![0] = "D";
  }
  for (let j = 1; j < cols; j++) {
    dp[0]![j] = j;
    ops[0]![j] = "I";
  }

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      if (tokensA[i - 1] === tokensB[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]!;
        ops[i]![j] = "=";
      } else {
        const sub = dp[i - 1]![j - 1]! + 1;
        const del = dp[i - 1]![j]! + 1;
        const ins = dp[i]![j - 1]! + 1;
        const min = Math.min(sub, del, ins);
        dp[i]![j] = min;
        if (min === sub) ops[i]![j] = "S";
        else if (min === del) ops[i]![j] = "D";
        else ops[i]![j] = "I";
      }
    }
  }

  const edits: EditOp[] = [];
  let i = tokensA.length;
  let j = tokensB.length;
  while (i > 0 || j > 0) {
    const op = ops[i]![j]!;
    if (op === "=") {
      edits.push({ kind: "=", a: tokensA[i - 1]!, b: tokensB[j - 1]! });
      i--;
      j--;
    } else if (op === "S") {
      edits.push({ kind: "S", a: tokensA[i - 1]!, b: tokensB[j - 1]! });
      i--;
      j--;
    } else if (op === "D") {
      edits.push({ kind: "D", a: tokensA[i - 1]! });
      i--;
    } else {
      edits.push({ kind: "I", b: tokensB[j - 1]! });
      j--;
    }
  }

  return edits.reverse();
}

function phrase(words: string[]): string {
  return words.join(" ");
}

/**
 * Find grouped word disagreements between two transcripts (same normalization as WER).
 */
export function findDisagreementGroups(
  deepgramText: string,
  otherText: string,
  contextWords = 3,
): DisagreementGroup[] {
  const tokensA = getWerTokens(deepgramText);
  const tokensB = getWerTokens(otherText);
  const edits = alignEdits(tokensA, tokensB);

  const groups: DisagreementGroup[] = [];
  let pendingDg: string[] = [];
  let pendingOther: string[] = [];
  let pendingKind: DisagreementKind | null = null;
  let matchBuffer: string[] = [];

  const flush = () => {
    if (!pendingKind || (!pendingDg.length && !pendingOther.length)) {
      pendingKind = null;
      pendingDg = [];
      pendingOther = [];
      return;
    }

    const contextBefore = matchBuffer.slice(-contextWords);
    groups.push({
      kind: pendingKind,
      deepgramWords: [...pendingDg],
      otherWords: [...pendingOther],
      contextBefore: [...contextBefore],
      contextAfter: [],
    });

    pendingKind = null;
    pendingDg = [];
    pendingOther = [];
  };

  const fillContextAfter = (groupIndex: number, words: string[]) => {
    const group = groups[groupIndex];
    if (group) group.contextAfter = words.slice(0, contextWords);
  };

  for (const edit of edits) {
    if (edit.kind === "=") {
      if (pendingKind) {
        flush();
        const lastIndex = groups.length - 1;
        if (lastIndex >= 0) fillContextAfter(lastIndex, [edit.a]);
      }
      matchBuffer.push(edit.a);
      if (groups.length > 0 && groups[groups.length - 1]!.contextAfter.length < contextWords) {
        const g = groups[groups.length - 1]!;
        if (g.contextAfter.length === 0) {
          g.contextAfter.push(edit.a);
        }
      }
      continue;
    }

    if (edit.kind === "S") {
      if (pendingKind && pendingKind !== "substitution") flush();
      pendingKind = "substitution";
      pendingDg.push(edit.a);
      pendingOther.push(edit.b);
    } else if (edit.kind === "D") {
      if (pendingKind && pendingKind !== "deletion") flush();
      pendingKind = "deletion";
      pendingDg.push(edit.a);
    } else {
      if (pendingKind && pendingKind !== "insertion") flush();
      pendingKind = "insertion";
      pendingOther.push(edit.b);
    }
  }

  flush();

  return groups;
}

export function formatDisagreementGroup(group: DisagreementGroup): {
  context: string;
  deepgram: string;
  other: string;
  kind: DisagreementKind;
} {
  const parts: string[] = [];
  if (group.contextBefore.length) parts.push(group.contextBefore.join(" "));
  if (group.contextAfter.length) parts.push(group.contextAfter.join(" "));
  const context = parts.join(" … ");

  let deepgram = phrase(group.deepgramWords);
  let other = phrase(group.otherWords);

  if (group.kind === "deletion") {
    other = "(missing)";
  } else if (group.kind === "insertion") {
    deepgram = "(missing)";
  }

  return { context, deepgram, other, kind: group.kind };
}

export function referenceMatchesPhrase(referenceText: string, phrase: string): boolean {
  const phraseWords = getWerTokens(phrase);
  if (!phraseWords.length) return false;
  const ref = getWerTokens(referenceText);
  if (ref.length < phraseWords.length) return false;

  for (let i = 0; i <= ref.length - phraseWords.length; i++) {
    let match = true;
    for (let j = 0; j < phraseWords.length; j++) {
      if (ref[i + j] !== phraseWords[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}
