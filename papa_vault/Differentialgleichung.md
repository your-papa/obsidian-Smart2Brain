---
related:
- "[[Differential- und Integralrechnung]]"
created_at: "29-10-2022 14:20"
---


# Prof Präsentation

[dgl011105.pdf](dgl011105.pdf)

# Definition

![Untitled](Untitled%2070.png)

# 1. Ordnung

## Newton’sches Abkühlungsgesetz

![Untitled](Untitled%201%207.png)

![Untitled](Untitled%202%206.png)

## Logistische Funktion

![Untitled](Untitled%203%205.png)

![Untitled](Untitled%204%205.png)

## Charakteristisches Polynom

![Untitled](Untitled%205%205.png)

## Allgemeine Lösung (Partikular, Homogene Lösung)

![Untitled](Untitled%206%205.png)

## Beispiel

![IMG-20220511-WA0002.jpg](IMG-20220511-WA0002.jpg)

# 2. Ordnung

Wir besprechen die Lösung einer gewöhnlichen, inhomogenen, linearen DGL 2. Ordnung mit $A,B,C\in\R$ :

$$
Ay''+By'+Cy=f(t)
$$

## Homogene Lösung

$p(x)=A\lambda^2+B\lambda+C=0\Leftrightarrow$

$\lambda^2+\frac{B}{A}\lambda+\frac{C}{A}=0 \Leftrightarrow$

$\lambda_{1,2}=-\frac{B}{2A}+-\sqrt{(-\frac{B}{2A})^2-\frac{C}{A}}$

1. Fall: $(\frac{B}{-2A})^2-\frac{C}{A}\gt 0$        $\lambda_1\ne \lambda_2\in\R$          $y_h=A_1e^{\lambda_1t}+A_2e^{\lambda_2t}$
2. Fall: $(\frac{B}{-2A})^2-\frac{C}{A}=0$        $\lambda_1= \lambda_2\in\R$          $y_h=A_1e^{\lambda_1t}+A_2te^{\lambda_2t}$
3. Fall: $(\frac{B}{-2A})^2-\frac{C}{A}\lt0$        $\lambda_1\ne \lambda_2\in\Complex$          $y_h=A_1e^{\lambda_1t}+A_2e^{\lambda_2t}$

## Partikulare Lösung

Ansätze:

1. Ansatz nach der Form der rechten Seite (Bsp. 1 Ordnung siehe oben)

[Ansatz vom Typ der rechten Seite / Störfunktion | einfach erklärt](https://studyflix.de/mathematik/ansatz-vom-typ-der-rechten-seite-storfunktion-939)

1. Komplexe Variablen
    
    ![Untitled](Untitled%207%205.png)
    
2. Variation der Konstanten

[Variation der Konstanten: Erklärung und Beispiel](https://studyflix.de/mathematik/variation-der-konstanten-938)

## Allgemeine Lösung

$y(t)=y_h(t)+y_p(t)=A_1e^{\lambda_1t}+A_2e^{\lambda_2t}+\frac{a}{\sqrt{(-\omega^2A+C)^2+(\omega B)^2}}\sin(\omega t-\arctan(\frac{\omega B}{-\omega^2A+C})$

### Beispiel

![Untitled](Untitled%208%205.png)

![Untitled](Untitled%209%205.png)

![Untitled](Untitled%2010%205.png)

# Mehrdimensional in $\R^n$

Definition: Es sei $f:\R^n\to\R$ eine Funktion mit den Variablen $x_1,x_2,...,x_n$. Den Grenzwert: 

$$
\frac{\partial f}{\partial x_1} =\lim_{h\to 0}\frac{f(x_1+h,x_2,...,x_n)-f(x_1,...,x_n)}{h}
$$

bezeichnen wir als partielle Ableitung von $f$ nach $x_1$.

## Partielle Ableitung Beispiel

![Untitled](Untitled%2011%205.png)

## Gradient

Definition: Es sei $f:\R^n\to\R$ eine Funktion. Die $n$ partiellen Ableitungen $\frac{\partial f}{\partial x_1},...,\frac{\partial f}{\partial x_n}$ existieren. Dann ist 

$$
\nabla f=grad(f)=(\frac{\partial f}{\partial x_1},...,\frac{\partial f}{\partial x_n})
$$

der Gradient von $f$.

### Beispiel

![Untitled](Untitled%2012%205.png)