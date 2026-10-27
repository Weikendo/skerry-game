# Modelle aus Blender (Otter, Skua, Stoorworm)

Die Modelle des Spiels entstehen bisher im Code (`src/models/*.ts`). Hier entstehen sie in Blender, gesteuert über Python-Skripte, damit sie mehr Details, abgeschrägte Kanten und gebackene Schatten in den Ecken bekommen. Spielmaße und bewegliche Teile bleiben dabei gleich.

## Bauen

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python art/otter/build_otter.py -- --render
```

Genauso für die Skua mit `art/skua/build_skua.py` und die Stoorworm mit `art/stoorworm/build_stoorworm.py`. Der frühere Entwurf mit Kuppel steht noch in `build_stoorworm_kuppel.py`; er ist nicht mehr im Spiel und schreibt `stoorworm_kuppel.*`. Das schreibt (hier am Beispiel des Otters):
- `art/otter/otter.blend`: zum Ansehen und Nachbessern in Blender.
- `art/otter/otter.glb`: für das Spiel.
- `art/otter/renders/`: Vorschaubilder aus Blender, nur mit `--render`.

`--no-bake` lässt das Backen der Eckenschatten weg, was schneller ist.

`-- --feind` baut Otter und Skua in den Farben des Gegners (`otter_feind.glb`, `skua_feind.glb`): Ocker und Signalorange werden Violett, wie es `src/models/tint.ts` bei den Code-Modellen macht.

## Im Spiel

`src/models/glb.ts` lädt die GLB-Dateien vor dem Spielstart. `buildWalrus()` und `buildManta()` liefern danach die Blender-Modelle mit denselben beweglichen Teilen wie bisher; fehlt eine Datei, bleibt das Code-Modell, mit `'code'` als Argument bekommt man es ausdrücklich. Gegnerische Otter und Skuas tauschen in `enemyTint()` ihre Geometrie gegen die `_feind`-Variante. `buildCarrier('spieler')` ist immer die Stoorworm aus Blender, `shipCameras()` liest ihre drei Kameras aus dem Modell. Nur der gegnerische Träger (`buildCarrier('feind')`) wird noch im Code gebaut. Nach einem neuen Blender-Lauf genügt es, das Spiel neu zu laden.

Rumpf und Startbahn der Stoorworm stehen zweimal: in `build_stoorworm.py` (`STATIONS`, `BOW_TIP`, `RUNWAY`) und in `src/models/carrier.ts` (`STOORWORM_HULL`, `STOORWORM_RUNWAY`) für Schaum, Bugwelle, Grundberührung und die Skua auf der Bahn. Wer das eine ändert, ändert das andere mit.

Mit `?modelle=code` in der Adresse (z. B. `http://127.0.0.1:5173/?modelle=code`) läuft das Spiel mit den alten Code-Modellen, zum Vergleich von Aussehen und Bildrate.

## Vergleich im Spiellicht

Wenn der Dev-Server läuft, zeigt `http://127.0.0.1:5173/viewer/compare.html?model=otter` (oder `model=skua`, `model=stoorworm`) links das bisherige Code-Modell und rechts das neue; unten links wechselt man das Modell. Das neue Modell steckt dort so in Gruppen wie im Spiel (die Skua mit Maßstab 0,75 und 2,4 angehoben). Beide stehen im Licht, Material und Tone Mapping des Spiels, und eine gemeinsame Kamera bewegt beide gleich. Die Tasten `1`–`4` schalten die Tageszeit um (Mittag, Abend, Morgen, Nacht, mit den Werten aus `src/world/environment.ts`). Nachts leuchten Lampen und Leuchtpunkte wie im Spiel. Mit `?view=front|rear|top|close&angle=0.5&light=night` sind Blickwinkel und Licht fest. Bei der Stoorworm steht links der gegnerische Träger aus dem Code. `view=bridge`, `view=heck` und `view=aussen` zeigen nur die Stoorworm durch ihre Kameras `cam_bridge`, `cam_stern` und `cam_outside`, im Format 16:9 wie im Spiel. `lift=4.5` senkt den Aufzug so weit ab und stellt eine Skua darauf. Gespeicherte Vergleichsbilder liegen in `art/<modell>/compare/` (nicht im Git, wie die `.blend`-Dateien und die Renderbilder; die Skripte bauen sie neu).

Hilfen in `art/lib/lowpoly.py` für den handbemalten Look:
- Jedes Bauteil bekommt einen leicht eigenen Farbton (`jitter`).
- `dirt()` lässt Farben zu den Ketten hin ins Schlammbraun laufen.
- `stripes()` legt Warnstreifen auf eine Fläche.

## Regeln

- **Koordinaten:** `art/lib/lowpoly.py` arbeitet in Spielkoordinaten: x rechts, y oben, z vorn, Meter. Der glTF-Export (+Y oben) liefert genau diese Achsen.
- **Farben:** Sie kommen aus `src/engine/palette.ts`. Gespeichert sind sie pro Flächenecke als lineare Werte, so wie `LowPolyBuilder` sie schreibt. Das Spiel kann deshalb weiter sein flach schattiertes Vertex-Farben-Material verwenden.
- **Kanten:** Abgeschrägte Kanten bekommen eine hellere Schattierung ihrer Farbe (Kantenlicht). Eckenschatten werden mit Cycles in die Farben gebacken.
- **Namen** trennen ihre Teile mit Unterstrichen. Der glTF-Lader von three.js entfernt Punkte aus Namen; `safe_names()` ersetzt sie vor dem Export.
- **Für alle Modelle:** `lights*` sind Leuchtflächen (unbeleuchtetes Material, nachts hell), `decals*` sind aufgemalte Flächen (mit Tiefenversatz), `glow_*` sind Leuchtpunkte (Farbe und Größe als Eigenschaften).
- **Bewegliche Teile des Otters:**
  - `turret` > `barrel` > `recoil` (Turm, Rohr, Rückstoß)
  - `wheel_L|R_n` mit dem Radius als Eigenschaft `r`
  - `cleats_top|bottom_L|R` (Kettenglieder)
  - L ist +x, wie die Seite 1 im Spielcode.
- **Bewegliche Teile der Skua:**
  - `elevon_L|R`, Drehpunkt auf der Ruderachse
  - `rudder`
  - `gear_0|1|2`, Drehpunkt oben am Bein
  - `missile_0` bis `missile_5` in Schussreihenfolge
  - `exhaust_*`, Leuchtpunkte des Triebwerks mit der Eigenschaft `exhaust`
- **Teile der Stoorworm:**
  - `radar` (dreht sich, auf dem Mast des Bunkers), `turret` > `barrel` (auf dem Backbord-Sponson), `sternDoor` (Heckklappe)
  - `lift` (mit `lift_mesh` und `decals_lift`): die Aufzugsplattform, `position.y` von 0 (Deck) bis -9 (Hangar). Darunter liegt der Schacht. Die Skuas warten im Hangar und kommen zum Start mit dem Aufzug herauf.
  - `cam_bridge`, `cam_stern`, `cam_outside`: die drei Kameras des Schiffs mit den Eigenschaften `eye` und `look` in Spielkoordinaten
  - Das Schiff fährt ohne Besatzung: Auf dem Deck stehen keine Menschen, Schlepper oder abgestellten Skuas.
