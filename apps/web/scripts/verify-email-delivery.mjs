import fs from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";

const file = path.resolve(process.cwd(), ".env.local");
if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);

for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (!match || line.trimStart().startsWith("#")) continue;

  const [, name, raw] = match;
  if (process.env[name] !== undefined) continue;

  let value = raw;
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      value = JSON.parse(value);
    } catch {
      value = value.slice(1, -1);
    }
  } else if (value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1);
  }

  process.env[name] = value;
}

for (const name of [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "AUTH_EMAIL_FROM",
]) {
  if (!process.env[name]?.trim()) throw new Error(`Missing ${name}`);
}

const secure = process.env.SMTP_SECURE?.toLowerCase() !== "false";
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure,
  requireTLS: !secure,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 20000,
  tls: { minVersion: "TLSv1.2" },
});

await transporter.verify();

const result = await transporter.sendMail({
  from: process.env.AUTH_EMAIL_FROM,
  to: process.env.TEST_EMAIL || process.env.SMTP_USER,
  subject: "Vercentlabs ERP email delivery test",
  text: "Your Vercentlabs ERP authentication email service is working.",
  html: "<h2>Vercentlabs ERP</h2><p>Your authentication email service is working.</p>",
});

console.log("SUCCESS: SMTP authentication and delivery verified.");
console.log("Message ID:", result.messageId);
