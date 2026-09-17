import { prisma } from "../../../../lib/prisma";
import { calculateParkingFee } from "../../../../lib/fee";

const DEFAULT_RATES = { firstHourRate: 10, additionalHourRate: 5, dailyCap: 45 };

export async function POST(request: Request) {
	try {
		const body = await request.json();
		const ticketId = typeof body.ticketId === "string" ? body.ticketId.trim() : "";
		const reason = typeof body.reason === "string" ? body.reason.trim().toUpperCase() : "MANUAL_OVERRIDE";
		if (!ticketId || !reason) return Response.json({ error: "ticketId and reason are required" }, { status: 400 });

		const requestedExit = typeof body.currentTime === "string" ? new Date(body.currentTime) : new Date();
		if (Number.isNaN(requestedExit.getTime())) return Response.json({ error: "Invalid currentTime" }, { status: 400 });

		const result = await prisma.$transaction(async (tx) => {
			const ticket = await tx.ticket.findUnique({ where: { id: ticketId }, include: { spot: true } });
			if (!ticket || ticket.status !== "ACTIVE") return null;
			const rateCard = await tx.rateCard.findUnique({ where: { spotType: ticket.spot.type } });
			const fee = calculateParkingFee(ticket.entryTime, requestedExit, rateCard ?? DEFAULT_RATES);
			const updated = await tx.ticket.updateMany({
				where: { id: ticket.id, status: "ACTIVE" },
				data: { status: "COMPLETED", exitTime: requestedExit, fee: fee.totalFee, closeReason: reason },
			});
			if (updated.count !== 1) throw new Error("TICKET_UPDATE_FAILED");
			await tx.spot.updateMany({ where: { id: ticket.spotId }, data: { status: "AVAILABLE" } });
			return { ticket: { ...ticket, status: "COMPLETED", exitTime: requestedExit, fee: fee.totalFee, closeReason: reason }, fee };
		});

		if (!result) return Response.json({ error: "Active ticket not found" }, { status: 404 });
		return Response.json({ success: true, ...result });
	} catch (error: unknown) {
		return Response.json({ error: error instanceof Error ? error.message : "Force close failed" }, { status: 400 });
	}
}