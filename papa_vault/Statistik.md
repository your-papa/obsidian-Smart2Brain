---
related:
  - "[[HWR]]"
  - "[[4. Semester]]"
created_at: 14-02-2023 18:32
tags: []
prof: Tobias Wannemacher
---


# Prof Präsi
---
- [[Formelsammlung.pdf]]
- [[Handout 1.pdf]]
- [[Handout 2.pdf]]
- [[Handout 3.pdf]]
- [[Handout 4.pdf]] 
- [[Klausurvorbereitung IT inkl lösung.pdf]]

# Zufällige Ereignisse und ihre Wahrscheinlichkeiten
---
## Klassische Wahrscheinlichkeitsdefinition nach LAPLACE
![[image (50).png]]

## Häufigkeitsdefinition von MISES
![[image (51).png]]

## Relationen und Verknüpfung zufälliger Ereignisse
![[image (52).png]]

## Axiomsystem von KOLMOGOROW
![[image (53).png]]

## Bedingte Wahrscheinlichkeit
---
![[image (54).png]]

### Multiplikationssatz
![[image (55).png]]

### Satz der totalen Wahrscheinlichkeit
![[image (56).png]]

### Formel von Bayes
![[image (57).png]]

## Stochastisch unabhängige Ereignisse
![[image (58).png]]

# Zufallsvariable und ihre Verteilung
---
## Zufallsvariable
![[image (59).png]]

## Diskrete Zufallsvariable
---
![[image (60).png]]

### Binomialverteilung
Wahrscheinlichkeit bleibt gleich (meisten mit zurücklegen)
Kann auch bei Probleme mit ohne Zurücklegen angewendet werden wenn man auf die Messwerte der Vergangenheit (bestimmtes Intervall) schaut und Annahmen trifft (Deskriptive Statistik).
![[image (61).png]]

### Hypergeometrische Verteilung
Wahrscheinlichkeit ändert sich (ohne Zurücklegen)
![[image (62).png]]
N = Umfang der Gesamtheit
M = Anzahl der Merkmalsträger in N
n = Stichprobenumfang

**Beispiel**
![[image (64).png|800]]

### Poisson-Verteilung
![[image (63).png]]
$\lambda$ = mittlere Zahl der Ereignisse pro Raum (e.g. Intervall)

**Beispiel**
![[image (67).png|800]]

### Vergleich
![[image (68).png|800]]

## Stetige Zufallsvariable
---
Unendlich viele kontinuierliche Ereignisse
Das genaue erfassen der Wahrscheinlichkeit aller Nachkommastellen ist nicht möglich:
![[image (70).png|800]]

Man teilt im folgenden durch h, weil sonst die Wahrscheinlichkeit in dem Intervall h gegen null laufen würde
-> Diagramm wenig Aussagekraft:
![[image (71).png|600]]
Durch das Teilen von h:
**Verteilungsfunktion** ($f(x)$ ist Wahrscheinlichkeit wo Summe aller gleich 1 ist) 
-> **Dichtefunktion** ($f(x)$ ist keine Wahrscheinlichkeit, aber Fläche unter $f(x)$ ist 1)
Um Wahrscheinlichkeit zu berechnen muss man Integrieren:
![[image (69).png]]

### Stetige Gleichverteilung (LAPLACE)
gleiche Wahrscheinlichkeit aller Zufallsvariablen x in dem Intervall $[a,b]$

Erwartungswert:
![[image (73).png|800]]

Varianz:
![[image (74).png|800]]

### Exponentialverteilung
![[Screenshot 2023-03-02 085849 (1).png]]

### Normalverteilung
![[image (14) 2.png]]
$N(0,1)$ entspricht $\mu = EX=0$ und $\sigma=1$ nachdem man $f(x)$ normalisiert hat durch das was in $\phi$ steht
$\phi$ wurde approximiert und kann von einer Tabelle abgelesen werden

### Vergleich
![[image (75).png|1000]]

# Verteilungsparameter
---
Eigenschaften von Erwartungswert und Varianz
![[image (15) 2.png]]

## Gesetz der großen Zahlen
![[image (79).png]]

## Grenzwertsatz
![[image (80).png]]

<iframe width="560" height="315" src="https://www.youtube.com/embed/zeJD6dqJ5lo" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>

# Einführung in die Testtheorie
---
![[image (81).png]]

## Arten statistischer Tests
![[image (82).png]]
![[image (83).png]]

## Fehler erster und zweiter Art
![[image (84).png]]
![[image (85).png]]

## Prüfung von Anteilen
![[image (86).png]]
$N(0,1)$ ist die Normalverteilung

## Prüfung von Durchschnitten bei bekannter Varianz
![[image (87).png]]

![[Pasted image 20230309104403.png]]
![[Pasted image 20230309104545.png]]
![[Pasted image 20230309105038.png]]

## Prüfung von Durchschnitten bei unbekannter Varianz
![[Pasted image 20230309105336.png]]
$t_{n-1}$ entspricht t-Verteilung