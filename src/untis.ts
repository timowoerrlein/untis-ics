/**
 * A minimal WebUntis client (the JSON-RPC interface every school server offers): sign in as a
 * student, read the timetable of a date range, sign out.
 */

export interface UntisCredentials {
	server: string;
	school: string;
	user: string;
	password: string;
}

/** A named thing of a lesson (subject, teacher, room, class). */
export interface UntisElement {
	name: string;
	longname?: string;
}

export interface UntisLesson {
	id: number;
	/** `YYYYMMDD`. */
	date: number;
	/** `HHMM` in the school's time zone, e.g. 745. */
	startTime: number;
	endTime: number;
	/** `cancelled` for a lesson that does not take place, `irregular` for a changed one. */
	code?: string;
	su?: UntisElement[];
	te?: UntisElement[];
	ro?: UntisElement[];
	lstext?: string;
	substText?: string;
}

export class UntisError extends Error {
	readonly code: number | undefined;
	constructor(message: string, code?: number) {
		super(message);
		this.name = 'UntisError';
		this.code = code;
	}
}

interface RpcResponse<T> {
	result?: T;
	error?: { code: number; message: string };
}

/** `baseUrl` is only for tests; it defaults to `https://<server>`. */
export function createUntisClient(
	credentials: UntisCredentials,
	options: { baseUrl?: string; fetcher?: typeof fetch; timeoutMs?: number } = {},
) {
	const fetcher = options.fetcher ?? fetch;
	const base = options.baseUrl ?? `https://${credentials.server}`;
	const url = `${base}/WebUntis/jsonrpc.do?school=${encodeURIComponent(credentials.school)}`;
	let cookie = '';
	let nextId = 1;

	async function rpc<T>(method: string, params: unknown): Promise<T> {
		const response = await fetcher(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...(cookie && { cookie }) },
			body: JSON.stringify({ id: String(nextId++), method, params, jsonrpc: '2.0' }),
			signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
		});
		if (!response.ok) throw new UntisError(`${method}: HTTP ${response.status}`);
		const body = (await response.json()) as RpcResponse<T>;
		if (body.error) throw new UntisError(`${method}: ${body.error.message}`, body.error.code);
		if (body.result === undefined) throw new UntisError(`${method}: no result`);
		return body.result;
	}

	return {
		/** Reads the lessons from `start` to `end` (both `YYYYMMDD`, inclusive). */
		async timetable(start: number, end: number): Promise<UntisLesson[]> {
			const session = await rpc<{ sessionId: string; personType: number; personId: number }>(
				'authenticate',
				{ user: credentials.user, password: credentials.password, client: 'untis-ics' },
			);
			cookie = `JSESSIONID=${session.sessionId}`;
			try {
				const fields = ['name', 'longname'];
				return await rpc<UntisLesson[]>('getTimetable', {
					options: {
						element: { id: session.personId, type: session.personType },
						startDate: start,
						endDate: end,
						showInfo: true,
						showSubstText: true,
						showLsText: true,
						showBooking: false,
						subjectFields: fields,
						teacherFields: fields,
						roomFields: fields,
					},
				});
			} finally {
				// Signing out is a courtesy; a failure must not hide the timetable.
				await rpc('logout', {}).catch(() => {});
			}
		},
	};
}
