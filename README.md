# WATTZEN

Energie-Tracker fürs eigene Haus: Zählerstände in unregelmäßigen Abständen eintragen, die App rechnet Verbräuche, Kosten, Vergütung und die Herkunft des Stroms (PV oder Netz) für Wärmepumpe und Wallbox aus.

Installierbare PWA, offline-fähig, ohne Backend und ohne Login. Alle Daten liegen lokal im Browser (IndexedDB).

## Entwickeln

```bash
npm install
npm run dev      # Entwicklungsserver
npm test         # Unit-Tests der Rechenlogik (Vitest)
npm run build    # statische Seite nach dist/
npm run preview  # gebaute Seite lokal ansehen
```

## Deployen

`dist/` ist eine rein statische Seite mit relativen Pfaden und läuft unverändert auf GitHub Pages, Netlify oder jedem anderen Static-Host.

- **GitHub Pages:** Der Workflow `.github/workflows/deploy.yml` baut und veröffentlicht bei jedem Push auf `main`. Einmalig unter *Settings → Pages → Source* „GitHub Actions" wählen.
- **Netlify:** Build-Befehl `npm run build`, Publish-Verzeichnis `dist`.

Danach die Seite am Handy öffnen und „Zum Startbildschirm hinzufügen".

## Aufbau

| Pfad | Inhalt |
|---|---|
| `src/calc/engine.ts` | Zählerreihen (inkl. Zählerwechsel), Interpolation, PV-Aufteilung, Tageswerte, Kennzahlen |
| `src/calc/forecast.ts` | Prognose bis 31.12., Abschläge |
| `src/calc/advice.ts` | Spar-Empfehlungen, Plausibilitätscheck bei der Eingabe |
| `src/calc/demo.ts` | Demo-Datensatz (ca. 2 Jahre) |
| `src/calc/engine.test.ts` | Tests der Rechenlogik |
| `src/db.ts` | IndexedDB (Dexie), Backup-Export/-Import |
| `src/screens/` | Erfassen, Auswertung, Verlauf, Elektromeisterbereich, Onboarding |

## Rechenmodell in Kürze

Jede Ablesung beschreibt den Zählerstand zu Tagesbeginn. Zwischen zwei Ablesungen wird linear nach Tagen interpoliert, daraus entstehen Tageswerte. Auf dieser Ebene werden Saisonfaktoren (je Monat), Tarife und Vergütung (tagesgenau) angewendet; ein Zeitraum ist die Summe seiner Tage. Weil die Aufteilung proportional ist, entspricht das exakt der Rechnung „pro Intervall und Monat".

Der PV-Strom für Wärmepumpe und Wallbox ist `X = max(0, Einspeisung laut WR − Einspeisung Zähler)` und wird nach Verbrauch verteilt (Wärmepumpe gewichtet mit dem Monatsfaktor, Überlauf geht an den jeweils anderen Verbraucher). Das ist eine rechnerische Schätzung.
