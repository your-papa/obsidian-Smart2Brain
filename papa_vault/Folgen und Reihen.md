---
related:
- "[[Differential- und Integralrechnung]]"
created_at: "29-10-2022 14:21"
---


# Prof Präsentation
---
[ProfPräsiFolgenReihen.pdf](ProfPrsiFolgenReihen.pdf)

# Ordnung des Körper der Reelen Zahlen
---
![Untitled](Untitled%2074.png)

<aside>
💡 **Definition**: Eine Funktion

$$
i:\N\to\R \\
i\mapsto a
$$

  wird als reele Zahlenfolge bezeichnet.

</aside>

# Monotonie
---
![Untitled](Untitled%201%2011.png)

# Stetigkeit
---
![image (1).png](image_(1)%201.png)

# Folge
---
![Untitled](Untitled%202%2010.png)

## Beispiel: Annäherung Wurzelrechnung
![Untitled](Untitled%203%208.png)

# Grenzwert, Konvergent und Divergent

$\epsilon$  kann als Präzision bezeichnet werden

![Untitled](Untitled%204%207.png)

## Beispiel: Folge der Eulerschen Zahl

$e_n=(1+1/n)^n$

$e_1=2\\ e_2=9/4=2\frac{1}{4}\\ e_4=\left(\frac{5}{4}\right)^4=\frac{625}{256}\approx2,4414$

$e^1=2,71828$

## Beispiel: Zinseszins

$k_0\in\R^+$

$0<p<1$

$k_1=k_0+pk_0$     Startwert + Teil vom Startwert

$k_2=k_1+pk_1=k_1(1+p)=k_0(1+p)(1+p)=k_0(1+p)^2$

$k_3=k_2+pk_2=k_2(1+p)=k_0(1+p)^3$

...

$k_n=k_0(1+p)^n$

# Reihen

![Untitled](Untitled%205%207.png)

Eine geometrische Folge ist eine Folge der Form $q_n=q^n$

Eine **geometrische Reihe** ist eine Summe der Folgenglieder der geometrischen Folge.

$$
s_n=1+q+q^2+q^3+...+q^n=\sum_{i=0}^nq^i
$$

Wenn n eine natürliche Zahl ist sprechen wir von einer endlichen Reihe, bzw. n-te Partialsumme.

Wir suchen eine Formel für $s_n$

$1:\ \ s_n=1+q+...+q^n$

$2:\ \ qs_n=q+q^2+...+q^n+q^{n+1}$

$1-2:\ \ qs_n-s_n=q^{n+1}-1$

              $s_n(q-1)=q^{n+1}-1$

$$
s_n=\frac{q^{n+1}-1}{q-1}
$$

**Zahlenbeispiel für** $q=2,\ n=3$

$1+2+4+8 = 15$

$s_3=\frac{2^4-1}{2-1}=\frac{15}{1}=15$