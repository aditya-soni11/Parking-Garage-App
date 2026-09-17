import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const spots = [
	...Array.from({ length: 5 }, (_, index) => ({
		number: `EV-${index + 1}`,
		type: "EV",
	})),
	...Array.from({ length: 5 }, (_, index) => ({
		number: `C-${index + 1}`,
		type: "COMPACT",
	})),
	...Array.from({ length: 5 }, (_, index) => ({
		number: `S-${index + 1}`,
		type: "STANDARD",
	})),
];

async function main() {
	const password = await bcrypt.hash("admin123", 12);

	await prisma.user.upsert({
		where: { email: "attendant@garage.com" },
		update: { password },
		create: {
			email: "attendant@garage.com",
			password,
		},
	});

	for (const spot of spots) {
		await prisma.spot.upsert({
			where: { number: spot.number },
			update: { type: spot.type, status: "AVAILABLE" },
			create: { ...spot, status: "AVAILABLE" },
		});
	}
}

main()
	.then(async () => {
		await prisma.$disconnect();
	})
	.catch(async (error) => {
		console.error(error);
		await prisma.$disconnect();
		process.exit(1);
	});
