import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        background: "#0c0f12",
        color: "#fffef9",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 56,
          height: "100%",
          display: "flex",
          background: "#4353ff",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 42,
          top: 42,
          width: 44,
          height: 44,
          display: "flex",
          background: "#d9ff43",
        }}
      />
      <div
        style={{
          display: "flex",
          fontSize: 188,
          fontWeight: 900,
          letterSpacing: -24,
          lineHeight: 1,
        }}
      >
        VL
      </div>
    </div>,
    size,
  );
}
