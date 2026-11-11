# Third-party data in ztd-charts

The library code is MIT (see LICENSE). The built-in map boundaries under `src/geo/maps/` (shipped as the entry points `ztd-charts/geo/world`, `ztd-charts/geo/us-states` and `ztd-charts/geo/kr-sido`) are derived from the public data below. `scripts/build-geo.mjs` rebuilds them from pinned source files whose SHA-256 sums are in `scripts/geo-sources.json`.

## Borders

World borders follow Natural Earth, which shows de facto boundaries: the line of actual control, not any one country's claim. Disputed areas are drawn as Natural Earth draws them at 1:110m. If you need different borders, pass your own GeoJSON FeatureCollection as `options.map` (or the `map` prop); it replaces the built-in map entirely.

## world (`ztd-charts/geo/world`)

- Source: Natural Earth 1:110m Cultural Vectors, Admin 0 Countries, as packaged in world-atlas 2.0.2 (`countries-110m.json`), https://github.com/topojson/world-atlas
- Natural Earth data is in the public domain: https://www.naturalearthdata.com/about/terms-of-use/
- world-atlas is distributed under the ISC licence:

  > Copyright 2013-2019 Michael Bostock
  >
  > Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.
  >
  > THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

- Changes: coordinates requantised to 0.01°, re-encoded. Country codes (ISO 3166-1 alpha-2, alpha-3, numeric), English display names (CLDR, through `Intl.DisplayNames`, with a few edits) and the continent table (UN M49 regions) were added by ztd-charts.

## us-states (`ztd-charts/geo/us-states`)

- Source: US Census Bureau cartographic boundary files (state level, 1:10m), as packaged in us-atlas 3.0.1 (`states-10m.json`), https://github.com/topojson/us-atlas
- US Census Bureau data is a work of the US federal government and in the public domain.
- us-atlas is distributed under the ISC licence, with the same text as world-atlas above (Copyright 2013-2019 Michael Bostock).
- Changes: territories left out (50 states and DC kept), lines simplified (Douglas-Peucker, 0.03°), coordinates requantised to 0.01°, re-encoded.

## kr-sido (`ztd-charts/geo/kr-sido`)

- Source: geoBoundaries gbOpen KOR ADM1 (release 9469f09, built from Natural Earth), https://www.geoboundaries.org/
- Licence stated by geoBoundaries for this boundary: public domain (Natural Earth terms of use).
- Changes: Gwangju (KR-29) and Jeollanam-do (KR-46) merged into one region, Jeonnam-Gwangju (전남광주통합특별시), which they became on 2026-07-01; lines simplified (Douglas-Peucker, 0.004°), coordinates requantised to 0.001°, re-encoded. Ulleungdo comes from the source and is kept.
- Dokdo: geoBoundaries KOR ADM1 has no polygon for it, so it is added to Gyeongsangbuk-do (it belongs to Ulleung-gun) from Natural Earth 1:10m Physical Vectors, Minor Islands (`ne_10m_minor_islands.geojson`, natural-earth-vector v5.1.2, public domain): the island whose centre is at about 131.86° E, 37.24° N. It is kept unsimplified. At most sizes it is drawn as a small speck, since the map draws any island smaller than 1px as a 1.6px square.

## Tile layouts

The tile grid layouts (`us-states`, `kr-sido`, `kr-sido-2025` in `src/data/`) were arranged by ztd-charts for this library and are covered by its MIT licence.
