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
| `src/calc/engine.ts` | Zählerreihen (inkl. Zählerwechsel), Interpolation, gemessener Netzanteil über den WechselRichter-Import, PV-Aufteilung, eigene Zähler mit Kosten, Kennzahlen |
| `src/calc/smart.ts` | Wetterbasierte Modelle (Heizgradtage, WP-Regression, Performance Ratio, Eigenverbrauch), Prognose mit Spanne, PV-Check, WP-Effizienz |
| `src/calc/finance.ts` | Kostentabelle pro Monat, Amortisation, Vertragsende-Hinweise, Fälligkeit |
| `src/calc/ics.ts` | Kalenderdateien (Ablese-Erinnerung, Vertragsende) |
| `src/calc/meters.ts` | Zählerverwaltung: eingebaute und eigene Zähler, Gruppen, Reihenfolge |
| `src/calc/advice.ts` | Spar-Empfehlungen, Plausibilitätscheck bei der Eingabe |
| `src/calc/demo.ts` | Demo-Datensatz (ca. 2 Jahre, mit simuliertem Wetter und Wasserzählern) |
| `src/calc/*.test.ts`, `src/migration.test.ts` | Tests der Rechenlogik und der Datenbank-Migration |
| `src/db.ts` | IndexedDB (Dexie, Schema-Version 2 mit Migration), Backup-Export/-Import |
| `src/weather.ts` | Open-Meteo: Ortssuche, Tageswetter, 16-Tage-Vorhersage, Klimamittel – im Gerät gespeichert |
| `src/screens/` | Übersicht, Auswertung, Erfassen, Verlauf, Meisterbereich, Onboarding |

## Rechenmodell in Kürze

Jede Ablesung beschreibt den Zählerstand zu Tagesbeginn. Zwischen zwei Ablesungen wird linear nach Tagen interpoliert, daraus entstehen Tageswerte. Auf dieser Ebene werden Saisonfaktoren (je Monat), Tarife und Vergütung (tagesgenau) angewendet; ein Zeitraum ist die Summe seiner Tage. Weil die Aufteilung proportional ist, entspricht das exakt der Rechnung „pro Intervall und Monat".

Der PV-Strom für Wärmepumpe und Wallbox ist `X = max(0, Einspeisung laut WR − Einspeisung Zähler)` und wird nach Verbrauch verteilt (Wärmepumpe gewichtet mit dem Monatsfaktor, Überlauf geht an den jeweils anderen Verbraucher). Das ist eine rechnerische Schätzung.

Mit dem WechselRichter-Import ist der Netzanteil gemessen: `Netz Haus = Import`, `Netz WP + Wallbox = Bezug − Import`. Geschätzt bleibt nur die Aufteilung zwischen Wärmepumpe und Wallbox. Fehlt der Import, rechnet WATTZEN wie zuvor.

## Wetter

Mit Standort (Meister → Haus und Anlage) lädt die App Wetterdaten von [Open-Meteo](https://open-meteo.com) (kostenlos, ohne API-Key) und speichert sie im Gerät. Ohne Standort oder Netz rechnet die Prognose mit einem typischen Klima für Deutschland.
