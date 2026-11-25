import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';

const FILE = /^[a-z0-9][a-z0-9_-]{0,40}\.ics$/;

/**
 * Serves the feeds. With a token the address is `/<token>/<name>.ics`, so it cannot be guessed;
 * anything else answers 404 and nothing but `.ics` files of the folder is ever read.
 */
export function createFeedServer(outDir: string, token?: string): Server {
	return createServer(async (request, response) => {
		const path = (request.url ?? '').split('?')[0] ?? '';
		const parts = path.split('/').filter(Boolean);
		const name = token ? (parts[0] === token && parts.length === 2 ? parts[1] : undefined) : parts.length === 1 ? parts[0] : undefined;
		if (request.method !== 'GET' || !name || !FILE.test(name)) {
			response.writeHead(404).end();
			return;
		}
		try {
			const body = await readFile(join(outDir, name));
			response.writeHead(200, {
				'content-type': 'text/calendar; charset=utf-8',
				'cache-control': 'no-store',
			});
			response.end(body);
		} catch {
			response.writeHead(404).end();
		}
	});
}
