import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseConfig } from '../src/config.ts';
import { FamosError, type FamosClient } from '../src/famos.ts';
import { syncHomework } from '../src/homework.ts';
import { toHomework, type UntisHomework } from '../src/untis.ts';

const config = parseConfig(
	JSON.stringify({
		children: [
			{
				name: 'anna', title: 'Anna', server: 's', school: 'x', userEnv: 'U', passwordEnv: 'P',
				homework: true, famosMemberId: 'member_a',
			},
			{ name: 'ben', title: 'Ben', server: 's', school: 'x', userEnv: 'U', passwordEnv: 'P' },
		],
	}),
);
// Wednesday 25 November 2026.
const now = Date.UTC(2026, 10, 25, 10);
const homework = (over: Partial<UntisHomework> = {}): UntisHomework => ({
	id: 1, subject: 'F', dueDate: 20261127, text: 'Carnet p. 20\nund mehr', remark: '', completed: false, ...over,
});

function fakeFamos() {
	const calls: string[] = [];
	const famos = {
		addTask: async (t: { title: string; assigneeId?: string }) => {
			calls.push(`add ${t.title} ${t.assigneeId}`);
			return `task_${calls.length}`;
		},
		changeTask: async (id: string, t: { title: string }) => void calls.push(`change ${id} ${t.title}`),
		completeTask: async (id: string) => void calls.push(`complete ${id}`),
		deleteTask: async () => {},
	} as FamosClient;
	return { calls, famos };
}

const withDir = async (run: (dir: string) => Promise<void>) => {
	const dir = await mkdtemp(join(tmpdir(), 'untis-ics-'));
	try {
		await run(dir);
	} finally {
		await rm(dir, { recursive: true });
	}
};

test('adds a task once, only for a child with homework on, and not for old homework', () =>
	withDir(async (dir) => {
		const { calls, famos } = fakeFamos();
		const lessons = [homework(), homework({ id: 2, dueDate: 20261120 }), homework({ id: 3, completed: true })];
		const fetcher = async () => lessons;
		await syncHomework(config, dir, fetcher, famos, now, () => {});
		await syncHomework(config, dir, fetcher, famos, now, () => {});
		assert.deepEqual(calls, ['add F: Carnet p. 20 member_a']);
	}));

test('changes a task when the homework changes and finishes it when Untis does', () =>
	withDir(async (dir) => {
		const { calls, famos } = fakeFamos();
		let current = homework();
		const fetcher = async () => [current];
		await syncHomework(config, dir, fetcher, famos, now, () => {});
		current = homework({ text: 'Neu' });
		await syncHomework(config, dir, fetcher, famos, now, () => {});
		current = homework({ text: 'Neu', completed: true });
		await syncHomework(config, dir, fetcher, famos, now, () => {});
		await syncHomework(config, dir, fetcher, famos, now, () => {});
		assert.deepEqual(calls, ['add F: Carnet p. 20 member_a', 'change task_1 F: Neu', 'complete task_1']);
	}));

test('does not make a task again that is gone in FamilyOS', () =>
	withDir(async (dir) => {
		const { calls, famos } = fakeFamos();
		famos.changeTask = async () => {
			throw new FamosError('gone', 404);
		};
		let current = homework();
		const fetcher = async () => [current];
		await syncHomework(config, dir, fetcher, famos, now, () => {});
		current = homework({ text: 'Neu' });
		const { failed } = await syncHomework(config, dir, fetcher, famos, now, () => {});
		await syncHomework(config, dir, fetcher, famos, now, () => {});
		assert.deepEqual(failed, []);
		assert.equal(calls.length, 1);
	}));

test('a dry run changes nothing and remembers nothing', () =>
	withDir(async (dir) => {
		const { calls, famos } = fakeFamos();
		const log: string[] = [];
		await syncHomework(config, dir, async () => [homework()], famos, now, (m) => log.push(m), true);
		assert.deepEqual(calls, []);
		assert.match(log[0] ?? '', /would add/);
		await syncHomework(config, dir, async () => [homework()], famos, now, () => {});
		assert.equal(calls.length, 1);
	}));

test('reads the subject of each homework from its lesson', () => {
	const result = toHomework({
		data: {
			homeworks: [{ id: 5, lessonId: 9, dueDate: 20261127, text: ' Aufgabe ', completed: false }],
			lessons: [{ id: 9, subject: 'MUS' }],
		},
	});
	assert.deepEqual(result, [{ id: 5, subject: 'MUS', dueDate: 20261127, text: 'Aufgabe', remark: '', completed: false }]);
});
