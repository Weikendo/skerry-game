# Controller in Skerry: Konzept für die Einheitensteuerung

Stand 22.10.2026.

**Umsetzung (23.10.2026, Meilenstein 11, Etappe 1):** Schritte 1–7 sind umgesetzt, ohne das Zielen: LT-Zielmodus, Turm-Marke, Treffermarker und Zielhilfe folgen in Etappe 2. Die Einstellung „Harbinger-Höhe invertieren“ fehlt, weil der Harbinger ruht. Offen ist Schritt 8, der Test mit echten Controllern (der Spieler nutzt einen PlayStation-Controller). Siehe README, „Meilenstein 11“.

**Entscheidung der Spielleitung (22.10.2026):** Der Controller steuert nur die Einheiten, das aber richtig gut: Lenken, Tempo und Feuern. Skerry bleibt ein Spiel für PC und Mac. Karte, Konsole, Lager, Ausrüstung, Menü und Einstellungen bleiben bei Maus und Tastatur. Die erste Fassung dieses Berichts (Vollsteuerung per Pad, Räder, Fokus-Navigation, TV-Modus) ist damit verworfen.

**Grundlage:**
- Code gelesen: `src/game/input.ts`, `handleKeys()` und `simulate()` in `src/main.ts`, `carrierController.ts`, `walrus.ts`, `manta.ts`, `drone.ts`, `cameras.ts` und `weapons.ts`.
- Spiel im Browser bei 1512×860 angesehen.
- Ein echtes Gamepad war nicht angeschlossen. Aussagen über das Verhalten am Pad stammen aus dem Code.

**Spielweise, für die das Konzept gedacht ist:** Am Mac liegen Maus und Pad. Mit der Maus wählt man Einheiten, setzt Wegpunkte auf der Karte, rüstet aus und stellt den Nachschub ein. Dann nimmt man das Pad und fährt oder fliegt die Einheit. Der Wechsel zwischen beiden muss ohne Reibung gehen: Das Pad darf nie etwas in einem Fenster auslösen, das gerade die Maus bedient.

## Kurzfassung

- **Heute geht das Fahren per Pad, aber nicht gut:**
  - Der **Otter** wertet den Gas-Stick nur nach Richtung aus. Halbe Auslenkung gibt volles Gas (`walrus.ts:304–314`), ein feines Tempo ist unmöglich.
  - Die **Stoorworm** schaltet die Fahrstufen per „Schnippen“ des linken Sticks über die Schwelle 0,5, ohne Hysterese. Wer schräg lenkt, schaltet leicht aus Versehen.
  - **Totzonen** sind je Achse (0,16) statt kreisförmig. Diagonalen rasten dadurch auf die Achsen ein, das stört bei Kamera und Drohne.
  - **Kurven:** Kamera und Lenkung reagieren linear. Feines Zielen mit dem Avatar über 1–2 km ist so schwer.
  - **Rückmeldung:** Es gibt keine Vibration, keinen Treffermarker und keine Anzeige, wohin der Turm gerade wirklich zeigt.
  - **Hinweise:** Die Hilfezeile nennt nur Tasten der Tastatur.
- **Vorschlag:** eine Belegung, die bei allen Einheiten dasselbe Muster hat:
  - linker Stick = **Lenken**,
  - Steuerkreuz ↑↓ = **Tempo-Stufe** (Fahrstufe, Tempomat, Schubstufe, Drohnentempo),
  - RT = **Feuer**, LT = **Zielen bzw. Zweitwaffe**,
  - rechter Stick = Blick und Zielen (Skua und Drohne: zweite Flugachse),
  - B = Start/Landen, X = Nutzlast, Y = Kamera, Start = Pause.
- **Was entfällt:** Pad-Belegungen für Karte, Lager, Inselkameras und Einheitenwechsel. Das gibt Tasten frei und beseitigt Fehlbedienungen (heute steuert das Pad zum Beispiel eine verdeckte Karte unter dem Lager-Fenster).
- **Reihenfolge:** (1) Eingabeschicht mit runden Totzonen, Kurven und Hysterese, (2) Belegung aufräumen und Fenster sperren, (3) Otter (analoges Gas, Tempomat, Zielmodus), (4) Skua, (5) Drohne und Stoorworm, (6) Hinweise mit Xbox- und PlayStation-Symbolen, (7) Vibration und Zielhilfe, (8) Test mit echten Controllern.

---

## 1. Bestand: Einheitensteuerung per Pad heute

### 1.1 Was die Modelle aus dem Pad machen

| Einheit | Lenken | Tempo | Feuern | Befund |
|---|---|---|---|---|
| Stoorworm | linker Stick ←→ = Ruder, analog (`carrierController.ts:114`) | linker Stick ↑↓ über 0,5 = eine Fahrstufe (`:112–113`, `hit()`) | – (Trägerwaffe kommt erst mit M11) | Schaltet beim schrägen Lenken leicht mit. Ohne Hysterese kann ein Stick, der um 0,5 zittert, zweimal schalten. |
| Otter | linker Stick ←→, analog (Drehrate × Auslenkung) | linker Stick ↑↓, **nur das Vorzeichen** zählt (`walrus.ts:304–314`) | A oder RT: Avatar halten bzw. Harbinger drücken; X: Fracht | Kein Teilgas, kein Tempomat. Lange Überfahrten heißen minutenlang Stick halten. |
| Otter-Harbinger | linker Stick lenkt die Rakete (`main.ts` `simulate()`) | – | – | Gut so. Höhe-Invertieren gibt es nicht. |
| Skua | linker Stick: Nicken und Rollen als Raten, analog (`manta.ts:279–292`) | rechter Stick ↑↓ ändert den Schub mit 0,5 je Sekunde (`:283`), der Wert bleibt stehen | A oder RT Quasar, X Assassin, Steuerkreuz ↓ Quaker | Brauchbar. Quaker auf dem Steuerkreuz ist schwer zu finden. Kein Invertieren. |
| Drohne | linker Stick: Steigen und Drehen; rechter Stick: vor und seitwärts (Mode 2), alles analog (`drone.ts:217–222`) | proportional zum Stick, höchstens 24 m/s | – | Gut. Die Totzone je Achse lässt den rechten Stick bei Diagonalen einrasten. |
| Kamera und Zielen | rechter Stick, linear, 1,8 bzw. 1,3 rad/s, schon durch den Zoom geteilt (`main.ts` `handleKeys()`, `cameras.ts:63`) | – | Der Avatar zielt dorthin, wohin die Kamera blickt (`updateAim()`). Der Turm dreht mit 2,2 rad/s nach. | Kein Zoom außer bei der Drohne, keine Kurve, keine Beschleunigung. Ist der Turm noch nicht ausgerichtet, geht der Schuss entlang der Rohre statt aufs Fadenkreuz (`walrus.ts:174`), und davon sieht man nichts. |

### 1.2 Eingabeschicht (`input.ts`)

- **Totzone** 0,16 je Halbachse, mit Umrechnung auf 0–1. Sie ist eckig, nicht rund: Eine kleine Diagonale ergibt 0 auf der schwächeren Achse.
- **Kurven:** keine. Alle Achsen sind linear.
- **Digital aus analog:** Trigger und Stick zählen ab 0,5 als gedrückt, ohne Hysterese.
- **Gerät:** Gelesen wird der erste verbundene Pad. `mapping` wird nicht geprüft; ein Pad ohne „standard“-Belegung liefert dann falsche Tasten ohne Hinweis.
- Es gibt keine Vibration, keine Meldung beim Anstecken und keine Erkennung des Herstellers (für die Symbole).

### 1.3 Pad-Belegungen außerhalb der Einheiten (fallen weg)

| Taste heute | Wirkung heute | Warum weg |
|---|---|---|
| Back | Karte auf und zu | Karte ist Maussache. Heute steuert das Pad bei offener Karte die Karte; liegt das Lager-Fenster darüber, wirkt es auf die verdeckte Karte. |
| `map.pad()` (Stick, LT/RT, LB/RB, A, X, Y, B auf der Karte) | Karte schieben, zoomen, Wegpunkte | wie oben |
| RS drücken | Lager & Nachschub | Fenster sind Maussache. |
| Steuerkreuz ←→ | Inselkameras | Hat mit dem Fahren nichts zu tun. Bleibt auf `I` und in der Konsole. |
| Y | nächste Einheitenart | Einheitenwahl bleibt bei Maus, `V` und `Tab`. Y wird „Kamera“. |
| A | Feuer (doppelt mit RT) | A erreicht man nur mit dem Daumen vom rechten Stick, also schießt man damit immer ohne zu zielen. Wird frei. |
| LB/RB | Kamera zurück und vor | wird Y, die Schultertasten werden für die Drohnenkamera frei |

**Bleibt außerhalb der Einheiten:** Start = Pause und Weiter, und im Pausenmenü die vorhandene Navigation (Steuerkreuz, A, B). Sie kostet nichts und erspart den Griff zur Maus für eine kurze Pause. Sie wird nicht weiter ausgebaut.

### 1.4 Fehler mit Bezug auf das Fahren

1. **Offene Fenster lassen das Pad durch.** `simulate()` sperrt das Pad nur bei offener Karte. Bei offenem Lager-Fenster fährt und schießt das Pad weiter, und B startet oder landet die Einheit.
2. **Otter ohne Teilgas** (siehe 1.1).
3. **Fahrstufen-Schnippen ohne Hysterese** (siehe 1.1).
4. **Toter Code:** `AccbDialog` mit den Pad-Bezeichnungen X/A/Y wird seit der Rollenwahl in der Ausrüstung nicht mehr aufgerufen.
5. **Veraltete Texte:** Die README und der Kommentar am Ende von `input.ts` beschreiben noch das ACCB-Fenster und die Pad-Kartensteuerung.

---

## 2. Konzept: Lenken, Tempo, Feuern

### 2.1 Gemeinsames Muster für alle Einheiten

Wer die Einheit wechselt, soll nicht umdenken müssen. Jede Taste hat bei jeder Einheit dieselbe Rolle; was die Rolle konkret bedeutet, hängt vom Fahrzeug ab.

| Taste | Rolle | Stoorworm | Otter | Skua | Drohne |
|---|---|---|---|---|---|
| Linker Stick ←→ | **Lenken** | Ruder | lenken | rollen | drehen |
| Linker Stick ↑↓ | **Lenken bzw. Gas** | – | Gas, Bremse, rückwärts (analog, übersteuert den Tempomat) | Nase runter/hoch | steigen/sinken |
| Rechter Stick | **Blick bzw. zweite Achse** | Kamera | Kamera = Zielrichtung des Turms | ←→ Seitenruder, ↑↓ Schub fein | ↑↓ vor/zurück, ←→ seitwärts |
| Steuerkreuz ↑ / ↓ | **Tempo-Stufe** | Fahrstufe ± | Tempomat ± | Schubstufe ± | Tempo langsam / normal / schnell |
| RT | **Feuer** | (reserviert für den Trägerlaser aus M11) | Avatar (halten), Harbinger (drücken) | Quasar (halten) | – |
| LT | **Zielen bzw. Zweitwaffe** | Fernglas (halten, analog) | Zielmodus (halten, analog) | Assassin (drücken, braucht Aufschaltung) | Zoom (halten, analog) |
| X | **Nutzlast** | – | Fracht: ACCB, Virus-Bombe, Tank | Quaker | – |
| B | **Start/Landen** | – | aussetzen | Katapult- oder Senkrechtstart, Landeanflug | Start, Rückkehr |
| Y | **Kamera** | nächste Kamera | nächste Kamera | nächste Kamera | nächste Kamera |
| LS drücken | **Blick geradeaus** | ja | ja | ja | ja |
| LB / RB | einheitenabhängig | – | – | – | Kamera neigen runter / hoch |
| Start | **Pause** | ja | ja | ja | ja |
| A, Back, RS drücken, Steuerkreuz ←→ | frei | | | | |

**Änderungen gegenüber heute:**
- Assassin wandert von X auf LT, Quaker vom Steuerkreuz ↓ auf X, A feuert nicht mehr.
- Das Neigen der Drohnenkamera wandert vom Steuerkreuz ↑↓ auf LB/RB. Der Drohnen-Zoom wandert von LT/RT auf LT.
- Die Kamera wechselt mit Y statt LB/RB, die Fahrstufe mit dem Steuerkreuz statt per Stick-Schnippen.
- Die Tastatur bleibt unverändert.

**Konfliktprüfung:** In jeder Spalte hat jede Taste höchstens eine Bedeutung. Keine Einheit braucht eine Taste, die eine andere Einheit anders verwendet; nur LB/RB sind allein bei der Drohne belegt.

### 2.2 Stoorworm

- **Tempo:** Das Steuerkreuz ↑/↓ schaltet die Fahrstufen (Zurück … Äußerste Kraft), wie die Knöpfe der Steuerleiste. Dabei leuchtet die Stufe in der Leiste kurz auf. Der linke Stick schaltet nicht mehr. Damit fällt das versehentliche Schalten beim schrägen Lenken weg.
- **Lenken:** Linker Stick ←→ legt das Ruder mit einer Kurve (2.6), damit kleine Kurskorrekturen fein gehen. Wie heute schaltet Ruderlegen den Autopiloten ab. Dank der runden Totzone löst ein leicht schiefer Stick das nicht mehr aus.
- **Blick:** rechter Stick, LT = Fernglas (2,5× bei voll gedrücktem Trigger, analog dazwischen).
- **Feuer:** RT bleibt für den Trägerlaser aus M11 reserviert.

### 2.3 Otter

- **Analoges Gas:** Der linke Stick ↑ gibt eine Wunschgeschwindigkeit vor (Auslenkung × Höchsttempo: 12 m/s an Land, 8 m/s im Wasser). Der Otter beschleunigt mit den heutigen Werten dorthin. Stick ↓ bremst während der Vorwärtsfahrt anteilig (bis 9 m/s² bei Vollausschlag), aus dem Stand fährt er rückwärts. Losgelassen gilt der Tempomat; ohne Tempomat rollt der Otter aus wie heute.
- **Tempomat** (Steuerkreuz ↑/↓): Stufen Zurück, Stopp, ¼, ½, ¾ und Voll.
  - Der Stick übersteuert nur, solange er ausgelenkt ist. Danach gilt wieder die Stufe.
  - Lenken hebt den Tempomat nicht auf.
  - Konsole und Hilfezeile zeigen die Stufe („Tempomat ½“).
  - **Warum:** Überfahrten von 2 km dauern bei 8 m/s gut 4 Minuten. Und Andocken mit „¼“ ist einfacher als mit gefühltem Halbgas.
- **Lenken:** Drehrate mit Kurve. An Land bleibt das Drehen auf der Stelle (0,75 rad/s), im Wasser die tempoabhängige Wirkung (heute 0,45 × Faktor).
- **Zielen:**
  - **Rechter Stick** mit Kurve und Beschleunigung (2.6).
  - **LT halten = Zielmodus:** analoger Zoom bis 3× (das Sichtfeld wird kleiner). Die Kamera wird entsprechend langsamer; das macht `cams.look()` über `/ this.zoom` schon. Das Fadenkreuz wird feiner. Loslassen führt zurück zu 1×.
  - **Turm-Marke:** Neben dem Fadenkreuz zeigt ein kleiner Ring, wohin die Rohre gerade zeigen. Er läuft mit 2,2 rad/s auf das Fadenkreuz zu. Steht er noch weit daneben (mehr als 0,25 rad, `walrus.ts:174`), ist er rot und der Schuss geht nicht aufs Fadenkreuz. **Warum:** Heute geht ein Schuss nach einem schnellen Schwenk ins Leere, ohne dass man den Grund sieht.
- **Feuer:**
  - RT halten feuert den Avatar im Takt der Waffe.
  - Hitze: Ab 70 % blinkt die Marke gelb, bei Überhitzung vibriert der Pad lang und schwach, und der Hinweis „überhitzt“ erscheint am Fadenkreuz.
  - Harbinger: RT drücken startet, danach lenkt der linke Stick die Rakete. „Harbinger-Höhe invertieren“ wird eine Einstellung.
- **Nutzlast X:** ACCB absetzen, Virus-Bombe feuern, Tank abgeben (wie heute).
- **Start B:** aussetzen. Andocken bleibt Fahren ins Heckdock; das klappt mit Tempomat ¼ gut.

### 2.4 Skua

- **Lenken:** Linker Stick ↑↓ nickt, ←→ rollt. Beides sind Raten wie heute (0,9 bzw. 1,7 rad/s), aber mit Kurve (2.6), damit feine Korrekturen beim Anflug gehen.
  - **Höhenruder invertieren** wird eine Einstellung. Heute heißt Stick vor = Nase runter, das ist die Flieger-Gewohnheit und bleibt Standard.
  - Die Rollneigung richtet sich wie heute von selbst auf, die Nase bleibt stehen.
- **Tempo:**
  - Das Steuerkreuz ↑/↓ springt in Schubstufen 0 / 25 / 50 / 75 / 100 %; die Schubanzeige in der Konsole zeigt den Sprung.
  - Der rechte Stick ↑↓ verstellt den Schub fein wie heute; der Wert bleibt stehen.
  - Rechter Stick ←→ = Seitenruder (wie heute).
- **Feuer:**
  - RT = Quasar (halten).
  - LT = Assassin, ein Druck je Rakete. Ohne Aufschaltung kommt die heutige Meldung „kein Ziel“ und eine kurze Doppel-Vibration.
  - Bei neuer Aufschaltung (`manta.lock` wechselt) gibt es eine kurze Vibration. Der Rahmen `#lock` ist schon da.
- **Nutzlast X:** Quaker abwerfen.
- **Start/Landen B:** wie heute.
- **Warnungen:** Strömungsabriss und Kraftstoff unter 15 % bekommen eine leichte pulsierende Vibration, zusätzlich zur Meldung.

### 2.5 Drohne

- **Lenken und Tempo** bleiben Mode 2 wie bei echten Drohnen-Fernbedienungen: linker Stick Steigen/Drehen, rechter Stick vor/zurück und seitwärts, losgelassen hält sie die Position. Neu ist die runde Totzone auf dem rechten Stick, damit „geradeaus“ nicht seitlich driftet.
- **Tempo-Stufe** (Steuerkreuz ↑/↓): langsam (40 % von 24 m/s), normal (70 %), schnell (100 %). Langsam dient zum Kartieren und für Nahaufnahmen.
- **Kamera:** LB/RB neigen den Gimbal (1,0 rad/s wie heute mit Bild↑/↓). LT halten zoomt analog bis 6×.

### 2.6 Eingabeschicht: was „richtig gut“ technisch heißt

Das alles kommt in `input.ts`; die Modelle bekommen fertige Werte.

| Thema | Vorschlag | Startwert |
|---|---|---|
| Totzone | **rund je Stick** statt je Achse, mit Umrechnung (0 an der Totzone, 1 am Rand) und **äußerer Totzone**, damit auch abgenutzte Sticks den Vollausschlag erreichen | innen 0,12 (einstellbar 0,05–0,25), außen 0,96 |
| Kurven | für Lenken, Rollen, Nicken und Ruder: `v′ = 0,4·v + 0,6·v³`; für die Kamera dasselbe | getrennt einstellbar |
| Beschleunigung der Kamera | bei über 0,95 Auslenkung länger als 0,2 s steigt die Drehrate in 0,4 s auf das 1,6-Fache | aus im Zielmodus |
| Trigger | Feuer ab 0,30, Ende unter 0,20 (Hysterese). Analoge Nutzung (Zoom) über den vollen Weg. | – |
| Digitale Nutzung von Achsen | gedrückt ab 0,6, losgelassen unter 0,4 | – |
| Schnittstelle | `stick('L' \| 'R')` gibt `{x, y}` nach Totzone und Kurve zurück. `KEYS` und `InputLike` bleiben für die Tastatur, damit Autopiloten (`VirtualInput`) unverändert laufen. | – |
| Gerät | `mapping !== 'standard'`: einmal melden („Controller ohne Standardbelegung, Tasten können vertauscht sein“). Beim Anstecken melden: „Controller verbunden: …“. | – |
| Hersteller | aus `Gamepad.id`: `054c`, DualSense oder DUALSHOCK → PlayStation; sonst Xbox. Die Einstellung kann es überschreiben. | Auto |
| Vibration | Helfer `rumble(stark, schwach, ms)` über `vibrationActuator.playEffect('dual-rumble', …)`, wenn vorhanden; sonst still | an, Stärke 70 % |
| Letztes Gerät | `lastDevice = 'keys' \| 'pad'` für die Hinweise (2.8) | – |

### 2.7 Zusammenspiel mit Maus und Fenstern

- **Offene Fenster** (Lager, Ausrüstung, Pausenmenü, Dialoge): Einheiten bekommen kein Pad, Feuer ist gesperrt. Nur Start wirkt (Pause bzw. Weiter).
- **Offene Karte:** Das Pad lenkt die Einheit weiter, wie heute schon die Tastatur. Feuer bleibt gesperrt wie heute. **Warum:** Man kann auf der Karte mit der Maus einen Wegpunkt setzen und mit dem Pad weiterfahren, ohne die Karte zu schließen.
- **Hand an der Maus:** Ein Mausklick auf die Konsole (Einheit wählen) ändert nichts an der Pad-Belegung; das Pad fährt danach einfach die neue Einheit.

### 2.8 Hinweise mit Pad-Symbolen

- **Hilfezeile über der Konsole** (`helpLine()` in `hud.ts`): Ist der Pad zuletzt benutzt worden, zeigt sie die Pad-Belegung der aktiven Einheit, sonst die Tasten wie heute. Beispiel Otter: „LS Fahren · ✥ Tempomat ½ · RS Zielen · LT Zielmodus · RT Avatar · X ACCB · B Aussetzen · Y Kamera“.
- **Symbolsätze** nach der **Position** im Standard-Mapping:

| Index | Xbox | PlayStation |
|---|---|---|
| 0 unten | A (grün) | ✕ (blau) |
| 1 rechts | B (rot) | ○ (rot) |
| 2 links | X (blau) | □ (rosa) |
| 3 oben | Y (gelb) | △ (grün) |
| 4 / 5 | LB / RB | L1 / R1 |
| 6 / 7 | LT / RT | L2 / R2 |
| 9 | Menu ☰ | Options |
| 10 / 11 | LS / RS | L3 / R3 |
| 12–15 | Steuerkreuz ✥ | Steuerkreuz |

- **Darstellung:** Kleine Inline-SVG-Plaketten aus `src/ui/glyphs.ts` (rund für die Aktionstasten, abgerundete Rechtecke für Schultern und Trigger), 16–18 px hoch, passend zur Zeile. Unicode-Zeichen reichen nicht, die PS-Formen fehlen dort.
- **Katalog:** Die Pad-Texte bekommen eigene Schlüssel (`pad.ship`, `pad.otter` …) mit Platzhaltern wie `{p:fire}`, die je Symbolsatz ersetzt werden. Die Tastentexte `keys.*` bleiben.
- **Steuerungsseite im Menü:** Der Gamepad-Teil zeigt die Tabelle aus 2.1 mit den Symbolen des erkannten Controllers.

### 2.9 Einstellungen (mit der Maus, im vorhandenen Einstellungsfeld)

Neuer Ordner „Controller“:
- Tastensymbole: Automatisch / Xbox / PlayStation
- Kamera-Empfindlichkeit
- Kamera Y invertieren
- Skua-Höhenruder invertieren
- Harbinger-Höhe invertieren
- Totzone
- Zielhilfe: aus / leicht
- Vibration: an/aus und Stärke

**Zielhilfe „leicht“:** Liegt das Fadenkreuz auf einem Feindziel oder in dessen Nähe, wird die Kamera halb so schnell („Reibung“). Es gibt kein automatisches Nachführen. Die Hilfe wirkt nur am Pad; mit der Maus gibt es nie eine. **Warum:** Mit dem Stick ein Ziel in 1–2 km zu halten ist viel schwerer als mit der Maus. Die Reibung gleicht das aus, ohne das Zielen abzunehmen.

### 2.10 Rückmeldung (Vibration und Anzeige)

| Ereignis | Vibration | Anzeige |
|---|---|---|
| Avatar-Schuss | kurz, schwach (40 ms) | Rückstoß gibt es schon |
| Eigener Treffer auf ein Ziel | – | Treffermarker: Fadenkreuz-Ecken blitzen 120 ms; dafür braucht `combat.ts` einen Rückruf bei Treffern des Spielers |
| Die eigene Einheit wird getroffen | stark, 150 ms | Meldung gibt es schon |
| Überhitzt | lang, schwach | Fadenkreuz-Hinweis |
| Aufschaltung neu (Skua) | kurzer Tick | `#lock` gibt es schon |
| Assassin ohne Ziel | Doppel-Tick | Meldung gibt es schon |
| Strömungsabriss, Tank unter 15 % | pulsierend, schwach | Meldung gibt es schon |
| Katapultstart, Andocken, Landen | mittel, 200 ms | – |
| Zu steil, Gebäude im Weg (Otter) | ein kurzer Stoß | Meldung gibt es schon |

---

## 3. Anzeige rund ums Fahren

Die allgemeinen UI-Punkte der ersten Fassung (TV-Lesbarkeit, Doppelanzeigen auf Karte und Konsole) sind mit der Entscheidung für PC/Mac und durch den laufenden UI-Umbau entfallen oder überholt. Übrig bleibt, was das Fahren mit dem Pad unmittelbar braucht:

1. **Turm-Marke beim Otter** (2.3). Der Spieler sieht dann, warum ein Schuss danebengeht.
2. **Tempo-Stufe sichtbar:** Fahrstufe (gibt es), Tempomat beim Otter, Schubstufe bei der Skua und Drohnentempo erscheinen in der Detailzeile der Konsole und kurz als Einblendung beim Umschalten.
3. **Treffermarker** am Fadenkreuz (2.10).
4. **Hilfezeile je Gerät** (2.8): Sie ist heute die einzige Stelle, an der man die Belegung lernt.

---

## 4. Umsetzungsplan

Aufwand: **S** ≈ 1–3 h, **M** ≈ ½–1 Tag (jeweils mit Test über einen simulierten Pad).

| # | Schritt | Gewinn | Aufwand | Dateien |
|---|---|---|---|---|
| 1 | **Eingabeschicht:** runde Totzone mit äußerer Totzone, Kurven, Kamera-Beschleunigung, Trigger- und Achsen-Hysterese, `stick()`, `lastDevice`, Hersteller-Erkennung, Meldung beim Anstecken, Prüfung `mapping`, `rumble()` (noch ohne Ereignisse) | spürbar feineres Lenken und Zielen bei allen Einheiten | M | `src/game/input.ts`, `src/main.ts` (Meldungen) |
| 2 | **Belegung aufräumen:** Back, `map.pad()`, RS drücken, Steuerkreuz ←→ und Y (Einheit) raus; A feuert nicht mehr; Y = Kamera; offene Fenster sperren Pad und Feuer; bei offener Karte lenkt das Pad weiter; `AccbDialog` entfernen; README und Kommentare richten | keine Fehlbedienungen mehr | S | `main.ts` (`handleKeys`, `simulate`), `map.ts`, `input.ts` (`KEYS`, Kommentar), `accbDialog.ts`, `README.md`, `de.ts` (`help.pad*`, `map.padHelp`) |
| 3 | **Otter:** analoges Gas, Tempomat auf dem Steuerkreuz, LT-Zielmodus (Zoom), Turm-Marke mit Ausrichtungsfarbe, Hitze am Fadenkreuz | die meistgefahrene Einheit fährt und zielt sauber | M | `walrus.ts` (`drive`), `main.ts` (`handleKeys`, `updateCrosshair`), `index.html` (Marke), `deck.ts` (Tempomat-Zeile), `de.ts` |
| 4 | **Skua:** LT Assassin, X Quaker, Schubstufen auf dem Steuerkreuz, Kurven für Nicken und Rollen, Invertieren | Flug und Waffen auf einer Hand-Logik | S–M | `manta.ts` (`MANTA_KEYS`), `input.ts` (`KEYS.missile`), `main.ts`, `deck.ts`, `de.ts` |
| 5 | **Drohne und Stoorworm:** Drohne LB/RB Gimbal, LT Zoom, Tempostufen; Stoorworm Fahrstufe auf dem Steuerkreuz statt per Stick, LT Fernglas | gleiches Muster überall | S | `drone.ts` (`DRONE_KEYS`, `fly`), `carrierController.ts` (`update`), `main.ts` |
| 6 | **Hinweise:** `glyphs.ts`, Pad-Hilfezeile je Einheit, Steuerungsseite im Menü, Ordner „Controller“ in den Einstellungen | Belegung ist lernbar und einstellbar | M | neu `src/ui/glyphs.ts`; `hud.ts` (`helpLine`), `menu.ts` (`HELP`), `main.ts` (lil-gui-Ordner), `de.ts`, `index.html` |
| 7 | **Rückmeldung:** Vibrations-Ereignisse, Treffermarker, Zielhilfe „leicht“ | das Fahren fühlt sich nach Spiel an | M | `main.ts`, `combat.ts` (Treffer-Rückruf), `cameras.ts` (Reibung), `walrus.ts`/`manta.ts` (Ereignisse), `index.html` |
| 8 | **Test mit echten Controllern** (Xbox und DualSense per Bluetooth am Mac, im Browser und in der Electron-App) und Feinabstimmung von Totzone, Kurven, Raten und Vibrationsstärke | die Startwerte stimmen nur mit echter Hardware | S–M | `input.ts`, `README.md` |

**Reihenfolge-Begründung:** Schritt 1 verbessert sofort alle Einheiten und ist die Grundlage für alles Weitere. Schritt 2 ist klein und verhindert Fehlbedienungen im gemischten Betrieb mit der Maus. Der Otter kommt vor der Skua, weil er am meisten gefahren wird und das Zielen dort am schwersten ist.

**Testhinweis:** Im Browser-Pane lässt sich kein echter Pad anschließen. Für die Logik reicht ein Mock über `navigator.getGamepads = () => [fakePad]` zusammen mit `cc.step(t, fixedDt)`. Totzonen, Kurven und Vibration lassen sich aber nur mit echter Hardware einstellen. Deshalb muss Schritt 8 vor dem Abschluss stattfinden, nicht erst danach.
