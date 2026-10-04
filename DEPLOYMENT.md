# Deploy to the existing Netlify portfolio

1. Extract Chigozie-Portfolio-Revision.zip.
2. Open your existing chigozie-nkwopara site in Netlify.
3. Open its Deploys page and upload the entire portfolio folder to the manual deploy area.
4. The folder must contain index.html, _redirects, assets and downloads at its top level.
5. After deployment, open /readmissions-case-study and test the capacity slider.

The site is plain HTML, CSS and JavaScript. No build command or script launcher is needed. For a Git-connected site, copy the contents of portfolio into the current publish directory and deploy through the existing workflow.

## Included changes

- Redesigned home page with a featured healthcare project and project category filters.
- Dedicated readmissions case study with an aggregate capacity explorer, PDF and CSV downloads.
- Existing USAID, stockroom and fulfilment case studies retained.
- USAID dashboard controls retained. The page now loads a 0.3 MB file of four fields (country, mode, route, delay days) instead of the 3.8 MB source extract.
- Shared desktop/mobile navigation, light/dark theme, keyboard focus styles and reduced-motion handling.
- Updated social preview, sitemap, page metadata and CV PDF.
- Readmissions explorer data, CSV download and PDF rebuilt from the current case-study pipeline.
- Interactive patient dashboard on the readmissions page (age, gender, race and discharge filters), built from aggregate counts in assets/overview-data.json.

The Power BI image is a screenshot of the Patient overview page from Power BI Desktop. The web capacity explorer is a separate view of aggregate model results, not an embedded Power BI service report. No patient-level healthcare records are included in this public site.

## Validation

Six routes checked on desktop and 390px mobile layouts. Internal resources and links passed. No horizontal overflow or JavaScript errors were found. Project filters, mobile menu, theme switch, capacity slider, age filter, reset and USAID country filter passed browser tests. All-age 20% capacity reproduces 4,200 flags, 699 captured readmissions, 37.1% recall and 16.6% precision, matching the case study and the Power BI report.
