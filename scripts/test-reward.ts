/**
 * Reward-parser assertions (spec section B). Runs before every `next build`
 * (see package.json "build") and exits non-zero on any failure, so a reward
 * display regression can never ship silently.
 *
 * Run directly: npx tsx scripts/test-reward.ts
 */
import { formatReward } from "../src/lib/reward";

const CASES: [input: string | null, expected: string][] = [
  // ---- required cases from the spec ----
  ["a reward of up to $5 million for information", "UP TO $5 MILLION"],
  ["up to $10 million", "UP TO $10 MILLION"],
  ["up to $1,000,000", "UP TO $1,000,000"],
  ["up to $150,000", "UP TO $150,000"],
  ["Reward offered", "REWARD OFFERED"],
  [null, "—"],
  ["", "—"],
  ["   ", "—"],

  // ---- live records that were rendering wrong on the site ----
  [
    "The Rewards For Justice Program, United States Department of State, is offering a reward of up to $5 million for information leading to the arrest or conviction of Ahlam Ahmad Al-Tamimi.",
    "UP TO $5 MILLION",
  ],
  [
    "The FBI is offering a reward of up to $3 million for information leading to the arrest and/or conviction of Evgeniy Mikhailovich Bogachev.",
    "UP TO $3 MILLION",
  ],
  [
    "The United States Department of State's Transnational Organized Crime Rewards Program is offering a reward of up to $5 million for information leading to the arrest and/or conviction of Maksim Viktorovich Yakubets.",
    "UP TO $5 MILLION",
  ],

  // ---- digit forms stay verbatim ----
  ["The FBI is offering a reward of up to $245,000 for information leading to an arrest.", "UP TO $245,000"],
  ["A reward of $10,000 is available.", "$10,000"],

  // ---- magnitude variants ----
  ["Up To $1.5 Million", "UP TO $1.5 MILLION"],
  ["a reward of up to $5 MILLION", "UP TO $5 MILLION"],
  ["up to 5 million dollars", "UP TO $5 MILLION"],
  ["a reward of up to $5-million for information", "UP TO $5 MILLION"],

  // ---- fail-safe: ambiguous / truncated amounts must NOT show a number ----
  ["up to $5", "REWARD OFFERED"],
  ["a substantial reward is available", "REWARD OFFERED"],
  ["Reward: contact your local FBI field office", "REWARD OFFERED"],
];

let failed = 0;
for (const [input, expected] of CASES) {
  const actual = formatReward(input);
  const ok = actual === expected;
  if (!ok) failed++;
  const label = input === null ? "null" : JSON.stringify(input.length > 60 ? input.slice(0, 57) + "..." : input);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`      expected ${JSON.stringify(expected)}  got ${JSON.stringify(actual)}`);
}

console.log(`\n${CASES.length - failed}/${CASES.length} reward parser cases passed`);
if (failed > 0) {
  console.error("Reward parser test FAILED — refusing to build with a broken reward display.");
  process.exit(1);
}
