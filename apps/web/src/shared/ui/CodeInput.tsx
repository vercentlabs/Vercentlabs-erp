"use client";

// The 6-digit email code: six boxes, one digit each; pasting a whole code fills all six, and the code is sent as soon as the sixth digit
// is in (no button). resetKey: when it changes (a wrong code), the boxes empty and the first one takes focus again.
import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";

export function CodeInput({ onComplete, disabled = false, resetKey }: { onComplete: (code: string) => void; disabled?: boolean; resetKey?: unknown }) {
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [seenReset, setSeenReset] = useState(resetKey);
  const boxes = useRef<Array<HTMLInputElement | null>>([]);
  if (seenReset !== resetKey) {
    setSeenReset(resetKey);
    setDigits(["", "", "", "", "", ""]);
  }
  useEffect(() => {
    boxes.current[0]?.focus();
  }, [resetKey]);
  const update = (next: string[]) => {
    setDigits(next);
    if (next.every((d) => d !== "")) onComplete(next.join(""));
  };
  const type = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = digit;
    if (digit && index < 5) boxes.current[index + 1]?.focus();
    update(next);
  };
  const paste = (event: ClipboardEvent<HTMLInputElement>) => {
    const code = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (code.length !== 6) return;
    event.preventDefault();
    update(code.split(""));
    boxes.current[5]?.focus();
  };
  const key = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !digits[index] && index > 0) boxes.current[index - 1]?.focus();
  };
  return (
    <div className="flex justify-between gap-2" role="group" aria-label="6-digit code">
      {digits.map((digit, index) => (
        <input key={index} ref={(el) => { boxes.current[index] = el; }} value={digit} disabled={disabled} inputMode="numeric" autoComplete={index === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${index + 1}`} maxLength={1} autoFocus={index === 0}
          className="h-12 w-11 rounded-md border border-border bg-surface text-center text-lg font-semibold text-text focus:border-brand focus:outline-none disabled:opacity-60"
          onChange={(event) => type(index, event.target.value)} onPaste={paste} onKeyDown={(event) => key(index, event)} />
      ))}
    </div>
  );
}
