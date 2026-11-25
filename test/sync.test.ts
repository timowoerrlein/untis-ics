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

test('reads the timetable through authenticate, getTimetable and logout', async () => {
	const calls: { method: string; cookie?: string; params: Record<string, unknown> }[] = [];
	const server = createServer((req, res) => {
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => {
			const { method, params } = JSON.parse(body);
			calls.push({ method, params, cookie: req.headers.cookie });
			const result =
				method === 'authenticate'
					? { sessionId: 'abc', personType: 5, personId: 42 }
					: method === 'getTimetable'
						? [{ id: 1, date: 20261125, startTime: 800, endTime: 845 }]
						: {};
			res.end(JSON.stringify({ result }));
		});
	});
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const client = createUntisClient({ server: 's', school: 'my school', user: 'u', password: 'p' }, { baseUrl });
	const lessons = await client.timetable(20261123, 20261129);
	server.close();
	assert.equal(lessons.length, 1);
	assert.deepEqual(calls.map((c) => c.method), ['authenticate', 'getTimetable', 'logout']);
	assert.equal(calls[1]?.cookie, 'JSESSIONID=abc');
	assert.deepEqual((calls[1]?.params as { options: { element: unknown } }).options.element, { id: 42, type: 5 });
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
