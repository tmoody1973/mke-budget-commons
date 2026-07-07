# Budget Explainer (L4)

`index.html` is a **standalone, self-contained** public explainer of Milwaukee's
city operating budget — where it goes, what's changing in 2027, and how every
number is reconciled to the source PDF (each figure carries its source page).

## Share it with anyone

It's a single HTML file with no external dependencies — host it anywhere:

- **GitHub Pages** — commit it and enable Pages on the repo.
- **Any static host** — Netlify, Vercel, S3, your own server; just upload the file.
- **Email / send** — the file renders on its own in any browser.
- **Locally** — `open apps/explainer/index.html`.

## Regenerate

It's built from the live serving layer, so it stays in sync with the data:

```bash
make load-neon     # rebuild the DB from repo Parquet (if data changed)
make explainer     # regenerate apps/explainer/index.html
```

The generator (`scripts/build_explainer.py`) reads the reconciled figures from
Neon — the L4 app reading L3/L2, exactly as the architecture intends.
