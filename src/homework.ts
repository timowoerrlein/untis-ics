import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChildConfig, Config } from './config.ts';
import { FamosError, type FamosClient } from './famos.ts';
import { todayIn } from './sync.ts';
import type { UntisHomework } from './untis.ts';

/** What is known of one homework in FamilyOS. */
interface Entry {
	taskId: string;
	/** What was last sent, to see a change. */
	hash: string;
	/** The task was finished in FamilyOS by us, or deleted there: leave it alone. */
	done?: boolean;
}

/** Per child, by Untis homework id. */
export type HomeworkState = Record<string, Record<string, Entry>>;

export interface HomeworkFetcher {
	(child: ChildConfig, start: number, end: number): Promise<UntisHomework[]>;
}

const STATE_FILE = 'homework-state.json';
const TITLE_LENGTH = 80;

export async function loadState(dir: string): Promise<HomeworkState> {
	try {
		return JSON.parse(await readFile(join(dir, STATE_FILE), 'utf8')) as HomeworkState;
	} catch {
		return {};
	}
}

async function saveState(dir: string, state: HomeworkState): Promise<void> {
	const target = join(dir, STATE_FILE);
	await writeFile(`${target}.tmp`, JSON.stringify(state, null, '\t'));
	await rename(`${target}.tmp`, target);
}

const isoDate = (n: number) =>
	`${Math.floor(n / 10_000)}-${String(Math.floor(n / 100) % 100).padStart(2, '0')}-${String(n % 100).padStart(2, '0')}`;

/** The task for a homework: `F: first line`, the full text as notes. */
export function taskFor(homework: UntisHomework, child: ChildConfig) {
	const firstLine = homework.text.split('\n')[0]?.trim() ?? '';
	const short = firstLine.length > TITLE_LENGTH ? `${firstLine.slice(0, TITLE_LENGTH - 1)}…` : firstLine;
	const subject = homework.subject ? `${homework.subject}: ` : '';
	// Without an assignee the task belongs to nobody, so the child's name says whose it is.
	const owner = child.famosMemberId ? '' : `${child.title}: `;
	return {
		title: `${owner}${subject}${short || 'Hausaufgabe'}`,
		dueDate: isoDate(homework.dueDate),
		notes: [homework.text, homework.remark].filter(Boolean).join('\n\n'),
	};
}

const hashOf = (task: { title: string; dueDate: string; notes: string }) => JSON.stringify(task);

/**
 * Puts the homework of every child with `"homework": true` into FamilyOS as tasks. A task is made
 * once, changed when the homework changes, and finished when Untis says it is done. What was
 * finished or deleted in FamilyOS is never made again. Only homework due today or later is made,
 * so the old homework Untis still lists as open does not fill the list.
 */
export async function syncHomework(
	config: Config,
	dir: string,
	fetchHomework: HomeworkFetcher,
	famos: FamosClient,
	now: number = Date.now(),
	log: (message: string) => void = console.log,
	dryRun = false,
): Promise<{ failed: string[] }> {
	const state = await loadState(dir);
	const failed: string[] = [];
	const today = Number(todayIn(config.timezone, now).replaceAll('-', ''));
	for (const child of config.children.filter((c) => c.homework)) {
		const known = (state[child.name] ??= {});
		let made = 0;
		let changed = 0;
		let finished = 0;
		try {
			// Given up to a month back can still be due; the far end covers what is announced early.
			const lessons = await fetchHomework(child, addDays(today, -30), addDays(today, 90));
			for (const homework of lessons) {
				const entry = known[homework.id];
				if (!entry && (homework.completed || homework.dueDate < today)) continue;
				const task = taskFor(homework, child);
				try {
					if (!entry) {
						if (dryRun) log(`${child.name}: would add "${task.title}" (${task.dueDate})`);
						else
							known[homework.id] = {
								taskId: await famos.addTask({ ...task, ...(child.famosMemberId && { assigneeId: child.famosMemberId }) }),
								hash: hashOf(task),
							};
						made++;
					} else if (!entry.done) {
						if (homework.completed) {
							if (!dryRun) {
								await famos.completeTask(entry.taskId, child.famosMemberId);
								entry.done = true;
							} else log(`${child.name}: would finish "${task.title}"`);
							finished++;
						} else if (entry.hash !== hashOf(task)) {
							if (!dryRun) {
								await famos.changeTask(entry.taskId, task, child.famosMemberId);
								entry.hash = hashOf(task);
							} else log(`${child.name}: would change "${task.title}"`);
							changed++;
						}
					}
				} catch (error) {
					// A task that is gone in FamilyOS stays gone: remember it, do not make it again.
					if (error instanceof FamosError && (error.status === 404 || error.status === 410) && entry) entry.done = true;
					else throw error;
				}
			}
			log(`${child.name}: homework ${made} new, ${changed} changed, ${finished} finished`);
		} catch (error) {
			failed.push(child.name);
			log(`${child.name}: homework failed (${error instanceof Error ? error.message : 'unknown error'})`);
		}
	}
	if (!dryRun) await saveState(dir, state);
	return { failed };
}

/** `YYYYMMDD` plus days. */
function addDays(date: number, days: number): number {
	const d = new Date(Date.UTC(Math.floor(date / 10_000), Math.floor(date / 100) % 100 - 1, date % 100 + days));
	return d.getUTCFullYear() * 10_000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}
