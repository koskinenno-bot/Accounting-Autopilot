import { create } from 'xmlbuilder2';

export interface FinvoiceData {
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  sellerName: string;
  sellerBusinessId: string;
  sellerIban: string;
  buyerName: string;
  buyerAddress?: string;
  totalAmount: number;
  currency: string;
  referenceNumber: string;
  lines: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    vatRate: number;
    totalAmount: number;
  }>;
}

/**
 * Generates a Finvoice 3.0 compliant XML string.
 * This is a simplified version focusing on core mandatory fields.
 */
export const generateFinvoiceXml = (data: FinvoiceData): string => {
  const root = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('Finvoice', { 
      'Version': '3.0',
      'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      'xsi:noNamespaceSchemaLocation': 'Finvoice3.0.xsd'
    })
      .ele('MessageTransmissionDetails')
        .ele('MessageSenderDetails').ele('FromIdentifier').txt(data.sellerBusinessId).up().up()
        .ele('MessageReceiverDetails').ele('ToIdentifier').txt('RECEIVER_ID').up().up() // Placeholder
      .up()
      .ele('SellerPartyDetails')
        .ele('SellerPartyIdentifier').txt(data.sellerBusinessId).up()
        .ele('SellerOrganisationName').txt(data.sellerName).up()
      .up()
      .ele('BuyerPartyDetails')
        .ele('BuyerOrganisationName').txt(data.buyerName).up()
      .up()
      .ele('InvoiceDetails')
        .ele('InvoiceNumber').txt(data.invoiceNumber).up()
        .ele('InvoiceDate', { 'Format': 'CCYYMMDD' }).txt(data.issueDate.replace(/-/g, '')).up()
        .ele('InvoiceTotalVatExcludedAmount', { 'AmountCurrencyIdentifier': data.currency }).txt(data.totalAmount.toFixed(2)).up()
        .ele('InvoiceTotalVatIncludedAmount', { 'AmountCurrencyIdentifier': data.currency }).txt(data.totalAmount.toFixed(2)).up()
      .up()
      .ele('EpiDetails')
        .ele('EpiPartyDetails')
          .ele('EpiBeneficiaryPartyDetails')
            .ele('EpiAccountID').txt(data.sellerIban).up()
          .up()
        .up()
        .ele('EpiPaymentInstructionDetails')
          .ele('EpiRemittanceInfoIdentifier', { 'IdentificationSchemeName': 'ISO' }).txt(data.referenceNumber).up()
          .ele('EpiDateOut', { 'Format': 'CCYYMMDD' }).txt(data.dueDate.replace(/-/g, '')).up()
        .up()
      .up();

  return root.end({ prettyPrint: true });
};
