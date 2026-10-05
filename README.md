# paianjenul

Cauta firme romanesti din terminal: date ONRC, bilanturi, status TVA ANAF si cautare avansata, prin API-ul [paianjenul.ro](https://www.paianjenul.ro).

- Zero dependinte, Node.js 20 sau mai nou.
- Raspunsurile vin ca rezumat in limba romana sau, cu `--json`, ca date brute.

## Instalare

Fara instalare, direct cu npx:

```bash
npx paianjenul search dante international
```

Sau global:

```bash
npm install -g paianjenul
```

## Autentificare

1. Creeaza o cheie API la https://www.paianjenul.ro/cont (incepe cu `pj_`).
2. Salveaz-o:

```bash
paianjenul login
# lipeste cheia; nu va fi afisata pe ecran
```

Merge si din pipe, util in scripturi:

```bash
echo "$CHEIA_MEA" | paianjenul login
```

Cheia se salveaza in `$XDG_CONFIG_HOME/paianjenul/key` (implicit `~/.config/paianjenul/key`), cu permisiuni 600 pe fisier si 700 pe director. Alternativ, seteaza variabila `PAIANJENUL_API_KEY`, care are prioritate fata de fisier.

```bash
paianjenul whoami   # email, plan, consumul de azi
paianjenul logout   # sterge cheia salvata
```

## Exemple

```bash
paianjenul search emag --limit 5
paianjenul company RO14399840
paianjenul financials 14399840 --years 3
paianjenul vat 14399840
paianjenul company 14399840 --json | jq .name

# doar plan Pro
paianjenul advanced --county Cluj --caen 62 --min-employees 10 --sort turnover --limit 20
```

Optiunile pentru `advanced`: `--county`, `--caen`, `--min-turnover`, `--max-turnover`, `--min-employees`, `--max-employees`, `--year`, `--sort turnover|employees|profit|name`, `--limit 1..50`, `--offset`.

Planul gratuit permite 5 firme distincte pe zi. Planul Pro: https://www.paianjenul.ro/pro

## Coduri de iesire

| Cod | Semnificatie |
| --- | --- |
| 0 | ok |
| 1 | utilizare gresita (comanda sau optiune necunoscuta, argument lipsa) |
| 2 | date invalide (`bad_input`, sau cheie cu format gresit la `login`) |
| 3 | firma negasita (`not_found`) |
| 4 | cheie lipsa sau invalida (`unauthorized`) |
| 5 | limita zilnica atinsa (`limit`) sau functie Pro (`pro_required`) |
| 6 | eroare de server, de retea sau timeout (20 s) |

Rezultatele merg pe stdout, erorile pe stderr. Cheia API nu este afisata niciodata.

## Variabile de mediu

- `PAIANJENUL_API_KEY`: cheia API (are prioritate fata de fisierul salvat).
- `PAIANJENUL_BASE`: adresa API-ului (implicit `https://www.paianjenul.ro`).
- `PAIANJENUL_TIMEOUT_MS`: timeout per cerere in milisecunde (implicit 20000).

## Claude

Preferi sa intrebi in limbaj natural? Conecteaza paianjenul.ro la Claude: https://www.paianjenul.ro/mcp

## English

`paianjenul` is a zero-dependency CLI for paianjenul.ro, a Romanian company lookup service (trade registry data, financial statements, VAT status, advanced search).

```bash
npx paianjenul login                  # paste your key from https://www.paianjenul.ro/cont
npx paianjenul search emag
npx paianjenul company RO14399840 --json
```

Commands: `search`, `company`, `financials`, `vat`, `advanced` (Pro), `login`, `logout`, `whoami`. Add `--json` for raw data instead of the Romanian summary. Exit codes are listed in the table above. A Claude connector (MCP) is available at https://www.paianjenul.ro/mcp.

## Licenta

MIT, Freeapp SRL 2026.

---

Made with [freeapp.ai](https://freeapp.ai)
