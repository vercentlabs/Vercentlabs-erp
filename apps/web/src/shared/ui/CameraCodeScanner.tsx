"use client";

// Scan a barcode or QR code with the camera on phones and tablets whose browser can read codes itself (the Barcode Detection API), or read
// one from a photo. Offered only where that API exists; elsewhere typing remains. The camera is asked for only when scanning starts,
// released when the dialog closes, and a code held in front of the lens counts once: the dialog closes on the first read.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Camera } from "lucide-react";
import { Button, Dialog } from "@vercentlabs/design-system";

type Detector = { detect(source: HTMLVideoElement | ImageBitmap): Promise<Array<{ rawValue: string }>> };
type DetectorConstructor = new (options?: { formats?: string[] }) => Detector;

export function cameraScanningSupported() {
  return typeof window !== "undefined" && "BarcodeDetector" in window && Boolean(navigator.mediaDevices?.getUserMedia);
}
export function codeReadingSupported() {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}
const detectorFor = (formats: string[]) => new (window as unknown as { BarcodeDetector: DetectorConstructor }).BarcodeDetector({ formats });

// The first code in a photo, or null.
export async function readCodeFromImage(file: File, formats: string[]): Promise<string | null> {
  if (!codeReadingSupported()) return null;
  const bitmap = await createImageBitmap(file);
  try {
    const [first] = await detectorFor(formats).detect(bitmap);
    return first?.rawValue ?? null;
  } finally {
    bitmap.close();
  }
}

export function CameraScanButton({ onDetect, isDisabled, formats, label = "Scan with camera", title = "Scan with camera",
  hint = "Hold the code inside the frame. The first code read is used, then the camera turns off.",
  problem: problemText = "The camera could not be used. Allow camera access, or type the code." }: {
  onDetect: (code: string) => void; isDisabled?: boolean; formats: string[]; label?: string; title?: string; hint?: string; problem?: string;
}) {
  const [open, setOpen] = useState(false);
  // Known only in the browser (false while rendering on the server, so the first paint matches).
  const supported = useSyncExternalStore(() => () => {}, cameraScanningSupported, () => false);
  if (!supported) return null;
  return (
    <>
      <Button variant="secondary" isDisabled={isDisabled} onPress={() => setOpen(true)}>
        <Camera className="size-4" aria-hidden="true" />
        {label}
      </Button>
      {open && <CameraDialog formats={formats} title={title} hint={hint} problemText={problemText} onClose={() => setOpen(false)}
        onDetect={(value) => { setOpen(false); onDetect(value); }} />}
    </>
  );
}

function CameraDialog({ onClose, onDetect, formats, title, hint, problemText }: {
  onClose: () => void; onDetect: (code: string) => void; formats: string[]; title: string; hint: string; problemText: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The camera starts once per opening, whatever the parent re-renders.
  const detected = useRef(onDetect);
  const wanted = useRef(formats);
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
        const detector = detectorFor(wanted.current);
        timer = setInterval(async () => {
          if (done || !video.current) return;
          try {
            const [first] = await detector.detect(video.current);
            if (first?.rawValue && !done) { done = true; detected.current(first.rawValue); }
          } catch { /* a frame that could not be read */ }
        }, 200);
      } catch {
        setProblem(problemText);
      }
    })();
    return () => {
      done = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [problemText]);
  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title={title}>
      <div className="flex flex-col gap-3">
        {problem ? <p className="text-sm text-danger-emphasis">{problem}</p> : (
          <div className="relative overflow-hidden rounded-[var(--radius-control)] bg-black">
            <video ref={video} muted playsInline className="aspect-video w-full object-cover" />
            <div className="pointer-events-none absolute inset-x-8 top-1/2 h-16 -translate-y-1/2 rounded border-2 border-white/80" aria-hidden="true" />
          </div>
        )}
        <p className="text-xs text-text-muted">{hint}</p>
        <Button variant="secondary" onPress={onClose}>Cancel</Button>
      </div>
    </Dialog>
  );
}
