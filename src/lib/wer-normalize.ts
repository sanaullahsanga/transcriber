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
