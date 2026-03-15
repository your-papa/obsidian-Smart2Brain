---
name: html-sandbox
description: Render interactive HTML, CSS, and JavaScript in a sandboxed iframe. Use when the user asks for visual demos, animations, mini-games, interactive widgets, or any self-contained web content that goes beyond plotting.
license: MIT
metadata:
  author: "Smart2Brain"
  version: "1.0"
  category: "core"
---

# HTML Sandbox

You can render arbitrary HTML, CSS, and JavaScript by outputting an `s2b-html` code block. The content runs in a secure sandboxed iframe.

## How It Works

Write a **complete HTML document** (or fragment) inside a fenced `s2b-html` code block. The sandbox provides:

- Full DOM access (`document.*`)
- Canvas 2D and WebGL
- CSS animations, transitions, and `@keyframes`
- Keyboard and mouse events (`keydown`, `click`, `mousemove`, etc.)
- `requestAnimationFrame`, `setTimeout`, `setInterval`
- `AudioContext` (oscillator-based sound synthesis)

The content renders inline in the chat or note within an iframe.

## Theme Integration

Obsidian theme colours are injected as CSS variables on `:root`. Use them for a cohesive look:

- `--background-primary` — page background
- `--text-normal` — text colour
- `--text-muted` — secondary text
- `--interactive-accent` — accent colour
- `--color-red`, `--color-green`, `--color-blue`, `--color-yellow`, `--color-cyan`, `--color-purple`, `--color-orange`, `--color-pink`

## Rules

1. The code must be a **self-contained HTML document**. Include `<style>` and `<script>` tags as needed.
2. Keep code concise — output only the code block, not explanations of the code.
3. Set `body { background: var(--background-primary); color: var(--text-normal); }` so the content blends with the Obsidian theme.
4. Do NOT use `fetch()`, `XMLHttpRequest`, `import()`, or any network APIs — they are blocked by the sandbox.
5. Do NOT rely on external libraries or CDN links — all code must be inline and self-contained.
6. Do NOT try to access `parent`, `top`, `localStorage`, `sessionStorage`, or `document.cookie` — these are blocked.
7. For full-area content (canvas games, animations), use `width: 100%; height: 100vh;` on the canvas or container and set `margin: 0; overflow: hidden;` on `body`.

## Capabilities

| Supported | Not Supported |
|---|---|
| DOM manipulation | `fetch` / network requests |
| Canvas 2D | External scripts / CDNs |
| WebGL | `localStorage` / `sessionStorage` |
| CSS animations | `parent` / `top` frame access |
| Keyboard & mouse events | Cookies |
| `requestAnimationFrame` | Clipboard API |
| `AudioContext` (synthesis) | Geolocation |
| SVG | Camera / Microphone |
| ES2020+ JavaScript | ES Modules / `import()` |

## Examples

### Bouncing Ball Animation

````
```s2b-html
<!DOCTYPE html>
<html>
<head>
<style>
  body { margin: 0; overflow: hidden; background: var(--background-primary); }
  canvas { display: block; width: 100%; height: 100vh; }
</style>
</head>
<body>
<canvas id="c"></canvas>
<script>
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--interactive-accent').trim();

  function resize() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  let x = 100, y = 80, vx = 3, vy = 2, r = 20;

  function frame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    x += vx; y += vy;
    if (x - r < 0 || x + r > canvas.width) vx = -vx;
    if (y - r < 0 || y + r > canvas.height) vy = -vy;

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
    requestAnimationFrame(frame);
  }
  frame();
</script>
</body>
</html>
```
````

### Interactive Counter

````
```s2b-html
<!DOCTYPE html>
<html>
<head>
<style>
  body {
    margin: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    background: var(--background-primary);
    color: var(--text-normal);
    font-family: sans-serif;
  }
  #count { font-size: 4rem; margin: 1rem 0; }
  button {
    padding: 0.5rem 1.5rem;
    margin: 0.25rem;
    font-size: 1.2rem;
    cursor: pointer;
    border: 1px solid var(--text-muted);
    border-radius: 6px;
    background: var(--background-primary);
    color: var(--text-normal);
  }
  button:hover { background: var(--interactive-accent); color: #fff; }
</style>
</head>
<body>
  <div id="count">0</div>
  <div>
    <button onclick="update(-1)">−</button>
    <button onclick="update(0)">Reset</button>
    <button onclick="update(1)">+</button>
  </div>
  <script>
    let count = 0;
    const el = document.getElementById('count');
    function update(d) {
      count = d === 0 ? 0 : count + d;
      el.textContent = count;
    }
  </script>
</body>
</html>
```
````

### Fractal Tree (Canvas)

````
```s2b-html
<!DOCTYPE html>
<html>
<head>
<style>
  body { margin: 0; overflow: hidden; background: var(--background-primary); }
  canvas { display: block; width: 100%; height: 100vh; }
</style>
</head>
<body>
<canvas id="c"></canvas>
<script>
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;

  const green = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-green').trim() || '#4caf50';
  const textColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--text-muted').trim();

  function branch(x, y, len, angle, depth) {
    if (depth === 0) return;
    const x2 = x + len * Math.cos(angle);
    const y2 = y + len * Math.sin(angle);
    ctx.strokeStyle = depth > 3 ? textColor : green;
    ctx.lineWidth = depth * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    branch(x2, y2, len * 0.7, angle - 0.5, depth - 1);
    branch(x2, y2, len * 0.7, angle + 0.5, depth - 1);
  }

  branch(canvas.width / 2, canvas.height, canvas.height * 0.28, -Math.PI / 2, 10);
</script>
</body>
</html>
```
````
