from sqlmodel import Session, select
from database import engine, create_db_and_tables
from models import (
    AccountCategory,
    AccountType,
    Apartment,
    HousingCompany,
    User,
)
from auth import get_password_hash


def calculate_finnish_reference_checksum(base: str) -> str:
    """Calculates the Finnish reference number checksum digit (7-3-1 rule)."""
    weights = [7, 3, 1]
    total = sum(
        int(char) * weights[idx % 3] for idx, char in enumerate(reversed(base))
    )
    check = (10 - (total % 10)) % 10
    return f"{base}{check}"


def seed_db():
    create_db_and_tables()

    with Session(engine) as session:
        # 1. Admin User
        admin = session.exec(select(User).where(User.email == "admin@example.com")).first()
        if not admin:
            admin = User(
                email="admin@example.com",
                hashed_password=get_password_hash("password123"),
            )
            session.add(admin)
            session.commit()
            session.refresh(admin)

        # 2. FULL LEGAL TALO-2024 Chart of Accounts (Tilikartta)
        # Tuple: (code, name, AccountType, normal_balance)
        # normal_balance: DEBIT = assets & expenses, CREDIT = liabilities/equity/revenue
        accounts = [
            # ── ASSETS (1xxx) ── normal balance: DEBIT ──────────────────────
            ("1000", "Kehittämismenot", AccountType.ASSET, "DEBIT"),
            ("1020", "Aineettomat oikeudet", AccountType.ASSET, "DEBIT"),
            ("1100", "Omistuskiinteistöt", AccountType.ASSET, "DEBIT"),
            ("1110", "Omistusrakennukset ja -rakennelmat", AccountType.ASSET, "DEBIT"),
            ("1120", "Koneet ja kalusto", AccountType.ASSET, "DEBIT"),
            ("1500", "Myyntisaamiset", AccountType.ASSET, "DEBIT"),
            ("1510", "Lainasaamiset", AccountType.ASSET, "DEBIT"),
            ("1522", "OmaVerosaamiset", AccountType.ASSET, "DEBIT"),
            # Pankkitilit — journalizer käyttää koodia 1910
            ("1910", "Pankkitili (Hoitotili)", AccountType.ASSET, "DEBIT"),
            ("1920", "Pankkitili (Remonttitili)", AccountType.ASSET, "DEBIT"),
            # KPL 2:1 § — ALV-saatava (ostojen ALV)
            ("1780", "ALV-saatava (Ostojen ALV)", AccountType.ASSET, "DEBIT"),

            # ── EQUITY & LIABILITIES (2xxx) ── normal balance: CREDIT ───────
            ("2000", "Osakepääoma", AccountType.LIABILITY, "CREDIT"),
            ("2010", "Rakennusrahasto", AccountType.LIABILITY, "CREDIT"),
            ("2040", "Lainanlyhennysrahasto", AccountType.LIABILITY, "CREDIT"),
            ("2070", "Edellisten tilikausien voitto/tappio", AccountType.LIABILITY, "CREDIT"),
            ("2100", "Asuintalovaraukset", AccountType.LIABILITY, "CREDIT"),
            ("2320", "Lainat rahoituslaitoksilta (Pitkäaikainen)", AccountType.LIABILITY, "CREDIT"),
            ("2400", "Ostovelat", AccountType.LIABILITY, "CREDIT"),
            ("2430", "Muut lyhytaikaiset velat", AccountType.LIABILITY, "CREDIT"),
            ("2450", "Siirtovelat", AccountType.LIABILITY, "CREDIT"),
            # KPL 2:1 § — ALV-velka (myynnin ALV)
            ("2700", "ALV-velka (Myynnin ALV)", AccountType.LIABILITY, "CREDIT"),

            # ── REVENUE (3xxx) ── normal balance: CREDIT ────────────────────
            ("3000", "Hoitovastikkeet", AccountType.REVENUE, "CREDIT"),
            ("3010", "Hankeosuusvastikkeet", AccountType.REVENUE, "CREDIT"),
            ("3020", "Vesivastikkeet / Kulutusperusteiset", AccountType.REVENUE, "CREDIT"),
            ("3030", "Erityisvastikkeet", AccountType.REVENUE, "CREDIT"),
            ("3040", "Rahastoidut vastikkeet (Tuloutetut)", AccountType.REVENUE, "CREDIT"),
            ("3100", "Vuokrat (Huoneistot)", AccountType.REVENUE, "CREDIT"),
            ("3110", "Vuokrat (Liiketilat)", AccountType.REVENUE, "CREDIT"),
            ("3200", "Saunamaksut", AccountType.REVENUE, "CREDIT"),
            ("3210", "Autopaikkamaksut", AccountType.REVENUE, "CREDIT"),
            ("3220", "Pesutupamaksut", AccountType.REVENUE, "CREDIT"),
            ("3300", "Muut kiinteistön tuotot", AccountType.REVENUE, "CREDIT"),

            # ── EXPENSES (4xxx-5xxx) ── normal balance: DEBIT ───────────────
            ("4000", "Palkat ja palkkiot", AccountType.EXPENSE, "DEBIT"),
            ("4050", "Henkilösivukulut", AccountType.EXPENSE, "DEBIT"),
            ("4100", "Hallintokulut (Yleiset)", AccountType.EXPENSE, "DEBIT"),
            ("4110", "Isännöintipalkkiot", AccountType.EXPENSE, "DEBIT"),
            ("4130", "Tilintarkastus ja tarkastus", AccountType.EXPENSE, "DEBIT"),
            ("4160", "Toimistokulut ja viestintä", AccountType.EXPENSE, "DEBIT"),
            ("4200", "Huoltopalvelut (Kiinteistöhuolto)", AccountType.EXPENSE, "DEBIT"),
            ("4300", "Ulkoalueiden hoito", AccountType.EXPENSE, "DEBIT"),
            ("4400", "Siivous", AccountType.EXPENSE, "DEBIT"),
            ("4500", "Lämmitys (Kaukolämpö)", AccountType.EXPENSE, "DEBIT"),
            ("4600", "Vesi ja jätevesi", AccountType.EXPENSE, "DEBIT"),
            ("4700", "Sähkö ja kaasu", AccountType.EXPENSE, "DEBIT"),
            ("4800", "Jätehuolto", AccountType.EXPENSE, "DEBIT"),
            ("4900", "Vahinkovakuutukset", AccountType.EXPENSE, "DEBIT"),
            ("5100", "Kiinteistövero", AccountType.EXPENSE, "DEBIT"),
            # Korjaukset (5200+) — näytetään korjauslaskelmassa
            ("5200", "Vuosikorjaukset (Yleiset)", AccountType.EXPENSE, "DEBIT"),
            ("5210", "Rakennuskorjaukset", AccountType.EXPENSE, "DEBIT"),
            ("5220", "LVI-korjaukset", AccountType.EXPENSE, "DEBIT"),
            ("5230", "Sähkökorjaukset", AccountType.EXPENSE, "DEBIT"),

            # ── FINANCIAL (9xxx) ─────────────────────────────────────────────
            ("9000", "Osinkotuotot", AccountType.REVENUE, "CREDIT"),
            ("9100", "Korkotuotot", AccountType.REVENUE, "CREDIT"),
            ("9200", "Pääomavastikkeet (Rahoitusvastikkeet)", AccountType.REVENUE, "CREDIT"),
            ("9210", "Lainaosuussuoritukset", AccountType.REVENUE, "CREDIT"),
            ("9300", "Korkokulut", AccountType.EXPENSE, "DEBIT"),
            ("9400", "Pankkikulut", AccountType.EXPENSE, "DEBIT"),
            ("9990", "Senttierot", AccountType.EXPENSE, "DEBIT"),
        ]

        for code, name, acc_type, nb in accounts:
            existing = session.exec(select(AccountCategory).where(AccountCategory.code == code)).first()
            if not existing:
                session.add(AccountCategory(code=code, name=name, type=acc_type, normal_balance=nb))
            else:
                # Update normal_balance on existing records
                existing.normal_balance = nb
                session.add(existing)

        # 3. Housing Company
        company = session.exec(select(HousingCompany).where(HousingCompany.business_id == "1234567-8")).first()
        if not company:
            company = HousingCompany(
                name="Asunto Oy Esimerkki",
                business_id="1234567-8",
                bank_account="FI1234567890123456",
                owner_id=admin.id,
            )
            session.add(company)
            session.commit()
            session.refresh(company)

            # 4. Apartments for this Company
            apartments_data = [
                ("A1", "Matti Meikäläinen", 250.00, "10001"),
                ("A2", "Maija Meikäläinen", 180.00, "10002"),
                ("A3", "Kalle Konsultti", 210.00, "10003"),
                ("B1", "Ville Virtanen", 150.00, "10004"),
                ("B2", "Sari Siivooja", 175.00, "10005"),
            ]

            for apt_num, owner, fee, base_ref in apartments_data:
                full_ref = calculate_finnish_reference_checksum(base_ref)
                apt = Apartment(
                    company_id=company.id,
                    apartment_number=apt_num,
                    owner_name=owner,
                    monthly_fee=fee,
                    reference_number=full_ref,
                )
                session.add(apt)

            # 5. Seed default matching rules (TALO-2024 Aligned)
            rules_definitions = [
                ("Fortum|Helen|Vattenfall|Energia", "4700"),   # Sähkö
                ("HSY|Vesi|Viemäri", "4600"),                   # Vesi
                ("Lassila|Jäte|Roska", "4800"),                 # Jätehuolto
                ("Isännöinti|Isannointi|Pääkirja", "4110"),     # Isännöinti
                ("Huolto|Talkkari", "4200"),                    # Huolto
                ("Siivous|Puhdistus", "4400"),                  # Siivous
                ("Lämpö|Kaukolämpö", "4500"),                   # Lämmitys
                ("Vakuutus|If|Fennia|Pohjola", "4900"),         # Vakuutus
                ("Verohallinto|Kiinteistövero", "5100"),        # Veronmaksu
                ("Pankki|Palvelumaksu", "9400"),                # Pankkikulut
            ]

            for pattern, code in rules_definitions:
                cat = session.exec(select(AccountCategory).where(AccountCategory.code == code)).first()
                if cat:
                    from models import MatchingRule
                    rule = MatchingRule(
                        company_id=company.id,
                        keyword_pattern=pattern,
                        account_category_id=cat.id
                    )
                    session.add(rule)

        # 6. Second Housing Company for Portfolio Testing
        company2 = session.exec(select(HousingCompany).where(HousingCompany.business_id == "7654321-0")).first()
        if not company2:
            company2 = HousingCompany(
                name="Asunto Oy Keskuskatu",
                business_id="7654321-0",
                bank_account="FI9876543210987654",
                owner_id=admin.id,
            )
            session.add(company2)
            session.commit()
            session.refresh(company2)

            apts2 = [
                ("C10", "Pekka Puupää", 300.00, "20001"),
                ("C11", "Kaisa Kassinen", 350.00, "20002"),
                ("C12", "Jussi Juonio", 280.00, "20003"),
            ]
            for apt_num, owner, fee, base_ref in apts2:
                full_ref = calculate_finnish_reference_checksum(base_ref)
                apt = Apartment(
                    company_id=company2.id,
                    apartment_number=apt_num,
                    owner_name=owner,
                    monthly_fee=fee,
                    reference_number=full_ref,
                )
                session.add(apt)

        session.commit()
        print("Database seeded: TALO-2024 tilikartta + normal_balance + journalizer-yhteensopivat tilikoodit.")

if __name__ == "__main__":
    seed_db()
