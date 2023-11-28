---
related:
  - "[[HWR]]"
  - "[[1. Semester]]"
created_at: 29-10-2022 15:34
tags: []
prof: Laura Haase
---

## Motivation

- Komplexe Sachverhalte auf algorithmisch umsetzbares Niveau herunterbrechen
- Verständnis für Parser und Rechnerarchitektur erhalten

## DEA - Akzeptor
- Eingabealphabet
- Zustandsmenge
- Zustandsübergangstabelle/-funktion
- Startzustand
- Menge der Endzustände
A = { Σ, S, $\delta$, $s_{0}$, F }

## NEA

Überführungsfunktion enthält jetzt Mengen

Zu jeden NEA existiert ein äquivalenter DEA und umgekehrt.

# Reguläre Ausdrücke

"Bauanleitung" für Wörter, die nur nach bestimmten Regeln erstellt werden sollen.

### Operatoren

![image (4).png](image_(4)%207.png)

# Sprache

Eine Sprache L is eine Menge von Zeichenreihen aus $\Sigma^*$.

($\Sigma^*$ Menge aller Wörter über $\Sigma$)

![image 10.png](image%2010.png)

**Beispiel:**

![image (1).png](image_(1)%206.png)

$L = \{(a|b)^na(a|b)(a|b)|n\gt0\}$

$L=\{w\in \{a, n\}|\ w\ enthält\ als\ drittletztes\ Zeichen\ ein\ a\}$

## Grammatiken

[Grammatiken](https://hpi.de/friedrich/teaching/units/grammatiken.html)

[{Regex} In welche Chomsky-Klasse gehören regular expressions? @CODEKICKER](http://codekicker.de/fragen/In-welche-Chomsky-Klasse-gehoeren-regular-expressions/369)

Grammatiken sind ein erzeugendes Konzept für Sprachen.

Sie geben Regeln zur Ableitung aller Worte der Sprache an.

**Formale Definition**
- Terminale
- Nichtterminale
- Produktionsregel
- Startsymbol
$G=(T, N,P,S)$

# Pumping Lemma

Es wird für den Nachweis genutzt, dass eine Sprache NICHT regulär ist.

![image (3).png](image_(3)%208.png)

![image (4).png](image_(4)%201%202.png)

**Beispiel 1:**

![image (5).png](image_(5)%207.png)

**Beispiel 2:**

![Untitled](Untitled%20105.png)

# Chomsky Hierarchie

![Screenshot 2021-12-02 130425.png](Screenshot_2021-12-02_130425.png)

## Typ 3

- Keine Benötigung vom Speicherplatz
- Einfachste aber eingeschränktesten Automaten
- nur ein Nichtterminal und ein Terminal auf rechte Seite

![image (2).png](image_(2)%209.png)

## Typ 2

- Automaten mit Stack
- nur ein Nichtterminal auf linke Seite
    
    → Kontextfrei
    
- Kellerautomat

![image (27).png](image_(27)%203.png)

![image (28).png](image_(28)%204.png)

## Typ 1

- Kontextsensitiv
- links Anzahl Terminale und Nichtterminale ≤ als rechts
    
    → man kann nur Elemente hinzufügen und nicht mehr löschen
    
- Speicherplatz berechenbar

## Typ 0

- Rekursiv Aufzählbar, Speicherplatz unberechenbar
- keine Einschränungen
- Turing Maschine

# Transduktor - Mealy Machine

Ausgabe eines Übergangs

**Ausgabe an Kanten**
- Eingabealphabet
- Ausgabealphabet
- Zustandsmenge
- Zustandsübergangestabelle/-funktion
- Ausgabetabelle/-funktion
- Startzustand
$A=(\sum, \Delta, S, \delta, \lambda,  s_0)$

# Moore Machine

Ausgabe eines Zustands

**Ausgabe an Zuständen**
- Eingabealphabet
- Ausgabealphabet
- Zustandsmenge
- Zustandsübergangstabelle/-funktion
- Ausgabetabelle/-funktion
- Startzustand
$A=(\sum, \Delta, S, \delta, \lambda,  s_0)$

# Turing Maschine

![image (12).png](image_(12)%204.png)

### Beispiel für $L=\{a^nb^nc^n|\ n \geq 1\}$

![image (13).png](image_(13)%205.png)

Zustandübergangstabelle

![image (14).png](image_(14)%203.png)

T={{a,b},

{q0, q1, q2, q3, q4},

{a,b,#},

Übergangstabelle siehe unten,

q0,

#,

{q1}}

| Aktueller Zustand | Zeichen | Zustand | geschriebenes Zeichen | Kopfbewegung |
| --- | --- | --- | --- | --- |
| q0 | # | q1 | # | N |
| q0 | x | q0 | x | R |
| q0 | a | q2 | x | R |
| q2 | x | q2 | x | R |
| q2 | a | q2 | a | R |
| q2 | b | q3 | x | R |
| q3 | b | q4 | x | N |
| q4 | x | q4 | x | L |
| q4 | a | q4 | a | L |
| q4 | x | q4 | x | R |
| q4 | # | q0 | # | R |

## Entscheidende Turingmaschine

![Untitled](Untitled%201%2030.png)

# Zur Problemlösung

- Probleme können in Sprachen kodiert werde.
- Probleme können Entscheidbar oder Unentscheidbar sein

Gibt es für ein entscheidbares Problem einen effizienten Algorithmus?

![Untitled](Untitled%202%2029.png)

Polynomial Algorithmen werden im Allgemeinen als effizient betrachtet