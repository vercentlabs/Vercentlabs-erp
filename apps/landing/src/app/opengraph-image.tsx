import { ImageResponse } from "next/og";

export const alt =
  "VercentLabs ERP — Connected ERP for growing Indian businesses";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        background:
          "linear-gradient(135deg, #f8fafc 0%, #eef2ff 55%, #ecfeff 100%)",
        color: "#0f172a",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          position: "absolute",
          width: 460,
          height: 460,
          borderRadius: 999,
          left: -120,
          top: -160,
          background: "rgba(79,70,229,0.18)",
        }}
      />
      <div
        style={{
          display: "flex",
          position: "absolute",
          width: 380,
          height: 380,
          borderRadius: 999,
          right: -80,
          bottom: -140,
          background: "rgba(13,148,136,0.16)",
        }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "72px 84px",
          position: "relative",
          width: "100%",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 30,
            fontWeight: 800,
            letterSpacing: -1,
          }}
        >
          <span style={{ color: "#0f3b73" }}>VercentLabs</span>
          <span style={{ color: "#0284c7" }}>labs</span>
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 48,
            maxWidth: 980,
            fontSize: 68,
            lineHeight: 1.08,
            letterSpacing: -4,
            fontWeight: 800,
          }}
        >
          Connected ERP for growing Indian businesses.
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 28,
            maxWidth: 900,
            fontSize: 26,
            lineHeight: 1.45,
            color: "#475569",
          }}
        >
          Finance, inventory, sales and operations on one controlled platform.
        </div>
        <div style={{ display: "flex", marginTop: 40, gap: 12 }}>
          {[
            "10 connected modules",
            "5 end-to-end workflows",
            "Phased implementation",
          ].map((item) => (
            <div
              key={item}
              style={{
                display: "flex",
                border: "1px solid rgba(79,70,229,0.18)",
                borderRadius: 999,
                background: "rgba(255,255,255,0.82)",
                padding: "10px 18px",
                fontSize: 18,
                fontWeight: 700,
                color: "#4338ca",
              }}
            >
              {item}
            </div>
          ))}
        </div>
      </div>
    </div>,
    size,
  );
}
