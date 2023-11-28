---
related:
  - "[[HWR]]"
  - "[[4. Semester]]"
created_at: 17-01-2023 17:17
tags: []
prof: Nicola Winter
---


# Prof Präsis
---
- [[Folien_Optimierung_2023_Teil1_Druckversion1.0_print.pdf]]
	- [[Folien_Optimierung_2023_Teil1_V1.0_Folien35-36 1.pdf]]
	- [[Scan_SimplexAbbruchkriterium_zuFolie38.pdf]]
	- [[Simplexverfahren_2-Phasen_BspLV_2023_Druckversion1.0_print.pdf]]
	- [[Beispiel_Dualität_Transportproblem.pdf]]
- [[Folien_Optimierung_2023_Teil2_Druckversion1.0_print.pdf]]
- [[Folien_Optimierung_2023_Teil3_Druckversion1.0_print.pdf]]

Übungen:
- [[1.Übung_mitLösung (1).pdf]]
- [[2.Übung_mitLösung.pdf]]
- [[3.Übung_mitLösung.pdf]]
- [[4.Übung_mitLösung.pdf]]
- [[5.Übung_mitLösung.pdf]]

Klausurvorbereitung:
- [[Klausurmaterial.pdf]]


# Allgemeines Optimierungsproblem
---
- Minimiere/Maximiere eine Zielfunktion
- unter gewissen, gegebenen Nebenbedingungen, die die Menge der zulässigen Lösungen definieren 
- mit gewissen Variablen, von denen die Zielfunktion und/oder die Nebenbedingungen abhängen
![[image (43).png]]


## Aufstellen des mathematischen Modells
---
1. Variablen beschreiben
2. Zielfunktionen $z(\vec{x})$ aufstellen
3. Nebenbedingungen aufstellen (subject-to or s.t.)

### Klassifikation
Klassifikation nach Struktur der Zielfunktion und der Nebenbedingungen sowie nach Variablentypen:
1. Zielfunktion: linear, quadratisch, nicht-linear, differenzierbar
2. Nebenbedingungen:
	- keine
	- lineare
	- nicht-lineare
	- Gleichungen / Ungleichungen
	- deterministisch oder stochastisch
3. Variablen: diskret, binär, kontinuierlich (rational, reell)

Für jede Problemstruktur/-klasse gibt es spezielle Verfahren

### Kanonische Form
![[image (15) 1.png]]

Umformung:
![[image (44).png]]

### Standardform
![[image (14) 1.png]]

Umformung:
![[image (45).png]]

# Geometrische Betrachtung
---
## Halbräume und Hyperebenen
![[image (46).png]]

## Polyeder
![[image (47).png]]

### Seiten
![[image (48).png]]

### Ecken
![[image (49).png]]

# Lösungsverfahren
---
## Graphisches Lösen
**Am Beispiel eines Lineares Optimierungsproblem**
![[image (31).png]]

1. Variablen:
	- $x_1$: Anzahl zu produzierenden Schachteln langer Streichhölzer (in 1.000.000)
	- $x_2$: Anzahl zu produzierenden Schachteln kurzer Streichhölzer (in 1.000.000)
2. Zielfunktion: max $3000x_1 + 2000x_2$
3. Nebenbedingungen st. (subject to)
	- $x_1 + x_2 \leq 9$
	- 3$x_1 + x_2 \leq 18$
	- $x_1 \leq 7$
	- $x_2 \leq 6$
	- $x_1,\ x_2 \geq 0$
	- $x_1,\ x_2:\  ganzahllig$
![[Pasted image 20230118100137.png]]

- Gesucht: der Punkt  (bzw. die Punkte $(x_1,\ x_2)$) in farbigen Bereich einschließlich Rand, für den die Zielfunktion maximal ist.
- Für einen festen Zielfunktionswert $z$ liefert $z=3000x_1 + 2000x_2$ eine Gerade $\Leftrightarrow z-3000x_1 = 2000x_2 \Leftrightarrow \frac{1}{2000}z-\frac{3}{2}x_1=x_2$ für deren Abstand zum Punkt ($\Phi$) umso größer ist, je größer $z$ ist -> Parallelverschiebung.
- Für den optimalen Zielfunktionswert liegt die Steigung dieser Geraden zwischen den Steigungen der Randgeraden.
  Steigungen: -1, -3
  => optimale Lösung entspricht Schnittpunkt der Geraden mit Steigung -1 und -3
  => $x_1 = 4,5$
  => $x_2 = 4,5$
  => 22.500€ Profit ist der optimale Zielfunktionswert

## Simplexverfahren
---
Weiteres Lösungsverfahren
Grundidee: Von Ecke zur Ecke besseres Optimum
#TODO

### Herleitung des Tableaus
[[Folien_Optimierung_2023_Teil1_V1.0_Folien35-36.pdf]]

### Primal und Dual

```start-multi-column
ID: ID_kt30
Number of Columns: 2
Largest Column: standard
border: off
```


![[image - 2023-03-25T214122.435.png]]
--- column-end ---

![[image - 2023-03-25T214125.624.png]] 

=== end-multi-column
Beispiel:
![[image - 2023-03-25T210949.486.png|900]]

Zusammenhang primal & dual
![[image - 2023-03-25T212329.311.png|900]]
![[image - 2023-03-25T212516.896.png|900]]
![[image - 2023-03-25T212720.445.png|900]]
![[Pasted image 20230326140627 1.png]]

Ökonomische Interpretation:
![[image - 2023-03-25T213117.632.png|900]]
![[image - 2023-03-25T213255.884.png|900]]
![[image - 2023-03-25T213341.336.png|900]]

Zusammenfassung
![[image - 2023-03-25T213356.176.png|900]]

### Zusammenfassung
![[image - 2023-03-25T214015.668.png|900]]

# LP-Probleme
---
## Rucksackproblem
---
### Mathematisches Modell
![[image (37).png]]
![[image (39).png]]

### Relaxierte Problem (Nicht-Ganzzahlige Lösung)
Schnell polynomial lösbar
![[image (32).png]]
![[image (33).png]]

### Branch & Bounds Algorithmus (Ganzzahlige Lösung)
Liefert optimale Lösung aber [[NP-Problem]](keine Heuristik)
![[image (34).png]]
![[image (35).png]]
"Zutaten":
![[image (36).png]]

**Beispiel:**
![[image (40) (1).png]]

### Greedy Heuristiken
- Zielfunktionsgreedy
![[image (41).png]]
- Gewichtsdichtengreedy
![[image (42).png]]

### Beispiel
[[3Ubung_230221_164518_1.pdf]]

## Traveling Sales Man Problem
---
![[image 14.png]]

### [[Graphentheoretische Optimierungsprobleme#Heuristiken (liefert keine exakte Lösung)|TSP Heuristiken]]

### Verbesserungsverfahren
![[image (1) 1.png]]

### 2-OPT
![[image (2) 1.png]]

![[Optimierungsverfahren 2023-02-22 08.17.40.excalidraw]]
Wenn der Austausch vom Gesamtgewicht der beiden Kanten kleiner wird dann ist eine neue kürzere Tour entstanden.
Das für alle Kanten in K. Anzahl $=\frac{|V|*(|V|-3)}{2}$
$|V|-3$ weil Nachbarkanten nicht genommen werden können.
$\frac{}{2}$ weil 2 Kanten nur einmal gezählt werden sollen
- Es ist nicht bekannt, ob 2-OPT ein "schnelles" (d.h. ein polynomiales) Verfahren ist.
- 2-OPT findet lediglich ein lokales Optimum (sofern man das Verfahren bis zum Ende ausführt)

## Maximal-Fluss-Problem
---
### Definition
![[image (3) 1.png]]

![[image (4) 1.png]]

### MFP als LP
![[image (5) 1.png]]

Beispiel Knoten-Kanten-Inzidenz-Matrix:
![[Pasted image 20230324113544.png|800]]

### Ford-Fulkerson-Algorithmus
<iframe width="560" height="315" src="https://www.youtube.com/embed/LdOnanfc5TM" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
![[image (6).png]]
![[image (7).png]]
![[image (8).png]]
![[image (9).png]]

### s-t-Schnitt
![[image (10).png]]

### Max-Flow-Min-Cut-Theorem
![[image (11).png]]
s-t-Schnitt ist das Dual System zum primalen
💡Ein minimaler s-t-Schnitt beschreibt die Engpässe, die den maximalen Durchfluss durch das Netzwerk begrenzen d.h. das Min-Cut-Problem entspricht der Suche nach "Bottlenecks"

### Beispiel
von der 2. Iteration aus
![[Optimierungsverfahren 2023-02-22 09.07.44.excalidraw|700]]
💡Ein minimaler s-t-Schnitt beschreibt die Engpässe, die den maximalen Durchfluss durch das Netzwerk begrenzen d.h. das Min-Cut-Problem entspricht der Suche nach "Bottlenecks"

## Min Cost Flow Problem
---
### Definition
![[image (98).png]]
![[image (100).png]]

### MCF als LP
![[image (99).png]]

### Zusammenhang flusserhöhende Wege & kostenminimale Flüsse
![[image - 2023-03-24T122234.430.png]]

### Augmeniterendes Netzwerk
![[image - 2023-03-24T122942.892.png]]

### Zusammenhang augmentierendes Netzwerk und flusserhöhende Wege
![[image - 2023-03-24T123126.596.png]]

### Flusserhöhungsalgorithmus
![[image - 2023-03-24T123216.648.png]]

[[Graphentheoretische Optimierungsprobleme#Floyd-(Warschall-)Algorithmus|Floyd-(Warshall-)Algorithmus]] - Länge eines kürzesten Weges von jedem Knoten i zu allen anderen Knoten

### Beispiel
![[image (88).png]]

![[image (89).png]]

![[image (90).png]]

![[image (91).png]]

![[image (92).png]]

![[image (93).png]]

![[image (94) 1.png]]

## Bin Packing Problem
---
### Definition
![[image - 2023-03-24T123612.229.png]]

### Heuristiken
- First Fit
- Best Fit
- Worst Fit
- Almost-Worst-Fit
- First-Fit-Decreasing
- Best-Fit-Decreasing

### Online-Heuristiken
![[image - 2023-03-24T124101.669.png]]

### Beispiel
![[image (95).png]]
![[image (96).png]]
Optimal 3 Kisten
 
![[image (97).png]]
# Zusammenfassung
---
![[image - 2023-03-24T123958.765.png]]