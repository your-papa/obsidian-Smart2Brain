---
related:
  - "[[HWR]]"
  - "[[4. Semester]]"
created_at: 02-02-2023 15:05
tags: []
prof: Rainer Höhne
aliases:
  - Datamining
---

# Grundlagen
---
## Merkmale/Variablen
![[image (26).png|800]]

Interval = Metrisch

## Mittelwert
![[image (23).png]]

Kennt man

## Varianz
![[image (24).png]]

Maß der Zerstreuung eines Datensatzes.
Kleine Varianz: Daten liegen nah am Durchschnitt
Große Varianz: Daten liegen weiter weg vom Durchschnitt
(Differenz zwischen einem Datenelement und Durchschnitt wird **²** um negative Differenz positiv zu machen)

## Standardabweichung
![[image (25).png]]

Wurzel von der Varianz um den Effekt des **²** zu eliminieren
Gibt an wie weit man im Durchschnitt vom Mittelwert entfernt ist.

# Korrelation
---
**Korrelation UNGLEICH Kausalität:** [Great Khan Video](https://www.youtube.com/watch?v=ROpbdO-gRUo)

## Für metrische Datensätze
![[image (16) 1.png]]

[Great Khan Video on Korrelationskoeffizient](https://www.youtube.com/watch?v=u4ugaNo6v1Q)

### Cauchy-Schwartz'sche Ungleichung
![[image (19).png|700]]

kor(x,y) = 1 => linear abhängig
![[image (17).png|700]]

kor(x,y) = -1 => gegenläufig linear abhängig
![[image (18).png|700]]

kor(x,y) = 0 => linear unabhängig

## Korrelogram - Beispiel Lebenszufriedenheit
Jeder Punkt ist ein Land
![[image (20).png|1400]]
![[image (21) 2.png|1400]]

## Rangkorrelationskoeffizient (Für ordinale Datensätze)
![[image (27).png]]

Beweis in Folien

# [[Entropy]]
# [[Regression Problems]]
# [[Dimensionality Reduction]]
# [[Classification Problems]]
# [[Clustering Problems]]

# Prof Präsi
---
- [[DA.pdf]]
- ([[DApresI.pdf]], [[DApresII.pdf]])
- Klausurvorbereitung: [[DAKlausur20.pdf]]