export interface RateConfig {
	firstHourRate: number;
	additionalHourRate: number;
	dailyCap: number;
}

export interface ParkingFeeBreakdown {
	gracePeriodApplied: boolean;
	totalParkedMinutes: number;
	durationInHours: number;
	billedHours: number;
	completeDays: number;
	remainingHours: number;
	dailyFee: number;
	remainingFee: number;
	totalFee: number;
	itemized: {
		baseHourFee: number;
		additionalHoursFee: number;
		dailyCapFee: number;
	};
}

const DEFAULT_RATES: RateConfig = {
	firstHourRate: 10,
	additionalHourRate: 5,
	dailyCap: 45,
};

const HOURS_PER_DAY = 24;
const DEFAULT_GRACE_PERIOD_MINUTES = 0;

function calculateHourlyFee(hours: number, rates: RateConfig): number {
	if (hours <= 0) {
		return 0;
	}

	return Math.min(
		rates.firstHourRate + (hours - 1) * rates.additionalHourRate,
		rates.dailyCap,
	);
}

export function calculateParkingFee(
	entryTime: Date,
	exitTime: Date = new Date(),
	customRates?: Partial<RateConfig>,
	gracePeriodMinutes = DEFAULT_GRACE_PERIOD_MINUTES,
): ParkingFeeBreakdown {
	const durationInMilliseconds = exitTime.getTime() - entryTime.getTime();

	if (!Number.isFinite(entryTime.getTime()) || !Number.isFinite(exitTime.getTime())) {
		throw new RangeError("Entry and exit times must be valid dates");
	}

	if (durationInMilliseconds < 0) {
		throw new RangeError("Exit time cannot be before entry time");
	}

	const rates: RateConfig = {
		firstHourRate: customRates?.firstHourRate ?? DEFAULT_RATES.firstHourRate,
		additionalHourRate: customRates?.additionalHourRate ?? DEFAULT_RATES.additionalHourRate,
		dailyCap: customRates?.dailyCap ?? DEFAULT_RATES.dailyCap,
	};

	const durationInHours = durationInMilliseconds / (60 * 60 * 1000);
	const totalParkedMinutes = durationInMilliseconds / (60 * 1000);
	const gracePeriodApplied = totalParkedMinutes <= Math.max(0, gracePeriodMinutes);
	if (gracePeriodApplied) {
		return {
			gracePeriodApplied: true,
			totalParkedMinutes,
			durationInHours,
			billedHours: 0,
			completeDays: 0,
			remainingHours: 0,
			dailyFee: 0,
			remainingFee: 0,
			totalFee: 0,
			itemized: { baseHourFee: 0, additionalHoursFee: 0, dailyCapFee: 0 },
		};
	}

	const billedHours = Math.max(1, Math.ceil(durationInHours));
	const completeDays = Math.floor(billedHours / HOURS_PER_DAY);
	const remainingHours = billedHours % HOURS_PER_DAY;
	const dailyFee = completeDays * rates.dailyCap;
	const remainingFee = calculateHourlyFee(remainingHours, rates);
	const baseHourFee = remainingHours > 0 ? rates.firstHourRate : 0;
	const additionalHoursFee = remainingHours > 1
		? Math.min((remainingHours - 1) * rates.additionalHourRate, Math.max(0, rates.dailyCap - baseHourFee))
		: 0;

	return {
		gracePeriodApplied: false,
		totalParkedMinutes,
		durationInHours,
		billedHours,
		completeDays,
		remainingHours,
		dailyFee,
		remainingFee,
		totalFee: dailyFee + remainingFee,
		itemized: {
			baseHourFee,
			additionalHoursFee,
			dailyCapFee: dailyFee,
		},
	};
}