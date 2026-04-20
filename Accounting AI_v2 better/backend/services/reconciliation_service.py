"""
The Finnish Matcher Engine — three-priority reconciliation service.

Priority 1 — Viitenumero (Reference Number):
    Exact match between Transaction.reference_number and Apartment.reference_number.
    Categorised as "Hoitovastike" (code 3000).

Priority 2 — Rule Engine:
    Regex rules against the description text, mapped to account categories.
    Rules are defined as a list of (pattern, account_code) tuples so they are
    easy to extend without touching business logic.

Priority 3 — Local Keyword Fallback:
    Used when Priority 1 & 2 fail. Search for keywords in description
    against category names for a "fuzzy" best guess.
"""
import os
import re
import hashlib
from typing import Any, Dict, List, Optional, Tuple

from sqlmodel import Session, select
from models import AccountCategory, Apartment, MatchType, Transaction, MatchingRule
from services.global_rules import GLOBAL_KEYWORD_RULES
from services.journalizer import journalize_transaction


def _local_fuzzy_match(description: str, categories: List[AccountCategory]) -> Optional[str]:
    """
    Deterministic local fuzzy matcher. 
    Finds the first category whose name appears in the description.
    """
    desc_clean = description.lower()
    for cat in categories:
        if cat.name.lower() in desc_clean and len(cat.name) > 4:
            return cat.code
    return None


# ── Core Engine ───────────────────────────────────────────────────────────────
def is_valid_finnish_reference(ref: str) -> bool:
    """Mathematical validation for Finnish 7-3-1 reference numbers."""
    ref = ref.strip().replace(" ", "")
    if not ref.isdigit() or not (4 <= len(ref) <= 20):
        return False
        
    base = ref[:-1]
    expected_check = int(ref[-1])
    
    weights = [7, 3, 1]
    total_sum = 0
    # Multiply from right to left
    for i, digit in enumerate(reversed(base)):
        total_sum += int(digit) * weights[i % 3]
        
    calculated_check = (10 - (total_sum % 10)) % 10
    return calculated_check == expected_check


def reconcile_transactions(
    raw_transactions: List[Dict[str, Any]],
    company_id: int,
    session: Session,
    import_job_id: Optional[int] = None,
) -> Tuple[List[Transaction], Dict[str, int]]:
    """
    Reconcile a list of raw transaction dicts against the database.

    Returns:
        (saved_transactions, stats_dict)
        stats_dict keys: reference_matches, rule_matches, ai_matches, unmatched
    """
    # Load lookup data once
    apartments: List[Apartment] = list(
        session.exec(select(Apartment).where(Apartment.company_id == company_id))
    )
    categories: List[AccountCategory] = list(session.exec(select(AccountCategory)))

    # Build O(1) lookup map for viitenumero → Apartment
    ref_map: Dict[str, Apartment] = {a.reference_number: a for a in apartments}

    # Build O(1) lookup map for account code → AccountCategory
    cat_map: Dict[str, AccountCategory] = {c.code: c for c in categories}

    # Fetch and compile dynamic matching rules
    db_rules = session.exec(select(MatchingRule).where(MatchingRule.company_id == company_id)).all()
    iban_rules = {}
    compiled_rules = []
    for r in db_rules:
        if r.iban:
            iban_rules[r.iban.strip().replace(" ", "").lower()] = r.account_category_id
        if r.keyword_pattern:
            try:
                compiled_rules.append((re.compile(r.keyword_pattern, re.IGNORECASE), r.account_category_id))
            except re.error:
                continue

    # Compile global patterns once
    global_compiled = []
    for pattern, code in GLOBAL_KEYWORD_RULES:
        try:
            cat = cat_map.get(code)
            if cat:
                global_compiled.append((re.compile(pattern, re.IGNORECASE), cat.id))
        except re.error:
            continue

    # Load all existing hashes for deduplication
    existing_hashes = set(
        session.exec(
            select(Transaction.transaction_hash).where(Transaction.company_id == company_id, Transaction.transaction_hash != None)
        ).all()
    )

    # Find static categories (TALO-2024 standardized)
    hoitovastike = cat_map.get("3000")
    # Pankkikulut: 9400 (uusi) tai 6830 (legacy compatibiliteetti)
    bank_fee_cat = cat_map.get("9400") or cat_map.get("6830")
    sentti_cat = cat_map.get("9990")

    stats = {"reference_matches": 0, "rule_matches": 0, "ai_matches": 0, "unmatched": 0}
    saved: List[Transaction] = []

    unmatched_indices = []
    unmatched_data = []

    for i, raw in enumerate(raw_transactions):
        # ── PRE-FLIGHT 1: Hash Deduplication ─────────────
        hash_str = f"{raw['date']}_{raw['amount']}_{raw['description']}"
        tx_hash = hashlib.sha256(hash_str.encode("utf-8")).hexdigest()
        
        if tx_hash in existing_hashes:
            continue
            
        existing_hashes.add(tx_hash)
        
        # ── PRE-FLIGHT 2: Jaksotus Extractor ─────────────
        service_period = None
        period_match = re.search(r"(\d{1,2}\.\d{1,2})\s*-\s*(\d{1,2}\.\d{1,2})", raw["description"])
        if period_match:
            service_period = f"{period_match.group(1)} - {period_match.group(2)}"

        raw_iban = raw.get("iban")
        cleaned_iban = raw_iban.strip().replace(" ", "").lower() if raw_iban else None

        # 🚀 SCALING: Voucher Counter Cache per Year
        if not hasattr(session, '_voucher_counters'):
            session._voucher_counters = {}

        def get_next_voucher(tx_date):
            year = tx_date.year
            if year not in session._voucher_counters:
                from sqlalchemy import func
                stmt = select(func.max(Transaction.voucher_number)).where(
                    Transaction.company_id == company_id,
                    Transaction.voucher_number.like(f"{year}/%")
                )
                max_v = session.exec(stmt).first()
                if max_v:
                    try:
                        session._voucher_counters[year] = int(max_v.split('/')[1])
                    except:
                        session._voucher_counters[year] = 0
                else:
                    session._voucher_counters[year] = 0
            
            session._voucher_counters[year] += 1
            return f"{year}/{str(session._voucher_counters[year]).zfill(3)}"

        tx = Transaction(
            company_id=company_id,
            date=raw["date"],
            amount=raw["amount"],
            description=raw["description"],
            reference_number=raw.get("reference_number"),
            transaction_hash=tx_hash,
            iban=raw_iban,
            service_period=service_period,
            import_job_id=import_job_id,
            match_type=MatchType.UNMATCHED,
        )
        
        # ── PRE-FLIGHT 3: Bank Fee Override ──────────────
        if "palvelumaksu" in raw["description"].lower() and bank_fee_cat:
            tx.category_id = bank_fee_cat.id
            tx.match_type = MatchType.RULE
            stats["rule_matches"] += 1
            session.add(tx)
            saved.append(tx)
            continue

        # ── Priority 1: Viitenumero + Tolerance Buffer ───────────────────────
        ref = (raw.get("reference_number") or "").strip()
        matched = False
        if ref and is_valid_finnish_reference(ref):
            if ref in ref_map:
                apartment = ref_map[ref]
                diff = tx.amount - apartment.monthly_fee
                if diff == 0:
                    # ✔️ Exact match — Auto-Verify
                    tx.matched_apartment_id = apartment.id
                    tx.category_id = hoitovastike.id if hoitovastike else None
                    tx.match_type = MatchType.REFERENCE
                    tx.is_verified = True
                    tx.verified_at = tx.date
                    tx.verified_by = "Autopilot"
                    tx.voucher_number = get_next_voucher(tx.date)
                    stats["reference_matches"] += 1
                    matched = True
                elif abs(diff) <= 0.05:
                    # ✔️ Senttiero — round and split
                    tx.amount = apartment.monthly_fee
                    tx.matched_apartment_id = apartment.id
                    tx.category_id = hoitovastike.id if hoitovastike else None
                    tx.match_type = MatchType.REFERENCE
                    tx.is_verified = True
                    tx.verified_at = tx.date
                    tx.verified_by = "Autopilot"
                    tx.voucher_number = get_next_voucher(tx.date)
                    stats["reference_matches"] += 1
                    sentti_tx = Transaction(
                        company_id=company_id,
                        date=tx.date,
                        amount=round(diff, 2),
                        description=f"{tx.description} (Senttiero)",
                        reference_number=tx.reference_number,
                        transaction_hash=f"{tx_hash}_split",
                        iban=tx.iban,
                        import_job_id=import_job_id,
                        category_id=sentti_cat.id if sentti_cat else None,
                        match_type=MatchType.REFERENCE,
                        is_verified=True,
                        verified_by="Autopilot",
                        voucher_number=get_next_voucher(tx.date)
                    )
                    session.add(sentti_tx)
                    saved.append(sentti_tx)
                    matched = True
                else:
                    # ⚠️ Osittaismaksu — flag for manual review
                    tx.matched_apartment_id = apartment.id
                    tx.category_id = hoitovastike.id if hoitovastike else None
                    tx.match_type = MatchType.REFERENCE
                    tx.is_partial_payment = True
                    stats["reference_matches"] += 1
                    matched = True
            else:
                # 🚀 ZERO-INPUT: AUTO-DISCOVERY
                # Valid ref found but no apartment exists? CREATE IT.
                new_apt = Apartment(
                    company_id=company_id,
                    apartment_number=f"Apt (Ref {ref[-5:]})",
                    owner_name=tx.description[:50],
                    monthly_fee=tx.amount,
                    reference_number=ref
                )
                session.add(new_apt)
                session.flush()  # Get the ID

                tx.matched_apartment_id = new_apt.id
                tx.category_id = hoitovastike.id if hoitovastike else None
                tx.match_type = MatchType.REFERENCE
                tx.is_verified = True
                tx.verified_by = "Autopilot (New Apt Detected)"
                tx.voucher_number = get_next_voucher(tx.date)

                # Add to local ref_map so we don't recreate it in the same batch
                ref_map[ref] = new_apt
                stats["reference_matches"] += 1
                matched = True

        if matched:
            pass
        # ── Priority 1.5: IBAN Rule Matching ─────────────────────────────────
        elif cleaned_iban and cleaned_iban in iban_rules:
            tx.category_id = iban_rules[cleaned_iban]
            tx.match_type = MatchType.RULE
            stats["rule_matches"] += 1
        # ── Priority 2: Rule Engine ──────────────────────────────────────────
        elif _apply_rules(tx, raw["description"], compiled_rules):
            stats["rule_matches"] += 1
        # ── Priority 2.5: Global Rule Matcher ────────────────────────────────
        elif _apply_rules(tx, raw["description"], global_compiled):
            stats["rule_matches"] += 1
        # ── Priority 3: Local Fallback ───────────────────────────────────────
        else:
            code = _local_fuzzy_match(raw["description"], categories)
            if code:
                cat = cat_map.get(code)
                if cat:
                    tx.category_id = cat.id
                    tx.match_type = MatchType.RULE # We treat fuzzy as a rule-lite
                    stats["rule_matches"] += 1
                else:
                    stats["unmatched"] += 1
            else:
                stats["unmatched"] += 1

        session.add(tx)
        saved.append(tx)

    session.commit()
    for tx in saved:
        session.refresh(tx)

    # ── KPL 2:1 § Kahdenkertainen kirjanpito (Autopilot) ────────────────────
    # Generate journal lines for transactions that were automatically verified
    for tx in saved:
        if tx.is_verified and tx.category_id:
            try:
                jlines = journalize_transaction(tx, session)
                for jl in jlines:
                    session.add(jl)
            except ValueError as je:
                print(f"[JOURNALIZER WARNING] tx={tx.id}: {je}")
    session.commit()

    return saved, stats


def _apply_rules(
    tx: Transaction,
    description: str,
    compiled_rules: List[Tuple[re.Pattern, int]],
) -> bool:
    """Apply dynamic regex rule definitions to the transaction description. Mutates tx in place."""
    for pattern, cat_id in compiled_rules:
        if pattern.search(description):
            tx.category_id = cat_id
            tx.match_type = MatchType.RULE
            return True
    return False
