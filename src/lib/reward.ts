/**
 * Reward display formatting — fixes the magnitude-truncation bug.
 *
 * The FBI writes reward_text two ways: digits ("$1,000,000", "$245,000") and
 * words ("up to $5 million"). The old extractor matched only /\$[\d,]+/, so
 * "up to $5 million" rendered as "UP TO $5" — wrong by six orders of magnitude.
 *
 * FAIL-SAFE RULE: if an amount can't be parsed unambiguously WITH its
 * magnitude, return "REWARD OFFERED" rather than a number. A vague label is
 * acceptable; a wrong dollar figure is not. Concretely: a bare dollar figure
 * under $1,000 with no following magnitude word is treated as a truncation
 * artifact, never displayed as-is.
 *
 * Pure and dependency-free — safe to import from both server and client code.
 * Test cases: scripts/test-reward.ts (runs before every build).
 */

const MAGNITUDE_RE = /\$\s*(\d[\d,]*(?:\.\d+)?)[\s-]*(million|billion)\b/i;
const DIGITS_RE = /\$\s*(\d[\d,]*(?:\.\d+)?)/;
// words-only phrasing without a dollar sign, e.g. "up to 5 million dollars"
const WORDS_RE = /\b(\d[\d,]*(?:\.\d+)?)[\s-]*(million|billion)\b[\s-]*(?:U\.?S\.?\s*)?dollars/i;

export function formatReward(rewardText: string | null | undefined): string {
  if (typeof rewardText !== "string" || rewardText.trim() === "") return "—";
  const text = rewardText.replace(/\s+/g, " ").trim();
  const upTo = /\bup\s+to\b/i.test(text) ? "UP TO " : "";

  // 1. "$5 million" / "$1.5 billion" — number + magnitude word (case-insensitive)
  const withMag = text.match(MAGNITUDE_RE);
  if (withMag) {
    return `${upTo}$${withMag[1]} ${withMag[2].toUpperCase()}`;
  }

  // 2. "5 million dollars" — magnitude word, dollar sign spelled out
  const words = text.match(WORDS_RE);
  if (words) {
    return `${upTo}$${words[1]} ${words[2].toUpperCase()}`;
  }

  // 3. Digit-form amount ("$1,000,000", "$245,000") — the magnitude is already
  //    in the digits. A tiny figure (< $1,000) with no magnitude word is far
  //    more likely a parse/truncation artifact than a real federal reward, so
  //    it falls through to the fail-safe label instead of displaying wrong.
  const digits = text.match(DIGITS_RE);
  if (digits) {
    const amount = Number(digits[1].replace(/,/g, ""));
    if (Number.isFinite(amount) && amount >= 1000) {
      return `${upTo}$${digits[1]}`;
    }
  }

  // 4. Reward text exists but no unambiguous amount — fail-safe label.
  return "REWARD OFFERED";
}
