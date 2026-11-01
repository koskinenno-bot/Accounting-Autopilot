# Saapuneet-kansio (automaattinen tuonti)

Palvelut tarkkailevat tätä kansiota 15 sekunnin välein:

    inbox/<yhtiön tunnus>/tiliotteet/   camt.053 (.xml), pankin CSV (.csv, .txt) tai PDF   -> bank-service
    inbox/<yhtiön tunnus>/tositteet/    ostolaskut ja kuitit (.pdf, .jpg, .png, .webp)     -> voucher-service

Yhtiön tunnus (UUID) näkyy dashboardin osoiterivillä / Yhtiöt-sivulla.
Käsitellyt tiedostot siirtyvät alikansioon processed/, epäonnistuneet alikansioon failed/
(virheen syy samannimiseen .virhe.txt-tiedostoon). Saman tiliotteen tuominen uudelleen ei
kirjaa tapahtumia kahdesti.

Kansion voi osoittaa pankin tiedostonsiirron, sähköpostisäännön tai synkronoidun pilvikansion
kohteeksi. Sijainnin voi vaihtaa ympäristömuuttujalla INBOX_DIR (bank-service ja voucher-service),
ja tarkkailun voi kytkeä pois: INBOX_DISABLED=true. Kansion sisältöä ei viedä gitiin.