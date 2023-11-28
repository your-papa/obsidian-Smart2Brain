---
related:
- "[[Differential- und Integralrechnung]]"
created_at: "29-10-2022 14:20"
---


# Regeln

<aside>
💡 Differenzieren wird als Operation aufgefasst. Die Umkehroperation bezeichnen wir als Integrieren. In Zeichen: $f \to f'=\frac{df}{dx}$,      $f= \int{f'}\leftarrow f'$

</aside>

![Untitled](Untitled%2075.png)

# Bestimmte Integrale

[slides-lecture-220516-static-polymorphism 1.pdf](slides-lecture-220516-static-polymorphism%201.pdf)

## Definition

$f:[a;b]\to \R$. Flächeninhalt in einem bestimmten Intervall. Unterhalb der x-Achse ist die Fläche negativ (Orientierung) und oberhalb der x-Achse positiv. 

$x_i^* \in\  ]x_i;x_{i+1}]$

$a=x_1, \ b=x_n$

$$
\int_a^bf(x)dx=\lim_{n\to\infin}\sum_{i=1}^{n}(x_{i+1}-x_i)f(x_i^*)
$$

Falls dieser Grenzwert existiert, dann sprechen wir vom bestimmten Integral von $f$ in den Grenzen von a bis b.

<aside>
💡 Satz: (Hauptsatz der Differenzial- und Integralrechnung). Es sei F eine Funktion mit
 $F'=f$. Dann ist

$$
\int_a^bf(x)dx=F(b)-F(a)
$$

</aside>

## Mittelwert

$y=\{y_1,...,y_n\},\ y_i\in\R,\ i=1,...,n$

$$
\overline{y}=\sum_{i=1}^n\frac{y_i}{n}
$$

$\overline{y}$ ist das arithmetische Mittelwert.

Annahme: $y_i=f(x_i),\ f:[a,b]\to \R$

$$
\lim_{n\to\infin}\frac{1}{b-a}\sum_{i=1}^nf(x_i)*\frac{b-a}{n}=\frac{1}{b-a}\int_a^bf(x)dx
$$

<aside>
💡 Satz (Mittelwertsatz der Integralrechnung). Es sei $f$ eine stetige Funktion definiert auf $[a;b]\sub\R$.

$$
\overline{y}=\frac{1}{b-a}\int_a^bf(x)dx
$$

ist der Mittelwert der Funktionswerte $y_i=f(x_i),\ x_i\in[a;b]$

</aside>

## Quadratischer Mittelwert einer Funktion

→ Betrag des Integrals:

$rms[f]$ root mean square der Funktion $f$

$$
rms[f]=\sqrt{\frac{1}{b-a}\int_a^b(f(x))²dx}
$$

$f(x)=A\sin(2\pi fx),\ T=\frac{1}{f}=t$  (Integral über Periode) →

$$
rms[f]=\frac{A}{\sqrt{T}}*\sqrt{\frac{T}{2}}=\frac{A}{\sqrt{2}}
$$

[Bestimmte_Integrale.pdf](Bestimmte_Integrale.pdf)