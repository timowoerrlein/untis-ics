import { loadConfig } from './config.ts';
import { createFamosClient } from './famos.ts';
import { syncHomework } from './homework.ts';
import { createFeedServer } from './serve.ts';
import { fetchFromUntis, fetchHomeworkFromUntis, syncAll } from './sync.ts';

const config = loadConfig(process.env.CONFIG ?? 'config.json');
const outDir = process.env.OUT_DIR ?? 'public';
const fetchLessons = fetchFromUntis(process.env);
const dryRun = process.argv.includes('--dry-run');

// Homework needs FamilyOS; without its address and key the feeds still work.
const wantsHomework = config.children.some((child) => child.homework);
const { FAMOS_URL: famosUrl, FAMOS_KEY: famosKey } = process.env;
if (wantsHomework && (!famosUrl || !famosKey)) console.log('Homework is switched on, but FAMOS_URL or FAMOS_KEY is missing: skipped');
const famos = wantsHomework && famosUrl && famosKey ? createFamosClient({ url: famosUrl, key: famosKey }) : undefined;

async function run(): Promise<boolean> {
	const feeds = await syncAll(config, outDir, fetchLessons);
	const homework = famos
		? await syncHomework(config, outDir, fetchHomeworkFromUntis(process.env), famos, Date.now(), console.log, dryRun)
		: { failed: [] };
	return feeds.failed.length === 0 && homework.failed.length === 0;
}

if (process.argv.includes('--once') || dryRun) process.exit((await run()) ? 0 : 1);

await run();
setInterval(() => void run(), config.refreshMinutes * 60_000).unref();

const token = process.env.FEED_TOKEN || undefined;
const port = Number(process.env.PORT ?? 8080);
createFeedServer(outDir, token).listen(port, () => {
	console.log(`Serving the feeds on port ${port}${token ? ' (with a token in the address)' : ''}`);
});
