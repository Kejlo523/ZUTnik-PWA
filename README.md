# ZUTnik PWA

Instalowalny asystent studenta z interfejsem dopasowanym do aplikacji Android.
Plan zajec, oceny, informacje o studiach, finanse i aktualnosci w jednym miejscu.

## Uruchomienie

Wymagany Node.js 22.18 lub nowszy oraz skonfigurowany konsument OAuth USOS.
Sekrety konsumenta pozostaja na backendzie, nigdy w zmiennych `VITE_*`.

```sh
npm ci
npm run dev
```

Front: `http://localhost:5173/v2/`. Backend: `http://localhost:8787`.
Port backendu mozna zmienic przez `PORT`, a cel proxy przez
`VITE_API_PROXY_TARGET`. Bazowa sciezka aplikacji to domyslnie `/v2/`.
Przekierowanie OAuth musi wskazywac te sama konfiguracje hosta i sciezki.

```sh
npm run build
npm start
```

W produkcji backend udostepnia `dist` i API pod wspolnym originem.
Instalacja PWA i service worker wymagaja HTTPS lub lokalnego `localhost`.

## Interfejs

- Telefon: dolna nawigacja, uklady i typografia zgodne z Androidem.
- Tablet i komputer: prawa szyna nawigacji oraz wielokolumnowe widoki.
- Plan: dzien, tydzien, miesiac, gesty, wyszukiwanie USOS, filtry i eksport ICS.
- Oceny: poprawiona ocena z historia zamiast podwojnego wpisu w sredniej.
- Start: wlasne kafelki, kolejnosc, szerokosc, kolor i skroty wyszukiwania.
- Ustawienia: motywy oraz import i eksport bez tokenow.

## Dane, Sesja I Offline

Ekran najpierw pokazuje zapisane dane. Nie ma cyklicznego pollingu w tle.
Automatyczne pobieranie na ekranie jest ograniczone do danych nieobecnych lub
nieaktualnych: plan i oceny 6 godzin, finanse 24 godziny, studia i informacje
7 dni, aktualnosci 24 godziny. Reczne odswiezanie ma cooldown 5 minut.
Bledy maja rosnacy backoff; identyczne zapytania sa wspoldzielone.

Plan USOS pobiera widoczny tydzien, kolejny tydzien, a potem grupy semestru.
Dogrywanie jest sekwencyjne, zatrzymuje sie w ukrytej karcie lub offline,
a dane juz widoczne nie sa usuwane ani remontowane. Backend ogranicza tempo
zapytan i przechowuje odpowiedzi przez 6 godzin lub 7 dni zalezne od zakresu.
Kalendarz jest pomocniczy: nie blokuje pierwszego widoku planu.

Dane prywatne sa rozdzielone wedlug konta i studiow. IndexedDB ma limit
160 zasobow, plan 32 tygodni i 96 grup; starsze wpisy sa usuwane.
Service worker przechowuje interfejs i fonty, nie odpowiedzi OAuth ani API.
Zmiana wersji nie przerywa edycji: uzytkownik decyduje o przeladowaniu.

Sesja OAuth z `offline_access` pozostaje do wylogowania lub odwolania tokenu
przez USOS. Brak internetu i blad serwera nie wylogowuja ani nie kasuja cache.
Jawne wylogowanie usuwa dane danego konta. Przegladarka nadal moze usunac
pamiec witryny; aplikacja nie moze zagwarantowac bezterminowej sesji.
Tokeny sa zapisywane lokalnie; nalezy chronic origin przed XSS i nie korzystac
z aplikacji na wspoldzielonym profilu przegladarki.

## Weryfikacja

```sh
npm run lint
npm test
npm run build
npm run test:e2e
```

Testy przegladarki korzystaja wylacznie z lokalnych danych testowych.
Domyslny URL testow to `http://127.0.0.1:5174/v2/`; mozna ustawic `TEST_URL`.
`TEST_BROWSER=webkit` uruchamia WebKit zamiast Chrome.
`TEST_PRODUCTION=1` uruchamia odizolowany serwer na porcie 8879 dla testow
service workera i startu offline. Najpierw nalezy wykonac build.
WebKit wymaga `npx playwright install webkit`.

Test offline WebKit odcina polaczenia lokalnego serwera zamiast uzywac
wadliwej emulacji `setOffline`: [Playwright #42775](https://github.com/microsoft/playwright/issues/42775).
Testy silnika nie zastepuja weryfikacji zainstalowanej PWA na fizycznym iPhonie.
