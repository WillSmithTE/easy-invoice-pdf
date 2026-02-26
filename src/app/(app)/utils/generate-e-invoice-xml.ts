/**
 * Electronic Invoice XML Generator
 *
 * Generates XML for electronic invoice formats based on the EN 16931 European standard.
 *
 * Supported formats:
 * - XRechnung (UBL 2.1) - German B2G standard
 * - ZUGFeRD (Cross Industry Invoice / CII) - Hybrid PDF/XML format
 *
 * @see https://docs.peppol.eu/poacc/billing/3.0/
 * @see https://xeinkauf.de/xrechnung/
 * @see https://www.ferd-net.de/standards/zugferd/index.html
 */

import type { InvoiceData, SupportedEInvoiceFormats } from "@/app/schema";
import dayjs from "dayjs";

/**
 * Escapes special XML characters in a string
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Formats a number to 2 decimal places for XML output
 */
function formatAmount(amount: number): string {
  return amount.toFixed(2);
}

/**
 * Gets the currency code for the invoice
 */
function getCurrencyCode(invoiceData: InvoiceData): string {
  return invoiceData.currency;
}

/**
 * Calculates VAT breakdown from invoice items
 * Groups items by VAT rate and calculates totals per rate
 */
function calculateVatBreakdown(invoiceData: InvoiceData) {
  const vatGroups = new Map<
    string,
    {
      rate: number | string;
      taxableAmount: number;
      taxAmount: number;
    }
  >();

  for (const item of invoiceData.items) {
    const rateKey = String(item.vat);
    const existing = vatGroups.get(rateKey);

    if (existing) {
      existing.taxableAmount += item.netAmount;
      existing.taxAmount += item.vatAmount;
    } else {
      vatGroups.set(rateKey, {
        rate: item.vat,
        taxableAmount: item.netAmount,
        taxAmount: item.vatAmount,
      });
    }
  }

  return Array.from(vatGroups.values());
}

/**
 * Calculates invoice totals
 */
function calculateTotals(invoiceData: InvoiceData) {
  let totalNetAmount = 0;
  let totalVatAmount = 0;
  let totalGrossAmount = 0;

  for (const item of invoiceData.items) {
    totalNetAmount += item.netAmount;
    totalVatAmount += item.vatAmount;
    totalGrossAmount += item.preTaxAmount;
  }

  return {
    totalNetAmount,
    totalVatAmount,
    totalGrossAmount,
    payableAmount: totalGrossAmount,
  };
}

/**
 * Maps VAT rate to UN/ECE 5305 tax category code
 *
 * @see https://unece.org/fileadmin/DAM/trade/untdid/d16b/tred/tred5305.htm
 */
function getTaxCategoryCode(vatRate: number | string): string {
  if (typeof vatRate === "string") {
    // Non-numeric VAT rates (e.g., "NP", "OO") map to special categories
    const upperRate = vatRate.toUpperCase();
    if (upperRate === "NP" || upperRate === "N/A") return "O"; // Not subject to VAT
    if (upperRate === "OO") return "O"; // Outside scope
    return "E"; // Exempt from tax
  }

  if (vatRate === 0) return "Z"; // Zero rated goods
  return "S"; // Standard rate
}

/**
 * Generates XRechnung UBL 2.1 XML
 *
 * XRechnung is the German implementation of the European standard EN 16931.
 * It uses the UBL (Universal Business Language) 2.1 syntax.
 *
 * @see https://xeinkauf.de/xrechnung/
 * @see http://docs.oasis-open.org/ubl/UBL-2.1.html
 */
function generateXRechnungXml(invoiceData: InvoiceData): string {
  const currency = getCurrencyCode(invoiceData);
  const totals = calculateTotals(invoiceData);
  const vatBreakdown = calculateVatBreakdown(invoiceData);
  const invoiceNumber =
    invoiceData.invoiceNumberObject?.value || "DRAFT";
  const issueDate = invoiceData.dateOfIssue || dayjs().format("YYYY-MM-DD");
  const dueDate = invoiceData.paymentDue || dayjs().add(14, "days").format("YYYY-MM-DD");

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<ubl:Invoice xmlns:ubl="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
             xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
             xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${escapeXml(invoiceNumber)}</cbc:ID>
  <cbc:IssueDate>${escapeXml(issueDate)}</cbc:IssueDate>
  <cbc:DueDate>${escapeXml(dueDate)}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${escapeXml(currency)}</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${escapeXml(invoiceData.buyer.name)}</cbc:BuyerReference>`;

  // Seller (AccountingSupplierParty)
  xml += `
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>${escapeXml(invoiceData.seller.name)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${escapeXml(invoiceData.seller.address)}</cbc:StreetName>
        <cac:Country>
          <cbc:IdentificationCode>DE</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>`;

  if (invoiceData.seller.vatNo) {
    xml += `
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(invoiceData.seller.vatNo)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>`;
  }

  xml += `
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(invoiceData.seller.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
      <cac:Contact>
        <cbc:ElectronicMail>${escapeXml(invoiceData.seller.email)}</cbc:ElectronicMail>
      </cac:Contact>
    </cac:Party>
  </cac:AccountingSupplierParty>`;

  // Buyer (AccountingCustomerParty)
  xml += `
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>${escapeXml(invoiceData.buyer.name)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${escapeXml(invoiceData.buyer.address)}</cbc:StreetName>
        <cac:Country>
          <cbc:IdentificationCode>DE</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>`;

  if (invoiceData.buyer.vatNo) {
    xml += `
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(invoiceData.buyer.vatNo)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>`;
  }

  xml += `
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(invoiceData.buyer.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
      <cac:Contact>
        <cbc:ElectronicMail>${escapeXml(invoiceData.buyer.email)}</cbc:ElectronicMail>
      </cac:Contact>
    </cac:Party>
  </cac:AccountingCustomerParty>`;

  // Payment means
  if (invoiceData.paymentMethod || invoiceData.seller.accountNumber) {
    xml += `
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>`;

    if (invoiceData.paymentMethod) {
      xml += `
    <cbc:PaymentMeansCode name="${escapeXml(invoiceData.paymentMethod)}">58</cbc:PaymentMeansCode>`;
    }

    if (invoiceData.seller.accountNumber) {
      xml += `
    <cac:PayeeFinancialAccount>
      <cbc:ID>${escapeXml(invoiceData.seller.accountNumber)}</cbc:ID>`;

      if (invoiceData.seller.swiftBic) {
        xml += `
      <cac:FinancialInstitutionBranch>
        <cbc:ID>${escapeXml(invoiceData.seller.swiftBic)}</cbc:ID>
      </cac:FinancialInstitutionBranch>`;
      }

      xml += `
    </cac:PayeeFinancialAccount>`;
    }

    xml += `
  </cac:PaymentMeans>`;
  }

  // Tax total
  xml += `
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${escapeXml(currency)}">${formatAmount(totals.totalVatAmount)}</cbc:TaxAmount>`;

  for (const vatGroup of vatBreakdown) {
    const numericRate =
      typeof vatGroup.rate === "number" ? vatGroup.rate : 0;
    const categoryCode = getTaxCategoryCode(vatGroup.rate);

    xml += `
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${escapeXml(currency)}">${formatAmount(vatGroup.taxableAmount)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${escapeXml(currency)}">${formatAmount(vatGroup.taxAmount)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${categoryCode}</cbc:ID>
        <cbc:Percent>${formatAmount(numericRate)}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`;
  }

  xml += `
  </cac:TaxTotal>`;

  // Legal monetary total
  xml += `
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${escapeXml(currency)}">${formatAmount(totals.totalNetAmount)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${escapeXml(currency)}">${formatAmount(totals.totalNetAmount)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${escapeXml(currency)}">${formatAmount(totals.totalGrossAmount)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${escapeXml(currency)}">${formatAmount(totals.payableAmount)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>`;

  // Invoice lines
  invoiceData.items.forEach((item, index) => {
    const numericRate =
      typeof item.vat === "number" ? item.vat : 0;
    const categoryCode = getTaxCategoryCode(item.vat);

    xml += `
  <cac:InvoiceLine>
    <cbc:ID>${index + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${escapeXml(item.unit || "EA")}">${item.amount}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${escapeXml(currency)}">${formatAmount(item.netAmount)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${escapeXml(item.name || `Item ${index + 1}`)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${categoryCode}</cbc:ID>
        <cbc:Percent>${formatAmount(numericRate)}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${escapeXml(currency)}">${formatAmount(item.netPrice)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`;
  });

  xml += `
</ubl:Invoice>`;

  return xml;
}

/**
 * Generates ZUGFeRD / Factur-X Cross Industry Invoice (CII) XML
 *
 * ZUGFeRD uses the UN/CEFACT Cross Industry Invoice (CII) XML format.
 * Supports BASIC, COMFORT (EN 16931), and EXTENDED profiles.
 *
 * @see https://www.ferd-net.de/standards/zugferd/index.html
 * @see https://unece.org/trade/uncefact/xml-schemas
 */
function generateZugferdXml(
  invoiceData: InvoiceData,
  profile: "basic" | "comfort" | "extended",
): string {
  const currency = getCurrencyCode(invoiceData);
  const totals = calculateTotals(invoiceData);
  const vatBreakdown = calculateVatBreakdown(invoiceData);
  const invoiceNumber =
    invoiceData.invoiceNumberObject?.value || "DRAFT";
  const issueDate = (invoiceData.dateOfIssue || dayjs().format("YYYY-MM-DD")).replace(
    /-/g,
    "",
  );
  const dueDate = (invoiceData.paymentDue || dayjs().add(14, "days").format("YYYY-MM-DD")).replace(
    /-/g,
    "",
  );

  // Map profile to URN
  const profileUrns = {
    basic:
      "urn:factur-x.eu:1p0:basic",
    comfort:
      "urn:cen.eu:en16931:2017",
    extended:
      "urn:factur-x.eu:1p0:extended",
  };

  const profileUrn = profileUrns[profile];

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
                          xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
                          xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100"
                          xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>${escapeXml(profileUrn)}</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${escapeXml(invoiceNumber)}</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime>
      <udt:DateTimeString format="102">${escapeXml(issueDate)}</udt:DateTimeString>
    </ram:IssueDateTime>`;

  if (invoiceData.notes) {
    xml += `
    <ram:IncludedNote>
      <ram:Content>${escapeXml(invoiceData.notes)}</ram:Content>
    </ram:IncludedNote>`;
  }

  xml += `
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>`;

  // Invoice lines
  invoiceData.items.forEach((item, index) => {
    const numericRate =
      typeof item.vat === "number" ? item.vat : 0;
    const categoryCode = getTaxCategoryCode(item.vat);

    xml += `
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument>
        <ram:LineID>${index + 1}</ram:LineID>
      </ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>
        <ram:Name>${escapeXml(item.name || `Item ${index + 1}`)}</ram:Name>
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice>
          <ram:ChargeAmount>${formatAmount(item.netPrice)}</ram:ChargeAmount>
        </ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery>
        <ram:BilledQuantity unitCode="${escapeXml(item.unit || "EA")}">${item.amount}</ram:BilledQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>${categoryCode}</ram:CategoryCode>
          <ram:RateApplicablePercent>${formatAmount(numericRate)}</ram:RateApplicablePercent>
        </ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>${formatAmount(item.netAmount)}</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`;
  });

  // Trade agreement (seller and buyer)
  xml += `
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        <ram:Name>${escapeXml(invoiceData.seller.name)}</ram:Name>
        <ram:PostalTradeAddress>
          <ram:LineOne>${escapeXml(invoiceData.seller.address)}</ram:LineOne>
          <ram:CountryID>DE</ram:CountryID>
        </ram:PostalTradeAddress>`;

  if (invoiceData.seller.vatNo) {
    xml += `
        <ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">${escapeXml(invoiceData.seller.vatNo)}</ram:ID>
        </ram:SpecifiedTaxRegistration>`;
  }

  xml += `
        <ram:URIUniversalCommunication>
          <ram:URIID schemeID="EM">${escapeXml(invoiceData.seller.email)}</ram:URIID>
        </ram:URIUniversalCommunication>
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${escapeXml(invoiceData.buyer.name)}</ram:Name>
        <ram:PostalTradeAddress>
          <ram:LineOne>${escapeXml(invoiceData.buyer.address)}</ram:LineOne>
          <ram:CountryID>DE</ram:CountryID>
        </ram:PostalTradeAddress>`;

  if (invoiceData.buyer.vatNo) {
    xml += `
        <ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">${escapeXml(invoiceData.buyer.vatNo)}</ram:ID>
        </ram:SpecifiedTaxRegistration>`;
  }

  xml += `
        <ram:URIUniversalCommunication>
          <ram:URIID schemeID="EM">${escapeXml(invoiceData.buyer.email)}</ram:URIID>
        </ram:URIUniversalCommunication>
      </ram:BuyerTradeParty>
      <ram:BuyerReference>${escapeXml(invoiceData.buyer.name)}</ram:BuyerReference>
    </ram:ApplicableHeaderTradeAgreement>`;

  // Trade delivery
  xml += `
    <ram:ApplicableHeaderTradeDelivery/>`;

  // Trade settlement
  xml += `
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${escapeXml(currency)}</ram:InvoiceCurrencyCode>`;

  // Payment means
  if (invoiceData.seller.accountNumber) {
    xml += `
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>58</ram:TypeCode>
        <ram:PayeePartyCreditorFinancialAccount>
          <ram:IBANID>${escapeXml(invoiceData.seller.accountNumber)}</ram:IBANID>
        </ram:PayeePartyCreditorFinancialAccount>`;

    if (invoiceData.seller.swiftBic) {
      xml += `
        <ram:PayeeSpecifiedCreditorFinancialInstitution>
          <ram:BICID>${escapeXml(invoiceData.seller.swiftBic)}</ram:BICID>
        </ram:PayeeSpecifiedCreditorFinancialInstitution>`;
    }

    xml += `
      </ram:SpecifiedTradeSettlementPaymentMeans>`;
  }

  // Tax breakdown
  for (const vatGroup of vatBreakdown) {
    const numericRate =
      typeof vatGroup.rate === "number" ? vatGroup.rate : 0;
    const categoryCode = getTaxCategoryCode(vatGroup.rate);

    xml += `
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${formatAmount(vatGroup.taxAmount)}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        <ram:BasisAmount>${formatAmount(vatGroup.taxableAmount)}</ram:BasisAmount>
        <ram:CategoryCode>${categoryCode}</ram:CategoryCode>
        <ram:RateApplicablePercent>${formatAmount(numericRate)}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>`;
  }

  // Payment terms
  xml += `
      <ram:SpecifiedTradePaymentTerms>
        <ram:DueDateDateTime>
          <udt:DateTimeString format="102">${escapeXml(dueDate)}</udt:DateTimeString>
        </ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>`;

  // Monetary summation
  xml += `
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${formatAmount(totals.totalNetAmount)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${formatAmount(totals.totalNetAmount)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${escapeXml(currency)}">${formatAmount(totals.totalVatAmount)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${formatAmount(totals.totalGrossAmount)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${formatAmount(totals.payableAmount)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;

  return xml;
}

/**
 * Generates electronic invoice XML based on the selected format
 *
 * @param invoiceData - The invoice data to convert to XML
 * @param format - The e-invoice format to generate
 * @returns The generated XML string, or null if format is "none"
 */
export function generateEInvoiceXml(
  invoiceData: InvoiceData,
  format: SupportedEInvoiceFormats,
): string | null {
  switch (format) {
    case "none":
      return null;

    case "xrechnung":
      return generateXRechnungXml(invoiceData);

    case "zugferd-basic":
      return generateZugferdXml(invoiceData, "basic");

    case "zugferd-comfort":
      return generateZugferdXml(invoiceData, "comfort");

    case "zugferd-extended":
      return generateZugferdXml(invoiceData, "extended");

    default:
      return null;
  }
}

/**
 * Returns the appropriate file extension for the e-invoice format
 */
export function getEInvoiceFileExtension(
  format: SupportedEInvoiceFormats,
): string {
  return "xml";
}

/**
 * Returns a descriptive filename for the e-invoice XML export
 */
export function getEInvoiceFilename(
  invoiceData: InvoiceData,
  format: SupportedEInvoiceFormats,
): string {
  const invoiceNumber = invoiceData.invoiceNumberObject?.value || "draft";
  const formattedNumber = invoiceNumber.replace(/\//g, "-");

  const formatPrefix =
    format === "xrechnung" ? "xrechnung" : "zugferd";

  return `${formatPrefix}-${formattedNumber}.${getEInvoiceFileExtension(format)}`;
}
