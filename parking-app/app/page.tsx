"use client";

import { FormEvent, useEffect, useEffectEvent, useState } from "react";

type VehicleType = "STANDARD" | "COMPACT" | "EV";

type SpotStats = {
  total: number;
  occupied: number;
  available: number;
  byType: Record<VehicleType, { total: number; occupied: number; available: number }>;
  availableEvSpots: { id: string; number: string }[];
  spots: Spot[];
};

type Spot = {
  id: string;
  number: string;
  floor: number;
  type: string;
  status: string;
  tickets: { plate: string; entryTime: string }[];
};

type GarageSettings = {
  name: string;
  address: string;
  taxId: string;
  floorCount: number;
};

type Ticket = {
  id: string;
  plate: string;
  entryTime: string;
  exitTime: string | null;
  fee: number | null;
  status: string;
  spot: { number: string; type: string };
};

type Receipt = {
  ticket: Ticket;
  spot: { number: string };
  fee: { durationInHours: number; totalParkedMinutes: number; billedHours: number; completeDays: number; totalFee: number; gracePeriodApplied?: boolean; itemized?: { baseHourFee: number; additionalHoursFee: number; dailyCapFee: number } };
};

const emptyStats: SpotStats = {
  total: 0,
  occupied: 0,
  available: 0,
  byType: {
    EV: { total: 0, occupied: 0, available: 0 },
    COMPACT: { total: 0, occupied: 0, available: 0 },
    STANDARD: { total: 0, occupied: 0, available: 0 },
  },
  availableEvSpots: [],
  spots: [],
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  }).format(new Date(value));
}

export default function Home() {
  const [stats, setStats] = useState<SpotStats>(emptyStats);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketTotal, setTicketTotal] = useState(0);
  const [ticketPages, setTicketPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [plate, setPlate] = useState("");
  const [vehicleType, setVehicleType] = useState<VehicleType>("STANDARD");
  const [checkoutPlate, setCheckoutPlate] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [garage, setGarage] = useState<GarageSettings>({ name: "OmniPark Garage", address: "", taxId: "", floorCount: 1 });
  const [selectedFloor, setSelectedFloor] = useState(1);
  const [settingsForm, setSettingsForm] = useState({ name: "OmniPark Garage", address: "", taxId: "", floorCount: 1 });
  const [capacityType, setCapacityType] = useState<VehicleType>("STANDARD");
  const [capacityCount, setCapacityCount] = useState(5);
  const [selectedSpot, setSelectedSpot] = useState<Spot | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [operatorEmail, setOperatorEmail] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState("");

  async function refreshDashboard(nextPage = page, nextSearch = search, nextOrder = order) {
    setLoading(true);
    try {
      const [spotResponse, ticketResponse, settingsResponse] = await Promise.all([
        fetch("/api/spots", { cache: "no-store" }),
        fetch(
          `/api/tickets?page=${nextPage}&limit=8&sortBy=entryTime&order=${nextOrder}${
            nextSearch ? `&plate=${encodeURIComponent(nextSearch)}` : ""
          }`,
          { cache: "no-store" },
        ),
        fetch("/api/settings", { cache: "no-store" }),
      ]);
      if (!spotResponse.ok || !ticketResponse.ok || !settingsResponse.ok) throw new Error("Unable to load dashboard");
      const [spotData, ticketData, settingsData] = await Promise.all([spotResponse.json(), ticketResponse.json(), settingsResponse.json()]);
      setStats(spotData);
      setGarage(settingsData);
      setSettingsForm(settingsData);
      setTickets(ticketData.tickets);
      setTicketTotal(ticketData.total);
      setTicketPages(Math.max(ticketData.pages, 1));
    } catch {
      setMessage("Dashboard data is unavailable. Check that the API is running.");
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settingsForm) });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error ?? "Settings update failed");
    setGarage(data);
    setSelectedFloor(Math.min(selectedFloor, data.floorCount));
    setMessage("Garage settings saved");
  }

  async function addCapacity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/spots", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ floor: selectedFloor, type: capacityType, count: capacityCount }) });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error ?? "Spot creation failed");
    setMessage(`${data.spots.length} spots added to floor ${selectedFloor}`);
    await refreshDashboard();
  }

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthMessage("");
    const response = await fetch(`/api/auth/${authMode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: authEmail, password: authPassword }),
    });
    const data = await response.json();
    if (!response.ok) {
      setAuthMessage(data.error ?? "Authentication failed");
      return;
    }
    setOperatorEmail(data.session.email);
    setAuthEmail("");
    setAuthPassword("");
    setAuthOpen(false);
    setMessage(authMode === "login" ? "Signed in successfully" : "Account created and signed in");
  }

  const initialRefresh = useEffectEvent(() => {
    void refreshDashboard();
  });

  useEffect(() => {
    const refreshTimer = window.setTimeout(initialRefresh, 0);
    return () => window.clearTimeout(refreshTimer);
  }, []);

  async function handleCheckin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const response = await fetch("/api/tickets/checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plate, vehicleType, spotId: selectedSpot?.status === "AVAILABLE" ? selectedSpot.id : undefined }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error ?? "Check-in failed");
      return;
    }
    setPlate("");
    setSelectedSpot(null);
    setMessage(`${data.ticket.plate} checked in to ${data.spot.number}`);
    await refreshDashboard();
  }

  async function handleCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const response = await fetch("/api/tickets/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plate: checkoutPlate }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error ?? "Checkout failed");
      return;
    }
    setCheckoutPlate("");
    setReceipt(data);
    await refreshDashboard();
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    void refreshDashboard(1, search, order);
  }

  function toggleOrder() {
    const nextOrder = order === "desc" ? "asc" : "desc";
    setOrder(nextOrder);
    void refreshDashboard(1, search, nextOrder);
    setPage(1);
  }

  return (
    <main className="app-shell min-h-screen overflow-hidden bg-[#f4f6f2] text-[#173c36]">
      <section className="relative border-b border-[#d7e2dc] bg-[#e8f0eb] px-6 pb-20 pt-6 sm:px-10 lg:px-16">
        <div className="absolute right-[-8rem] top-[-8rem] h-80 w-80 rounded-full border-[2.5rem] border-[#f4b183]/35" />
        <nav className="relative mx-auto flex max-w-7xl items-center justify-between">
          <a href="#top" className="flex items-center gap-3 text-lg font-bold tracking-tight">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#e86d4f] text-white">O</span>
            OmniPark
          </a>
          <div className="flex items-center gap-3 text-sm font-medium text-[#54716a]">
            <div className="hidden items-center gap-8 md:flex">
            <a href="#panel" className="hover:text-[#e86d4f]">Control panel</a>
            <a href="#roadmap" className="hover:text-[#e86d4f]">Roadmap</a>
            </div>
            <button onClick={() => { setAuthMode("login"); setAuthOpen(true); }} className="rounded-full bg-[#173c36] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#285950]">
              {operatorEmail ? operatorEmail : "Operator sign in"}
            </button>
          </div>
        </nav>

        <div id="top" className="relative mx-auto grid max-w-7xl gap-12 pt-20 lg:grid-cols-[1.15fr_.85fr] lg:items-end">
          <div>
            <p className="mb-5 text-xs font-bold uppercase tracking-[0.24em] text-[#e86d4f]">Parking operations, without the guesswork</p>
            <h1 className="max-w-3xl text-5xl font-semibold leading-[.98] tracking-[-0.04em] text-[#173c36] sm:text-7xl">
              Every spot accounted for. <span className="text-[#e86d4f]">Every driver moving.</span>
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-[#54716a]">
              OmniPark gives commercial parking operators one calm command centre for tiered pricing, EV reservations, and real-time plate lookups.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <a href="#panel" className="rounded-full bg-[#173c36] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[#173c36]/15 transition hover:bg-[#285950]">Open control panel</a>
              <a href="#roadmap" className="rounded-full border border-[#a8c2b7] bg-white/40 px-6 py-3 text-sm font-semibold text-[#285950] transition hover:bg-white">See what is next</a>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            {[
              ["01", "Tiered pricing", "Fair fees, rounded up by the hour, capped by the day."],
              ["02", "EV reservation engine", "Keep charger-ready spots visible and correctly assigned."],
              ["03", "Real-time plate lookups", "Find any active vehicle before the queue finds you."],
            ].map(([number, title, copy]) => (
              <div key={number} className="border-l-2 border-[#e86d4f] bg-white/55 p-5 backdrop-blur-sm">
                <p className="text-xs font-bold text-[#e86d4f]">{number}</p>
                <h2 className="mt-2 font-semibold">{title}</h2>
                <p className="mt-1 text-sm leading-6 text-[#647c75]">{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="panel" className="operator-panel mx-auto max-w-7xl px-6 py-12 sm:px-10 lg:px-16">
        <div className="mb-8 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#e86d4f]">Live garage view</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">Attendant control panel</h2>
          </div>
          <p className="text-sm text-[#6b827a]">{loading ? "Syncing garage data..." : "Updated just now"}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl bg-[#173c36] p-5 text-white shadow-xl shadow-[#173c36]/10">
            <p className="text-sm text-[#bdd4ca]">Available spots</p>
            <p className="mt-3 text-4xl font-semibold">{stats.available}<span className="ml-2 text-base font-normal text-[#bdd4ca]">/ {stats.total}</span></p>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-[#f4b183]" style={{ width: `${stats.total ? (stats.available / stats.total) * 100 : 0}%` }} /></div>
          </div>
          <div className="rounded-2xl border border-[#d7e2dc] bg-white p-5">
            <p className="text-sm text-[#6b827a]">Occupied now</p>
            <p className="mt-3 text-4xl font-semibold">{stats.occupied}</p>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-[#e86d4f]">Active tickets</p>
          </div>
          <div className="rounded-2xl border-2 border-[#e86d4f]/60 bg-[#fff8f2] p-5 shadow-lg shadow-[#e86d4f]/10">
            <div className="flex items-center justify-between"><p className="text-sm font-semibold text-[#9a5c44]">Available EV spots</p><span className="rounded-full bg-[#e86d4f] px-2 py-1 text-[10px] font-bold text-white">PRIORITY</span></div>
            <p className="mt-3 text-5xl font-semibold text-[#d95e43]">{stats.byType.EV.available}</p>
            <p className="mt-2 text-xs text-[#9a7565]">{stats.availableEvSpots.map((spot) => spot.number).join(" · ") || "No chargers free"}</p>
          </div>
          <div className="rounded-2xl border border-[#d7e2dc] bg-white p-5">
            <p className="text-sm text-[#6b827a]">Occupancy rate</p>
            <p className="mt-3 text-4xl font-semibold text-[#2b806b]">{stats.total ? Math.round((stats.occupied / stats.total) * 100) : 0}%</p>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-[#6b827a]">Capacity utilization</p>
          </div>
        </div>

        <section className="mt-8 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
          <div className="rounded-2xl border border-[#d7e2dc] bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#6b827a]">Live floor plan</p><h3 className="mt-2 text-xl font-semibold">{garage.name} · Spot map</h3></div>
              <div className="flex gap-1 rounded-xl bg-[#f4f6f2] p-1">{Array.from({ length: garage.floorCount }, (_, index) => index + 1).map((floor) => <button key={floor} onClick={() => setSelectedFloor(floor)} className={`rounded-lg px-3 py-2 text-xs font-bold ${selectedFloor === floor ? "bg-[#173c36] text-white" : "text-[#789087]"}`}>Floor {floor}</button>)}</div>
            </div>
            <div className="mt-5 flex flex-wrap gap-3 text-xs text-[#789087]"><span>🟢 Available</span><span>🔴 Occupied</span><span>⚡ EV available</span><span>⚪ Maintenance</span></div>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6">{stats.spots.filter((spot) => spot.floor === selectedFloor).map((spot) => { const occupied = spot.status === "OCCUPIED"; const evAvailable = spot.type === "EV" && spot.status === "AVAILABLE"; return <button key={spot.id} onClick={() => { setSelectedSpot(spot); if (spot.status === "AVAILABLE") { setVehicleType(spot.type as VehicleType); setPlate(""); document.getElementById("checkin-card")?.scrollIntoView({ behavior: "smooth" }); } }} className={`min-h-20 rounded-xl border-2 p-3 text-left transition hover:-translate-y-0.5 ${spot.status === "MAINTENANCE" ? "border-[#b6c0bd] bg-[#eef1ef] text-[#789087]" : occupied ? "border-[#ef9b8d] bg-[#fff0ed] text-[#b94f42]" : evAvailable ? "border-[#87b8e8] bg-[#edf6ff] text-[#2870aa]" : "border-[#a7d5bd] bg-[#eefaf2] text-[#28745a]"}`}><span className="block font-mono text-sm font-bold">{spot.number}</span><span className="mt-2 block text-[10px] font-bold uppercase tracking-wider">{spot.status === "MAINTENANCE" ? "Maintenance" : occupied ? spot.tickets[0]?.plate ?? "Occupied" : spot.type}</span></button>; })}</div>
            {stats.spots.filter((spot) => spot.floor === selectedFloor).length === 0 && <p className="mt-8 text-center text-sm text-[#789087]">No spots configured on this floor yet.</p>}
            {selectedSpot?.floor === selectedFloor && <div className="mt-5 rounded-xl bg-[#f4f6f2] p-4 text-sm"><div className="flex justify-between"><strong>{selectedSpot.number}</strong><button onClick={() => setSelectedSpot(null)} className="text-[#789087]">Close</button></div>{selectedSpot.tickets[0] ? <p className="mt-2 text-[#54716a]">Plate <strong>{selectedSpot.tickets[0].plate}</strong> · entered {formatTime(selectedSpot.tickets[0].entryTime)}</p> : <><p className="mt-2 text-[#54716a]">{selectedSpot.status === "MAINTENANCE" ? "This spot is unavailable for parking." : `Available for immediate check-in. Vehicle type prefilled as ${selectedSpot.type}.`}</p><div className="mt-3 flex flex-wrap gap-2"><button onClick={async () => { const response = await fetch("/api/spots", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selectedSpot.id, status: selectedSpot.status === "MAINTENANCE" ? "AVAILABLE" : "MAINTENANCE" }) }); const data = await response.json(); if (!response.ok) setMessage(data.error ?? "Spot status update failed"); else { setSelectedSpot(null); await refreshDashboard(); } }} className="rounded-lg border border-[#789087] px-3 py-2 text-xs font-semibold text-[#54716a]">{selectedSpot.status === "MAINTENANCE" ? "Return to available" : "Mark maintenance"}</button><button onClick={async () => { const response = await fetch("/api/spots", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selectedSpot.id }) }); const data = await response.json(); if (!response.ok) setMessage(data.error ?? "Spot removal failed"); else { setSelectedSpot(null); setMessage(`${selectedSpot.number} removed`); await refreshDashboard(); } }} className="rounded-lg border border-[#e86d4f] px-3 py-2 text-xs font-semibold text-[#e86d4f]">Remove spot</button></div></>}</div>}
          </div>
          <div className="rounded-2xl border border-[#d7e2dc] bg-white p-6 shadow-sm"><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#e86d4f]">Garage settings</p><h3 className="mt-2 text-xl font-semibold">Configure this garage</h3><form onSubmit={saveSettings} className="mt-5 grid gap-3"><input value={settingsForm.name} onChange={(event) => setSettingsForm({ ...settingsForm, name: event.target.value })} placeholder="Garage name" className="h-10 rounded-lg border border-[#d7e2dc] px-3 text-sm" /><input value={settingsForm.address} onChange={(event) => setSettingsForm({ ...settingsForm, address: event.target.value })} placeholder="Address" className="h-10 rounded-lg border border-[#d7e2dc] px-3 text-sm" /><input value={settingsForm.taxId} onChange={(event) => setSettingsForm({ ...settingsForm, taxId: event.target.value })} placeholder="Tax / GST ID" className="h-10 rounded-lg border border-[#d7e2dc] px-3 text-sm" /><input type="number" min={1} value={settingsForm.floorCount} onChange={(event) => setSettingsForm({ ...settingsForm, floorCount: Number(event.target.value) })} placeholder="Floors" className="h-10 rounded-lg border border-[#d7e2dc] px-3 text-sm" /><button className="rounded-lg bg-[#173c36] py-2 text-sm font-semibold text-white">Save identity</button></form><form onSubmit={addCapacity} className="mt-6 border-t border-[#e6ede9] pt-5"><p className="text-sm font-semibold">Bulk-create spots on Floor {selectedFloor}</p><div className="mt-3 grid grid-cols-2 gap-2"><select value={capacityType} onChange={(event) => setCapacityType(event.target.value as VehicleType)} className="h-10 rounded-lg border border-[#d7e2dc] px-2 text-sm"><option value="STANDARD">Standard</option><option value="COMPACT">Compact</option><option value="EV">EV</option></select><input type="number" min={1} max={500} value={capacityCount} onChange={(event) => setCapacityCount(Number(event.target.value))} className="h-10 rounded-lg border border-[#d7e2dc] px-2 text-sm" /></div><button className="mt-3 w-full rounded-lg border border-[#2b806b] py-2 text-sm font-semibold text-[#2b806b]">Add capacity</button></form></div>
        </section>

        {message && <p className="mt-5 rounded-xl border border-[#f4b183] bg-[#fff8f2] px-4 py-3 text-sm text-[#9a5c44]">{message}</p>}

        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          <form id="checkin-card" onSubmit={handleCheckin} className="rounded-2xl border border-[#d7e2dc] bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#2b806b]">01 / Arrival</p><h3 className="mt-2 text-xl font-semibold">Check in a vehicle</h3></div><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e6f4ed] text-lg">↗</span></div>
            <div className="mt-7 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <label className="text-sm font-semibold">License plate<input value={plate} onChange={(event) => setPlate(event.target.value)} placeholder="MH 01 AB 1234" className="mt-2 h-12 w-full rounded-xl border border-[#d7e2dc] bg-[#f8faf8] px-4 font-mono text-sm uppercase outline-none transition focus:border-[#2b806b] focus:ring-2 focus:ring-[#2b806b]/10" required /></label>
              <label className="text-sm font-semibold">Vehicle type<select value={vehicleType} onChange={(event) => setVehicleType(event.target.value as VehicleType)} className="mt-2 h-12 w-full rounded-xl border border-[#d7e2dc] bg-[#f8faf8] px-4 text-sm outline-none focus:border-[#2b806b]"><option value="STANDARD">Standard</option><option value="COMPACT">Compact</option><option value="EV">EV / Charger</option></select></label>
              <button className="h-12 rounded-xl bg-[#2b806b] px-5 text-sm font-semibold text-white transition hover:bg-[#216353]">Assign spot</button>
            </div>
            <p className="mt-4 text-xs text-[#6b827a]">EV vehicles are automatically restricted to charger-equipped spots.</p>
          </form>

          <form onSubmit={handleCheckout} className="rounded-2xl border border-[#d7e2dc] bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#e86d4f]">02 / Departure</p><h3 className="mt-2 text-xl font-semibold">Check out a vehicle</h3></div><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#fff0e8] text-lg">↘</span></div>
            <div className="mt-7 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="text-sm font-semibold">License plate<input value={checkoutPlate} onChange={(event) => setCheckoutPlate(event.target.value)} placeholder="Find an active ticket" className="mt-2 h-12 w-full rounded-xl border border-[#d7e2dc] bg-[#f8faf8] px-4 font-mono text-sm uppercase outline-none transition focus:border-[#e86d4f] focus:ring-2 focus:ring-[#e86d4f]/10" required /></label>
              <button className="h-12 rounded-xl bg-[#e86d4f] px-6 text-sm font-semibold text-white transition hover:bg-[#d95e43]">Calculate fee</button>
            </div>
            <p className="mt-4 text-xs text-[#6b827a]">Rates round up partial hours: Rs.10 first hour, Rs.5 each after, Rs.45 daily cap.</p>
          </form>
        </div>

        <section className="mt-8 rounded-2xl border border-[#d7e2dc] bg-white shadow-sm">
          <div className="flex flex-col justify-between gap-4 border-b border-[#e6ede9] p-6 sm:flex-row sm:items-center">
            <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#6b827a]">Live parking log</p><h3 className="mt-2 text-xl font-semibold">Vehicles in the garage <span className="ml-2 text-sm font-normal text-[#8ba097]">{ticketTotal} total</span></h3></div>
            <form onSubmit={handleSearch} className="flex gap-2"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search plate or ticket..." className="h-10 w-48 rounded-lg border border-[#d7e2dc] bg-[#f8faf8] px-3 text-sm outline-none focus:border-[#2b806b]" /><button className="h-10 rounded-lg border border-[#d7e2dc] px-3 text-sm font-semibold hover:bg-[#f4f6f2]">Search</button></form>
          </div>
          <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-[#f8faf8] text-xs uppercase tracking-wider text-[#789087]"><tr><th className="px-6 py-4">Plate</th><th className="px-6 py-4">Spot</th><th className="px-6 py-4">Type</th><th className="px-6 py-4"><button onClick={toggleOrder} className="font-bold hover:text-[#2b806b]">Entry time {order === "desc" ? "↓" : "↑"}</button></th><th className="px-6 py-4">Status</th></tr></thead><tbody className="divide-y divide-[#edf2ef]">{tickets.map((ticket) => <tr key={ticket.id} className="hover:bg-[#fbfcfb]"><td className="px-6 py-4 font-mono font-semibold tracking-wide">{ticket.plate}</td><td className="px-6 py-4 font-semibold">{ticket.spot.number}</td><td className="px-6 py-4 text-[#6b827a]">{ticket.spot.type}</td><td className="px-6 py-4 text-[#6b827a]">{formatTime(ticket.entryTime)}</td><td className="px-6 py-4"><span className={`rounded-full px-3 py-1 text-xs font-bold ${ticket.status === "ACTIVE" ? "bg-[#e6f4ed] text-[#2b806b]" : "bg-[#f0f2ef] text-[#789087]"}`}>{ticket.status}</span></td></tr>)}{tickets.length === 0 && <tr><td colSpan={5} className="px-6 py-12 text-center text-[#789087]">No matching parking records yet.</td></tr>}</tbody></table></div>
          <div className="flex items-center justify-between border-t border-[#e6ede9] px-6 py-4 text-sm"><span className="text-[#789087]">Page {page} of {ticketPages}</span><div className="flex gap-2"><button disabled={page === 1} onClick={() => { const nextPage = page - 1; setPage(nextPage); void refreshDashboard(nextPage); }} className="rounded-lg border border-[#d7e2dc] px-4 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-40">Previous</button><button disabled={page >= ticketPages} onClick={() => { const nextPage = page + 1; setPage(nextPage); void refreshDashboard(nextPage); }} className="rounded-lg border border-[#d7e2dc] px-4 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-40">Next</button></div></div>
        </section>
      </section>

      <section id="roadmap" className="border-t border-[#d7e2dc] bg-[#173c36] px-6 py-16 text-white sm:px-10 lg:px-16">
        <div className="mx-auto max-w-7xl"><div className="max-w-xl"><p className="text-xs font-bold uppercase tracking-[0.2em] text-[#f4b183]">The next shift</p><h2 className="mt-3 text-4xl font-semibold tracking-[-0.04em]">3 features we are building next</h2></div><div className="mt-10 grid gap-4 md:grid-cols-3">{[["01", "License Plate Recognition cameras", "Turn arrivals into a hands-free, high-confidence check-in."], ["02", "Dynamic peak pricing", "Give operators a clearer lever for the busiest hours."], ["03", "Attendant mobile handheld mode", "Keep the whole garage in your hand while you walk it." ]].map(([number, title, copy]) => <div key={number} className="border-t border-white/20 pt-5"><p className="font-mono text-sm text-[#f4b183]">{number}</p><h3 className="mt-5 text-lg font-semibold">{title}</h3><p className="mt-3 text-sm leading-6 text-[#bdd4ca]">{copy}</p></div>)}</div></div>
      </section>

      {authOpen && <div className="fixed inset-0 z-20 grid place-items-center bg-[#173c36]/45 px-5 backdrop-blur-sm"><div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-7 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#e86d4f]">Operator access</p><h2 className="mt-2 text-2xl font-semibold">{authMode === "login" ? "Welcome back" : "Create an account"}</h2></div><button onClick={() => setAuthOpen(false)} aria-label="Close authentication" className="text-2xl text-[#789087]">×</button></div><div className="mt-5 grid grid-cols-2 rounded-xl bg-[#f4f6f2] p-1"><button onClick={() => { setAuthMode("login"); setAuthMessage(""); }} className={`rounded-lg py-2 text-sm font-semibold ${authMode === "login" ? "bg-white text-[#173c36] shadow-sm" : "text-[#789087]"}`}>Sign in</button><button onClick={() => { setAuthMode("register"); setAuthMessage(""); }} className={`rounded-lg py-2 text-sm font-semibold ${authMode === "register" ? "bg-white text-[#173c36] shadow-sm" : "text-[#789087]"}`}>Register</button></div><form onSubmit={handleAuth} className="mt-6 grid gap-4"><label className="text-sm font-semibold">Email<input type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[#d7e2dc] bg-[#f8faf8] px-3 outline-none focus:border-[#2b806b]" required /></label><label className="text-sm font-semibold">Password<input type="password" minLength={authMode === "register" ? 8 : undefined} value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[#d7e2dc] bg-[#f8faf8] px-3 outline-none focus:border-[#2b806b]" required /></label>{authMessage && <p className="rounded-lg bg-[#fff0ed] px-3 py-2 text-sm text-[#b94f42]">{authMessage}</p>}<button className="rounded-xl bg-[#173c36] py-3 text-sm font-semibold text-white hover:bg-[#285950]">{authMode === "login" ? "Sign in to OmniPark" : "Create operator account"}</button></form></div></div>}
      {receipt && <div className="fixed inset-0 z-10 grid place-items-center bg-[#173c36]/40 px-5 backdrop-blur-sm"><div role="dialog" aria-modal="true" className="receipt-modal w-full max-w-md rounded-2xl bg-white p-7 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#2b806b]">{garage.name} · Checkout complete</p><h2 className="mt-2 text-2xl font-semibold">Payment receipt</h2><p className="mt-1 text-xs text-[#789087]">Ticket {receipt.ticket.id} · {garage.address || "Garage location not configured"}</p></div><button onClick={() => setReceipt(null)} aria-label="Close receipt" className="no-print text-2xl text-[#789087] hover:text-[#173c36]">×</button></div><div className="mt-7 rounded-xl bg-[#f4f6f2] p-5"><div className="flex justify-between text-sm"><span className="text-[#789087]">License plate</span><span className="font-mono font-bold">{receipt.ticket.plate}</span></div><div className="mt-4 flex justify-between text-sm"><span className="text-[#789087]">Vehicle / spot</span><span className="font-semibold">{receipt.ticket.spot.type} · {receipt.spot.number}</span></div><div className="mt-4 flex justify-between text-sm"><span className="text-[#789087]">Entry</span><span className="font-semibold">{formatTime(receipt.ticket.entryTime)}</span></div><div className="mt-4 flex justify-between text-sm"><span className="text-[#789087]">Exit</span><span className="font-semibold">{receipt.ticket.exitTime ? formatTime(receipt.ticket.exitTime) : "Now"}</span></div><div className="mt-4 flex justify-between text-sm"><span className="text-[#789087]">Duration</span><span className="font-semibold">{receipt.fee.totalParkedMinutes.toFixed(0)} min · {receipt.fee.billedHours} billed hr · {receipt.fee.completeDays} day(s)</span></div><div className="mt-5 border-t border-[#d7e2dc] pt-4 text-sm text-[#54716a]"><div className="flex justify-between"><span>Base hour</span><span>Rs.{(receipt.fee.itemized?.baseHourFee ?? 0).toFixed(2)}</span></div><div className="mt-2 flex justify-between"><span>Additional hours</span><span>Rs.{(receipt.fee.itemized?.additionalHoursFee ?? 0).toFixed(2)}</span></div><div className="mt-2 flex justify-between"><span>Daily cap blocks</span><span>Rs.{(receipt.fee.itemized?.dailyCapFee ?? 0).toFixed(2)}</span></div><div className="mt-5 flex items-end justify-between border-t border-[#d7e2dc] pt-4"><span className="font-semibold">Fee charged</span><span className="text-3xl font-semibold text-[#e86d4f]">Rs.{receipt.fee.totalFee.toFixed(2)}</span></div></div></div><div className="no-print mt-6 grid grid-cols-2 gap-2"><button onClick={() => window.print()} className="rounded-xl border border-[#173c36] py-3 text-sm font-semibold text-[#173c36]">Print receipt</button><button onClick={() => setReceipt(null)} className="rounded-xl bg-[#173c36] py-3 text-sm font-semibold text-white hover:bg-[#285950]">Done</button></div></div></div>}
    </main>
  );
}
