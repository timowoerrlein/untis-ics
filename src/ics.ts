import type { UntisLesson } from './untis.ts';

export interface IcsOptions {
	/** The school's IANA time zone, e.g. `Europe/Berlin`. */
	timezone: string;
	labels: { cancelled: string; changed: string };
	/** The calendar's name, shown by calendar apps. */
	title: string;
	/** When the feed was made (epoch ms); a parameter so the output is reproducible. */
	now: number;
}

/** Escapes a text value: backslash, semicolon, comma and line breaks. */
export const escapeText = (text: string): string =>
	text.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n|\r/g, '\\n');

/** Folds a line to at most 75 octets, continuing with a space, as the standard asks. */
export function fold(line: string): string {
	const out: string[] = [];
	let current = '';
	let size = 0;
	for (const ch of line) {
		const bytes = Buffer.byteLength(ch);
		// The first line holds 75 octets, a continuation 74 (its leading space counts).
		if (size + bytes > (out.length === 0 ? 75 : 74)) {
			out.push(current);
			current = '';
			size = 0;
		}
		current += ch;
		size += bytes;
	}
	out.push(current);
	return out.join('\r\n ');
}

/** The UTC offset in minutes of a time zone at an instant. */
function offsetMinutes(timezone: string, at: number): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: timezone,
		hourCycle: 'h23',
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		hour: 'numeric',
		minute: 'numeric',
		second: 'numeric',
	}).formatToParts(new Date(at));
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
	const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
	return Math.round((asUtc - Math.floor(at / 1000) * 1000) / 60_000);
}

/** The instant (epoch ms) of a wall-clock time in a time zone. */
export function zonedToEpoch(
	timezone: string,
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
): number {
	const guess = Date.UTC(year, month - 1, day, hour, minute);
	// The offset at the wanted instant differs from the one at the guess only around a change of
	// clocks, so a second pass settles it.
	let epoch = guess - offsetMinutes(timezone, guess) * 60_000;
	epoch = guess - offsetMinutes(timezone, epoch) * 60_000;
	return epoch;
}

const stamp = (epoch: number) => new Date(epoch).toISOString().replace(/[-:]|\.\d{3}/g, '');
const names = (list?: { name: string; longname?: string }[]) =>
	(list ?? []).map((e) => e.name).filter(Boolean);

function lessonEpoch(timezone: string, date: number, time: number): number {
	const y = Math.floor(date / 10_000);
	const m = Math.floor(date / 100) % 100;
	const d = date % 100;
	return zonedToEpoch(timezone, y, m, d, Math.floor(time / 100), time % 100);
}

/** One lesson as a VEVENT, with its lines. */
function eventLines(lesson: UntisLesson, options: IcsOptions): string[] {
	const subject = names(lesson.su).join(', ') || lesson.lstext || '?';
	const cancelled = lesson.code === 'cancelled';
	const prefix = cancelled ? options.labels.cancelled : lesson.code === 'irregular' ? options.labels.changed : '';
	const teachers = names(lesson.te).join(', ');
	const rooms = names(lesson.ro).join(', ');
	const notes = [lesson.substText, lesson.lstext, teachers && `Lehrkraft: ${teachers}`]
		.filter((n, i, all) => n && all.indexOf(n) === i)
		.join('\n');
	const start = lessonEpoch(options.timezone, lesson.date, lesson.startTime);
	const end = lessonEpoch(options.timezone, lesson.date, lesson.endTime);
	return [
		'BEGIN:VEVENT',
		// Stable across runs, so a calendar app updates the lesson instead of adding another.
		`UID:untis-${lesson.id}-${lesson.date}-${lesson.startTime}@untis-ics`,
		`DTSTAMP:${stamp(options.now)}`,
		`DTSTART:${stamp(start)}`,
		`DTEND:${stamp(end)}`,
		`SUMMARY:${escapeText(prefix + subject)}`,
		...(rooms ? [`LOCATION:${escapeText(rooms)}`] : []),
		...(notes ? [`DESCRIPTION:${escapeText(notes)}`] : []),
		...(cancelled ? ['STATUS:CANCELLED'] : []),
		'END:VEVENT',
	];
}

/** A whole calendar, lines ended with CRLF as the standard says. */
export function buildIcs(lessons: UntisLesson[], options: IcsOptions): string {
	const sorted = lessons.toSorted((a, b) => a.date - b.date || a.startTime - b.startTime || a.id - b.id);
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//untis-ics//DE',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		`X-WR-CALNAME:${escapeText(options.title)}`,
		`X-WR-TIMEZONE:${options.timezone}`,
		...sorted.flatMap((lesson) => eventLines(lesson, options)),
		'END:VCALENDAR',
	];
	return `${lines.map(fold).join('\r\n')}\r\n`;
}
