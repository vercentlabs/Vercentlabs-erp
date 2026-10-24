"use client";

// Scan with the camera on phones and tablets whose browser can read barcodes itself (the Barcode Detection API). Offered only where that API
// exists; elsewhere the hardware scanner and typing remain. The scanner itself is shared (shared/ui/CameraCodeScanner).
import { CameraScanButton as SharedCameraScanButton } from "@/shared/ui/CameraCodeScanner";

export { cameraScanningSupported } from "@/shared/ui/CameraCodeScanner";

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"];

export function CameraScanButton({ onDetect, isDisabled }: { onDetect: (barcode: string) => void; isDisabled?: boolean }) {
  return <SharedCameraScanButton formats={FORMATS} onDetect={onDetect} isDisabled={isDisabled}
    hint="Hold the barcode inside the frame. The first code read is added, then the camera turns off."
    problem="The camera could not be used. Allow camera access, or scan with the hardware scanner or type the barcode." />;
}
