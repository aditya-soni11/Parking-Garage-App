import { prisma } from "../../../lib/prisma";
import { calculateParkingFee } from "../../../lib/fee";

const DEFAULT_RATES = {
  firstHourRate: 10,
  additionalHourRate: 5,
  dailyCap: 45,
};

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const currentTime =
      typeof body?.currentTime === "string" && body.currentTime.trim()
        ? new Date(body.currentTime)
        : new Date();

    if (Number.isNaN(currentTime.getTime())) {
      return Response.json(
        { error: "Invalid currentTime provided" },
        { status: 400 },
      );
    }

    // 1. Fetch all ACTIVE tickets along with their assigned spot
    const activeTickets = await prisma.ticket.findMany({
      where: { status: "ACTIVE" },
      include: { spot: true },
    });

    const closedTickets = [];

    // 2. Evaluate each active ticket
    for (const ticket of activeTickets) {
      const entryTime = new Date(ticket.entryTime);
      const durationMs = currentTime.getTime() - entryTime.getTime();
      const durationHours = durationMs / (1000 * 60 * 60);

      // Only auto-close if parked strictly over 24 hours
      if (durationHours > 24) {
        // 3. Atomically update ticket and free the spot
        const completedTicket = await prisma.$transaction(async (tx) => {
          const rateCard = await tx.rateCard.findUnique({
            where: { spotType: ticket.spot.type },
          });
          const activeRates = rateCard ?? DEFAULT_RATES;
          const feeBreakdown = calculateParkingFee(
            entryTime,
            currentTime,
            activeRates,
          );
          const updatedTicket = await tx.ticket.updateMany({
            where: { id: ticket.id, status: "ACTIVE" },
            data: {
              status: "COMPLETED",
              exitTime: currentTime,
              fee: feeBreakdown.totalFee,
              closeReason: "AUTO_24H",
            },
          });

          if (updatedTicket.count !== 1) {
            throw new Error("TICKET_UPDATE_FAILED");
          }

          const releasedSpot = await tx.spot.updateMany({
            where: { id: ticket.spotId },
            data: { status: "AVAILABLE" },
          });

          if (releasedSpot.count !== 1) {
            throw new Error("SPOT_RELEASE_FAILED");
          }

          return {
            ticket: { ...ticket, status: "COMPLETED", fee: feeBreakdown.totalFee },
            feeBreakdown,
          };
        });

        closedTickets.push({
          ticketId: completedTicket.ticket.id,
          plate: completedTicket.ticket.plate,
          billedHours: completedTicket.feeBreakdown.billedHours,
          totalFee: completedTicket.ticket.fee,
        });
      }
    }

    return Response.json({
      success: true,
      simulatedTime: currentTime.toISOString(),
      autoClosedCount: closedTickets.length,
      closedTickets,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Clock update failed";
    return Response.json({ error: message }, { status: 500 });
  }
}