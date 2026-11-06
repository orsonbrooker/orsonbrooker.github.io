// Checking a game sent to the leaderboard, without the database: whether it hangs together by the
// game's own rules (shared/rules.js), and whether anything about it looks odd. index.ts does the parts
// that need the server (the start token's signature and age, the robot check, the database).
// Tests: worker/test/scoring.test.ts.
//
//   rejected  impossible: the score doesn't match its shots, bonus balls the token didn't give, more
//             shots than fit in a game, shots too close together. A sudden death game must end on its
//             first miss, with nothing made after it. An around the world time must come just after
//             its last spot went in.
//   flagged   odd but possible: machine-like timing, a huge jump on the device's best. On the board
//             straight away, and in the admin inbox to check.

import { AROUND_SPOTS, GAME_SECONDS, MIN_SHOT_GAP, ballKind, recountScore } from "../../shared/rules.js";
import type { Mode, Shot } from "../../shared/rules.js";
import { HttpError } from "./http.ts";

/** A checked game: its tidied shot log, and what the token check needs. */
export type CheckedGame = {
	shots: Shot[];
	gaps: number[];
	made: number;
	/** The game can't have started less than this many seconds before it was sent. */
	minSeconds: number;
};

/**
 * Checks a game's shot log and score against the rules. Throws an HttpError (400) for anything
 * impossible.
 */
export function checkGame(mode: Mode, score: number, rawShots: unknown, token: unknown): CheckedGame {
	const raw = Array.isArray(rawShots) ? rawShots : [];
	if (raw.length > (mode === "timed" ? 80 : 500)) throw new HttpError(400, "That's more shots than fit in a game.");
	const shots: Shot[] = raw.map((s: unknown, i: number) => {
		if (!Array.isArray(s) || (s.length !== 4 && s.length !== 5) || !s.every((n) => typeof n === "number" && Number.isFinite(n))) throw new HttpError(400, "Bad shot log.");
		// A bonus ball only counts if this game's token really gave that shot one.
		const kind = s[4] ?? 0;
		if (kind !== 0 && kind !== ballKind(String(token), i)) throw new HttpError(400, "Bad shot log.");
		return [Math.round(s[0] * 100) / 100, s[1] ? 1 : 0, s[2] ? 1 : 0, Math.round(s[3] * 1000) / 1000, kind];
	});

	if (mode === "around") {
		// The time: once the last spot goes in, just after that shot was let go. No bonus balls here.
		const lastSpot = shots.reduce((found, s, i) => (found.made < AROUND_SPOTS && s[2] ? { made: found.made + 1, at: i } : found), { made: 0, at: -1 });
		const seconds = score / 10;
		if (!Number.isInteger(score) || lastSpot.made < AROUND_SPOTS || shots.some((s) => s[4]) || seconds < shots[lastSpot.at][0] || seconds > shots[lastSpot.at][0] + 5)
			throw new HttpError(400, "That time doesn't match its shots.");
	} else if (!Number.isInteger(score) || score < 1 || score !== recountScore(shots)) throw new HttpError(400, "That score doesn't match its shots.");

	const times = shots.map((s) => s[0]);
	const maxTime = mode === "timed" ? GAME_SECONDS + 0.5 : 6 * 3600;
	if (times.some((t, i) => t < 0 || t > maxTime || (i > 0 && t < times[i - 1]))) throw new HttpError(400, "Bad shot log.");
	if (mode === "survival") {
		// It ends on the first miss. A shot already in the air then doesn't count, so nothing after it is made.
		const miss = shots.findIndex((s) => !s[2]);
		if (miss < 0 || shots.slice(miss).some((s) => s[2])) throw new HttpError(400, "A sudden death game ends on its first miss.");
	}
	const gaps = times.slice(1).map((t, i) => t - times[i]);
	if (gaps.some((g) => g < MIN_SHOT_GAP)) throw new HttpError(400, "Those shots came too quickly.");

	const minSeconds = mode === "timed" ? GAME_SECONDS - 1 : Math.max(times.at(-1) ?? 0, mode === "around" ? score / 10 : 0) - 1;
	return { shots, gaps, made: shots.filter((s) => s[2]).length, minSeconds };
}

const spread = (values: number[]) => {
	const mean = values.reduce((a, b) => a + b, 0) / values.length;
	return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
};

/**
 * Reasons a possible game looks odd, for the admin to check. `pastBest` is this device's best in the
 * mode before this game (null for none).
 */
export function oddFlags(mode: Mode, score: number, game: CheckedGame, pastBest: number | null): string[] {
	const { shots, gaps, made } = game;
	const flags: string[] = [];
	if (shots.length >= 10 && spread(shots.map((s) => s[3])) < 0.03) flags.push("Every release timed the same, like a script");
	if (gaps.length >= 9 && spread(gaps) < 0.05) flags.push("Shots taken at a machine-like steady rhythm");
	// A perfect game isn't odd on its own: good players often make all 30+ (fire widens the green
	// zone). In sudden death every shot but the last goes in, so only a very long run is odd.
	if (mode === "survival" && made >= 50) flags.push(`${made} in a row before missing`);
	const best = pastBest ?? 0;
	if (mode === "around") {
		if (best > 0 && score * 2 < best) flags.push(`Twice as fast as this device's best (${best / 10}s)`);
	} else if (best >= 10 && score > best * 2.5) flags.push(`${Math.round(score / best)}x this device's best (${best})`);
	return flags;
}
