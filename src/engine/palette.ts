/**
 * Design palette. Every surface colour in the game comes from here, the way the
 * original lived on its 16 VGA colours. Families are ramps from light to dark;
 * lighting does the rest. Light colours (sky, sun, fog) are not part of it —
 * they blend continuously with time of day and weather.
 */
export const PAL = {
  // Wasser
  wasserFlach: '#8ae8d6', wasserMittel: '#36bccb', wasserTief: '#2a86aa', wasserSturm: '#4a6574', gischt: '#f4fbfb', gischtSturm: '#c3ccd2',
  // das Meer-Mosaik nach dem Titelbild: Facetten von Marine bis Türkis, Glanz zum Horizont
  wasserMarine: '#0a2b4d', wasserPetrol: '#155f80', wasserTeal: '#2a9294', wasserTuerkis: '#72c9b6', wasserGlanz: '#a8dcd8',
  // das Stufen-Meer (Farbholzschnitt), vom Wellental bis zum Kamm: sanfter als das Mosaik, die Täler nicht so tief
  stufenMarine: '#1c4560', stufenPetrol: '#2f7088', stufenTeal: '#4f9e9e', stufenTuerkis: '#a9d8cc',
  // die Sturmsee der Stufen nach Fotos der Nordsee: stahlblau, entsättigt, vom Tal bis zur hellen Flanke
  wasserSturmTal: '#475672', wasserSturmKamm: '#9faac0',
  // Sand & Erde
  sandHell: '#e8d6a6', sandNass: '#d2bb86', erde: '#a38c5f',
  // Grün (Wiese, Wald, Bäume) hell → dunkel
  gruen1: '#95a578', gruen2: '#809261', gruen3: '#6d7c54', gruen4: '#616e4a', gruen5: '#525d3e',
  // Fels hell → dunkel
  fels1: '#9facb5', fels2: '#8e9da8', fels3: '#798b98', fels4: '#697c89',
  // Schnee
  schnee: '#f3f5f8', schneeSchatten: '#e4eaf0',
  // Holz
  holz: '#6b4a2f', holzGrau: '#857565',
  // Schäre (flache Felsinsel wie vor Schottlands Küsten): flechtengrauer Fels, nasser Fels, Moos, Heide, trockenes Gras, Vogelkot, Tümpel
  // (der Tümpel hell und bläulich wie Wasser, das den Himmel spiegelt)
  flechte: '#b4b2a3', schaerenFels: '#8b887d', schaerenDunkel: '#5c5850', moos: '#7a8748', heide: '#a39a62', grasTrocken: '#b1a76f', vogelkot: '#e4e1d6', tuempel: '#6f8796',
  // Basalt (Säuleninseln wie Staffa) und Glut: die lava*-Farben färben Feuer, Raketenflammen und Glut
  basalt: '#3d3836', basaltHell: '#5b534d', asche: '#7d7671',
  lavaHell: '#ffd27a', lava: '#ff7a1a', lavaDunkel: '#d2380f',
  // Eis
  eis: '#cfe9f2', eisDunkel: '#a9d3e3',
  // Stahl & Grau hell → dunkel
  weiss: '#f1f1ec', stahlHell: '#aeb6bf', stahl: '#97a1ad', deck: '#7a8088', metallHell: '#80848c',
  metall: '#6c7078', deckDunkel: '#555a62', anthrazit: '#2a2e35', schwarz: '#1b1e23',
  // Schiffsstahl der Stoorworm: blaues Gunmetal wie auf dem Titelbild
  gunmetalHell: '#8d9db0', gunmetal: '#8697ab', gunmetalDunkel: '#5f6878', gunmetalTief: '#30363f',
  // Spieler-Akzent: Ocker aus der Original-Palette
  ockerHell: '#d8b262', ocker: '#c79b38', ockerDunkel: '#a07c2a', ockerGrau: '#bba77c',
  // Gegner-Akzent: Violett, gut unterscheidbar vom Ocker des Spielers
  feindHell: '#a982cf', feind: '#7f55a8', feindDunkel: '#583a78', feindGrau: '#9e8fb0',
  // Signalfarben
  signalOrange: '#e2601f', signalOrangeDunkel: '#b8481a', signalRot: '#b3221b', signalRotDunkel: '#8c1a14',
  signalGelb: '#f2c21b', rettungsOrange: '#f07a1e', rumpfRot: '#8e3b2c',
  // Glas
  glasBlau: '#a8dcf6', fensterBlau: '#28405e',
  // Leuchtfarben (unbeleuchtet gerendert, nachts mit Glühen)
  lichtWarm: '#ffd88a', lichtWeiss: '#f1f1ec', lichtRot: '#ff2a1a', lichtGruen: '#2aff6a', lichtBlau: '#6ab4ff',
  // Wetter
  wolke: '#ffffff', wolkeSturm: '#5d636c', regen: '#c8d4e0',
} as const;

export type PalName = keyof typeof PAL;

/** Families for the palette sheet (viewer/palette.html). */
export const PAL_FAMILIES: Record<string, PalName[]> = {
  Wasser: ['wasserFlach', 'wasserMittel', 'wasserTief', 'wasserSturm', 'gischt', 'gischtSturm', 'wasserMarine', 'wasserPetrol', 'wasserTeal', 'wasserTuerkis', 'wasserGlanz', 'stufenMarine', 'stufenPetrol', 'stufenTeal', 'stufenTuerkis', 'wasserSturmTal', 'wasserSturmKamm'],
  'Sand & Erde': ['sandHell', 'sandNass', 'erde'],
  'Grün': ['gruen1', 'gruen2', 'gruen3', 'gruen4', 'gruen5'],
  Fels: ['fels1', 'fels2', 'fels3', 'fels4'],
  'Schnee, Eis & Holz': ['schnee', 'schneeSchatten', 'eis', 'eisDunkel', 'holz', 'holzGrau'],
  'Schäre': ['flechte', 'schaerenFels', 'schaerenDunkel', 'moos', 'heide', 'grasTrocken', 'vogelkot', 'tuempel'],
  Basalt: ['basalt', 'basaltHell', 'asche'],
  'Feuer & Glut': ['lavaHell', 'lava', 'lavaDunkel'],
  'Stahl & Grau': ['weiss', 'stahlHell', 'stahl', 'deck', 'metallHell', 'metall', 'deckDunkel', 'anthrazit', 'schwarz'],
  'Gunmetal (Stoorworm)': ['gunmetalHell', 'gunmetal', 'gunmetalDunkel', 'gunmetalTief'],
  'Ocker (Spieler)': ['ockerHell', 'ocker', 'ockerDunkel', 'ockerGrau'],
  'Violett (Gegner)': ['feindHell', 'feind', 'feindDunkel', 'feindGrau'],
  Signal: ['signalOrange', 'signalOrangeDunkel', 'signalRot', 'signalRotDunkel', 'signalGelb', 'rettungsOrange', 'rumpfRot'],
  Glas: ['glasBlau', 'fensterBlau'],
  Leuchtfarben: ['lichtWarm', 'lichtWeiss', 'lichtRot', 'lichtGruen', 'lichtBlau'],
  Wetter: ['wolke', 'wolkeSturm', 'regen'],
};
