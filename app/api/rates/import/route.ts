import { prisma } from "../../../../lib/prisma";

// Cleans junk like "$10.00 / 1st hr" -> 10.00
function parseMoney(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = String(value ?? "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const amount = Number(match[0]);
  return Number.isFinite(amount) ? amount : null;
}

// Cleans junk like "  e.v.  " -> "EV"
function normalizeSpotType(value: unknown): "EV" | "COMPACT" | "STANDARD" | null {
  const clean = String(value ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  if (clean === "EV" || clean.includes("ELECTRIC")) return "EV";
  if (clean.includes("COMPACT")) return "COMPACT";
  if (clean.includes("STANDARD")) return "STANDARD";
  return null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const items = Array.isArray(body) ? body : [body];
      if (!items.length || items.some((item) => !item || typeof item !== "object")) {
        return Response.json({ error: "Expected a rate object or array" }, { status: 400 });
      }
      const results = [];

    for (const item of items) {
        const source = item as Record<string, unknown>;
        const spotType = normalizeSpotType(source.spotType ?? source.type);
        const firstHourRate = parseMoney(source.firstHourRate ?? source.firstHour ?? source.first_hour);
        const additionalHourRate = parseMoney(source.additionalHourRate ?? source.extraHour ?? source.additional_hour);
        const dailyCap = parseMoney(source.dailyCap ?? source.cap ?? source.daily_cap);
        if (!spotType || firstHourRate === null || additionalHourRate === null || dailyCap === null) {
          return Response.json({ error: "Each rate needs a valid type, first-hour rate, additional-hour rate, and daily cap" }, { status: 400 });
        }

      const rate = await prisma.rateCard.upsert({
        where: { spotType },
        update: { firstHourRate, additionalHourRate, dailyCap },
        create: { spotType, firstHourRate, additionalHourRate, dailyCap },
      });
      results.push(rate);
    }

    return Response.json({ success: true, rates: results });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Rate import failed";
      return Response.json({ error: message }, { status: 400 });
  }
}