import { prisma } from "../../../lib/prisma";

const spotTypes = ["EV", "COMPACT", "STANDARD"] as const;

export async function GET() {
	const spots = await prisma.spot.findMany({
		select: {
			id: true,
			number: true,
			floor: true,
			type: true,
			status: true,
			tickets: {
				where: { status: "ACTIVE" },
				select: { plate: true, entryTime: true },
				orderBy: { entryTime: "desc" },
				take: 1,
			},
		},
		orderBy: { number: "asc" },
	});

	const byType = Object.fromEntries(
		spotTypes.map((type) => {
			const typeSpots = spots.filter((spot) => spot.type === type);
			return [
				type,
				{
					total: typeSpots.length,
					occupied: typeSpots.filter((spot) => spot.status === "OCCUPIED")
						.length,
					available: typeSpots.filter((spot) => spot.status === "AVAILABLE")
						.length,
				},
			];
		}),
	);

	return Response.json({
		total: spots.length,
		occupied: spots.filter((spot) => spot.status === "OCCUPIED").length,
		available: spots.filter((spot) => spot.status === "AVAILABLE").length,
		byType,
		availableEvSpots: spots.filter(
			(spot) => spot.type === "EV" && spot.status === "AVAILABLE",
		),
		spots,
	});
}

export async function POST(request: Request) {
	try {
		const body = await request.json();
		const floor = Number(body.floor);
		const count = Number(body.count);
		const type = String(body.type ?? "").toUpperCase();
		if (!Number.isInteger(floor) || floor < 1 || !Number.isInteger(count) || count < 1 || count > 500 || !["EV", "COMPACT", "STANDARD"].includes(type)) {
			return Response.json({ error: "Valid floor, count, and spot type are required" }, { status: 400 });
		}
		const settings = await prisma.garageSettings.findUnique({ where: { id: "default" } });
		if (settings && floor > settings.floorCount) {
			return Response.json({ error: "Floor exceeds configured floor count" }, { status: 400 });
		}
		const prefix = type === "EV" ? "EV" : type === "COMPACT" ? "C" : "S";
		const existing = await prisma.spot.findMany({ where: { floor, type }, select: { number: true } });
		const used = new Set(existing.map((spot) => Number(spot.number.split("-").pop())));
		const data = [];
		let next = 1;
		while (data.length < count) {
			if (!used.has(next)) data.push({ number: `F${floor}-${prefix}-${next}`, floor, type, status: "AVAILABLE" });
			next += 1;
		}
		const created = await prisma.$transaction(data.map((spot) => prisma.spot.create({ data: spot })));
		return Response.json({ success: true, spots: created }, { status: 201 });
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : "Spot creation failed";
		return Response.json({ error: message }, { status: 400 });
	}
}

export async function DELETE(request: Request) {
	try {
		const body = await request.json();
		if (typeof body.id !== "string" || !body.id) return Response.json({ error: "Spot id is required" }, { status: 400 });
		const spot = await prisma.spot.findUnique({ where: { id: body.id }, select: { status: true } });
		if (!spot) return Response.json({ error: "Spot not found" }, { status: 404 });
		if (spot.status === "OCCUPIED") return Response.json({ error: "Occupied spots cannot be removed" }, { status: 409 });
		await prisma.spot.delete({ where: { id: body.id } });
		return Response.json({ success: true });
	} catch (error: unknown) {
		return Response.json({ error: error instanceof Error ? error.message : "Spot removal failed" }, { status: 400 });
	}
}

export async function PATCH(request: Request) {
	try {
		const body = await request.json();
		if (typeof body.id !== "string" || !["AVAILABLE", "MAINTENANCE"].includes(String(body.status))) {
			return Response.json({ error: "Spot id and AVAILABLE or MAINTENANCE status are required" }, { status: 400 });
		}
		const spot = await prisma.spot.findUnique({ where: { id: body.id }, select: { status: true } });
		if (!spot) return Response.json({ error: "Spot not found" }, { status: 404 });
		if (spot.status === "OCCUPIED") return Response.json({ error: "Occupied spots cannot change status" }, { status: 409 });
		const updated = await prisma.spot.update({ where: { id: body.id }, data: { status: String(body.status) } });
		return Response.json(updated);
	} catch (error: unknown) {
		return Response.json({ error: error instanceof Error ? error.message : "Spot status update failed" }, { status: 400 });
	}
}
