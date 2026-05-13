# ZUTnik PWA

Nieoficjalny asystent studenta ZUT w modelu **client-side first**.

## Architektura

- Front (`React + TypeScript + Vite + PWA`) robi cala logike:
  - token i logowanie,
  - mapowanie danych studiow/ocen/info,
  - budowanie widoku planu (dzien/tydzien/miesiac),
  - parsowanie RSS.
- Backend (`server/index.mjs`) jest cienkim proxy:
  - tylko forwarduje dane do ZUT / plan / RSS,
  - bez logiki domenowej.

## Uruchomienie

```bash
npm install
npm run icons
npm run dev:full
```

- Front: `http://localhost:5173`
- Proxy: `http://localhost:8787`

## Build

```bash
npm run build
npm run start
```

## Najwazniejsze cechy

- monolityczny app-shell (bez skakania po wielu podstronach),
- wewnetrzny stack nawigacji,
- przechwytywanie back/gestu cofania w ramach aplikacji,
- tryb instalowalny PWA (`display: standalone`).
