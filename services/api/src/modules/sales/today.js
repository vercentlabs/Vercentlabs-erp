// Today, as the company counts it (Sales audit B2): a document dated, defaulted or checked against "today" uses the date in the company's
// time zone (organizations.timezone), never the server's UTC date — between midnight and 05:30 IST that is still yesterday in UTC, and on
// 1 April the wrong financial year and GST month. In SQL the same day is tenant.company_today().

// The company's day ("YYYY-MM-DD"); the client's organization is the one set for the transaction.
export async function companyToday(client) {
  return (await client.query("SELECT tenant.company_today()::text AS today")).rows[0].today;
}

// Where no database is at hand (a display state): the date in India.
export const indiaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
