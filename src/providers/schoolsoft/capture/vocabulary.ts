/**
 * Words of SchoolSoft's own interface that the capture redactor may keep:
 * labels, headings, weekdays, statuses. A text is kept only when EVERY word
 * in it is listed here (see Redactor.text), so this list decides what a
 * fixture can say. Never add a subject, a person's name, a school, a class
 * or anything a teacher or guardian types; when a captured page needs a
 * label that is missing, the placeholder in the fixture is the safe outcome.
 */
const WORDS = `
och eller i på av för med om till från utan per vid som är har ej inte
ja nej ok avbryt spara skicka skickat skickade ändra ta bort radera stäng tillbaka
välj vald alla ingen inga annan annat andra övrigt övriga visa dölj läs mer
nästa föregående sida ny nytt nya sök filter uppdatera
datum tid tider start slut starttid sluttid från till fr.o.m t.o.m fom tom
dag dagar dagen hel hela heldag halv halvdag del delar deldag förmiddag eftermiddag
idag igår imorgon vecka veckan veckor v månad år läsår termin ht vt
måndag tisdag onsdag torsdag fredag lördag söndag mån tis ons tor tors fre lör sön
januari februari mars april maj juni juli augusti september oktober november december
jan feb mar apr jun jul aug sep sept okt nov dec
frånvaro frånvaron frånvaroanmälan frånvaroanmälningar anmäl anmäld anmälda anmälan
oanmäld oanmälda giltig ogiltig ogiltigt beviljad beviljat beviljade ej beviljad
närvaro närvarande frånvarande sen sent ankomst försenad
sjuk sjukdom sjukanmälan orsak orsaker typ kommentar kommentarer beskrivning
ledighet ledig ledighetsansökan ansökan ansökningar ansök beslut status väntar godkänd avslagen
meddelande meddelanden inkorg utkorg skickade mottagare avsändare ämnesrad rubrik text innehåll
svara vidarebefordra bilaga bilagor fil filer
elev elever vårdnadshavare förälder personal lärare mentor
lektion lektioner lektionen schema pass timmar timme minuter min procent totalt summa antal
översikt rapport närvarorapport sammanställning
ämne ämnen kurs kurser grupp klass skola
`;

export const INTERFACE_WORDS: ReadonlySet<string> = new Set(WORDS.split(/\s+/).filter(Boolean));

/** Exact strings (case-sensitive) kept in JSON values: enumerations the API is known to use. */
export const SAFE_VALUES: ReadonlySet<string> = new Set(["Europe/Stockholm"]);
