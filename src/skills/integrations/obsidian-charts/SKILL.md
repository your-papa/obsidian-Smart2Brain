---
name: obsidian-charts
description: Create charts and visualizations from note data using Chart.js via dataviewjs. Use when user wants bar charts, line graphs, pie charts, or any data visualization. Requires Obsidian Charts plugin.
license: MIT
compatibility: Requires Obsidian Charts plugin and Dataview plugin to be installed and enabled
metadata:
  author: "S2B"
  version: "1.0"
  linkedPlugin: "obsidian-charts"
---

# Charts Integration

You can create charts using `dataviewjs` code blocks with the `window.renderChart` function.

## How to Create Charts

Output a `dataviewjs` code block that uses `window.renderChart`.

**Important**: `window.renderChart` takes exactly two arguments:

1. The chart data object (follows standard Chart.js format: type, data, options)
2. The container element (`this.container`)

Use Obsidian CSS variables (e.g., `var(--interactive-accent)`) for chart colors to match the theme.

## Example: Bar Chart

```dataviewjs
const pages = dv.pages('#games');
const labels = pages.map(p => p.file.name).values;
const data = pages.map(p => p.rating).values;

const accentColor = getComputedStyle(document.body).getPropertyValue('--interactive-accent').trim();
const chartData = {
  type: 'bar',
  data: {
    labels: labels,
    datasets: [{
      label: 'Game Ratings',
      data: data,
      backgroundColor: accentColor,
      borderColor: accentColor
    }]
  }
}
window.renderChart(chartData, this.container);
```

## Supported Chart Types

- `bar` - Bar charts for comparing values
- `line` - Line charts for trends over time
- `pie` - Pie charts for proportions
- `doughnut` - Doughnut charts (pie with hole)
- `radar` - Radar charts for multi-axis comparison
- `polarArea` - Polar area charts

The chat interface will render the chart automatically when you output the code block.
