# Instagram (`@cardigan.mx`)

Estrategia de contenido orgánico para Instagram, fase 1: **awareness de marca** (3 meses, sin pauta pagada). Apunta a psicólogas y psicólogos independientes en México.

## Archivos

- [`strategy.md`](./strategy.md) — el documento de estrategia completo: pilares, banco de ideas, voz, cadencia, grid, bio, hashtags.
- [`mockups/`](./mockups/) — 6 SVG de referencia para el diseñador (Figma/Canva). Tokens de marca cableados al color exacto del producto.

## Cómo usar los mockups

Cada SVG está pensado como **referencia editable**, no como arte final.

- Abre cualquiera en el navegador para previsualizar (incluyen `@import` de Nunito vía Google Fonts).
- Importa a Figma con drag & drop: las capas vectoriales son editables. Si Nunito ya está instalado en Figma, las fuentes resuelven solo.
- Las dimensiones siguen el espec de Instagram: 1080×1080 (feed cuadrado), 1080×1350 (feed 4:5 / carrusel), 1080×1920 (story).
- Las zonas seguras de story están marcadas con guías punteadas y comentarios `DELETE-ME` — bórralas antes de exportar.

## Tokens de marca usados

Mismos valores que `src/styles/base.css`. Si la paleta cambia ahí, regenerar mockups.

| Token | Hex |
|---|---|
| `--teal` | `#5B9BAF` |
| `--teal-dark` | `#4A8799` |
| `--teal-light` | `#7AB5C7` |
| `--teal-pale` | `#EAF4F7` |
| `--cream` | `#F5F0EB` |
| `--charcoal` | `#2E2E2E` |
| `--charcoal-md` | `#555` |
| `--white` | `#FFFFFF` |

## Contacto

Cambios mayores a la estrategia → editar `strategy.md` y abrir PR. Cambios cosméticos a un mockup → editar el SVG directamente.
