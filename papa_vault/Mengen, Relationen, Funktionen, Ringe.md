---
related:
- "[[Diskrete Mathematik]]"
created_at: "29-10-2022 15:05"
---


# Aussage
---
Es gibt drei wichtige Definitionsebenen bei Aussagen:
- **Syntax**: Reihenfolge und Bindung
- **Semantik**: Bedeutung, Wahrheitswert (wahr oder falsch)
→ Beides muss erfüllt sein, damit ein Satz als eine Aussage gilt.

### Verknüpfung/Junktor
![Untitled](Untitled%2099.png)

# Menge
---
Unter einer **Menge** verstehen wir jede Zusammenfassung M von bestimmten wohlunterschiedenen Objekten (m) unserer Anschauung oder unseres Denkens (welche die Elemente von M genannt werden) zu einem Ganzen. *Georg Cantor*

Ist m Element von M? Muss eindeutig entschieden werden können
![Untitled](Untitled%201%2025.png)
Zwei Mengen $A, B \ne \text{\O}$ sind Disjunkt, wenn $A \bigcap B = \text{\O}$

## Potenzmenge
Gegeben ist $M:=\{a,b,c\}$. Wir geben $P(M)$ explizit an:
- $P(M)$ ist die Menge, die alle Teilmengen von M enthält. Explizit:
- $P(M)=\{\emptyset,\{a\},\{b\},\{c\},\{a,b\},\{a,c\},\{b,c\},M\}$
Bemerkung: $|M|$ impliziert $|P(M)|=2^{|M|}$

## Kartesisches Produkt
![Untitled](Untitled%202%2024.png)

![Untitled](Untitled%203%2021.png)

## Binäre Operation
![Untitled](Untitled%204%2019.png)

## Algebraische Struktur, Halbgruppe, Gruppe
![image (6).png](image_(6)%203.png)

**Neutrales Element $e$**: Es ist dadurch gekennzeichnet, dass jedes Element durch die Verknüpfung mit dem **neutralen Element** auf sich selbst abgebildet wird.

Ordnung: $g^k = e, g \in G$ und G ist eine algebraische Gruppe
![image (35).png](image_(35).png)

## Mengenoperationen
Analog zu den Junktoren im Falle von Aussagen, eine Operation ordnet einer oder zwei Mengen eine Menge zu. 
Die Operationen sind Komplementbildung, Durchschnitt und Vereinigung:
![image 5.png](image%205.png)

# Relation
---
![image (1).png](image_(1)%203.png)

![image.png](image%201%202.png)

![image.png](image%202%201.png)

# Matrizen
---
Matrizen sind Zahlenanordnungen, die aus linearen Gleichungssystemen entstehen können.
![image (7).png](image_(7)%204.png)

![image (8).png](image_(8)%203.png)

# Vollständige Induktion
---
Eine Beweismethode, die ausschließlich zum Beweis von Aussagen, die die Menge $\N$ betreffen angewandt werden kann. 

**Grundidee**: Eine Aussage ist wahr ab einer bestimmten natürlichen Zahl und für alle ihre Nachfolger, dann ist die Aussage wahr für alle $\N$.

**Beispiel**:
![image (9).png](image_(9)%202.png)

# Funktionen
---
![image (36).png](image_(36).png)

## Injektivität und Surjektivität (Definition: Bijektivität)
![image (37).png](image_(37).png)

Definitionsbereich $D_f$: Urbildmenge ist Teilmenge von $D_f$ (X-Menge)
Wertebereich $W$: Bildmenge ist Teilmenge von $W$(Y-Menge)

**Injektiv**: Zu jedem y-Wert höchstens ein x-Wert.
**Surjektiv**: Zu jedem y-Wert mindestens ein x-Wert
![image (2).png](image_(2)%203.png)

# Ring der ganzen Zahlen
---
![image (4).png](image_(4)%203.png)

In einem Ring haben wir zwei Operationen: Wir haben eine additive Gruppe und eine multiplikative Halbgruppe.
![image (3).png](image_(3)%203.png)

## Divisionsalgorithmus
![image (6).png](image_(6)%201%202.png)
![Untitled](Untitled%205%2019.png)
![image (10).png](image_(10)%203.png)

![image (5).png](image_(5)%203.png)
![image.png](image%203.png)

## Restklassenring
![image (2).png](image_(2)%201%202.png)

$Restklassenring: \Z_6$ 
![image (3).png](image_(3)%201%201.png)

## Euklidischer Algorithmus - ggT
[https://www.youtube.com/watch?v=cOwyHTiW4KE](https://www.youtube.com/watch?v=cOwyHTiW4KE)

![image (3).png](image_(3)%202%201.png)

![image (5).png](image_(5)%201%201.png)

### **Erweiterter Euklidische Algorithmus**
![image (4).png](image_(4)%201%201.png)

![Untitled](Untitled%206%2017.png)

## Sieb von Eratostenes
![image.png](image%204.png)

Wurzel 10: weil wenn Modulo größer als Wurzel 10 ist berechnen wir wieder den anderen Faktor der kleiner als Wurzel 10 ist, welchen wir schon 

# Zusammenfassung
---
![image (1).png](image_(1)%201%201.png)
**Nullteiler** eines Rings (nicht 0) das multipliziert mit einem anderen Element gleich null ist (Bsp. Restklassenring, **Nullteilerfrei** alle Restklassen einer Primzahl)