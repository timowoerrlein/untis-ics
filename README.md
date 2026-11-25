# untis-ics

Holt den WebUntis-Stundenplan von Kindern und stellt ihn als iCalendar-Feed bereit (ein Feed pro Kind).
Läuft unabhängig von FamilyOS; FamilyOS abonniert nur die Adresse.

- Keine Laufzeit-Abhängigkeiten, Node.js ≥ 24.
- Entfallene Stunden sind `STATUS:CANCELLED` (FamilyOS blendet sie aus), Vertretungen bekommen ein Präfix.
- Schlägt der Abruf fehl, bleibt die letzte gute Datei bestehen.

## Einrichten

```bash
cp config.example.json config.json   # Schule, Server und Kinder eintragen
cp .env.example .env                 # Logins und optional FEED_TOKEN eintragen
```

`server` und `school` stehen in der WebUntis-Adresse deiner Schule
(`https://<server>/WebUntis/?school=<school>`). Das Login ist das **Schüler-Login** des Kindes
oder das **Eltern-Login** (Erziehungsberechtigte).

### Eltern-Login mit mehreren Kindern

Hängt nur ein Kind am Login, ist nichts weiter nötig. Hängen mehrere Kinder daran, legst du in
`config.json` pro Kind einen eigenen Eintrag an (alle mit denselben `userEnv`/`passwordEnv`) und
trägst bei jedem die `studentId` als Zahl ein:

```json
{ "name": "aaron", "title": "Aaron", "server": "…", "school": "…",
  "userEnv": "ELTERN_USER", "passwordEnv": "ELTERN_PASSWORD", "studentId": 10534 }
```

Die ID zeigt WebUntis nicht an. So findest du sie:

- Lass `studentId` weg und starte `npm run sync`. Bei mehreren Kindern bricht der Abruf mit
  `cannot pick a student: set "studentId" to one of …` ab und nennt die möglichen IDs. Welche ID zu
  welchem Kind gehört, siehst du am Stundenplan in der erzeugten `.ics`.
- Oder öffne im Browser, während du bei WebUntis angemeldet bist,
  `https://<server>/WebUntis/api/rest/view/v1/app/data`. Unter `user` → `students` steht pro Kind
  eine `id` mit Namen. (Nicht getestet, ob die Seite ohne weiteren Token antwortet.)

## Starten

Lokal zum Ausprobieren (einmal abrufen, Dateien landen in `public/`):

```bash
npm run sync
```

Dauerhaft auf dem Pi (ruft stündlich ab und liefert die Feeds auf Port 8080 aus):

```bash
docker compose up -d --build
```

Die Feeds liegen unter `http://<pi-adresse>:8080/<FEED_TOKEN>/<name>.ics` (ohne Token: `/<name>.ics`).
In FamilyOS: Kalender → Abonnement hinzufügen → diese Adresse (im Heimnetz ist `http:` erlaubt).

## Tests

```bash
npm install && npm test && npm run typecheck
```
