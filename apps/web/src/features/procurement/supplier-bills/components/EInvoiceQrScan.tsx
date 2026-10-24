"use client";

// Scan the supplier's GST e-invoice QR on the bill form (Procurement report Phase 2): with the camera, from a photo of the invoice, or by
// pasting the QR's text. The server reads and checks it; the form takes the invoice number, date, total, IRN and (for a bill without an
// order) the supplier.
import { useRef, useState, useSyncExternalStore } from "react";
import { useMutation } from "@tanstack/react-query";
import { ImageUp, QrCode } from "lucide-react";
import { Button, TextArea } from "@vercentlabs/design-system";

import { Notice } from "@/shared/ui/Panel";
import { CameraScanButton, codeReadingSupported, readCodeFromImage } from "@/shared/ui/CameraCodeScanner";
import { post } from "@/features/procurement/shared/http";

export type EInvoiceRead = {
  qr: { supplierGstin: string | null; buyerGstin: string | null; invoiceNumber: string | null; documentType: string | null; invoiceDate: string | null; total: string | null;
    itemCount: number | null; irn: string; irnDate: string | null; signatureVerified: boolean | null };
  supplier: { id: string; name: string; status: string } | null;
  problems: string[];
};

const check = (qr: string) => post<{ result: EInvoiceRead }>("/supplier-bills/einvoice-qr", { qr }).then((result) => result.result);

export function EInvoiceQrScan({ onRead }: { onRead: (read: EInvoiceRead) => void }) {
  const photo = useRef<HTMLInputElement>(null);
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const reading = useSyncExternalStore(() => () => {}, codeReadingSupported, () => false);
  const run = useMutation({ mutationFn: check, onSuccess: (read) => { setPasting(false); setText(""); onRead(read); } });
  const fromPhoto = async (file: File | undefined) => {
    setProblem(null);
    if (!file) return;
    const code = await readCodeFromImage(file, ["qr_code"]).catch(() => null);
    if (code) run.mutate(code); else setProblem("No QR code was found in the photo. Take a closer, sharper photo of the QR.");
  };
  const read = run.data;
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium"><QrCode className="size-4" aria-hidden="true" />E-invoice QR</span>
        <CameraScanButton formats={["qr_code"]} label="Scan QR" title="Scan the e-invoice QR" isDisabled={run.isPending} onDetect={(code) => run.mutate(code)}
          hint="Hold the QR on the supplier's invoice inside the frame." />
        {reading && (
          <>
            <input ref={photo} type="file" accept="image/*" className="sr-only" onChange={(event) => { void fromPhoto(event.target.files?.[0]); event.target.value = ""; }} />
            <Button variant="secondary" isDisabled={run.isPending} onPress={() => photo.current?.click()}><ImageUp className="size-4" aria-hidden="true" />From a photo</Button>
          </>
        )}
        <Button variant="ghost" onPress={() => setPasting(!pasting)}>{pasting ? "Close" : "Paste QR text"}</Button>
      </div>
      {pasting && (
        <div className="flex flex-col gap-2">
          <TextArea label="QR text" value={text} onChange={setText} rows={3} description="What a QR reader app shows for the invoice's QR." />
          <Button className="w-fit" variant="secondary" isDisabled={!text.trim()} isLoading={run.isPending} onPress={() => run.mutate(text.trim())}>Read</Button>
        </div>
      )}
      {(problem || run.error) && <Notice>{problem ?? (run.error instanceof Error ? run.error.message : "The QR could not be read.")}</Notice>}
      {read && (
        <Notice tone={read.problems.length ? "warning" : "success"}>
          Read: invoice {read.qr.invoiceNumber ?? "—"}{read.qr.invoiceDate ? ` of ${read.qr.invoiceDate}` : ""}{read.qr.total ? `, total ${read.qr.total}` : ""}
          {read.supplier ? ` from ${read.supplier.name}` : ""}; IRN kept on the bill.
          {read.problems.length > 0 && <ul className="mt-1 list-disc pl-5">{read.problems.map((entry) => <li key={entry}>{entry}</li>)}</ul>}
        </Notice>
      )}
    </div>
  );
}
