/**
 * A minimal WebUntis client. It signs in over JSON-RPC (works for students and legal guardians),
 * then reads the timetable from the REST interface the WebUntis web app itself uses. A guardian
 * has no timetable of their own, so the timetable is that of a linked student.
 */

export interface UntisCredentials {
	server: string;
	school: string;
	user: string;
	password: string;
	/** Which linked student to read; needed only when a login has more than one. */
	studentId?: number;
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

interface AppData {
	user?: { person?: { id: number }; students?: { id: number }[] };
}

interface Position {
	current?: { type: string; status: string; shortName?: string; longName?: string };
}

interface GridEntry {
	ids: number[];
	duration: { start: string; end: string };
	status: string;
	position1?: Position[] | null;
	position2?: Position[] | null;
	position3?: Position[] | null;
	lessonText?: string;
	substitutionText?: string;
}

interface TimetableResponse {
	days?: { date: string; status: string; gridEntries?: GridEntry[] }[];
	errors?: unknown[];
}

const isoDate = (n: number) =>
	`${Math.floor(n / 10_000)}-${String(Math.floor(n / 100) % 100).padStart(2, '0')}-${String(n % 100).padStart(2, '0')}`;

/** `2026-11-25T07:45` to `745`. */
const hhmm = (iso: string) => Number(iso.slice(11, 13)) * 100 + Number(iso.slice(14, 16));

/** Turns the entries of the web app's timetable into lessons. */
export function toLessons(response: TimetableResponse): UntisLesson[] {
	const lessons: UntisLesson[] = [];
	for (const day of response.days ?? []) {
		for (const entry of day.gridEntries ?? []) {
			const elements = (positions?: Position[] | null) =>
				(positions ?? []).flatMap((p) =>
					p.current?.shortName
						? [{ name: p.current.shortName, ...(p.current.longName && { longname: p.current.longName }) }]
						: [],
				);
			const all = [entry.position1, entry.position2, entry.position3].flatMap((p) => p ?? []);
			const changed = entry.status === 'CHANGED' || all.some((p) => p.current && p.current.status !== 'REGULAR');
			const code = entry.status === 'CANCELLED' ? 'cancelled' : changed ? 'irregular' : undefined;
			lessons.push({
				id: entry.ids[0] ?? 0,
				date: Number(day.date.replaceAll('-', '')),
				startTime: hhmm(entry.duration.start),
				endTime: hhmm(entry.duration.end),
				...(code && { code }),
				su: elements(entry.position1),
				te: elements(entry.position2),
				ro: elements(entry.position3),
				...(entry.lessonText && { lstext: entry.lessonText }),
				...(entry.substitutionText && { substText: entry.substitutionText }),
			});
		}
	}
	return lessons;
}

/** `baseUrl` is only for tests; it defaults to `https://<server>`. */
export function createUntisClient(
	credentials: UntisCredentials,
	options: { baseUrl?: string; fetcher?: typeof fetch; timeoutMs?: number } = {},
) {
	const fetcher = options.fetcher ?? fetch;
	const base = `${options.baseUrl ?? `https://${credentials.server}`}/WebUntis`;
	const school = encodeURIComponent(credentials.school);
	let cookie = '';
	let nextId = 1;

	const call = async (url: string, init: RequestInit = {}): Promise<Response> => {
		const response = await fetcher(url, {
			...init,
			headers: { ...(cookie && { cookie }), ...(init.headers as Record<string, string>) },
			signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
		});
		if (!response.ok) throw new UntisError(`${new URL(url).pathname}: HTTP ${response.status}`);
		return response;
	};

	async function rpc<T>(method: string, params: unknown): Promise<T> {
		const response = await call(`${base}/jsonrpc.do?school=${school}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id: String(nextId++), method, params, jsonrpc: '2.0' }),
		});
		const body = (await response.json()) as RpcResponse<T>;
		if (body.error) throw new UntisError(`${method}: ${body.error.message}`, body.error.code);
		if (body.result === undefined) throw new UntisError(`${method}: no result`);
		return body.result;
	}

	return {
		/** Reads the lessons from `start` to `end` (both `YYYYMMDD`, inclusive). */
		async timetable(start: number, end: number): Promise<UntisLesson[]> {
			const session = await rpc<{ sessionId: string }>('authenticate', {
				user: credentials.user,
				password: credentials.password,
				client: 'untis-ics',
			});
			const schoolCookie = Buffer.from(`_${Buffer.from(credentials.school).toString('base64')}`).toString('base64');
			cookie = `JSESSIONID=${session.sessionId}; schoolname=${schoolCookie}`;
			try {
				const token = (await (await call(`${base}/api/token/new`)).text()).trim();
				const auth = { authorization: `Bearer ${token}` };
				const data = (await (await call(`${base}/api/rest/view/v1/app/data`, { headers: auth })).json()) as AppData;
				// A guardian lists the linked students; a student has only themselves.
				const user = data.user;
				const students = user?.students?.length ? user.students : user?.person ? [user.person] : [];
				const student =
					credentials.studentId === undefined
						? students.length === 1
							? students[0]
							: undefined
						: students.find((s) => s.id === credentials.studentId);
				if (!student)
					throw new UntisError(
						`cannot pick a student: set "studentId" to one of ${students.map((s) => s.id).join(', ') || '(none)'}`,
					);
				const query = new URLSearchParams({
					start: isoDate(start),
					end: isoDate(end),
					format: '1',
					resourceType: 'STUDENT',
					resources: String(student.id),
				});
				const response = await call(`${base}/api/rest/view/v1/timetable/entries?${query}`, { headers: auth });
				return toLessons((await response.json()) as TimetableResponse);
			} finally {
				// Signing out is a courtesy; a failure must not hide the timetable.
				await rpc('logout', {}).catch(() => {});
			}
		},
	};
}
