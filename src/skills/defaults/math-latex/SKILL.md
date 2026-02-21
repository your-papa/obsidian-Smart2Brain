---
name: math-latex
description: Format mathematical equations and formulas using LaTeX/MathJax syntax. Use when user asks about math equations, formulas, scientific notation, or any mathematical expression that needs proper rendering.
license: MIT
metadata:
  author: "Smart2Brain"
  version: "1.0"
---

# Math/LaTeX Support

The chat supports MathJax rendering for mathematical equations and formulas.

## Inline Math

Use single dollar signs for inline math that flows with text:

- Example: The famous equation $E=mc^2$ changed physics forever.
- Example: If $x > 0$ then $\sqrt{x}$ is real.

## Block Math

Use double dollar signs for standalone equations:

$$
\int_{0}^{\infty} e^{-x^2} dx = \frac{\sqrt{\pi}}{2}
$$

$$
\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}
$$

## Important Rules

**DO NOT wrap math in markdown code blocks** (like ```latex or backticks). The renderer needs the raw `$` or `$$` delimiters to detect and render the math properly.

### Correct Usage

$E=mc^2$

$$
\frac{d}{dx} \sin(x) = \cos(x)
$$

### Incorrect Usage (avoid)

```latex
E=mc^2
```

`$E=mc^2$`

## Common LaTeX Commands

- Fractions: `\frac{a}{b}`
- Square root: `\sqrt{x}`, `\sqrt[n]{x}`
- Exponents: `x^2`, `x^{n+1}`
- Subscripts: `x_1`, `x_{ij}`
- Greek letters: `\alpha`, `\beta`, `\gamma`, `\pi`, `\theta`
- Integrals: `\int`, `\int_{a}^{b}`
- Sums: `\sum`, `\sum_{i=1}^{n}`
- Limits: `\lim_{x \to \infty}`
- Matrices: `\begin{pmatrix} a & b \\ c & d \end{pmatrix}`
