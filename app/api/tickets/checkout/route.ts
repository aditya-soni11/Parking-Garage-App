import { prisma } from "../../../../lib/prisma";
import { calculateParkingFee } from "../../../../lib/fee";

export async function POST(request: Request) {
	let body: unknown;

	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	if (typeof body !== "object" || body === null) {
		return Response.json({ error: "Ticket id, spot number, or plate is required" }, { status: 400 });
	}

	const input = body as { plate?: unknown; ticketId?: unknown; spotNumber?: unknown };
	const plate = typeof input.plate === "string" ? input.plate.trim().toUpperCase() : undefined;
	const ticketId = typeof input.ticketId === "string" ? input.ticketId.trim() : undefined;
	const spotNumber = typeof input.spotNumber === "string" ? input.spotNumber.trim().toUpperCase() : undefined;

	if (!plate && !ticketId && !spotNumber) {
		return Response.json({ error: "Ticket id, spot number, or plate is required" }, { status: 400 });
	}

	const result = await prisma.$transaction(async (transaction) => {
		const activeTicket = await transaction.ticket.findFirst({
			where: {
				status: "ACTIVE",
				OR: [
					...(ticketId ? [{ id: ticketId }] : []),
					...(plate ? [{ plate }] : []),
					...(spotNumber ? [{ spot: { number: spotNumber } }] : []),
				],
			},
			include: { spot: true },
			orderBy: { entryTime: "asc" },
		});

		if (!activeTicket) {
			return null;
		}

		const exitTime = new Date();
		const rateCard = await transaction.rateCard.findUnique({
			where: { spotType: activeTicket.spot.type },
		});
		const rates = {
			firstHourRate: rateCard?.firstHourRate ?? 10,
			additionalHourRate: rateCard?.additionalHourRate ?? 5,
			dailyCap: rateCard?.dailyCap ?? 45,
		};
		const breakdown = calculateParkingFee(
			activeTicket.entryTime,
			exitTime,
			rates,
		);
		const updatedTicket = await transaction.ticket.updateMany({
			where: { id: activeTicket.id, status: "ACTIVE" },
				data: {
				status: "COMPLETED",
				fee: breakdown.totalFee,
				exitTime,
					closeReason: "NORMAL_CHECKOUT",
			},
		});

		if (updatedTicket.count !== 1) {
			throw new Error("TICKET_UPDATE_FAILED");
		}

		const releasedSpot = await transaction.spot.updateMany({
			where: { id: activeTicket.spotId },
			data: { status: "AVAILABLE" },
		});

		if (releasedSpot.count !== 1) {
			throw new Error("SPOT_RELEASE_FAILED");
		}

		return {
			ticket: {
				...activeTicket,
				status: "COMPLETED",
				fee: breakdown.totalFee,
				exitTime,
			},
			spot: { ...activeTicket.spot, status: "AVAILABLE" },
			fee: breakdown,
		};
	});

	if (!result) {
		return Response.json(
			{ error: "No active ticket found for this plate" },
			{ status: 404 },
		);
	}

	return Response.json(result);
}
