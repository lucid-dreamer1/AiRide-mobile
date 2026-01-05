function testSmartShorten(text, maxLength = 10) {
  const replacements = {
    "SINISTRA": "SX",
    "DESTRA": "DX",
    "DRITTO": "DRT",
    "ROTATORIA": "ROT",
    "ROTONDA": "ROT",
    "USCITA": "USC",
    "VIALE": "V.LE",
    "CORSO": "C.SO",
    "PIAZZA": "P.ZA",
    "PIAZZALE": "P.LE",
    "LUNGO": "L.",
    "PONTE": "P.TE",
    "VIA": "V.",
    "TRA": " ",
    "DIREZIONE": "DIR",
    "ALLA": "A",
    "ALLE": "A",
    "AL": "A",
    "SULLA": "SU",
    "PRENDI": "",
    "IMBOCCA": "",
    "LA": "",
    "IL": "",
    "LO": "",
    "I": "",
    "GLI": "",
    "LE": "",
    "PRIMA": "1^",
    "SECONDA": "2^",
    "TERZA": "3^",
    "QUARTA": "4^",
    "QUINTA": "5^",
    "SESTA": "6^",
    "SETTIMA": "7^",
    "OTTAVA": "8^",
    "NONA": "9^",
    "DECIMA": "10^",
    "UNPO": "UN PO'",
    "POCO": "PO'",
    "METRI": "m",
    "CHILOMETRI": "km",
  };

  let processed = text.toUpperCase();

  for (const [full, short] of Object.entries(replacements)) {
    const regex = new RegExp(`\\b${full}\\b`, "g");
    processed = processed.replace(regex, short);
  }

  // Rimuovi spazi multipli e trim
  processed = processed.replace(/\s+/g, " ").trim();

  // Secondo passaggio per pulire eventuali spazi lasciati da parole rimosse all'inizio/fine
  processed = processed.trim();

  if (processed.length > maxLength) {
    processed = processed.slice(0, maxLength);
  }
  return processed;
}

const cases = [
  "alla rotonda prendi la quarta uscita", // Target: "A ROT 4^ USC"
  "alla rotonda prendi la prima uscita",  // Target: "A ROT 1^ USC"
  "imbocca la seconda uscita",            // Target: "2^ USC"
  "prosegui dritto per 100 metri",        // Target: "DRT 100 m"
  "gira a sinistra in via Roma",          // Target: "SX V.ROMA" (magari)
];

console.log("--- TEST RESULTS ---");
cases.forEach(c => {
  const res = testSmartShorten(c);
  console.log(`"${c}" -> "${res}" (len: ${res.length})`);
});
