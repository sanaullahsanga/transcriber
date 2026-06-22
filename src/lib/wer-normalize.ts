const DIGIT_WORD_TO_CHAR: Record<string, string> = {
  zero: "0",
  oh: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

const KNOWN_SPEAKER_LINE_RE =
  /^(Agent|Caller|Other|Unknown|Speaker\s+\d+):\s*(.+)$/i;
const NUMERIC_SPEAKER_LINE_RE = /^(\d+):\s*(.+)$/;

function parseSpeakerLine(line: string): { speaker: string; text: string } | null {
  const known = line.match(KNOWN_SPEAKER_LINE_RE);
  if (known) {
    return {
      speaker: known[1]!.toLowerCase(),
      text: known[2]!.trim(),
    };
  }

  const numeric = line.match(NUMERIC_SPEAKER_LINE_RE);
  if (numeric) {
    return {
      speaker: `speaker-${numeric[1]}`,
      text: numeric[2]!.trim(),
    };
  }

  return null;
}

function isSpeakerLine(line: string): boolean {
  return parseSpeakerLine(line) !== null;
}

/**
 * Strip speaker labels and merge consecutive same-speaker turns so WER
 * compares spoken words only, not diarization formatting differences.
 */
export function normalizeDialogueForWer(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const lines = trimmed.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const turns = lines.map((line) => parseSpeakerLine(line));
  const hasSpeakerLines = lines.some((line) => isSpeakerLine(line));

  if (!hasSpeakerLines) {
    return trimmed;
  }

  const merged: string[] = [];
  let currentSpeaker: string | null = null;
  let currentTexts: string[] = [];

  const flush = () => {
    if (!currentTexts.length) return;
    merged.push(currentTexts.join(" "));
    currentTexts = [];
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const turn = turns[index];

    if (!turn) {
      flush();
      currentSpeaker = null;
      merged.push(line);
      continue;
    }

    if (turn.speaker === currentSpeaker) {
      currentTexts.push(turn.text);
      continue;
    }

    flush();
    currentSpeaker = turn.speaker;
    currentTexts = [turn.text];
  }

  flush();
  return merged.join(" ");
}

function isDigitWord(token: string): boolean {
  return token in DIGIT_WORD_TO_CHAR;
}

function isDigitToken(token: string): boolean {
  return /^\d+$/.test(token);
}

function expandRunToDigits(run: string[]): string[] {
  const digits: string[] = [];
  for (const token of run) {
    if (isDigitToken(token)) {
      digits.push(...token.split(""));
      continue;
    }
    const digit = DIGIT_WORD_TO_CHAR[token];
    if (digit !== undefined) {
      digits.push(digit);
    }
  }
  return digits;
}

/**
 * Normalize digit strings and spoken digit sequences to single-character digit tokens.
 * Example: "1234" and "one two three four" both become ["1","2","3","4"].
 * Isolated number words (e.g. "one" in "one moment") are left unchanged.
 */
export function normalizeNumberTokens(tokens: string[]): string[] {
  const normalized: string[] = [];
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index]!;
    if (!isDigitToken(token) && !isDigitWord(token)) {
      normalized.push(token);
      index++;
      continue;
    }

    const run: string[] = [];
    while (index < tokens.length) {
      const current = tokens[index]!;
      if (!isDigitToken(current) && !isDigitWord(current)) break;
      run.push(current);
      index++;
    }

    if (run.length === 1 && isDigitWord(run[0]!)) {
      normalized.push(run[0]!);
      continue;
    }

    normalized.push(...expandRunToDigits(run));
  }

  return normalized;
}

export function prepareTextForWer(text: string): string {
  return normalizeDialogueForWer(text);
}
