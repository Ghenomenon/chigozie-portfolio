# Chigozie Nkwopara: Portfolio Website

Source for [chigozie-nkwopara.netlify.app](https://chigozie-nkwopara.netlify.app). A static site in plain HTML, CSS and JavaScript, with no build step.

## Pages

- Home, CV and five case studies: 30-day readmissions, USAID supply-chain delivery, warehouse inventory, fulfilment process improvement, and online sales pricing and cost.
- The readmissions page has an interactive patient dashboard and a follow-up capacity explorer. Both run on aggregate counts in `assets/overview-data.json` and `assets/capacity-data.json`, which are produced by [the analysis code](https://github.com/Ghenomenon/readmissions-case-study). No patient-level records are included.
- The pricing and cost scenario explorer runs on `assets/pricing-data.json`: order totals by category and month from a public 240-order sample, plus the stated cost assumptions. The SQL script and CSVs are in `downloads/`.
- The USAID dashboard runs on `assets/usaid-shipments.csv`, four fields derived from the public USAID Supply Chain Shipment Pricing dataset.

## Deploy

Publish this folder to Netlify. `netlify.toml` sets the publish directory to the repository root, and `_redirects` serves the clean page URLs.

## Related repositories

[Readmissions analysis](https://github.com/Ghenomenon/readmissions-case-study) · [Readmissions Power BI report](https://github.com/Ghenomenon/readmissions-powerbi) · [USAID supply chain](https://github.com/Ghenomenon/usaid-supply-chain-analytics) · [Stockroom analytics](https://github.com/Ghenomenon/stockroom-analytics-powerbi)
