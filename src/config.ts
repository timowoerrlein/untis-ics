import { readFileSync } from 'node:fs';

export interface ChildConfig {
	/** Used in the feed's address: `/<name>.ics`. */
	name: string;
	/** The calendar's name. */
	title: string;
	server: string;
	school: string;
	/** Names of the environment variables that hold the login. */
	userEnv: string;
	passwordEnv: string;
	/** Only for a login with several linked students (a parent login): which one. */
	studentId?: number;
}

export interface Config {
	timezone: string;
	weeksBehind: number;
	weeksAhead: number;
	refreshMinutes: number;
	labels: { cancelled: string; changed: string };
	children: ChildConfig[];
}

const NAME = /^[a-z0-9][a-z0-9_-]{0,40}$/;

export function parseConfig(text: string): Config {
	const raw = JSON.parse(text) as Partial<Config>;
	const children = raw.children ?? [];
	if (children.length === 0) throw new Error('config.json needs at least one child');
	for (const child of children) {
		if (!NAME.test(child.name ?? ''))
			throw new Error(`Child name "${child.name}" must be lowercase letters, digits, - or _`);
		for (const key of ['server', 'school', 'userEnv', 'passwordEnv', 'title'] as const)
			if (!child[key]) throw new Error(`Child "${child.name}" needs "${key}"`);
	}
	const names = children.map((c) => c.name);
	if (new Set(names).size !== names.length) throw new Error('Child names must be unique');
	return {
		timezone: raw.timezone ?? 'Europe/Berlin',
		weeksBehind: raw.weeksBehind ?? 1,
		weeksAhead: raw.weeksAhead ?? 4,
		refreshMinutes: raw.refreshMinutes ?? 60,
		labels: { cancelled: 'Entfällt: ', changed: 'Vertretung: ', ...raw.labels },
		children,
	};
}

export const loadConfig = (path = 'config.json'): Config => parseConfig(readFileSync(path, 'utf8'));
