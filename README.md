# Regal Rentals Website

Upload-ready static website for **Regal Rentals**.

## Files

- `index.html` — homepage
- `styles.css` — full responsive styling and animations
- `script.js` — mobile menu, scroll reveal, quote form mailto behavior
- `assets/regal-shield.png` — shield logo image
- `assets/regal-rentals-logo.png` — full logo image
- `assets/favicon.png` — browser tab icon
- `robots.txt` — search engine crawl file
- `sitemap.xml` — starter sitemap
- `404.html` — simple not-found page

## GitHub upload

Unzip this package and upload the contents to the root of:

`UmbrylLabs/regal-rentals-website`

The root should look like:

```text
index.html
styles.css
script.js
README.md
assets/
robots.txt
sitemap.xml
404.html
```

Do **not** upload the ZIP file itself to GitHub as the website. Unzip it first.

## Cloudflare Pages settings

Use this as a static site:

- Build command: leave blank
- Build output directory: `/`

## Before launch

Update these items:

- Phone number if `(916) 287-0848` is not final
- Social media links
- Product photos
- Rental categories you are not ready to offer yet
- Privacy Policy and Terms links
- Final quote form backend if you want something better than email draft

The current quote form opens an email draft to:

`bookings@regal.rentals`


## V2 mobile/light fixes

- Mobile hero shortened so the content appears above the fold.
- Top mobile utility bar removed to save vertical space.
- Added light color-scheme hints to resist browser/OS dark-mode auto-darkening.
- Home/logo links use `/` instead of `#top`.
