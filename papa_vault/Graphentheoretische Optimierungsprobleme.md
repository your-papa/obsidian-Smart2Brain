---
related:
- "[[Graphentheorie]]"
created_at: "29-10-2022 15:51"
---


# Shortest Path Problem (SPP)
---
**Dijksta-Algorithmus** zur Bestimmung eines kürzesten Weges von einem Startknoten zu allen anderen Knoten, wobei $w(i,j)\geq 0$.

![image (7).png](image_(7)%209.png)

![image (8).png](image_(8)%208.png)

[https://www.youtube.com/watch?v=KiOso3VE-vI&ab_channel=Algorithmenverstehen](https://www.youtube.com/watch?v=KiOso3VE-vI&ab_channel=Algorithmenverstehen)

## Eigenschaften
![image (9).png](image_(9)%207.png)

# Floyd-(Warschall-)Algorithmus
---
Zur Bestimmung der jeweiligen Länge eines kürzesten Weges von jedem Knoten i zu allen anderen Knoten.
![image (10).png](image_(10)%208.png)

### (Re-)Konstruktion der in P gespeicherten kürzesten Wege
![Untitled](Untitled%20107.png)

### Korrektheit
![image (12).png](image_(12)%205.png)

# Traveling Salesman Problem (NP-Vollständig)
---
![image (4).png](image_(4)%209.png)

![image (5).png](image_(5)%209.png)

![image (6).png](image_(6)%208.png)

**Bei n Städte ⇒ $(n-1)!$**  **verschiedene Rundreisen**

Beispiel: 10 Städte: $9!=362 880$

Beim symmetrischen TSP brauchen nur $\frac{9!}{2}$Rundreisen betrachtet werden, weil es eine gleiche Reise nur in die andere Richtung geben würde. Deswegen durch 2

## Heuristiken (liefert keine exakte Lösung)
![image (8).png](image_(8)%201%203.png)

![image (9).png](image_(9)%201%202.png)

![image (22).png](image_(22)%205.png)

## Beispiele zu den Heuristiken
![image (10).png](image_(10)%201%201.png)

### Nearest Neighbour
![image (11).png](image_(11)%207.png)

### Farthest-Insert
![image (12).png](image_(12)%201%202.png)
![image (13).png](image_(13)%206.png)
![image (14).png](image_(14)%204.png)
![image (15).png](image_(15)%205.png)
![Untitled](Untitled%201%2031.png)
![Untitled](Untitled%202%2030.png)
![image (20).png](image_(20)%204.png)
![image (19).png](image_(19)%205.png)
![image (21).png](image_(21)%205.png)

### Minimum-Tree-Aproximation
1. MST bestimmen mit Kruskal Algorithmus:
    ![image (23).png](image_(23)%203.png)
	
2. Kanten verdoppeln
    ![image (24).png](image_(24)%205.png)
    
3. Eulerzug bestimmen
    ![image (25).png](image_(25)%204.png)
    
4. "Abkürzungen" finden
    
    ![image (26).png](image_(26)%205.png)

## Gütegarantien und Laufzeit
![image (27).png](image_(27)%206.png)

# Clique - Anwendungsbeispiel (NP-Vollständig)
---
![image (35).png](image_(35)%202.png)

### Beispiel
![image (36).png](image_(36)%201.png)

**Cliquen**
$C_1=\{S_4, S_5, S_6\}$
$C_2=\{S_1, S_7, S_6\}$
$C_3=\{S_2, S_3, S_8\}$

## Unabhängige Mengen
![image (37).png](image_(37)%201.png)

## Komplementärgraph
![image (39).png](image_(39)%201.png)
Cliquen im Komplementärgraph sind unabhängige Mengen

# Chromatische Zahl
---
![image (38).png](image_(38)%201.png)

### Anwendungsbeispiel
![image (40).png](image_(40)%201.png)
![image (41).png](image_(41)%201.png)
![image (42).png](image_(42)%201.png)

![image (43).png](image_(43)%201.png)

$w(G)$ ist die Cliquengröße

# Sequential Coloring Algorithmus (NP-Vollständig)
---
![image (44).png](image_(44)%201.png)

### Beispiel
![image (45).png](image_(45)%201.png)

optimale Färbung, weil Cliquengröße gleich Färbungszahl

![image 11.png](image%2011.png)

![image (1).png](image_(1)%208.png)

![image (3).png](image_(3)%2010.png)

### Beispiel
![image (2).png](image_(2)%2011.png)

Nicht optimal: Färbungszahl größer als Cliquengröße=2