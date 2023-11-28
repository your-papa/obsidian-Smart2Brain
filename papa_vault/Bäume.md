---
related:
- "[[Graphentheorie]]"
created_at: "29-10-2022 15:50"
---


# Definition

![image (15).png](image_(15)%203.png)

![image (16).png](image_(16)%204.png)

![image (17).png](image_(17)%206.png)

![image (18).png](image_(18)%204.png)

![image (19).png](image_(19)%204.png)

![image (20).png](image_(20)%203.png)

![image (21).png](image_(21)%204.png)

![image (10).png](image_(10)%207.png)

![image (22).png](image_(22)%204.png)

→ Kein Baum
![image (24).png](image_(24)%204.png)

# Minimal aufspannender Baum
---
![image (1).png](image_(1)%207.png)

## Algorithmus von Kruskal zur Bestimmung eines MST
![image (3).png](image_(3)%209.png)

![image (2).png](image_(2)%2010.png)

1. Sortieren der Kanten$\{a,g\},\{g,e\},\{f,e\},\{e,d\},\{d,g\},\{b,c\},\{a,b\},\{c,d\},\{b,g\},\{c,g\},\{f,g\},\{a,f\}$
2. $T=(V,E(T))$
    
    $T=(V,E(T))$$V=\{a,b,c,d,e,f,g\}$
    $E(T)=\{\{a,b\},\{g,e\},\{e,f\},\{d,e\},\{b,c\},\{b,a\}\}$
    
    ![image (4).png](image_(4)%208.png)
    
    $T$ ist ein maximal aufspannender Baum mit Gewicht: $1+2+3+3+5+6=20$
    

## Bemerkung zum Kruskal Algorithmus

![image (5).png](image_(5)%208.png)

**Antwort**: Nach teuerstem Gewicht sortieren und teuerste Kante dazu nehmen.

# Wurzelbaum

Zur Speicherung von Daten

![Untitled](Untitled%20106.png)

## Binärer Suchbaum

![image (26).png](image_(26)%203.png)

![image (27).png](image_(27)%204.png)

![image (28).png](image_(28)%205.png)

## Divide and Conquer

![image (29).png](image_(29)%204.png)

## Speicherplatz

In einem binären Wurzelbaum der Länge l können maximal $n$ Daten gespeichert werden.

$$
n=\displaystyle\sum_{k=0}^{l}2^k=\dfrac{l^{l+1}-1}{x-1}
$$

## Suchaufwand

Suchaufwand: $O(l)=O(\log n)$