/** A minimal client for the FamilyOS public API: add, change, finish and read tasks. */

export interface TaskInput {
	title: string;
	/** `YYYY-MM-DD`. */
	dueDate: string;
	notes: string;
	/** The member who should do it. */
	assigneeId?: string;
}

export class FamosError extends Error {
	readonly status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = 'FamosError';
		this.status = status;
	}
}

export function createFamosClient(
	options: { url: string; key: string; fetcher?: typeof fetch; timeoutMs?: number },
) {
	const fetcher = options.fetcher ?? fetch;
	const base = `${options.url.replace(/\/+$/, '')}/api/public/v1`;

	async function request(method: string, path: string, body?: unknown, onBehalfOf?: string): Promise<unknown> {
		const response = await fetcher(`${base}${path}`, {
			method,
			headers: {
				authorization: `Bearer ${options.key}`,
				...(body !== undefined && { 'content-type': 'application/json' }),
				...(onBehalfOf && { 'x-familyos-on-behalf-of': onBehalfOf }),
			},
			...(body !== undefined && { body: JSON.stringify(body) }),
			signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
		});
		// Only the status: the answer may hold the family's data.
		if (!response.ok) throw new FamosError(`${method} ${path}: HTTP ${response.status}`, response.status);
		const text = await response.text();
		return text ? JSON.parse(text) : {};
	}

	return {
		/** Adds a task and returns its id. */
		async addTask(task: TaskInput): Promise<string> {
			const body = (await request('POST', '/lists/tasks', task, task.assigneeId)) as {
				status?: string;
				result?: { id?: string };
			};
			// A key in "wait for a person" mode only drafts: there is no task to track yet.
			if (body.status !== 'applied') throw new FamosError(`POST /lists/tasks: ${body.status ?? 'not applied'}`, 0);
			const id = body.result?.id;
			if (!id) throw new FamosError('POST /lists/tasks: no id in the answer', 0);
			return id;
		},
		async changeTask(id: string, task: Omit<TaskInput, 'assigneeId'>, onBehalfOf?: string): Promise<void> {
			await request('PATCH', `/lists/tasks/${encodeURIComponent(id)}`, task, onBehalfOf);
		},
		async completeTask(id: string, onBehalfOf?: string): Promise<void> {
			await request('POST', `/lists/tasks/${encodeURIComponent(id)}/complete`, undefined, onBehalfOf);
		},
		async deleteTask(id: string, onBehalfOf?: string): Promise<void> {
			await request('DELETE', `/lists/tasks/${encodeURIComponent(id)}`, undefined, onBehalfOf);
		},
	};
}

export type FamosClient = ReturnType<typeof createFamosClient>;
