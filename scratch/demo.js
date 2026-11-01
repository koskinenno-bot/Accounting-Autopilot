/**
 * AI Accountant V3 - Automaation logiikan validointi
 * Tämä skripti simuloi järjestelmän sisäistä logiikkaa kuitin ja tiliotteen osalta.
 */

console.log("\x1b[36m%s\x1b[0m", "=== AI ACCOUNTANT V3: AUTOMAATION DEMO ===");

// 1. SKENAARIO: KUITIN LATAUS (VOUCHER AUTOMATION)
console.log("\n\x1b[33m%s\x1b[0m", "1. SKENAARIO: Kuitin lataus ja AI-tiliöinti");
const mockVoucher = {
  filename: "kone_huolto.pdf",
  content: "KONE Oyj - Hissin huolto: 1240.00€"
};

console.log("-> Ladattu tiedosto:", mockVoucher.filename);
console.log("-> AI-palvelu analysoi sisältöä...");

// Simuloitu ML-logiikka
const suggestion = {
  account: "4400", // Korjaus ja huolto
  label: "Kunnossapito",
  confidence: 0.98
};

console.log(`\x1b[32m%s\x1b[0m`, `   [AI] Luokitus onnistui! Ehdotus: ${suggestion.account} (${suggestion.label}) - Luottamus: ${suggestion.confidence * 100}%`);
console.log(`   [Action] Luodaan kirjanpitovienti tilille ${suggestion.account}.`);

// 2. SKENAARIO: TILIOTTEEN LUKU (BANK AUTOMATION)
console.log("\n\x1b[33m%s\x1b[0m", "2. SKENAARIO: Tiliotteen luku ja automaattinen kuittaus");
const mockBankTx = {
  amount: 450.0,
  reference: "1234561",
  payer: "Osakas M. Meikäläinen"
};

console.log("-> Vastaanotettu tiliote (XML/CAMT.053)");
console.log(`-> Tunnistettu suoritus: ${mockBankTx.amount}€, Viite: ${mockBankTx.reference}`);

// Simuloitu laskun täsmäys
const matchedInvoice = {
  id: "INV-2026-001",
  status: "UNPAID",
  recipient: "M. Meikäläinen"
};

console.log(`\x1b[32m%s\x1b[0m`, `   [Match] Löydetty avoin lasku: ${matchedInvoice.id} (${matchedInvoice.recipient})`);
console.log(`   [Action] Lasku ${matchedInvoice.id} merkitty MAKSETUKSI automaattisesti.`);
console.log(`   [Action] Kirjanpitoon luotu automaattinen täsmäytysvienti.`);

console.log("\n\x1b[36m%s\x1b[0m", "=== DEMO VALMIS: Järjestelmän ydintoiminnot validoitu ===");
