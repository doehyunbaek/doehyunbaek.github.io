# Numbeo city value atlas

A data-driven reconstruction of the supplied reference graphic. All dot positions come from scraped Numbeo indices; no manually transcribed coordinates are used.

## Reverse-engineered methodology

The image's footnote says: “Both axes are percentile ranks among 306 cities in Numbeo’s current database, August 2026” and “Quality of life is Numbeo’s own formula with its price-linked terms removed: safety, healthcare, traffic, pollution, climate.”

Numbeo's published formula is:

```
max(0, 100 + purchasingPower / 2.5 - housing - cost / 10
       + safety / 2 + healthcare / 2.5 - commute / 2
       - pollution * 2 / 3 + climate / 3)
```

Remove the three price-linked terms (purchasing power, housing price-to-income, and cost of living), leaving:

```
nonPriceQuality = 100 + safety / 2 + healthcare / 2.5
                 - commute / 2 - pollution * 2 / 3 + climate / 3
```

- X: percentile rank of Cost of Living Index (higher = more expensive).
- Y: percentile rank of `nonPriceQuality` (higher = better).
- Both use the **entire scraped dataset**, before city selection or filtering.
- Percentile: `100 * (average rank - 1) / (N - 1)`, ascending one-based ranks; ties share average ranks. The image does not specify its exact percentile convention, so this endpoint-normalized convention is an implementation choice.
- The constant 100 has no effect on ranking. All derived scores in the current snapshot are positive, so a zero floor would have no effect either.
- Quadrants split at the 50th percentile.
- Default city selection follows the image; switch to **All cities** for the full dataset. Search includes all cities regardless of display mode. Regional groups follow the reference, not formal political memberships.
- Input values are the source table's rounded values, not undisclosed full-precision Numbeo data.

San Jose refers to California, as in the reference's North America category, not Costa Rica.

## Why positions may differ slightly

The available linked rankings page supplies **305 cities, 2026 Mid-Year**, whereas the reference cites **306 cities, August 2026 current data**. We retain the source's actual edition and do not claim to possess that historical snapshot. The source, retrieval timestamp, all input components, and derived score are stored in `data.json`.

As a sanity check, the corrected Y percentiles from the scraped snapshot are approximately Porto 98.0, Split 97.7, Hyderabad 14.5, and Seoul 68.4—close to the reference. This confirms the importance of removing price-linked terms rather than ranking the published overall quality-of-life index.

Formula source: https://www.numbeo.com/quality-of-life/indices_explained.jsp
Data source: https://www.numbeo.com/quality-of-life/rankings.jsp
Reference layout credited in the supplied graphic to Valerii Emelianov.

## Run and refresh

```sh
uv run python -m http.server 8000
```

Visit http://localhost:8000/numbeo/ or `/numbeo/` on the deployed site. `file://` does not allow JSON loading.

Refresh the data:

```sh
uv run python numbeo/update_data.py
```

The script fails on unknown countries or changed table structure rather than silently misclassifying data. The page is static and has no external runtime dependencies. Search, region filters, keyboard-accessible tooltips, all-labels mode, and SVG export are included.
