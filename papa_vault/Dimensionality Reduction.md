---
related:
- "[[Datenanalyse]]"
- "[[Artificial Intelligence]]"
created_at: "27-08-2023 20:46"
---

# Hauptkomponenten Analyse (PCA)
---
#TODO: SVD?
Big high dimensional Data with statistical distributions -> reduced to low dimensional space without losing to much information
filtering out key correlations of data

https://www.youtube.com/watch?v=g-Hb26agBFg
https://www.youtube.com/watch?v=FgakZw6K1QQ

1. Werte Mittelwert-zentrieren -> erleichtert Berechnung der Varianzen
2. Covarianzmatrix (Transformation auf Verteilung der Ursprünglichen Werte)
	- Jede Varianz zwischen Dimensionen ausrechnen
	- Größte Varianz/Covarianz ist beste Klassifizierung (Werte am größten Verteilt, größter Unterscheidungsfaktor)
3. Eigenwerte berechen
	- reduziert enthaltende Informationen der Covarianzmatrix auf niedrigere Dimensionen
	- Höchster Eigenwert gibt an Einfluss der größten Hauptkomponente
4. Eigenvektoren berechen und normieren
	- bilden Koordinatenachsen des reduzierten 2/3D Diagramms was wir interpretieren können
	- Eigenvektoren stehen senkrecht zueinander (dadurch das Covarianzmatrix immer symmetrisch ist)
![[image (28).png]]