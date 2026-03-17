---
name: plotting
description: Create interactive 2D and 3D plots and diagrams using Plotly.js. Use when user asks to plot functions, visualize data as surface plots, scatter plots, line charts, heatmaps, or any mathematical visualization.
license: MIT
metadata:
  author: "Smart2Brain"
  version: "1.0"
  category: "core"
---

# Interactive Plotting

You can create interactive 2D and 3D plots by outputting an `s2b-plot` code block. The code runs in a secure sandboxed environment with **Plotly.js** pre-loaded.

## How It Works

Write JavaScript inside a fenced `s2b-plot` code block. The environment provides:

- **`Plotly`** — the full Plotly.js API (scatter, surface, mesh3d, etc.)
- **`document.getElementById('plot')`** — the target `<div>` for rendering
- Standard JavaScript (ES2020+), Math functions, loops, arrays, etc.

The plot renders interactively in the chat or note — users can rotate 3D plots, zoom, pan, and hover for values.

## Theme Integration

Obsidian theme colours are available as CSS variables. Use these for a cohesive look:

- `--background-primary` — page background
- `--text-normal` — text colour
- `--text-muted` — secondary text
- `--interactive-accent` — accent colour
- `--color-red`, `--color-green`, `--color-blue`, `--color-yellow`, `--color-cyan`, `--color-purple`, `--color-orange`, `--color-pink`

Read them with: `getComputedStyle(document.documentElement).getPropertyValue('--interactive-accent')`

## Rules

1. Always call `Plotly.newPlot('plot', data, layout)` or `Plotly.react('plot', data, layout)` — the target div ID is always `'plot'`.
2. Keep code concise — this is a rendering environment, not a general-purpose sandbox. Do not output explanations of the code. Just output the code block.
3. Use `layout.paper_bgcolor` and `layout.plot_bgcolor` set to `'rgba(0,0,0,0)'` (transparent) so the plot inherits the Obsidian theme background.
4. Set `layout.font.color` to the CSS variable for `--text-normal` for readable axis labels in both light and dark themes.
5. Do NOT use `fetch()`, `XMLHttpRequest` or any network APIs — they are blocked by the sandbox. All data must be generated in the code.
6. For mathematical functions, use `Math.*` — `Math.sin`, `Math.cos`, `Math.exp`, `Math.PI`, etc.
7. Always include axis labels and a descriptive title in layout.

## Examples

### 2D Function Plot

````
```s2b-plot
const style = getComputedStyle(document.documentElement);
const accent = style.getPropertyValue('--interactive-accent').trim();
const textColor = style.getPropertyValue('--text-normal').trim();

const x = [];
const y = [];
for (let i = -2 * Math.PI; i <= 2 * Math.PI; i += 0.05) {
  x.push(i);
  y.push(Math.sin(i));
}

Plotly.newPlot('plot', [{
  x, y,
  type: 'scatter',
  mode: 'lines',
  line: { color: accent, width: 2 }
}], {
  title: 'f(x) = sin(x)',
  xaxis: { title: 'x', color: textColor },
  yaxis: { title: 'y', color: textColor },
  font: { color: textColor },
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(0,0,0,0)'
});
```
````

### 3D Surface Plot

````
```s2b-plot
const textColor = getComputedStyle(document.documentElement)
  .getPropertyValue('--text-normal').trim();

const size = 50;
const x = [], y = [], z = [];
for (let i = 0; i < size; i++) {
  const xi = -3 + (6 * i) / (size - 1);
  x.push(xi);
  y.push(xi);
}
for (let i = 0; i < size; i++) {
  const row = [];
  for (let j = 0; j < size; j++) {
    row.push(Math.sin(Math.sqrt(x[i] ** 2 + y[j] ** 2)));
  }
  z.push(row);
}

Plotly.newPlot('plot', [{
  z, x, y,
  type: 'surface',
  colorscale: 'Viridis'
}], {
  title: 'f(x,y) = sin(√(x² + y²))',
  scene: {
    xaxis: { title: 'x' },
    yaxis: { title: 'y' },
    zaxis: { title: 'z' }
  },
  font: { color: textColor },
  paper_bgcolor: 'rgba(0,0,0,0)'
});
```
````

### 3D Parametric Curve

````
```s2b-plot
const textColor = getComputedStyle(document.documentElement)
  .getPropertyValue('--text-normal').trim();
const accent = getComputedStyle(document.documentElement)
  .getPropertyValue('--interactive-accent').trim();

const t = [], x = [], y = [], z = [];
for (let i = 0; i <= 200; i++) {
  const ti = (i / 200) * 6 * Math.PI;
  t.push(ti);
  x.push(Math.cos(ti));
  y.push(Math.sin(ti));
  z.push(ti / (2 * Math.PI));
}

Plotly.newPlot('plot', [{
  x, y, z,
  type: 'scatter3d',
  mode: 'lines',
  line: { color: accent, width: 4 }
}], {
  title: 'Helix: (cos t, sin t, t/2π)',
  scene: {
    xaxis: { title: 'x' },
    yaxis: { title: 'y' },
    zaxis: { title: 'z' }
  },
  font: { color: textColor },
  paper_bgcolor: 'rgba(0,0,0,0)'
});
```
````

### Scatter Plot with Multiple Series

````
```s2b-plot
const style = getComputedStyle(document.documentElement);
const textColor = style.getPropertyValue('--text-normal').trim();
const blue = style.getPropertyValue('--color-blue').trim();
const red = style.getPropertyValue('--color-red').trim();

function randn(n, mean, std) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    arr.push(mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
  }
  return arr;
}

Plotly.newPlot('plot', [
  { x: randn(100, 0, 1), y: randn(100, 0, 1), mode: 'markers', name: 'Group A', marker: { color: blue } },
  { x: randn(100, 3, 1.5), y: randn(100, 2, 1), mode: 'markers', name: 'Group B', marker: { color: red } }
], {
  title: 'Scatter: Two Distributions',
  xaxis: { title: 'X', color: textColor },
  yaxis: { title: 'Y', color: textColor },
  font: { color: textColor },
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(0,0,0,0)'
});
```
````

## Available Plot Types

### 2D

- `scatter` — line plots, scatter plots (set `mode`: `'lines'`, `'markers'`, or `'lines+markers'`)
- `bar` — bar charts
- `heatmap` — heatmaps with colour scales

### 3D

- `surface` — 3D surface plots from a z-matrix
- `scatter3d` — 3D scatter or line plots
- `mesh3d` — 3D mesh / wireframe

### Layout Tips

- Use `colorscale: 'Viridis'` (or `'Plasma'`, `'Cividis'`, `'Hot'`) for surfaces and heatmaps
- Set `margin: { l: 40, r: 20, t: 40, b: 40 }` for compact layouts
- Use `showlegend: true` when plotting multiple traces
