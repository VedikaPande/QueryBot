"""
Plotting templates.

One template per chart type, assembled into a standalone script. The plotting
body is always chosen from this fixed set — the model never writes it — which is
what makes the script safe to run in-process when no sandbox is available.
"""
import json
from typing import Any, Dict, Optional

# Chart types the generator has a template for. A value outside this set would
# silently fall through to the default bar chart, so it is rejected instead.
CHART_TYPES = (
    'bar',
    'horizontal_bar',
    'line',
    'pie',
    'scatter',
    'histogram',
    'box',
    'heatmap',
    'none',
)

# Palettes the user can ask for, by name. The palette reaches the plotting
# template as a JSON literal so it can never become code, but an unknown name
# still makes seaborn raise mid-render — hence the allow-list.
PALETTES = (
    'husl',
    'deep',
    'muted',
    'pastel',
    'bright',
    'dark',
    'colorblind',
    'flare',
    'crest',
    'rocket',
    'mako',
    'viridis',
    'magma',
    'coolwarm',
    'Spectral',
    'Blues',
    'Greens',
    'Reds',
    'Purples',
    'Oranges',
    'Greys',
    'YlOrRd',
    'YlGnBu',
    'RdBu',
)

# Palettes that are also continuous colormaps, so a heatmap can use them.
CMAP_PALETTES = frozenset(
    {
        'flare',
        'crest',
        'rocket',
        'mako',
        'viridis',
        'magma',
        'coolwarm',
        'Spectral',
        'Blues',
        'Greens',
        'Reds',
        'Purples',
        'Oranges',
        'Greys',
        'YlOrRd',
        'YlGnBu',
        'RdBu',
    }
)

DEFAULT_PALETTE = 'husl'
DEFAULT_CMAP = 'YlGnBu'


def palette_of(chart_spec: Optional[Dict[str, Any]]) -> str:
    """The palette to render with, defaulting to the theme's own."""
    palette = (chart_spec or {}).get('palette')
    return palette if palette in PALETTES else DEFAULT_PALETTE


def cmap_of(chart_spec: Optional[Dict[str, Any]]) -> str:
    """The colormap for chart types that need a continuous scale."""
    palette = palette_of(chart_spec)
    return palette if palette in CMAP_PALETTES else DEFAULT_CMAP


def build_chart_code(
    visualization: str,
    results: list,
    question: str,
    output_path: str,
    palette: str = DEFAULT_PALETTE,
    cmap: str = DEFAULT_CMAP,
) -> str:
    """
    Build the plotting script for one result set.

    Data, title and palette are injected as JSON literals rather than
    interpolated into the generated source, so a question containing a brace or
    an apostrophe cannot produce invalid Python or escape its string literal.

    `output_path` is where the figure is written: a path inside the container
    mount for the sandbox, or a local path when rendering in-process.
    """
    title = json.dumps(f'{visualization.replace("_", " ").title()}: {question}'[:120])
    data_literal = json.dumps(results, default=str)
    output_literal = json.dumps(output_path.replace('\\', '/'))

    preamble = f'''
import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns

PALETTE = {json.dumps(palette)}
CMAP = {json.dumps(cmap)}

sns.set_theme(style="whitegrid", palette=PALETTE)
sns.set_context("notebook", font_scale=1.1)

DATA = json.loads({json.dumps(data_literal)})
TITLE = {title}
OUTPUT_PATH = {output_literal}

# Derived from the output path so the same template works inside the container
# mount and against a local directory.
os.makedirs(os.path.dirname(OUTPUT_PATH) or ".", exist_ok=True)

if not DATA:
    raise SystemExit("No data to plot")

# Name columns by position: two columns read as category/value, three add a series.
COLUMN_COUNT = len(DATA[0]) if isinstance(DATA[0], (list, tuple)) else 1
if COLUMN_COUNT == 2:
    df = pd.DataFrame(DATA, columns=["Category", "Value"])
elif COLUMN_COUNT == 3:
    df = pd.DataFrame(DATA, columns=["Category", "Series", "Value"])
else:
    df = pd.DataFrame(DATA, columns=[f"Column_{{i + 1}}" for i in range(COLUMN_COUNT)])

# Values arrive from JSON as strings when SQLite stored them as text.
if "Value" in df.columns:
    df["Value"] = pd.to_numeric(df["Value"], errors="coerce")

df = df.dropna()
if df.empty:
    raise SystemExit("No usable rows after cleaning")

plt.figure(figsize=(12, 8))
has_series = "Series" in df.columns
'''

    bodies = {
        'line': '''
if has_series:
    sns.lineplot(data=df, x="Category", y="Value", hue="Series", marker="o")
    plt.legend(title="Series", bbox_to_anchor=(1.02, 1), loc="upper left")
else:
    sns.lineplot(data=df, x="Category", y="Value", marker="o", linewidth=2.5)
plt.xticks(rotation=45, ha="right")
plt.xlabel("Category")
plt.ylabel("Value")
''',
        'horizontal_bar': '''
if has_series:
    sns.barplot(data=df, y="Category", x="Value", hue="Series", orient="h")
    plt.legend(title="Series", bbox_to_anchor=(1.02, 1), loc="upper left")
else:
    sns.barplot(data=df, y="Category", x="Value", hue="Category", legend=False, orient="h")
plt.xlabel("Value")
plt.ylabel("Category")
''',
        'pie': '''
totals = df.groupby("Category")["Value"].sum().sort_values(ascending=False)
# Too many slices are unreadable; group the tail into "Other".
if len(totals) > 8:
    head = totals.head(7)
    totals = pd.concat([head, pd.Series({"Other": totals.iloc[7:].sum()})])
plt.pie(
    totals.values,
    labels=totals.index.astype(str),
    autopct="%1.1f%%",
    startangle=90,
    colors=sns.color_palette(PALETTE, len(totals)),
)
plt.axis("equal")
''',
        'scatter': '''
df["Category"] = pd.to_numeric(df["Category"], errors="coerce")
df = df.dropna()
if has_series:
    sns.scatterplot(data=df, x="Category", y="Value", hue="Series", s=120, alpha=0.85)
    plt.legend(title="Series", bbox_to_anchor=(1.02, 1), loc="upper left")
else:
    sns.regplot(data=df, x="Category", y="Value", scatter_kws={"s": 120, "alpha": 0.85})
plt.xlabel("X")
plt.ylabel("Y")
''',
        'histogram': '''
sns.histplot(data=df, x="Value", bins=min(30, max(5, len(df) // 2)), kde=True)
mean_value = df["Value"].mean()
plt.axvline(mean_value, color="crimson", linestyle="--", linewidth=2, label=f"Mean: {mean_value:,.2f}")
plt.legend()
plt.xlabel("Value")
plt.ylabel("Frequency")
''',
        'box': '''
if has_series:
    sns.boxplot(data=df, x="Category", y="Value", hue="Series")
else:
    sns.boxplot(data=df, x="Category", y="Value", hue="Category", legend=False)
plt.xticks(rotation=45, ha="right")
''',
        'heatmap': '''
if has_series:
    pivot = df.pivot_table(index="Category", columns="Series", values="Value", aggfunc="sum")
else:
    pivot = df.set_index("Category")[["Value"]]
sns.heatmap(pivot, annot=True, fmt=".1f", cmap=CMAP, linewidths=0.5)
''',
    }

    default_body = '''
if has_series:
    sns.barplot(data=df, x="Category", y="Value", hue="Series")
    plt.legend(title="Series", bbox_to_anchor=(1.02, 1), loc="upper left")
else:
    ax = sns.barplot(data=df, x="Category", y="Value", hue="Category", legend=False)
    for container in ax.containers:
        ax.bar_label(container, fmt="%.1f", padding=2, fontsize=9)
plt.xticks(rotation=45, ha="right")
plt.xlabel("Category")
plt.ylabel("Value")
'''

    body = bodies.get(visualization, default_body)

    epilogue = '''
plt.title(TITLE, fontsize=15, fontweight="bold", pad=16)
plt.tight_layout()
plt.savefig(OUTPUT_PATH, dpi=150, bbox_inches="tight", facecolor="white")
plt.close()
print(f"Chart written to {OUTPUT_PATH}")
'''

    return preamble + body + epilogue
