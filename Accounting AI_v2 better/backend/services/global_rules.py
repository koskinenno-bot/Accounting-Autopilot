
from typing import Dict, List, Tuple

# Standardized TALO-2024 Global Rule Definitions
# These are applied if no company-specific rule is found.
# Format: (Regex Pattern, Default Account Code)

GLOBAL_KEYWORD_RULES: List[Tuple[str, str]] = [
    # Utilities
    (r"Fortum|Helen|Vattenfall|Energia|Enefit|Sähkö|Sahko|Sähkönsiirto", "4700"), # Sähkö
    (r"HSY|Vesi|Viemäri|Water", "4600"),                # Vesi
    (r"Lassila|Jäte|Roska|Waste|L&T|Sita|Remeo", "4800"),        # Jätehuolto
    (r"Lämpö|Kaukolämpö|Gasum|Polttoöljy", "4500"),          # Lämmitys
    (r"Elisa|Telia|DNA|Internet|Broadband|Lounea", "4160"),        # Viestintä
    
    # Services
    (r"Isännöinti|Isannointi|Pääkirja|Isännöitsijä|Isannoitsija", "4110"),   # Isännöinti
    (r"Tilintarkastus|Tarkastus|Revision|KPMG|PwC|EY|Deloitte", "4130"),        # Tilintarkastus
    (r"Huolto|Talkkari|Maintenance|Kiinteistöpalvelu", "4200"),      # Huolto
    (r"Siivous|Puhdistus|Cleaning|Clean", "4400"),       # Siivous
    (r"Vartiointi|Securitas|Avarn|Verisure", "4200"),    # Vartiointi (as Service/Huolto)
    
    # Financial & Tax
    (r"Verohallinto|Skatteförvaltningen|Kiinteistövero|Ennakkovero", "5100"),# Kiinteistövero
    (r"Pankki|Palvelumaksu|Nordea|OP|Sampo|S-Pankki|Danske", "9400"), # Pankkikulut
    (r"Vakuutus|If|Fennia|Pohjola|LähiTapiola|Tapiola|Turva", "4900"), # Vahinkovakuutukset
    
    # Common Hardware & Repair
    (r"K-Rauta|Bauhaus|Stark|Motonet|Biltema|Clas Ohlson|Rautia", "5200"),   # Vuosikorjaukset
    (r"Pihakalusteet|Hiekoitushiekka|Kukat|Istutus", "4300"), # Ulkoalueiden hoito (4300)
]

# Global IBANs for common Finnish entities (Optional, placeholder)
GLOBAL_IBAN_RULES: Dict[str, str] = {
    # "FI...": "4xxx"
}
