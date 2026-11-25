import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseConfig } from '../src/config.ts';
import { createFeedServer } from '../src/serve.ts';
import { rangeFor, syncAll } from '../src/sync.ts';
import { createUntisClient, UntisError } from '../src/untis.ts';

const config = parseConfig(
	JSON.stringify({
		children: [
			{ name: 'anna', title: 'Anna', server: 's', school: 'x', userEnv: 'U', passwordEnv: 'P' },
			{ name: 'ben', title: 'Ben', server: 's', school: 'x', userEnv: 'U', passwordEnv: 'P' },
		],
	}),
);

test('a guardian login reads the timetable of the linked student', async () => {
	const paths: string[] = [];
	const server = createServer((req, res) => {
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => {
			const url = new URL(req.url ?? '', 'http://x');
			paths.push(url.pathname);
			if (url.pathname.endsWith('/jsonrpc.do')) {
				const { method } = JSON.parse(body);
				res.end(JSON.stringify({ result: method === 'authenticate' ? { sessionId: 'abc', personType: 12 } : {} }));
			} else if (url.pathname.endsWith('/token/new')) res.end('tok');
			else if (url.pathname.endsWith('/app/data'))
				res.end(JSON.stringify({ user: { person: { id: 1 }, students: [{ id: 42 }] } }));
			else {
				assert.equal(req.headers.authorization, 'Bearer tok');
				assert.equal(url.searchParams.get('resources'), '42');
				assert.equal(url.searchParams.get('start'), '2026-11-23');
				res.end(
					JSON.stringify({
						days: [
							{
								date: '2026-11-25',
								status: 'REGULAR',
								gridEntries: [
									{
										ids: [7],
										status: 'CANCELLED',
										duration: { start: '2026-11-25T07:45', end: '2026-11-25T08:30' },
										position1: [{ current: { type: 'SUBJECT', status: 'REGULAR', shortName: 'BIO', longName: 'Biologie' } }],
									},
								],
							},
						],
					}),
				);
			}
		});
	});
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const client = createUntisClient({ server: 's', school: 'my school', user: 'u', password: 'p' }, { baseUrl });
	const lessons = await client.timetable(20261123, 20261129);
	server.close();
	assert.deepEqual(lessons, [
		{
			id: 7,
			date: 20261125,
			startTime: 745,
			endTime: 830,
			code: 'cancelled',
			su: [{ name: 'BIO', longname: 'Biologie' }],
			te: [],
			ro: [],
		},
	]);
	assert.ok(paths.at(-1)?.endsWith('/jsonrpc.do'), 'signs out last');
});

test('turns an Untis error into an UntisError', async () => {
	const fetcher = async () => new Response(JSON.stringify({ error: { code: -8504, message: 'bad credentials' } }));
	const client = createUntisClient({ server: 's', school: 'x', user: 'u', password: 'p' }, { fetcher: fetcher as typeof fetch });
	await assert.rejects(client.timetable(1, 2), (e: unknown) => e instanceof UntisError && e.code === -8504);
});

test('the range runs from a Monday to a Sunday', () => {
	// Wednesday 25 November 2026.
	const { start, end } = rangeFor('Europe/Berlin', Date.UTC(2026, 10, 25, 10), 1, 4);
	assert.equal(start, 20261116);
	assert.equal(end, 20261227);
});

test('a failing child keeps its last good file and does not stop the others', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'untis-ics-'));
	try {
		await writeFile(join(dir, 'anna.ics'), 'OLD');
		const result = await syncAll(
			config,
			dir,
			async (child) => {
				if (child.name === 'anna') throw new Error('server down');
				return [{ id: 1, date: 20261125, startTime: 800, endTime: 845, su: [{ name: 'Ma' }] }];
			},
			Date.UTC(2026, 10, 25, 10),
			() => {},
		);
		assert.deepEqual(result, { ok: ['ben'], failed: ['anna'] });
		assert.equal(await readFile(join(dir, 'anna.ics'), 'utf8'), 'OLD');
		assert.match(await readFile(join(dir, 'ben.ics'), 'utf8'), /SUMMARY:Ma/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test('serves only .ics files, and only under the token when one is set', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'untis-ics-'));
	await writeFile(join(dir, 'anna.ics'), 'BEGIN:VCALENDAR');
	await writeFile(join(dir, 'secret.txt'), 'no');
	const server = createFeedServer(dir, 'tok');
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	try {
		const ok = await fetch(`${base}/tok/anna.ics`);
		assert.equal(ok.status, 200);
		assert.equal(ok.headers.get('content-type'), 'text/calendar; charset=utf-8');
		assert.equal((await fetch(`${base}/anna.ics`)).status, 404);
		assert.equal((await fetch(`${base}/wrong/anna.ics`)).status, 404);
		assert.equal((await fetch(`${base}/tok/secret.txt`)).status, 404);
		assert.equal((await fetch(`${base}/tok/..%2Fsecret.txt`)).status, 404);
	} finally {
		server.close();
		await rm(dir, { recursive: true, force: true });
	}
});
