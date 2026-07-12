import { ImageResponse } from "next/og";

export const alt = "Vercent ERP — Connected enterprise operations";

export const size = {
  width: 1200,
  height: 630,
};

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
          "linear-gradient(135deg, #f8fafc 0%, #eef2ff 52%, #ecfeff 100%)",
        color: "#0f172a",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          position: "absolute",
          width: 480,
          height: 480,
          borderRadius: 999,
          left: -140,
          top: -160,
          background: "rgba(79,70,229,0.18)",
        }}
      />

      <div
        style={{
          display: "flex",
          position: "absolute",
          width: 400,
          height: 400,
          borderRadius: 999,
          right: -100,
          bottom: -150,
          background: "rgba(13,148,136,0.16)",
        }}
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "72px 86px",
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
          <span style={{ color: "#0f3b73" }}>Vercent</span>
          <span style={{ color: "#0284c7" }}>labs</span>
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 50,
            maxWidth: 930,
            fontSize: 72,
            lineHeight: 1.08,
            letterSpacing: -4,
            fontWeight: 800,
          }}
        >
          One connected enterprise ERP platform.
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 30,
            maxWidth: 830,
            fontSize: 27,
            lineHeight: 1.45,
            color: "#475569",
          }}
        >
          Connect finance, supply chain, manufacturing, people, projects and
          reporting.
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 42,
            gap: 12,
          }}
        >
          {[
            "10 modules",
            "5 business flows",
            "Role-based control",
            "Multi-company foundation",
          ].map((item) => (
            <div
              key={item}
              style={{
                display: "flex",
                border: "1px solid rgba(79,70,229,0.18)",
                borderRadius: 999,
                background: "rgba(255,255,255,0.8)",
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
