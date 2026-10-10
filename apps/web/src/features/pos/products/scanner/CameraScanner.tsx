"use client";

// Scan with the camera on phones and tablets whose browser can read barcodes itself (the Barcode Detection API). Offered only where that API
// exists; elsewhere the hardware scanner and typing remain. The camera is asked for only when the cashier starts, released when the dialog
// closes, and a code held in front of the lens counts once: the dialog closes on the first read.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Camera } from "lucide-react";
import { Button, Dialog } from "@vercentlabs/design-system";

type Detector = { detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>> };
type DetectorConstructor = new (options?: { formats?: string[] }) => Detector;
const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"];

export function cameraScanningSupported() {
  return typeof window !== "undefined" && "BarcodeDetector" in window && Boolean(navigator.mediaDevices?.getUserMedia);
}

export function CameraScanButton({ onDetect, isDisabled }: { onDetect: (barcode: string) => void; isDisabled?: boolean }) {
  const [open, setOpen] = useState(false);
  // Known only in the browser (false while rendering on the server, so the first paint matches).
  const supported = useSyncExternalStore(() => () => {}, cameraScanningSupported, () => false);
  if (!supported) return null;
  return (
    <>
      <Button variant="secondary" isDisabled={isDisabled} onPress={() => setOpen(true)}>
        <Camera className="size-4" aria-hidden="true" />
        Scan with camera
      </Button>
      {open && <CameraDialog onClose={() => setOpen(false)} onDetect={(value) => { setOpen(false); onDetect(value); }} />}
    </>
  );
}

function CameraDialog({ onClose, onDetect }: { onClose: () => void; onDetect: (barcode: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The camera starts once per opening, whatever the parent re-renders.
  const detected = useRef(onDetect);
  useEffect(() => { detected.current = onDetect; });
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let done = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const BarcodeDetector = (window as unknown as { BarcodeDetector: DetectorConstructor }).BarcodeDetector;
        const detector = new BarcodeDetector({ formats: FORMATS });
        timer = setInterval(async () => {
          if (done || !video.current) return;
          try {
            const [first] = await detector.detect(video.current);
            if (first?.rawValue && !done) { done = true; detected.current(first.rawValue); }
          } catch { /* a frame that could not be read */ }
        }, 200);
      } catch {
        setProblem("The camera could not be used. Allow camera access, or scan with the hardware scanner or type the barcode.");
      }
    })();
    return () => {
      done = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title="Scan with camera">
      <div className="flex flex-col gap-3">
        {problem ? <p className="text-sm text-danger-emphasis">{problem}</p> : (
          <div className="relative overflow-hidden rounded-[var(--radius-control)] bg-black">
            <video ref={video} muted playsInline className="aspect-video w-full object-cover" />
            <div className="pointer-events-none absolute inset-x-8 top-1/2 h-16 -translate-y-1/2 rounded border-2 border-white/80" aria-hidden="true" />
          </div>
        )}
        <p className="text-xs text-text-muted">Hold the barcode inside the frame. The first code read is added, then the camera turns off.</p>
        <Button variant="secondary" onPress={onClose}>Cancel</Button>
      </div>
    </Dialog>
  );
}
