---
related:
- "[[Graphentheorie]]"
created_at: "29-10-2022 15:46"
---


# Definitionen

**Graph** $G =\{V, E\}$ besteht aus einer endlichen Menge V (Vertex) von **Knoten** und einer Menge E (Edge) von **Kanten** $\{a, b\}$ mit $a, b \in V, a \ne b$.

Eine **Kante** $\{a, b\}$ verbindet also immer zwei Knoten a, b. Diese beiden Knoten heißen die Endknoten der Kante.

**Adjazent**: Zwei benachbarte Knoten

**Inzident**: Zwei Kanten mit genau einen gemeinsamen Endknoten oder ein Knoten der Endknoten einer Kante ist.

**Grad**: d(a) Anzahl der Kanten die inzident zu einem Knoten sind. (degree)

**Isoliert**: Wenn der Grad des Knoten null ist.

# Graphen

**Planarer Graph:** Ein Graph für den eine graphische Darstellung ohne kreuzende Kanten möglich ist.

**Vollständiger Graph:** Ein Graph bei dem es zwischen je zwei Knoten eine Kante gibt.

**Teilgraph:** Ein Graph **$H = (V', E')$** mit $V'\subseteq V$ und $E' \subseteq E$. 

**Multigraph**: Graph mit Schlingen und Mehrfachkanten.

**Zusammenhängender Graph**: [siehe unten](Grundbegriffe.md)

**Gewichteter Graph**: [siehe unten](Grundbegriffe.md)

# **Äquivalent/Isomorph**

![image (13).png](image_(13)%207.png)

# **Digraph**

![image (14).png](image_(14)%205.png)

![image (10).png](image_(10)%209.png)

(**Kardinalität**: Anzahl der Elemente, die in einer Menge M enthalten sind. $card(M) = |M|$  )

![image (12).png](image_(12)%206.png)

# **Zusammenhängender (Di-)Graph**

![image (25).png](image_(25)%205.png)

![image (28).png](image_(28)%206.png)

![image (29).png](image_(29)%205.png)

![image (30).png](image_(30)%203.png)

# Gewichteter Graph

![image 12.png](image%2012.png)

## Länge eines Weges

![image (6).png](image_(6)%209.png)

# Kantenfolgen, Kantenzug, Wege, Kreise

![image (19).png](image_(19)%206.png)

## Geschlossener Euler-Zug

![image (12).png](image_(12)%201%203.png)

![image (13).png](image_(13)%201%201.png)

![Untitled](Untitled%20108.png)

### Algorithmus von Fleury

![image (14).png](image_(14)%201%201.png)

## Hamilton-Kreis

![image (13).png](image_(13)%202%201.png)

![image (14).png](image_(14)%202%201.png)

![image (15).png](image_(15)%206.png)