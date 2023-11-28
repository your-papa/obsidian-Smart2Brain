---
related:
- "[[Logik]]"
created_at: "29-10-2022 15:25"
---


# Atom (Elementaraussage)

# Verknüpfung von Atomen (Junktoren)

![image 6.png](image%206.png)

## Konditionale Wahrheitstabelle

![image (1).png](image_(1)%204.png)

In der Mathematik verwendet man ⇒ um eine inhaltliche Folgerung auszudrücken und <⇒ in beide Richtungen eine Folgerung

alle Atomen sind Formeln

## Bikonditionale Wahrheitstabelle

![image (2).png](image_(2)%204.png)

# Formeln

![Untitled](Untitled%20100.png)

[http://wahrheitstabelle.daug.de/#/tabelle](http://wahrheitstabelle.daug.de/#/tabelle)

## Interpretation, Belegung

Setzte Atom auf wahr oder falsch 

Beispiel bei Atomen A, B und C: I(A)= 0, I(B)= 1, I(C)= 0

![image (3).png](image_(3)%204.png)

![image.png](image%201%203.png)

![image (1).png](image_(1)%201%202.png)

# De Morgansche Regeln

![image (34).png](image_(34)%201.png)

# Normalformen

Ein Literal bezeichnet ein Atom (positives Literal) oder seine Negation (negatives Literal) oder einen konstanten Wahrheitswert 0 oder 1.

Beispiel: Ist A ein Atom, sind A und $\neg A$ Literale.

## DNF - Disjunktive Normalform

![Untitled](Untitled%201%2026.png)

![image (42).png](image_(42).png)

## KNF - Konjunktive Normalform (auf oben angewand)

![Untitled](Untitled%202%2025.png)

![image (43).png](image_(43)%201.png)

# Folgerung

![image (44).png](image_(44).png)

![image (45).png](image_(45).png)

1. ⇒ ii. ⇒ iii. ⇒ i.
    
    ![image (9).png](image_(9)%203.png)
    

(KNF-Formel: **SAT** - Ist eine Formel in KNF erfüllbar? **NP-Problem)**

# Hornformel

![image (11).png](image_(11)%203.png)

Beispiel

![Untitled](Untitled%203%2022.png)

![image (16).png](Files/image_(16)%201.png)

![image (17).png](image_(17)%202.png)

![Untitled](Untitled%204%2020.png)

# Resolution

![image (21).png](image_(21)%202.png)

**Beispiel**

![image (22).png](image_(22)%202.png)

## Klauselmenge

![image (23).png](Files/image_(23)%201.png)

Alle Formeln sind äquivalent

![image (24).png](image_(24)%201.png)

## Resolvent

![image (25).png](image_(25)%201.png)

**Beispiel**

![image (26).png](image_(26)%201.png)

### Satz, F geschnitten Resolvent

![image (27).png](image_(27)%201.png)

**Beweis**

![image (28).png](image_(28)%201.png)

### Satz, endliche Klauselmenge

![image (29).png](image_(29)%202.png)

![image (30).png](image_(30)%201.png)

![image (31).png](image_(31)%202.png)

Formel unerfüllbar, da Resolvent $K_7=\empty$