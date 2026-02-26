"use client";

import { type InvoiceData } from "@/app/schema";
import { umamiTrackEvent } from "@/lib/umami-analytics-track-event";
import { cn } from "@/lib/utils";
import { FileCode2 } from "lucide-react";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import {
  generateEInvoiceXml,
  getEInvoiceFilename,
} from "../utils/generate-e-invoice-xml";
import { E_INVOICE_FORMAT_TO_LABEL } from "@/app/schema";

/**
 * Download link component for electronic invoice XML export.
 *
 * Generates and downloads XRechnung (UBL) or ZUGFeRD (CII) XML files
 * based on the selected e-invoice format in the invoice data.
 *
 * Only visible when an e-invoice format other than "none" is selected.
 */
export function InvoiceEInvoiceDownloadLink({
  invoiceData,
}: {
  invoiceData: InvoiceData;
}) {
  const eInvoiceFormat = invoiceData.eInvoiceFormat;

  const isVisible = eInvoiceFormat && eInvoiceFormat !== "none";

  const formatLabel = useMemo(() => {
    if (!eInvoiceFormat || eInvoiceFormat === "none") return "";
    return E_INVOICE_FORMAT_TO_LABEL[eInvoiceFormat];
  }, [eInvoiceFormat]);

  const handleDownloadClick = useCallback(() => {
    if (!eInvoiceFormat || eInvoiceFormat === "none") {
      return;
    }

    try {
      const xml = generateEInvoiceXml(invoiceData, eInvoiceFormat);

      if (!xml) {
        toast.error("Failed to generate electronic invoice XML");
        return;
      }

      const filename = getEInvoiceFilename(invoiceData, eInvoiceFormat);

      // Create blob and trigger download
      const blob = new Blob([xml], {
        type: "application/xml;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up the object URL
      URL.revokeObjectURL(url);

      // Track download event
      umamiTrackEvent("download_e_invoice_xml", {
        data: {
          e_invoice_format: eInvoiceFormat,
        },
      });

      toast.success(`${formatLabel} XML downloaded successfully`);
    } catch (error) {
      console.error("Error generating e-invoice XML:", error);
      toast.error("Error generating electronic invoice XML. Please try again.");
    }
  }, [invoiceData, eInvoiceFormat, formatLabel]);

  if (!isVisible) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={handleDownloadClick}
      className={cn(
        "inline-flex h-[36px] w-full items-center justify-center gap-2 rounded-lg border border-emerald-600 bg-emerald-600 px-4 py-2 text-center text-sm font-medium text-white",
        "shadow-sm shadow-black/5 outline-offset-2 hover:bg-emerald-700 active:scale-[98%] active:transition-transform",
        "focus-visible:border-emerald-500 focus-visible:ring focus-visible:ring-emerald-200 focus-visible:ring-opacity-50",
        "lg:mb-0 lg:w-[210px]",
      )}
    >
      <FileCode2 className="h-4 w-4" />
      Download {formatLabel.includes("ZUGFeRD") ? "ZUGFeRD" : "XRechnung"} XML
    </button>
  );
}
