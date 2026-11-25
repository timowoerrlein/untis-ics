import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChildConfig, Config } from './config.ts';
import { buildIcs } from './ics.ts';
import { createUntisClient, type UntisHomework, type UntisLesson } from './untis.ts';

/** Today's date in a time zone as `YYYY-MM-DD`. */
export function todayIn(timezone: string, now: number): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(now));
}

const toNumber = (date: Date) =>
	date.getUTCFullYear() * 10_000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();

/** The Monday of the week `weeksBehind` ago to the Sunday `weeksAhead` ahead, as `YYYYMMDD`. */
export function rangeFor(timezone: string, now: number, weeksBehind: number, weeksAhead: number) {
	const [y, m, d] = todayIn(timezone, now).split('-').map(Number) as [number, number, number];
	const today = new Date(Date.UTC(y, m - 1, d));
	const sinceMonday = (today.getUTCDay() + 6) % 7;
	const start = new Date(today.getTime() - (sinceMonday + weeksBehind * 7) * 86_400_000);
	const end = new Date(today.getTime() + ((6 - sinceMonday) + weeksAhead * 7) * 86_400_000);
	return { start: toNumber(start), end: toNumber(end) };
}

export interface Fetcher {
	(child: ChildConfig, start: number, end: number): Promise<UntisLesson[]>;
}

/** Reads a child's homework with the same login. */
export const fetchHomeworkFromUntis =
	(env: NodeJS.ProcessEnv) =>
	async (child: ChildConfig, start: number, end: number): Promise<UntisHomework[]> => {
		const user = env[child.userEnv];
		const password = env[child.passwordEnv];
		if (!user || !password) throw new Error(`${child.userEnv} and ${child.passwordEnv} must be set`);
		const client = createUntisClient({
			server: child.server,
			school: child.school,
			user,
			password,
			...(child.studentId !== undefined && { studentId: child.studentId }),
		});
		return client.homework(start, end);
	};

/** Reads a child's lessons from WebUntis with the login named in the environment. */
export const fetchFromUntis =
	(env: NodeJS.ProcessEnv): Fetcher =>
	async (child, start, end) => {
		const user = env[child.userEnv];
		const password = env[child.passwordEnv];
		if (!user || !password) throw new Error(`${child.userEnv} and ${child.passwordEnv} must be set`);
		const client = createUntisClient({ server: child.server, school: child.school, user, password, ...(child.studentId !== undefined && { studentId: child.studentId }) });
		return client.timetable(start, end);
	};

/**
 * Makes every child's feed. A child whose fetch fails keeps the file of the last good run, so
 * a calendar app never sees an empty timetable because the school's server was down.
 */
export async function syncAll(
	config: Config,
	outDir: string,
	fetchLessons: Fetcher,
	now: number = Date.now(),
	log: (message: string) => void = console.log,
): Promise<{ ok: string[]; failed: string[] }> {
	await mkdir(outDir, { recursive: true });
	const { start, end } = rangeFor(config.timezone, now, config.weeksBehind, config.weeksAhead);
	const ok: string[] = [];
	const failed: string[] = [];
	for (const child of config.children) {
		try {
			const lessons = await fetchLessons(child, start, end);
			const ics = buildIcs(lessons, {
				timezone: config.timezone,
				labels: config.labels,
				title: child.title,
				now,
			});
			const target = join(outDir, `${child.name}.ics`);
			await writeFile(`${target}.tmp`, ics);
			await rename(`${target}.tmp`, target);
			ok.push(child.name);
			log(`${child.name}: ${lessons.length} lessons`);
		} catch (error) {
			failed.push(child.name);
			// Never the login or the response: only what went wrong.
			log(`${child.name}: failed (${error instanceof Error ? error.message : 'unknown error'})`);
		}
	}
	return { ok, failed };
}
