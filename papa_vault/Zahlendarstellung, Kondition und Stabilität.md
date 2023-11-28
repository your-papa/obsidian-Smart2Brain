---
related:
- "[[Numerische Methoden]]"
created_at: "29-10-2022 14:45"
---


# Prof Präsentation

[Zahlendarstellung_Kondition_Stabilitaet_Notes.pdf](Zahlendarstellung_Kondition_Stabilitaet_Notes.pdf)

# Fehlerarten

- Jede Rechnung auf einem Computer ist fehlerbehaftet
- Fehler im Ergebnis resultieren aus
    - Daten- bzw. Eingabefehlern
    - Fehler im Algorithmus (Verfahrens- und Rundungsfehler)
- Gegen Datenfehler sind wir mehr oder weniger machtlos
- Fehler im Algorithmus können wir analysieren und evtl. vermeiden oder minimieren

# Zahlenarten auf Rechenanlagen

## Ganze Zahlen (mit und ohne Vorzeichen)

- unproblematisch und exakt

## Festkommazahlen

<aside>
💡 Eine Festkommazahl ist eine Zahl, die aus einer festen Anzahl von Ziffern und einer festen Position des Kommas besteht.

</aside>

![Untitled](Untitled%2096.png)

- recht einfach zu handhaben
- begrenzte Reichweite und Genauigkeit

![Untitled](Untitled%201%2022.png)

## Gleit- oder Fließkommazahlen

<aside>
💡 Eine Gleitkommazahl/Fließkommazahl ist eine Zahl, die aus einer festen Anzahl von Ziffern und einer variablen Position des Kommas besteht. (Vorzeichen, Mantisse, Exponent)

</aside>

- komplizierter
- für numerische Zwecke unverzichtbar

![Untitled](Untitled%202%2021.png)

<aside>
💡 Normalisierung: Erste Ziffer der Mantisse (Ziffernstellen vor der Potenz) ist immer von Null verschieden. Außer die Zahl 0.

</aside>

### Eigenschaften

Die Mantisse habe eine Länge von 10 und der Exponent liege zwischen -99 und 99:

- Auslöschung

![Untitled](Untitled%203%2019.png)

- Absorption

![Untitled](Untitled%204%2017.png)

- Unterlauf

![Untitled](Untitled%205%2017.png)

- Rechengesetze (Assoziativität und Distributivität) gehen verloren

### Nach IEEE Standart

![Untitled](Untitled%206%2016.png)

![Untitled](Untitled%207%2015.png)

### Rundungsfehler

![Untitled](Untitled%208%2015.png)

# Zahlendarstellung und Rundungsfehler - Axiom der Gleitkomma-Arithmetik

![Untitled](Untitled%209%2015.png)

# Kondition

<aside>
💡 Die Kondition eines Problems beschreibt, wie sich Störungen der Eingangsdaten auf das Ergebnis unabhängig vom konkreten Algorithmus auswirken. Die Kondition ist damit nur vom Problem abhängig und nicht vom gewählten Lösungsweg (Algorithmus).
Die Kondition ist damit ein Maß für die bei exakter Rechnung bestenfalls zu erzielende Genauigkeit, wenn die Eingabedaten gestört sind.

</aside>

![Untitled](Untitled%2010%2015.png)

![Untitled](Untitled%2011%2015.png)

![Untitled](Untitled%2012%2015.png)

## Beispiele

### Schnittpunkt zweier Geraden

![Untitled](Untitled%2013%2013.png)

### Multiplikation

$eps=Maschinengenauigkeit$

$\epsilon=Ungenauigkeit\ der\ Eingabedaten, \epsilon\le eps$

![Untitled](Untitled%2014%2013.png)

![Untitled](Untitled%2015%2012.png)

**Gute Kondition**

### Subtraktion

![Untitled](Untitled%2016%2012.png)

Schlechte Kondition, wenn zwei Input Zahlen nah aneinander liegen.

# Stabilität

![Untitled](Untitled%2017%2011.png)

<aside>
💡 Ein Algorithmus heißt gutartig oder stabil, wenn die durch ihn im Laufe der Rechnung erzeugten Fehler in der Größenordnung des durch die Kondition bedingten unvermeidbaren Fehlers bleiben.

</aside>

## Anmerkung

![Untitled](Untitled%2018%2010.png)

## Beispiel

![Untitled](Untitled%2019%2010.png)

![Untitled](Untitled%2020%2010.png)