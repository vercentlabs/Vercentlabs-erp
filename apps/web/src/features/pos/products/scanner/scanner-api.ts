"use client";

// Browser client for Barcode Scanning: one completed scan → POST /api/pos/carts/{id}/scan with its own action id; terminal scanner settings;
// matching a returned product to its receipt line.
import type { PosScanOutcome, PosScannerSettings } from "@vercentlabs/api";

import { post, request } from "@/features/pos/shared/http";

export type { PosScanOutcome, PosScannerSettings };

export const scanIntoCart = (cartId: string, input: { barcode: string; scanActionId: string; itemId?: string | null; serialNumber?: string | null; batchId?: string | null }) =>
  post<{ outcome: PosScanOutcome }>(`/carts/${cartId}/scan`, input).then((response) => response.outcome);
export const getScannerSettings = (terminalId: string) =>
  request<{ settings: PosScannerSettings }>(`/terminals/${terminalId}/scanner-settings`).then((response) => response.settings);
export const updateScannerSettings = (terminalId: string, input: Partial<PosScannerSettings> & { expectedVersion?: number }) =>
  request<{ settings: PosScannerSettings }>(`/terminals/${terminalId}/scanner-settings`, { method: "PATCH", body: JSON.stringify(input) }).then((response) => response.settings);
export type ReturnLineMatch = { saleLineId: string; itemId: string; description: string; uomCode: string | null; serialNumber: string | null; soldQuantity: string; remainingQuantity: string };
export const findReturnLine = (saleId: string, barcode: string, serial?: string | null) =>
  request<{ line: ReturnLineMatch }>(`/sales/${saleId}/return-line?barcode=${encodeURIComponent(barcode)}${serial ? `&serial=${encodeURIComponent(serial)}` : ""}`)
    .then((response) => response.line);

export const DEFAULT_SCANNER_SETTINGS: PosScannerSettings = {
  terminalId: "", enabled: true, inputMode: "keyboard_wedge", prefix: null, suffix: "enter", suffixCustom: null, successSound: true, errorSound: true, version: 0,
};

// A short beep: high for success, low for a problem. Sound only ever adds to the visual feedback.
let audio: AudioContext | null = null;
export function scanTone(kind: "success" | "error") {
  try {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    audio ??= new Context();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = kind === "success" ? 1180 : 240;
    gain.gain.value = 0.08;
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + (kind === "success" ? 0.07 : 0.25));
  } catch { /* no audio: the screen still says what happened */ }
}

// The barcode in what a scanner sent: its configured prefix and suffix and transport characters removed, nothing else.
export function stripScannerFraming(raw: string, settings: Pick<PosScannerSettings, "prefix" | "suffix" | "suffixCustom">) {
  let value = raw.replace(/[\r\n\t]/g, "");
  if (settings.suffix === "custom" && settings.suffixCustom && value.endsWith(settings.suffixCustom)) value = value.slice(0, -settings.suffixCustom.length);
  if (settings.prefix && value.startsWith(settings.prefix)) value = value.slice(settings.prefix.length);
  return value.trim();
}
