import { prisma } from "../../../lib/prisma";

export async function GET() {
	const settings = await prisma.garageSettings.upsert({
		where: { id: "default" },
		update: {},
		create: { id: "default" },
	});
	return Response.json(settings);
}

export async function PATCH(request: Request) {
	try {
		const body = await request.json();
		const data: Record<string, string | number> = {};
		if (typeof body.name === "string") data.name = body.name.trim();
		if (typeof body.address === "string") data.address = body.address.trim();
		if (typeof body.taxId === "string") data.taxId = body.taxId.trim();
		if (body.floorCount !== undefined) {
			const floorCount = Number(body.floorCount);
			if (!Number.isInteger(floorCount) || floorCount < 1 || floorCount > 100) return Response.json({ error: "floorCount must be between 1 and 100" }, { status: 400 });
			data.floorCount = floorCount;
		}
		const settings = await prisma.garageSettings.upsert({ where: { id: "default" }, update: data, create: { id: "default", ...data } });
		return Response.json(settings);
	} catch (error: unknown) {
		return Response.json({ error: error instanceof Error ? error.message : "Settings update failed" }, { status: 400 });
	}
}