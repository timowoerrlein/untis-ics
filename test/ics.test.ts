import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildIcs, escapeText, fold, zonedToEpoch } from '../src/ics.ts';
import type { UntisLesson } from '../src/untis.ts';

const options = {
	timezone: 'Europe/Berlin',
	labels: { cancelled: 'Entfällt: ', changed: 'Vertretung: ' },
	title: 'Anna',
	now: Date.UTC(2026, 10, 25, 12, 0, 0),
};
const lesson = (over: Partial<UntisLesson> = {}): UntisLesson => ({
	id: 7,
	date: 20261125,
	startTime: 800,
	endTime: 845,
	su: [{ name: 'Ma' }],
	te: [{ name: 'Mül' }],
	ro: [{ name: 'R12' }],
	...over,
});

test('converts school time to UTC, winter and summer', () => {
	assert.equal(new Date(zonedToEpoch('Europe/Berlin', 2026, 11, 25, 8, 0)).toISOString(), '2026-11-25T07:00:00.000Z');
	assert.equal(new Date(zonedToEpoch('Europe/Berlin', 2026, 7, 1, 8, 0)).toISOString(), '2026-07-01T06:00:00.000Z');
});

test('writes a calendar with CRLF line ends and UTC times', () => {
	const ics = buildIcs([lesson()], options);
	assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
	assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
	assert.ok(!/[^\r]\n/.test(ics), 'every line feed follows a carriage return');
	assert.match(ics, /DTSTART:20261125T070000Z\r\n/);
	assert.match(ics, /DTEND:20261125T074500Z\r\n/);
	assert.match(ics, /SUMMARY:Ma\r\n/);
	assert.match(ics, /LOCATION:R12\r\n/);
	assert.match(ics, /UID:untis-7-20261125-800@untis-ics\r\n/);
});

test('marks a cancelled lesson and labels a changed one', () => {
	const ics = buildIcs([lesson({ code: 'cancelled' }), lesson({ id: 8, startTime: 900, endTime: 945, code: 'irregular' })], options);
	assert.match(ics, /SUMMARY:Entfällt: Ma\r\n/);
	assert.match(ics, /STATUS:CANCELLED\r\n/);
	assert.match(ics, /SUMMARY:Vertretung: Ma\r\n/);
});

test('escapes text and folds long lines', () => {
	assert.equal(escapeText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
	const folded = fold(`SUMMARY:${'ä'.repeat(100)}`);
	for (const line of folded.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
	assert.equal(folded.split('\r\n').join('').replace(/ /g, ''), `SUMMARY:${'ä'.repeat(100)}`);
});

test('orders lessons by day and time', () => {
	const ics = buildIcs([lesson({ id: 2, startTime: 900, endTime: 945 }), lesson({ id: 1 })], options);
	assert.ok(ics.indexOf('untis-1-') < ics.indexOf('untis-2-'));
});
