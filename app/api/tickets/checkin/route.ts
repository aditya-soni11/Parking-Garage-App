import { prisma } from "../../../../lib/prisma";

const vehicleTypes = ["EV", "COMPACT", "STANDARD"] as const;
type VehicleType = (typeof vehicleTypes)[number];

export async function POST(request: Request) {
	let body: unknown;

	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	if (
		typeof body !== "object" ||
		body === null ||
		typeof (body as { plate?: unknown }).plate !== "string" ||
		!vehicleTypes.includes((body as { vehicleType?: unknown }).vehicleType as VehicleType)
	) {
		return Response.json(
			{ error: "Plate and a valid vehicleType are required" },
			{ status: 400 },
		);
	}

	const plate = (body as { plate: string }).plate.trim().toUpperCase();
	const vehicleType = (body as { vehicleType: VehicleType }).vehicleType;
	const requestedSpotId =
		typeof (body as { spotId?: unknown }).spotId === "string"
			? (body as { spotId: string }).spotId
			: undefined;

	if (!plate) {
		return Response.json({ error: "Plate is required" }, { status: 400 });
	}

	try {
		const result = await prisma.$transaction(async (transaction) => {
			const existingTicket = await transaction.ticket.findFirst({
				where: { plate, status: "ACTIVE" },
				select: { id: true },
			});

			if (existingTicket) {
				return "ALREADY_CHECKED_IN" as const;
			}

			const spot = await transaction.spot.findFirst({
				where: {
					id: requestedSpotId,
					type: vehicleType,
					status: "AVAILABLE",
				},
				orderBy: { number: "asc" },
			});

			if (!spot) {
				return null;
			}

			const claimedSpot = await transaction.spot.updateMany({
				where: { id: spot.id, status: "AVAILABLE" },
				data: { status: "OCCUPIED" },
			});

			if (claimedSpot.count !== 1) {
				throw new Error("SPOT_CLAIM_FAILED");
			}

			const ticket = await transaction.ticket.create({
				data: {
					plate,
					entryTime: new Date(),
					status: "ACTIVE",
					spotId: spot.id,
				},
			});

			return { spot: { ...spot, status: "OCCUPIED" }, ticket };
		});

		if (result === "ALREADY_CHECKED_IN") {
			return Response.json(
				{ error: "This plate already has an active ticket" },
				{ status: 409 },
			);
		}

		if (!result) {
			return Response.json(
				{ error: "No available spot for this vehicle type" },
				{ status: 409 },
			);
		}

		return Response.json(result, { status: 201 });
	} catch {
		return Response.json(
			{ error: "Unable to check in vehicle" },
			{ status: 409 },
		);
	}
}
