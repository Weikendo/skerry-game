# Bordcomputer-Stimme der Stoorworm (Entwurf)

Der Bordcomputer meldet wichtige Ereignisse mit einer Stimme. Die Meldung im Logbuch bleibt wie bisher, die Stimme ergänzt sie. Inselnamen und Entfernungen spricht sie nicht, die stehen im Logbuch. So reicht eine feste Liste kurzer Sätze.

## Aufnahmen mit ElevenLabs

- **Eine Stimme für beide Sprachen**, Modell „Multilingual v2“, damit Deutsch und Englisch nach demselben Computer klingen.
- **Charakter:** eine weibliche Stimme, ruhig, sachlich, knapp, wie ein Schiffscomputer. Warnungen dringlich, aber nicht geschrien.
- **Einstellungen als Startpunkt:** Stability 60–70 %, Similarity 75 %, Style 0, Speaker Boost an.
- **Jede Zeile einzeln erzeugen** und als Datei mit ihrer ID speichern, z. B. `de/rakete-anflug.mp3` und `en/rakete-anflug.mp3`. MP3 mit 44,1 kHz und 128 kbit/s reicht, WAV ist besser, wenn der Tarif es anbietet.
- **Lizenz** (nach meinem Stand, bitte im eigenen Tarif nachsehen): Der kostenlose Tarif verlangt eine Nennung und erlaubt keine kommerzielle Nutzung, die bezahlten Tarife schließen eine kommerzielle Lizenz ein. ElevenLabs kommt so oder so in den Abspann (Menü → Mitwirkende).

Die Sätze stehen zum Einsprechen in `docs/stimme-saetze.txt`: erst die 33 deutschen, dann die 33 englischen, jeder mit Punkt und durch eine Leerzeile getrennt, in der Reihenfolge der Tabellen unten. Eine lange Aufnahme je Sprache reicht auch, dann schneide ich sie an den Pausen. Danach schneide ich die Stille ab, gleiche die Lautheit an, wandle in OGG um und lege die Dateien nach `src/assets/stimme/de/` und `src/assets/stimme/en/`.

## Die Sätze

Priorität 1 hat Vorrang vor allem anderen, Priorität 3 entfällt, wenn gerade viel los ist. „neu“ heißt: Für diesen Satz braucht das Spiel einen neuen Auslöser, die anderen hängen an Meldungen, die es schon gibt.

### Warnungen

| ID | Deutsch | English | Auslöser | Prio |
|---|---|---|---|---|
| `rakete-anflug` | Rakete im Anflug! | Missile inbound! | erste feindliche Rakete auf die gesteuerte Einheit (heute der schnelle Warnton) | 1 |
| `hammerhead-anflug` | Hammerhead im Anflug! | Hammerhead inbound! | `hammer.incoming` | 1 |
| `schiff-beschuss` | Wir werden beschossen! | We are under fire! | `foe.shipHit` | 1 |
| `schiff-schaden` | Schwere Schäden am Schiff! | Heavy damage to the ship! | neu: Panzerung der Stoorworm unter 30 % | 1 |
| `schiff-sinkt` | Die Stoorworm sinkt. | The Stoorworm is sinking. | `end.shipSinking` | 1 |
| `feind-skua` | Feindliche Skua im Anflug. | Enemy Skua inbound. | `foe.skuaSighted` | 2 |
| `feind-luftangriff` | Feindlicher Luftangriff auf eine Insel. | Enemy air raid on one of our islands. | `foe.raid` | 2 |
| `insel-angriff` | Eine unserer Inseln wird angegriffen. | One of our islands is under attack. | `foe.attack` | 2 |
| `feind-traeger` | Feindlicher Träger gesichtet. | Enemy carrier sighted. | `enemy.sighted` | 2 |
| `feind-traeger-weg` | Kontakt zum feindlichen Träger verloren. | Contact with the enemy carrier lost. | `enemy.lost` | 3 |
| `feind-accb` | Der Feind setzt eine ACCB ab. | Enemy ACCB landing. | `foe.accb` | 2 |
| `feind-beobachter` | Feindliche Zielsonde gestartet. | Enemy spotter pod launched. | `observer.foeUp` | 3 |
| `feind-insel` | Der Feind hat eine Insel eingenommen. | The enemy has taken an island. | `foe.islandTaken` | 2 |
| `skua-verloren` | Skua verloren. | Skua lost. | `kill.unitLost` (Skua) | 2 |
| `otter-verloren` | Otter verloren. | Otter lost. | `kill.unitLost` (Otter) | 2 |
| `drohne-verloren` | Drohne verloren. | Drone lost. | `kill.unitLost` (Drohne) | 2 |
| `funk-schwach` | Funksignal schwach. | Signal weak. | Signal des gesteuerten Fahrzeugs unter 40 % | 3 |
| `funk-weg` | Funkverbindung verloren. | Signal lost. | neu: Signal des gesteuerten Fahrzeugs bei 0 | 2 |
| `treibstoff` | Treibstoff knapp. | Fuel low. | Treibstoff (Drohne: Akku) des gesteuerten Fahrzeugs unter 20 % | 3 |
| `panzerung` | Panzerung niedrig. | Armour low. | Panzerung des gesteuerten Fahrzeugs unter 30 % | 3 |
| `laser-heiss` | Laser überhitzt. | Laser overheated. | Laser oder Laserturm überhitzt (zusätzlich zum Warnton) | 3 |

### Erfolge

| ID | Deutsch | English | Auslöser | Prio |
|---|---|---|---|---|
| `ziel-zerstoert` | Ziel zerstört. | Target destroyed. | `kill.enemyUnit` (außer Skua) und vom Spieler zerstörte Gebäude | 3 |
| `skua-abschuss` | Feindliche Skua abgeschossen. | Enemy Skua down. | `kill.enemyUnit` (Skua) | 2 |
| `insel-neutral` | Inselverteidigung ausgeschaltet. | Island defences neutralised. | `kill.neutralised`, gleich nach `feind-zentrale` | 2 |
| `feind-zentrale` | Feindliche Kommandozentrale zerstört. | Enemy command centre destroyed. | `kill.neutralised` | 2 |
| `insel-erobert` | Insel eingenommen. | Island captured. | `base.ccBuilt`, `virus.captured` | 2 |
| `traeger-treffer` | Treffer auf dem feindlichen Träger. | Hit on the enemy carrier. | neu: eigener Treffer auf die Nuckelavee, höchstens alle 60 s | 3 |
| `traeger-sinkt` | Der feindliche Träger sinkt! | The enemy carrier is sinking! | `end.foeSinking` | 1 |

### Bordbetrieb

| ID | Deutsch | English | Auslöser | Prio |
|---|---|---|---|---|
| `bereit` | Bordcomputer bereit. | Ship's computer online. | Spielstart und Laden | 3 |
| `angriff-start` | Skua startet zum Angriff. | Skua launching for attack. | `strike.go` | 3 |
| `angriff-heim` | Skua kehrt zurück. | Skua returning. | Ende eines Auto-Angriffs (`strike.end.*`, `strike.recall`) | 3 |
| `reparatur` | Reparatur abgeschlossen. | Repairs complete. | `repair.done` | 3 |
| `kartiert` | Insel kartiert. | Island surveyed. | `survey.done` | 3 |

### Transferdrohne (zweite Runde)

Die Sätze zum Einsprechen stehen in `docs/stimme-saetze-transfer.txt`, wieder erst Deutsch, dann Englisch, in dieser Reihenfolge.

| ID | Deutsch | English | Auslöser | Prio |
|---|---|---|---|---|
| `transfer-start` | Transferdrohne läuft aus. | Transfer drone under way. | `transfer.launched` (von Hand oder automatisch) | 3 |
| `transfer-angedockt` | Transferdrohne angedockt. | Transfer drone docked. | neu: sie legt am Bug an | 3 |
| `transfer-geliefert` | Nachschub an Bord. | Supplies on board. | `transfer.delivered` | 2 |
| `transfer-voll` | Laderaum voll, der Rest geht zurück. | Hold full, the rest goes back. | neu: beim Entladen passt nicht alles in den Laderaum | 2 |
| ~~`transfer-bereit`~~ | ~~Transferdrohne wieder bereit.~~ | ~~Transfer drone ready again.~~ | am 29.10.2026 entfernt: eine Meldung zu viel | – |
| `transfer-abbruch` | Transfer abgebrochen. | Transfer aborted. | `transfer.aborted` (Schiff zu weit weg oder von Hand) | 2 |
| `transfer-unterwegs` | Transferdrohne ist bereits unterwegs. | Transfer drone already under way. | `transfer.busy` (Start von Hand abgelehnt) | 3 |
| `transfer-zu-weit` | Zu weit von der Lagerinsel entfernt. | Too far from the stockpile island. | `transfer.tooFar` (Start von Hand abgelehnt) | 3 |
| `transfer-nichts` | Nichts zu liefern. | Nothing to deliver. | `transfer.nothing` (Start von Hand abgelehnt) | 3 |
| `lager-in-reichweite` | Lagerinsel in Reichweite. | Stockpile island in range. | neu: das Schiff kommt in Transferreichweite (3,5 km) | 3 |
| `lager-ausser-reichweite` | Lagerinsel außer Reichweite. | Stockpile island out of range. | neu: das Schiff verlässt die Transferreichweite | 3 |
| `netz-unterbrochen` | Versorgungsnetz unterbrochen. | Supply network cut off. | `transfer.frozen`, und wenn das Netz einfriert (Basis verloren) | 2 |
| `lager-verloren` | Lagerinsel verloren. | Stockpile island lost. | `economy.depotLost` | 2 |

### Waffen (dritte Runde)

Die Sätze zum Einsprechen stehen in `docs/stimme-saetze-kampf.txt`, erst Deutsch, dann Englisch. Die Beobachtungsdrohne heißt jetzt Zielsonde (englisch „spotter pod“): Sie ist keine Drohne, sondern eine Kamera am Fallschirm. Deshalb ist auch `feind-beobachter` neu eingesprochen. Die drei Sätze kamen als eine Aufnahme je Sprache und sind wie die anderen an den Pausen geschnitten (die Kommapause in „Zielsonde bereit, Zielerfassung aktiv“ bleibt drin) und auf −20 LUFS angeglichen.

| ID | Deutsch | English | Auslöser | Prio |
|---|---|---|---|---|
| `ausser-reichweite` | Ziel außer Reichweite. | Target out of range. | Feuer mit Laserturm oder Otter auf ein Ziel jenseits der Laserreichweite (1,56 km); frühestens alle 8 s | 3 |
| `zielsonde-bereit` | Zielsonde bereit, Zielerfassung aktiv. | Spotter pod ready, targeting active. | die eigene Zielsonde hängt am Schirm; an der Stoorworm schaltet die Ansicht dann von selbst auf ihre Kamera (`observer.ready`) | 2 |
| `feind-beobachter` (neu) | Feindliche Zielsonde gestartet. | Enemy spotter pod launched. | wie oben, nur der neue Name | 3 |

### Otter und der Treibstoff der Stoorworm (vierte Runde, 29.10.2026)

Die Sätze zum Einsprechen stehen in `docs/stimme-saetze-otter.txt`, erst Deutsch, dann Englisch. Sie kamen als eine Aufnahme je Sprache (knapp 6 s) und sind wie die anderen an den Pausen geschnitten und auf −20 LUFS angeglichen. Die Pause im dritten Satz nach „Treibstoff“ bzw. „Stoorworm“ bleibt drin. Dass sie dort sitzt, zeigt die Länge: „der Stoorworm knapp“ dauert 1,44 s wie das vorhandene „Die Stoorworm sinkt.“. Gewünscht vom Spieler: Bisher sagte die Stimme zu den Ottern nur „Otter verloren.“, und für das Schiff selbst warnte sie nie vor knappem Treibstoff (nur für das Fahrzeug in der Hand).

| ID | Deutsch | English | Auslöser | Prio |
|---|---|---|---|---|
| `otter-wegpunkt` | Otter am Wegpunkt. | Otter at waypoint. | der Autopilot eines Otters kommt an (`pilot.waypointReached`) | 3 |
| `otter-an-land` | Otter an Land. | Otter ashore. | ein eigener Otter fährt vom Wasser auf eine Insel; frühestens alle 20 s | 3 |
| `treibstoff-schiff` | Treibstoff der Stoorworm knapp. | Stoorworm fuel low. | Treibstoff der Stoorworm unter 20 % (wieder scharf ab 30 %) | 2 |

`transfer-bereit` („Transferdrohne wieder bereit.“) ist am selben Tag entfallen.

Zusammen 33 + 13 + 2 + 3 − 1 = 50 Sätze, also 100 Dateien. Solange eine Datei fehlt, überspringt der Bordcomputer den Satz, statt die Schlange aufzuhalten.

## Im Spiel

- **Eine Stimme zur Zeit:** Meldungen warten in einer Schlange von höchstens 4 Sätzen, nach jedem Satz 0,35 s Pause. Priorität 1 springt nach vorn. Wer zu lange wartet, verfällt: Priorität 1 nach 8 s, 2 nach 6 s, 3 nach 3 s.
- **Keine Wiederholungen:** Derselbe Satz kommt frühestens nach 15 s wieder, „Wir werden beschossen“ nach 30 s, „Feindliche Skua im Anflug“ nach 25 s, „Treffer auf dem feindlichen Träger“ nach 60 s, „Ziel zerstört“ schon nach 8 s.
- **Ducking:** Während die Stimme spricht, gehen Kampfklänge und Triebwerke auf 55 % zurück.
- Der Untergang der eigenen Insel (`kill.islandLost`) hat keinen eigenen Satz.
- **Einstellungen:** eigener Regler „Stimme“ im Mischpult und ein Schalter zum Abschalten. Die Sprache folgt der Spielsprache.
- **Klang:** erst einmal so, wie ElevenLabs ihn liefert. Ein leichter Funk- oder Lautsprecherfilter lässt sich danach per Ohr ausprobieren.
