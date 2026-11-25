import { loadConfig } from './config.ts';
import { createFeedServer } from './serve.ts';
import { fetchFromUntis, syncAll } from './sync.ts';

const config = loadConfig(process.env.CONFIG ?? 'config.json');
const outDir = process.env.OUT_DIR ?? 'public';
const fetchLessons = fetchFromUntis(process.env);

const run = () => syncAll(config, outDir, fetchLessons);

if (process.argv.includes('--once')) {
	const { failed } = await run();
	process.exit(failed.length > 0 ? 1 : 0);
}

await run();
setInterval(() => void run(), config.refreshMinutes * 60_000).unref();

const token = process.env.FEED_TOKEN || undefined;
const port = Number(process.env.PORT ?? 8080);
createFeedServer(outDir, token).listen(port, () => {
	console.log(`Serving the feeds on port ${port}${token ? ' (with a token in the address)' : ''}`);
});
