# Babyverrassing

Countdown-pagina voor de zwangerschap, met een instellingenpagina achter een pincode.

## Starten

```bash
docker compose up -d --build
```

Open daarna http://localhost (of het IP-adres van de computer/server).

- Countdown: `http://<adres>/`
- Instellingen: `http://<adres>/instellingen` (of het tandwieltje rechtsonder)

**Standaard pincode: `1234`** — wijzig deze direct via het tabblad *Pincode*.

## Wat kan er in de instellingen?

- **Takenlijst**: taken toevoegen, afvinken en verwijderen (met voorbeeldtaken).
- **Notities**: vrij tekstveld dat automatisch opslaat.
- **Instellingen**: geslacht (nog geheim = groen, meisje = roze, jongen = blauw), uitgerekende datum, naam, titel, bericht en eventueel de naam van de baby.
- **Pincode** wijzigen.

Alle gegevens staan in `./data/data.json`, dus ze blijven bewaard bij herstarten of updaten.
Na 5 foute pincodes wordt inloggen 5 minuten geblokkeerd.

## Handig

- Beginwaarden (naam, datum, pincode) staan in `docker-compose.yml` en worden alleen bij de eerste start gebruikt.
- Pincode vergeten? Stop de container, verwijder `data/data.json` en start opnieuw (let op: taken en notities gaan dan ook weg).
- Draai je dit op een server die vanaf internet bereikbaar is, zet er dan bij voorkeur HTTPS voor (bijv. via Caddy of Nginx Proxy Manager).
