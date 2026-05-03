# SEO + distribution checklist

Static marketing pages, sitemap, JSON-LD, OG tags are all in place
(see `scripts/build-marketing.mjs` to regen). This file lists the
**off-page** work that complements them. Treat as a one-time
todo — none of it requires code changes.

## Search Console & Analytics (do these FIRST — they unlock the rest)

- [ ] Submit **cardigan.mx** to [Google Search Console](https://search.google.com/search-console).
      Verify via DNS TXT record (Cloudflare DNS).
- [ ] Submit `https://cardigan.mx/sitemap.xml` from Search Console
      → Sitemaps. Re-submit after adding new blog articles.
- [ ] Confirm Search Console shows the profession pages indexed
      within ~7 days. If not, use "Request indexing" on each.
- [ ] Submit to [Bing Webmaster Tools](https://www.bing.com/webmasters/).
      Bing has 5–10% of MX search traffic — easy win.
- [ ] Confirm Vercel Analytics is firing (already wired in
      `src/main.jsx`). Check dashboard for the new routes
      (`/psicologos/`, etc.) showing up after deploy.

## Mexican / LATAM SaaS directories

These are free, take 5–15 min each. Submit Cardigan once and
they generate backlinks + occasional referral traffic.

- [ ] **Capterra LATAM** — https://www.capterra.com.mx/vendors/sign-up
      Category: "Software de Gestión de Consultorio" o "CRM"
- [ ] **GetApp Latinoamérica** — https://www.getapp.com.mx/vendors/sign-up
      Same vendor account as Capterra (Gartner umbrella)
- [ ] **Software Advice** — https://www.softwareadvice.com.mx/listing/
- [ ] **G2** — https://www.g2.com/products/new (English-leaning but
      growing in LATAM; lots of profile traffic)
- [ ] **AppFutura** — https://www.appfutura.com.mx/ (más enfocado a apps)
- [ ] **Comparasoftware** — https://www.comparasoftware.com.mx/

## Profession-specific directories

- [ ] **Federación Nacional de Colegios de Psicólogos (FENAPSIME)** —
      Pedir listing en su directorio de "Recursos para psicólogos"
- [ ] **Colegio Mexicano de Nutriólogos (CMN)** — Lo mismo
- [ ] **AMENA / IFI México** (entrenamiento) — Mismo enfoque

## Backlinks via content + outreach

- [ ] Identifica 5–10 blogs MX de psicología / nutrición / fitness
      con DA ≥ 25 (usa Ahrefs / Moz Free) y propón un guest post
      reciclando el contenido del blog.
- [ ] Subir tu cuenta de Cardigan a [Product Hunt](https://www.producthunt.com)
      como "Cardigan — App para profesionales independientes en México".
      Top-of-day en LATAM = ~2,000 visitas.
- [ ] Pídele a 3–5 usuarios actuales que dejen review en Capterra +
      G2 (los reviews positivos son el #1 SEO factor para directorios).

## Social presence (long-term, low priority)

- [ ] Crear cuenta de Twitter/X **@cardiganmx** — postear 1x/semana
      tips para profesionales independientes (referencia el blog).
- [ ] LinkedIn Company Page — más relevante para B2B
- [ ] YouTube — un solo video de "Cómo funciona Cardigan" (3 min)
      cubre 80% del valor; SEO en búsquedas tipo "como llevar
      pacientes en una app".

## Per-page Open Graph images (when you have time)

The `og-image.png` is generic. For maximum social CTR:

- [ ] Generar 5 OG images por profesión (1200×630px) con el hero
      visual de cada página. Un buen tool: `og-image-generator`
      en Vercel, o Figma + export.
- [ ] Reemplazar `<meta property="og:image">` en cada
      `public/<profession>/index.html` con el path específico
      (`/og-images/psicologos.png`, etc.).
- [ ] Re-correr `node scripts/build-marketing.mjs` después de
      actualizar el path en el config del script.

## Re-build cadence

Cada vez que cambies copy, agregues un blog post, o cambies precio:

1. Edita `scripts/build-marketing.mjs` (config `PROFESSIONS` o
   `ARTICLES`).
2. Corre `node scripts/build-marketing.mjs`.
3. Commit los archivos generados en `public/`.
4. Push → Vercel deploy.
5. Re-submit sitemap en Search Console (botón "Resubmit").
