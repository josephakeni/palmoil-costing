import { useEffect, useMemo, useState } from "react";

const PRODUCTION_API = import.meta.env.VITE_PRODUCTION_API;
const COST_API = import.meta.env.VITE_COST_API;
const AUDIT_API = import.meta.env.VITE_AUDIT_API;

const ngn = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });
const fmtN = (n) => Number(n || 0).toLocaleString("en-NG");

// Cost categories matching actual palm oil production workflow
const CATEGORIES = [
  "FFB_PROCUREMENT",
  "HARVESTING_LABOR",
  "HARVESTING_SUPPLIES",
  "PROCESSING_LABOR",
  "LOGISTICS",
  "MAINTENANCE",
  "OVERHEAD",
];

const CATEGORY_META = {
  FFB_PROCUREMENT:     { label: "FFB Procurement",      color: "text-emerald-300",  bg: "bg-emerald-500/15 border-emerald-400/40" },
  HARVESTING_LABOR:    { label: "Harvesting Labour",    color: "text-cyan-300",     bg: "bg-cyan-500/15 border-cyan-400/40" },
  HARVESTING_SUPPLIES: { label: "Harvesting Supplies",  color: "text-amber-300",    bg: "bg-amber-500/15 border-amber-400/40" },
  PROCESSING_LABOR:    { label: "Processing Labour",    color: "text-violet-300",   bg: "bg-violet-500/15 border-violet-400/40" },
  LOGISTICS:           { label: "Logistics & Misc",     color: "text-sky-300",      bg: "bg-sky-500/15 border-sky-400/40" },
  MAINTENANCE:         { label: "Maintenance",          color: "text-rose-300",     bg: "bg-rose-500/15 border-rose-400/40" },
  OVERHEAD:            { label: "Overhead",             color: "text-orange-300",   bg: "bg-orange-500/15 border-orange-400/40" },
};

export default function PalmOilCostingApp() {
  const [screen, setScreen] = useState("dashboard");
  const [batches, setBatches] = useState([]);
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [batchCosts, setBatchCosts] = useState([]);
  const [farmBreakdowns, setFarmBreakdowns] = useState({});   // keyed by batch_id
  const [summary, setSummary] = useState({ batch_count: 0, total_cost: 0, by_category: [] });
  const [auditEvents, setAuditEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: "info", text: "" });

  const [batchForm, setBatchForm] = useState({
    id: "",
    mill_name: "",
    operator: "",
    batch_date: new Date().toISOString().slice(0, 10),
    ffb_count: "",
    cpo_kegs: "",
    pko_kegs: "",
    notes: "",
  });

  // For FFB_PROCUREMENT: special sub-fields
  const [costForm, setCostForm] = useState({
    batch_id: "",
    category: "FFB_PROCUREMENT",
    amount: "",
    description: "",
    // FFB procurement sub-fields
    farm_name: "",
    ffb_units: "",
    price_per_unit: "",
    purchase_date: new Date().toISOString().slice(0, 10),
    // General cost fields
    cost_date: new Date().toISOString().slice(0, 10),
    // Maintenance allocation
    total_cost: "",
    allocated: "",
  });

  const selectedBatch = useMemo(
    () => batches.find((b) => b.id === selectedBatchId) || null,
    [batches, selectedBatchId]
  );

  const totalFFB   = useMemo(() => batches.reduce((s, b) => s + Number(b.ffb_count || 0), 0), [batches]);
  const totalKegs  = useMemo(() => batches.reduce((s, b) => s + Number(b.cpo_kegs || 0), 0), [batches]);

  // Actual kegs from confirmed daily output entries across all batches
  const actualTotalKegs = useMemo(() => {
    return Object.values(farmBreakdowns).reduce((total, bd) => {
      if (!bd?.farms) return total;
      return total + bd.farms.reduce((bSum, farm) => {
        return bSum + (farm.daily_outputs || []).reduce((fSum, o) => fSum + Number(o.kegs_produced || 0), 0);
      }, 0);
    }, 0);
  }, [farmBreakdowns]);

  const kegsPerFFB = totalFFB > 0 ? (totalKegs / totalFFB).toFixed(3) : "0.000";
  const costPerKeg = actualTotalKegs > 0 ? summary.total_cost / actualTotalKegs
                   : totalKegs > 0 ? summary.total_cost / totalKegs : 0;

  const batchTotal    = useMemo(() => batchCosts.reduce((s, e) => s + Number(e.amount || 0), 0), [batchCosts]);
  const batchCostPerKeg = selectedBatch && Number(selectedBatch.cpo_kegs) > 0
    ? batchTotal / Number(selectedBatch.cpo_kegs) : 0;

  useEffect(() => { void loadAll(); }, []);
  useEffect(() => {
    if (selectedBatchId) {
      void loadBatchCosts(selectedBatchId);
      void loadFarmBreakdown(selectedBatchId);
    }
  }, [selectedBatchId]);

  // Auto-compute FFB procurement amount
  useEffect(() => {
    if (costForm.category === "FFB_PROCUREMENT") {
      const units = Number(costForm.ffb_units);
      const price = Number(costForm.price_per_unit);
      if (units > 0 && price > 0) {
        setCostForm((p) => ({ ...p, amount: String(units * price) }));
      }
    }
  }, [costForm.ffb_units, costForm.price_per_unit, costForm.category]);

  // Auto-compute maintenance allocated amount
  useEffect(() => {
    if (costForm.category === "MAINTENANCE" && costForm.allocated) {
      setCostForm((p) => ({ ...p, amount: costForm.allocated }));
    }
  }, [costForm.allocated, costForm.category]);

  async function api(url, options = {}) {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
    if (!res.ok) {
      let msg = "Request failed";
      try { const d = await res.json(); msg = d.detail || d.message || JSON.stringify(d); } catch { msg = await res.text(); }
      throw new Error(msg || "Request failed");
    }
    const ct = res.headers.get("content-type") || "";
    return ct.includes("application/json") ? res.json() : res.text();
  }

  async function loadAll() {
    setLoading(true);
    try {
      const [batchData, summaryData, auditData] = await Promise.all([
        api(`${PRODUCTION_API}/batches`),
        api(`${AUDIT_API}/report/summary`),
        api(`${AUDIT_API}/audit?limit=20`),
      ]);
      const batchList = Array.isArray(batchData) ? batchData : [];
      setBatches(batchList);
      setSummary(summaryData || { batch_count: 0, total_cost: 0, by_category: [] });
      setAuditEvents(Array.isArray(auditData) ? auditData : []);
      void loadAllFarmBreakdowns(batchList);
    } catch (err) {
      setMessage({ type: "error", text: err.message || "Failed to load data" });
    } finally {
      setLoading(false);
    }
  }

  async function loadBatchCosts(batchId) {
    try {
      const data = await api(`${COST_API}/costs/${batchId}`);
      setBatchCosts(Array.isArray(data) ? data : []);
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    }
  }

  async function loadFarmBreakdown(batchId) {
    try {
      const data = await api(`${PRODUCTION_API}/batches/${batchId}/farms`);
      setFarmBreakdowns((prev) => ({ ...prev, [batchId]: data }));
    } catch { /* silent — batch may have no farm records yet */ }
  }

  async function loadAllFarmBreakdowns(batchList) {
    const results = await Promise.allSettled(
      batchList.map((b) => api(`${PRODUCTION_API}/batches/${b.id}/farms`))
    );
    const next = {};
    batchList.forEach((b, i) => {
      if (results[i].status === "fulfilled") next[b.id] = results[i].value;
    });
    setFarmBreakdowns(next);
  }

  async function handleCreateBatch(event) {
    event.preventDefault();
    const payload = {
      id: batchForm.id.trim(),
      mill_name: batchForm.mill_name.trim(),
      operator: batchForm.operator.trim(),
      batch_date: batchForm.batch_date,
      ffb_count: Number(batchForm.ffb_count) || 0,
      cpo_kegs: Number(batchForm.cpo_kegs) || 0,
      pko_kegs: Number(batchForm.pko_kegs) || 0,
      notes: batchForm.notes.trim() || null,
    };
    if (!payload.id || !payload.mill_name || !payload.operator || !payload.batch_date) {
      setMessage({ type: "error", text: "Fill in all required fields." });
      return;
    }
    try {
      await api(`${PRODUCTION_API}/batches`, { method: "POST", body: JSON.stringify(payload) });
      setBatchForm({ id: "", mill_name: "", operator: "", batch_date: new Date().toISOString().slice(0, 10), ffb_count: "", cpo_kegs: "", pko_kegs: "", notes: "" });
      await loadAll();
      setMessage({ type: "success", text: `Batch ${payload.id} created.` });
      setScreen("batches");
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    }
  }

  async function handleLogCost(event) {
    event.preventDefault();
    const batchId = costForm.batch_id || selectedBatchId;
    if (!batchId) { setMessage({ type: "error", text: "Select a batch first." }); return; }

    const amount = Number(costForm.amount);
    if (!amount || amount <= 0) { setMessage({ type: "error", text: "Enter a valid amount." }); return; }

    // Build human-readable description from sub-fields
    let description = costForm.description.trim();
    if (costForm.category === "FFB_PROCUREMENT" && costForm.farm_name && costForm.ffb_units && costForm.price_per_unit) {
      description = `${costForm.farm_name} | ${costForm.ffb_units} units × ${ngn.format(Number(costForm.price_per_unit))}${description ? " — " + description : ""}`;
    } else if (costForm.category === "MAINTENANCE" && costForm.total_cost && costForm.allocated) {
      description = `Total: ${ngn.format(Number(costForm.total_cost))} | Allocated: ${ngn.format(Number(costForm.allocated))}${description ? " — " + description : ""}`;
    }

    const payload = {
      batch_id: batchId,
      category: costForm.category,
      amount,
      description,
      farm_name: costForm.farm_name || null,
      cost_date: costForm.category === "FFB_PROCUREMENT" ? costForm.purchase_date : costForm.cost_date,
    };

    try {
      await api(`${COST_API}/costs`, { method: "POST", body: JSON.stringify(payload) });

      // For FFB procurement, also record the structured farm entry
      if (costForm.category === "FFB_PROCUREMENT" && costForm.farm_name && costForm.ffb_units && costForm.price_per_unit) {
        await api(`${PRODUCTION_API}/batches/${batchId}/farms`, {
          method: "POST",
          body: JSON.stringify({
            farm_name: costForm.farm_name,
            ffb_units: Number(costForm.ffb_units),
            price_per_unit: Number(costForm.price_per_unit),
            purchase_date: costForm.purchase_date || null,
          }),
        });
        await loadFarmBreakdown(batchId);
      }

      setCostForm((p) => ({ ...p, amount: "", description: "", farm_name: "", ffb_units: "", price_per_unit: "", purchase_date: new Date().toISOString().slice(0, 10), cost_date: new Date().toISOString().slice(0, 10), total_cost: "", allocated: "" }));
      await loadBatchCosts(batchId);
      await loadAll();
      setMessage({ type: "success", text: `${CATEGORY_META[costForm.category]?.label} cost logged — ${ngn.format(amount)}` });
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    }
  }

  const nav = ["dashboard", "batches", "new-batch", "costs", "report"];
  const navLabels = { dashboard: "Dashboard", batches: "Batches", "new-batch": "New Batch", costs: "Log Costs", report: "Report" };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">

        {/* Top Nav */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-3">
            {nav.map((item) => (
              <button key={item} type="button" onClick={() => setScreen(item)}
                className={`rounded-2xl px-4 py-2 text-sm transition ${item === screen ? "bg-gradient-to-r from-emerald-400 to-green-600 text-slate-950 font-medium" : "border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"}`}>
                {navLabels[item]}
              </button>
            ))}
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-400">
            Palm Oil Cost Accounting
          </div>
        </div>

        {message.text ? (
          <div className={`mb-6 flex items-center justify-between rounded-2xl border px-4 py-3 text-sm ${{ success: "border-emerald-400/20 bg-emerald-500/10 text-emerald-200", error: "border-rose-400/20 bg-rose-500/10 text-rose-200", info: "border-cyan-400/20 bg-cyan-500/10 text-cyan-200" }[message.type]}`}>
            <span>{message.text}</span>
            <button type="button" onClick={() => setMessage({ type: "info", text: "" })} className="ml-4 opacity-60 hover:opacity-100">✕</button>
          </div>
        ) : null}

        {screen === "dashboard" && (
          <DashboardScreen
            batches={batches} totalFFB={totalFFB} totalKegs={totalKegs}
            actualTotalKegs={actualTotalKegs}
            kegsPerFFB={kegsPerFFB} summary={summary} costPerKeg={costPerKeg}
            auditEvents={auditEvents} loading={loading}
            onRefresh={loadAll} setScreen={setScreen}
          />
        )}
        {screen === "batches" && (
          <BatchListScreen batches={batches} selectedBatchId={selectedBatchId}
            farmBreakdowns={farmBreakdowns}
            onLoadFarmBreakdown={loadFarmBreakdown}
            onSelect={(id) => { setSelectedBatchId(id); setCostForm((p) => ({ ...p, batch_id: id })); setScreen("costs"); }}
            onNew={() => setScreen("new-batch")}
          />
        )}
        {screen === "new-batch" && (
          <NewBatchScreen batchForm={batchForm} setBatchForm={setBatchForm}
            onSubmit={handleCreateBatch} onBack={() => setScreen("batches")}
          />
        )}
        {screen === "costs" && (
          <CostScreen
            batches={batches} selectedBatchId={selectedBatchId}
            setSelectedBatchId={(id) => { setSelectedBatchId(id); setCostForm((p) => ({ ...p, batch_id: id })); }}
            selectedBatch={selectedBatch} batchCosts={batchCosts} batchTotal={batchTotal}
            batchCostPerKeg={batchCostPerKeg} costForm={costForm} setCostForm={setCostForm}
            farmBreakdowns={farmBreakdowns}
            onSubmit={handleLogCost}
          />
        )}
        {screen === "report" && (
          <ReportScreen summary={summary} batches={batches}
            totalFFB={totalFFB} totalKegs={totalKegs}
            kegsPerFFB={kegsPerFFB} costPerKeg={costPerKeg} auditEvents={auditEvents}
            farmBreakdowns={farmBreakdowns}
          />
        )}
      </div>
    </div>
  );
}

// ─── Shared components ────────────────────────────────────────────────────────

function Shell({ children, badge, title, subtitle, aside }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
      <div className="rounded-[32px] border border-white/10 bg-slate-900/85 p-8 shadow-2xl shadow-black/30">
        {badge ? <p className="text-sm uppercase tracking-[0.25em] text-emerald-300">{badge}</p> : null}
        <h1 className="mt-3 text-4xl font-semibold">{title}</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">{subtitle}</p>
        <div className="mt-8">{children}</div>
      </div>
      {aside ? (
        <div className="rounded-[32px] border border-white/10 bg-gradient-to-br from-slate-900 via-emerald-950/40 to-green-950/30 p-8 shadow-2xl shadow-black/30">
          {aside}
        </div>
      ) : null}
    </div>
  );
}

function MetricCard({ title, value, sub, tone = "text-white" }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/5 p-5">
      <p className="text-sm text-slate-400">{title}</p>
      <h4 className={`mt-2 text-2xl font-semibold ${tone}`}>{value}</h4>
      {sub ? <p className="mt-1 text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}

function Field({ label, placeholder, type = "text", value, onChange, required, children }) {
  return (
    <div>
      <label className="mb-2 block text-sm text-slate-300">{label}{required ? " *" : ""}</label>
      {children ?? (
        <input type={type} value={value} onChange={(e) => onChange?.(e.target.value)} required={required}
          className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-white outline-none placeholder:text-slate-500 focus:border-emerald-500/50"
          placeholder={placeholder}
        />
      )}
    </div>
  );
}

function FarmBreakdownTable({ breakdown, batchId, onRefresh }) {
  const [adding, setAdding] = useState(null);   // farm_name currently open for input
  const [dateVal, setDateVal] = useState(new Date().toISOString().slice(0, 10));
  const [kegsVal, setKegsVal] = useState("");
  const [saving, setSaving] = useState(false);

  if (!breakdown || !breakdown.farms || breakdown.farms.length === 0) return null;

  const totalActual = breakdown.farms.reduce((s, f) => s + (f.cpo_kegs_actual ?? 0), 0);
  const hasAnyActual = breakdown.farms.some((f) => f.cpo_kegs_actual !== null);

  async function handleSave(farmName) {
    if (!kegsVal || Number(kegsVal) < 0) return;
    setSaving(true);
    try {
      await fetch(`${PRODUCTION_API}/batches/${batchId}/output`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ farm_name: farmName, production_date: dateVal, kegs_produced: Number(kegsVal) }),
      });
      setAdding(null);
      setKegsVal("");
      if (onRefresh) onRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(outputId) {
    await fetch(`${PRODUCTION_API}/batches/${batchId}/output/${outputId}`, { method: "DELETE" });
    if (onRefresh) onRefresh();
  }

  return (
    <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">Farm Output Breakdown</p>
        {hasAnyActual && (
          <span className="text-xs text-slate-400">
            Actual total: <span className="font-medium text-emerald-300">{totalActual.toFixed(2)} kegs</span>
          </span>
        )}
      </div>

      <div className="space-y-3">
        {breakdown.farms.map((farm) => {
          const isOpen = adding === farm.farm_name;
          const displayKegs = farm.cpo_kegs_actual !== null ? farm.cpo_kegs_actual : farm.cpo_kegs_proportional;
          const isActual = farm.cpo_kegs_actual !== null;

          return (
            <div key={farm.id} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              {/* Farm header row */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-white">{farm.farm_name}</span>
                  {farm.purchase_date && (
                    <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-slate-400">
                      {fmtDate(farm.purchase_date)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-semibold ${isActual ? "text-emerald-300" : "text-slate-400"}`}>
                    {Number(displayKegs).toFixed(2)} kegs
                    {!isActual && <span className="ml-1 text-xs font-normal text-slate-500">(est.)</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setAdding(isOpen ? null : farm.farm_name); setDateVal(new Date().toISOString().slice(0, 10)); setKegsVal(""); }}
                    className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-500/20"
                  >
                    {isOpen ? "Cancel" : "+ Add day"}
                  </button>
                </div>
              </div>

              {/* FFB share bar */}
              <div className="mt-2 flex items-center gap-3">
                <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-green-500" style={{ width: `${farm.ffb_share_pct}%` }} />
                </div>
                <span className="text-xs text-slate-400 w-28 text-right">{fmtN(farm.ffb_units)} FFB · {farm.ffb_share_pct}%</span>
                <span className="text-xs text-slate-500 w-24 text-right">{ngn.format(farm.amount)}</span>
              </div>

              {/* Existing daily outputs */}
              {farm.daily_outputs && farm.daily_outputs.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {farm.daily_outputs.map((o) => (
                    <div key={o.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                      <span className="text-xs text-slate-400">{fmtDate(o.production_date)}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-emerald-300">{Number(o.kegs_produced).toFixed(2)} kegs</span>
                        <button
                          type="button"
                          onClick={() => handleDelete(o.id)}
                          className="text-xs text-slate-600 hover:text-rose-400 transition"
                          title="Remove"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Inline add form */}
              {isOpen && (
                <div className="mt-3 flex items-end gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/5 p-3">
                  <div className="flex-1">
                    <label className="mb-1 block text-xs text-slate-400">Date</label>
                    <input type="date" value={dateVal} onChange={(e) => setDateVal(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                    />
                  </div>
                  <div className="w-28">
                    <label className="mb-1 block text-xs text-slate-400">Kegs</label>
                    <input type="number" value={kegsVal} onChange={(e) => setKegsVal(e.target.value)}
                      placeholder="0"
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={saving || !kegsVal}
                    onClick={() => handleSave(farm.farm_name)}
                    className="rounded-xl bg-gradient-to-r from-emerald-400 to-green-600 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
                  >
                    {saving ? "…" : "Save"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex justify-between border-t border-white/10 pt-3 text-xs text-slate-400">
        <span>Total FFB: {fmtN(breakdown.total_ffb)} units</span>
        <span className="text-emerald-300 font-medium">
          {hasAnyActual
            ? `${totalActual.toFixed(2)} kegs actual · ${Number(breakdown.total_cpo_kegs).toFixed(1)} kegs batch total`
            : `${Number(breakdown.total_cpo_kegs).toFixed(1)} kegs CPO`}
        </span>
      </div>
    </div>
  );
}

function CategoryTag({ category }) {
  const m = CATEGORY_META[category] || { label: category, color: "text-slate-300" };
  return <span className={`text-sm font-medium ${m.color}`}>{m.label}</span>;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function DashboardScreen({ batches, totalFFB, totalKegs, actualTotalKegs, kegsPerFFB, summary, costPerKeg, auditEvents, loading, onRefresh, setScreen }) {
  const openBatches = batches.filter((b) => b.status === "OPEN").length;
  const hasActual = actualTotalKegs > 0;
  const displayKegs = hasActual ? actualTotalKegs : totalKegs;
  const actualKegsPerFFB = totalFFB > 0 && hasActual ? (actualTotalKegs / totalFFB).toFixed(3) : null;

  return (
    <>
      <header className="mb-8 flex flex-col gap-4 rounded-[32px] border border-white/10 bg-gradient-to-r from-slate-900 to-slate-800 px-6 py-6 shadow-2xl shadow-black/30 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-gradient-to-br from-emerald-400 to-green-600 text-xl font-bold text-slate-950 shadow-lg shadow-emerald-500/20">PO</div>
          <div>
            <p className="text-sm uppercase tracking-[0.25em] text-emerald-300">Production Management</p>
            <h1 className="mt-1 text-3xl font-semibold">Palm Oil Cost Accounting</h1>
            <p className="mt-2 text-sm text-slate-400">Track production costs, FFB yield, and profitability per batch.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onRefresh} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300 hover:bg-white/10">
            {loading ? "Loading…" : "Refresh"}
          </button>
          <button onClick={() => setScreen("new-batch")} className="rounded-2xl bg-gradient-to-r from-emerald-400 to-green-600 px-5 py-3 text-sm font-medium text-slate-950 shadow-lg shadow-emerald-500/25">
            New Batch
          </button>
        </div>
      </header>

      {/* Hero stats */}
      <section className="mb-8 rounded-[32px] border border-white/10 bg-gradient-to-br from-emerald-500/15 via-slate-900 to-green-600/10 p-7 shadow-2xl shadow-black/20">
        <p className="text-sm text-emerald-200">{hasActual ? "Actual CPO Produced" : "CPO Produced (Recorded)"}</p>
        <h2 className="mt-3 text-5xl font-semibold tracking-tight">
          {Number(displayKegs).toFixed(1)} kegs
        </h2>
        <div className="mt-2 flex items-center gap-4 flex-wrap">
          <p className="text-sm text-slate-300">
            from {fmtN(totalFFB)} FFB units across {batches.length} batch{batches.length !== 1 ? "es" : ""}
          </p>
          {hasActual && totalKegs !== actualTotalKegs && (
            <span className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-400">
              Batch record: {Number(totalKegs).toFixed(1)} kegs
            </span>
          )}
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="Total Batches" value={String(batches.length)} sub={`${openBatches} open`} />
          <MetricCard title="FFB Purchased" value={`${fmtN(totalFFB)} units`} sub="Fresh Fruit Bunches" />
          <MetricCard
            title={hasActual ? "Actual CPO Produced" : "CPO Produced"}
            value={`${Number(displayKegs).toFixed(1)} kegs`}
            tone="text-emerald-300"
            sub={hasActual && totalKegs !== actualTotalKegs ? `${Number(totalKegs).toFixed(1)} kegs recorded` : null}
          />
          <MetricCard
            title="Kegs per FFB"
            value={actualKegsPerFFB ?? kegsPerFFB}
            sub={hasActual ? "actual yield ratio" : "yield ratio"}
            tone="text-emerald-300"
          />
        </div>
      </section>

      <section className="mb-8 grid gap-6 xl:grid-cols-2">
        {/* Cost summary */}
        <div className="rounded-[32px] border border-white/10 bg-slate-900/80 p-6 shadow-2xl shadow-black/20">
          <h3 className="mb-5 text-xl font-semibold">Cost Summary</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <MetricCard title="Total Production Cost" value={ngn.format(summary.total_cost)} />
            <MetricCard title="Cost Per Keg" value={ngn.format(costPerKeg)} tone="text-amber-300" sub="all batches avg" />
          </div>
          <div className="mt-5 space-y-2">
            {(summary.by_category || []).map((row) => {
              const m = CATEGORY_META[row.category] || { label: row.category, color: "text-slate-300" };
              const pct = summary.total_cost > 0 ? ((row.total / summary.total_cost) * 100).toFixed(0) : 0;
              return (
                <div key={row.category} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <span className={`w-40 text-sm font-medium ${m.color}`}>{m.label}</span>
                  <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-green-500" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-28 text-right text-sm text-slate-300">{ngn.format(row.total)}</span>
                  <span className="w-8 text-right text-xs text-slate-500">{pct}%</span>
                </div>
              );
            })}
            {!(summary.by_category || []).length && <p className="text-sm text-slate-500">No cost entries yet.</p>}
          </div>
        </div>

        {/* Audit feed */}
        <div className="rounded-[32px] border border-white/10 bg-slate-900/80 p-6 shadow-2xl shadow-black/20">
          <h3 className="mb-5 text-xl font-semibold">Recent Activity</h3>
          <div className="space-y-3">
            {auditEvents.slice(0, 8).map((ev) => (
              <div key={ev.id} className="flex items-start justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{ev.batch_id}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{CATEGORY_META[ev.category]?.label || ev.category || "—"}</p>
                  {ev.description ? <p className="mt-0.5 text-xs text-slate-500 truncate max-w-[200px]">{ev.description}</p> : null}
                </div>
                <div className="text-right flex-shrink-0">
                  {ev.amount ? <p className="text-sm font-medium text-slate-200">{ngn.format(ev.amount)}</p> : null}
                  <p className="mt-0.5 text-xs text-slate-500">{formatDate(ev.created_at)}</p>
                </div>
              </div>
            ))}
            {!auditEvents.length && <p className="text-sm text-slate-500">No events yet.</p>}
          </div>
        </div>
      </section>
    </>
  );
}

// ─── Batch list ───────────────────────────────────────────────────────────────

function BatchListScreen({ batches, selectedBatchId, farmBreakdowns, onLoadFarmBreakdown, onSelect, onNew }) {
  const [expandedId, setExpandedId] = useState(null);

  return (
    <Shell badge="Production Batches" title="All Batches" subtitle="Select a batch to log costs, or expand to see per-farm output breakdown."
      aside={
        <div className="flex h-full flex-col gap-5">
          <div className="rounded-[30px] border border-white/10 bg-white/5 p-6">
            <p className="text-sm text-emerald-300">Summary</p>
            <h3 className="mt-3 text-2xl font-semibold">{batches.length} Batches</h3>
            <p className="mt-2 text-sm text-slate-300">
              {batches.filter((b) => b.status === "OPEN").length} open · {batches.filter((b) => b.status === "CLOSED").length} closed
            </p>
            <div className="mt-4 space-y-2">
              {batches.slice(0, 3).map((b) => (
                <div key={b.id} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-400">
                  {b.id} — {fmtN(b.ffb_count)} FFB → {Number(b.cpo_kegs).toFixed(1)} kegs
                </div>
              ))}
            </div>
          </div>
          <button onClick={onNew} className="rounded-2xl bg-gradient-to-r from-emerald-400 to-green-600 px-5 py-4 font-medium text-slate-950 shadow-lg shadow-emerald-500/25">
            + Create New Batch
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {batches.length === 0 && <p className="text-sm text-slate-500">No batches yet. Create your first batch.</p>}
        {batches.map((batch) => {
          const isExpanded = expandedId === batch.id;
          const breakdown = farmBreakdowns[batch.id];
          return (
            <div key={batch.id} className={`rounded-2xl border ${batch.id === selectedBatchId ? "border-emerald-400/40" : "border-white/10"} bg-white/5`}>
              <div className="flex items-start justify-between gap-4 px-5 py-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <p className="font-semibold text-white">{batch.id}</p>
                    <span className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-0.5 text-sm font-medium text-emerald-300">
                      {fmtDate(batch.batch_date)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-400">{batch.mill_name} · {batch.operator}</p>
                  {batch.notes ? <p className="mt-1 text-xs text-slate-500 italic">{batch.notes}</p> : null}
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => onSelect(batch.id)}
                      className="rounded-xl bg-gradient-to-r from-emerald-400 to-green-600 px-3 py-1.5 text-xs font-medium text-slate-950">
                      Log Costs
                    </button>
                    {breakdown?.farms?.length > 0 && (
                      <button type="button" onClick={() => setExpandedId(isExpanded ? null : batch.id)}
                        className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/20">
                        {isExpanded ? "Hide" : `Farm breakdown (${breakdown.farms.length})`}
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm text-slate-200">{fmtN(batch.ffb_count)} FFB units</p>
                  <p className="text-lg font-semibold text-emerald-300">{Number(batch.cpo_kegs).toFixed(1)} kegs CPO</p>
                  {Number(batch.pko_kegs) > 0 && <p className="text-xs text-slate-400">{Number(batch.pko_kegs).toFixed(1)} kegs PKO</p>}
                  <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${batch.status === "OPEN" ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-500/20 text-slate-400"}`}>
                    {batch.status}
                  </span>
                </div>
              </div>
              {isExpanded && breakdown && (
                <div className="border-t border-white/10 px-5 pb-4">
                  <FarmBreakdownTable
                    breakdown={breakdown}
                    batchId={batch.id}
                    onRefresh={() => onLoadFarmBreakdown(batch.id)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Shell>
  );
}

// ─── New batch ────────────────────────────────────────────────────────────────

function NewBatchScreen({ batchForm, setBatchForm, onSubmit, onBack }) {
  const f = (key) => ({ value: batchForm[key], onChange: (v) => setBatchForm((p) => ({ ...p, [key]: v })) });
  const kegsNum = Number(batchForm.cpo_kegs) || 0;
  const ffbNum  = Number(batchForm.ffb_count) || 0;
  const ratio   = ffbNum > 0 && kegsNum > 0 ? (kegsNum / ffbNum).toFixed(3) : "—";

  return (
    <Shell badge="Production" title="New Batch" subtitle="Record a palm oil production run — FFB input in individual units, CPO output in kegs."
      aside={
        <div className="flex h-full flex-col gap-4">
          <div className="rounded-[30px] border border-white/10 bg-white/5 p-6">
            <p className="text-sm text-emerald-300">Preview</p>
            <h3 className="mt-3 text-2xl font-semibold">{batchForm.id || "Batch ID"}</h3>
            <p className="mt-1 text-sm text-slate-300">{batchForm.mill_name || "Mill name"} · {batchForm.operator || "Operator"}</p>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between text-slate-300"><span>FFB units</span><span>{fmtN(batchForm.ffb_count) || "—"}</span></div>
              <div className="flex justify-between text-slate-300"><span>CPO output</span><span>{batchForm.cpo_kegs || "—"} kegs</span></div>
              <div className="flex justify-between text-slate-300"><span>PKO output</span><span>{batchForm.pko_kegs || "—"} kegs</span></div>
              <div className="flex justify-between border-t border-white/10 pt-2 font-medium">
                <span className="text-slate-400">Kegs / FFB</span>
                <span className="text-emerald-300">{ratio}</span>
              </div>
            </div>
          </div>
          {["FFB = individual Fresh Fruit Bunches (1 bunch = 1 unit)", "CPO output recorded in kegs", "Notes field: record day-by-day keg breakdown (e.g. 2 day1 + 5 day2)"].map((tip) => (
            <div key={tip} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-slate-400">{tip}</div>
          ))}
        </div>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5">
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Batch ID" placeholder="BATCH-2026-001" required {...f("id")} />
          <Field label="Date" type="date" required {...f("batch_date")} />
          <Field label="Mill / Location" placeholder="e.g. Ikot Ekpene Mill" required {...f("mill_name")} />
          <Field label="Operator / Manager" placeholder="Name" required {...f("operator")} />
          <Field label="FFB Count (units)" type="number" placeholder="e.g. 75" {...f("ffb_count")} />
          <Field label="CPO Output (kegs)" type="number" placeholder="e.g. 7" {...f("cpo_kegs")} />
          <Field label="PKO Output (kegs)" type="number" placeholder="e.g. 0" {...f("pko_kegs")} />
        </div>
        <Field label="Notes" placeholder="e.g. 2 kegs day 1 + 5 kegs day 2" {...f("notes")}>
          <textarea value={batchForm.notes} onChange={(e) => setBatchForm((p) => ({ ...p, notes: e.target.value }))}
            className="h-20 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-slate-500"
            placeholder="e.g. 2 kegs day 1 + 5 kegs day 2. Any additional notes."
          />
        </Field>
        <div className="flex gap-3">
          <button type="button" onClick={onBack} className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-slate-300 hover:bg-white/10">Cancel</button>
          <button className="flex-1 rounded-2xl bg-gradient-to-r from-emerald-400 to-green-600 px-5 py-4 font-medium text-slate-950 shadow-lg shadow-emerald-500/25">Create Batch</button>
        </div>
      </form>
    </Shell>
  );
}

// ─── Cost entry ───────────────────────────────────────────────────────────────

function CostScreen({ batches, selectedBatchId, setSelectedBatchId, selectedBatch, batchCosts, batchTotal, batchCostPerKeg, costForm, setCostForm, farmBreakdowns, onSubmit }) {
  const isFfb   = costForm.category === "FFB_PROCUREMENT";
  const isMaint = costForm.category === "MAINTENANCE";
  const batchFarms = farmBreakdowns?.[selectedBatchId]?.farms ?? [];

  return (
    <Shell badge="Cost Entry" title="Log Production Costs" subtitle="Record expenses against a batch by category. FFB procurement auto-calculates from units × price."
      aside={
        <div className="space-y-4">
          <div className="rounded-[28px] border border-white/10 bg-white/5 p-5">
            <p className="text-sm text-slate-400">Selected Batch</p>
            <h3 className="mt-1 text-xl font-semibold">{selectedBatch?.id || "None"}</h3>
            {selectedBatch && (
              <div className="mt-3 space-y-1 text-sm text-slate-300">
                <p>{selectedBatch.mill_name} · {selectedBatch.operator}</p>
                <p>{selectedBatch.batch_date}</p>
                <p>{fmtN(selectedBatch.ffb_count)} FFB units → {Number(selectedBatch.cpo_kegs).toFixed(1)} kegs CPO</p>
                {selectedBatch.notes && <p className="text-xs text-slate-500 italic">{selectedBatch.notes}</p>}
              </div>
            )}
          </div>

          <div className="rounded-[28px] border border-emerald-400/20 bg-emerald-500/10 p-5">
            <p className="text-sm text-emerald-300">Batch Total</p>
            <h4 className="mt-2 text-2xl font-semibold">{ngn.format(batchTotal)}</h4>
            <div className="mt-3 space-y-2 text-sm text-slate-300">
              <div className="flex justify-between"><span>Entries logged</span><span>{batchCosts.length}</span></div>
              <div className="flex justify-between border-t border-white/10 pt-2 font-medium">
                <span>Cost / keg</span>
                <span className="text-amber-300">{ngn.format(batchCostPerKeg)}</span>
              </div>
            </div>
          </div>

          {/* Recent entries for this batch */}
          <div className="space-y-2">
            {batchCosts.slice(0, 6).map((e) => (
              <div key={e.id} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="flex items-center justify-between">
                  <CategoryTag category={e.category} />
                  <span className="text-sm font-medium text-slate-200">{ngn.format(e.amount)}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  {e.farmName && <span className="text-xs text-emerald-400">{e.farmName}</span>}
                  {e.costDate && <span className="text-xs text-slate-500">{fmtDate(e.costDate)}</span>}
                </div>
                {e.description && <p className="mt-1 text-xs text-slate-500 truncate">{e.description}</p>}
              </div>
            ))}
          </div>
        </div>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5">
        {/* Batch selector */}
        <Field label="Batch *">
          <select value={costForm.batch_id || selectedBatchId}
            onChange={(e) => { setSelectedBatchId(e.target.value); setCostForm((p) => ({ ...p, batch_id: e.target.value })); }}
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-white outline-none"
          >
            <option value="">Select a batch</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>{b.id} — {b.mill_name} ({b.batch_date})</option>
            ))}
          </select>
        </Field>

        {/* Category picker */}
        <div>
          <label className="mb-2 block text-sm text-slate-300">Category *</label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {CATEGORIES.map((cat) => {
              const m = CATEGORY_META[cat];
              return (
                <button key={cat} type="button"
                  onClick={() => setCostForm((p) => ({ ...p, category: cat, amount: "", farm_name: "", ffb_units: "", price_per_unit: "", purchase_date: new Date().toISOString().slice(0, 10), cost_date: new Date().toISOString().slice(0, 10), total_cost: "", allocated: "" }))}
                  className={`rounded-2xl border px-3 py-3 text-left text-xs font-medium transition ${costForm.category === cat ? m.bg + " " + m.color : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"}`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* FFB Procurement sub-form */}
        {isFfb && (
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/5 p-4 space-y-4">
            <p className="text-xs text-emerald-300 font-medium uppercase tracking-wider">FFB Purchase Details</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Purchase Date">
                <input type="date" value={costForm.purchase_date} onChange={(e) => setCostForm((p) => ({ ...p, purchase_date: e.target.value }))}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none"
                />
              </Field>
              <Field label="Farm / Source" placeholder="farm1">
                <input value={costForm.farm_name} onChange={(e) => setCostForm((p) => ({ ...p, farm_name: e.target.value }))}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-slate-500"
                  placeholder="farm1"
                />
              </Field>
              <Field label="Number of FFB units" placeholder="54">
                <input type="number" value={costForm.ffb_units} onChange={(e) => setCostForm((p) => ({ ...p, ffb_units: e.target.value }))}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-slate-500"
                  placeholder="54"
                />
              </Field>
              <Field label="Price per unit (₦)" placeholder="250">
                <input type="number" value={costForm.price_per_unit} onChange={(e) => setCostForm((p) => ({ ...p, price_per_unit: e.target.value }))}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-slate-500"
                  placeholder="250"
                />
              </Field>
            </div>
            {costForm.amount ? (
              <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200">
                Amount: <strong>{ngn.format(Number(costForm.amount))}</strong>
                {costForm.ffb_units && costForm.price_per_unit && ` (${costForm.ffb_units} × ${ngn.format(Number(costForm.price_per_unit))})`}
              </div>
            ) : null}
          </div>
        )}

        {/* Maintenance sub-form */}
        {isMaint && (
          <div className="rounded-2xl border border-rose-400/20 bg-rose-500/5 p-4 space-y-4">
            <p className="text-xs text-rose-300 font-medium uppercase tracking-wider">Maintenance Allocation</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Total maintenance cost (₦)" placeholder="12000">
                <input type="number" value={costForm.total_cost} onChange={(e) => setCostForm((p) => ({ ...p, total_cost: e.target.value }))}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-slate-500"
                  placeholder="12000"
                />
              </Field>
              <Field label="Allocated to this batch (₦)" placeholder="6000">
                <input type="number" value={costForm.allocated} onChange={(e) => setCostForm((p) => ({ ...p, allocated: e.target.value }))}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-slate-500"
                  placeholder="6000"
                />
              </Field>
            </div>
          </div>
        )}

        {/* Date + Farm — shown for all non-FFB categories (FFB has its own sub-form fields) */}
        {!isFfb && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cost Date *">
              <input type="date" value={costForm.cost_date}
                onChange={(e) => setCostForm((p) => ({ ...p, cost_date: e.target.value }))}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none"
              />
            </Field>
            <Field label="Farm / Source">
              {batchFarms.length > 0 ? (
                <select value={costForm.farm_name}
                  onChange={(e) => setCostForm((p) => ({ ...p, farm_name: e.target.value }))}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-white outline-none"
                >
                  <option value="">All farms / unspecified</option>
                  {batchFarms.map((f) => (
                    <option key={f.farm_name} value={f.farm_name}>{f.farm_name}</option>
                  ))}
                </select>
              ) : (
                <input value={costForm.farm_name}
                  onChange={(e) => setCostForm((p) => ({ ...p, farm_name: e.target.value }))}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-slate-500"
                  placeholder="e.g. farm1 (optional)"
                />
              )}
            </Field>
          </div>
        )}

        {/* Manual amount (for non-auto categories) */}
        {!isFfb && (
          <Field label={isMaint ? "Allocated amount (₦)" : "Amount (₦) *"} type="number" placeholder="0"
            value={costForm.amount} onChange={(v) => setCostForm((p) => ({ ...p, amount: v }))}
          />
        )}

        <Field label="Description / Notes">
          <textarea value={costForm.description} onChange={(e) => setCostForm((p) => ({ ...p, description: e.target.value }))}
            className="h-20 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-slate-500"
            placeholder={
              isFfb   ? "e.g. harvested on 05/06/2026" :
              isMaint ? "e.g. bike maintenance — 2 bikes" :
              costForm.category === "HARVESTING_LABOR" ? "e.g. 7 workers, 1 day lifting/picking" :
              costForm.category === "PROCESSING_LABOR" ? "e.g. 7 workers, 1 day processing" :
              costForm.category === "LOGISTICS" ? "e.g. transport + miscellaneous" :
              "Details…"
            }
          />
        </Field>

        <button className="w-full rounded-2xl bg-gradient-to-r from-emerald-400 to-green-600 px-5 py-4 font-medium text-slate-950 shadow-lg shadow-emerald-500/25">
          Log Cost Entry
        </button>
      </form>
    </Shell>
  );
}

// ─── Report ───────────────────────────────────────────────────────────────────

function ReportScreen({ summary, batches, totalFFB, totalKegs, kegsPerFFB, costPerKeg, auditEvents, farmBreakdowns }) {
  return (
    <Shell badge="Analytics" title="Cost Report" subtitle="Production cost breakdown by category, yield efficiency, and per-keg profitability."
      aside={
        <div className="space-y-4">
          <div className="rounded-[28px] border border-white/10 bg-white/5 p-6">
            <p className="text-sm text-slate-400">Report scope</p>
            <h3 className="mt-2 text-2xl font-semibold">All Batches</h3>
            <p className="mt-2 text-sm text-slate-300">{batches.length} production runs</p>
          </div>
          <MetricCard title="Total Production Cost" value={ngn.format(summary.total_cost)} />
          <MetricCard title="Cost Per Keg CPO" value={ngn.format(costPerKeg)} tone="text-amber-300" sub="break-even price guide" />
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <MetricCard title="FFB Units Processed" value={fmtN(totalFFB)} />
        <MetricCard title="CPO Produced" value={`${Number(totalKegs).toFixed(1)} kegs`} tone="text-emerald-300" />
        <MetricCard title="Yield Ratio" value={`${kegsPerFFB} kegs/FFB`} tone="text-emerald-300" />
        <MetricCard title="Open Batches" value={String(batches.filter((b) => b.status === "OPEN").length)} />
      </div>

      {/* Category breakdown */}
      <div className="mt-5 space-y-3">
        <h3 className="text-lg font-semibold">Cost Breakdown</h3>
        {(summary.by_category || []).map((row) => {
          const m = CATEGORY_META[row.category] || { label: row.category, color: "text-slate-300" };
          const pct = summary.total_cost > 0 ? ((row.total / summary.total_cost) * 100).toFixed(1) : 0;
          return (
            <div key={row.category} className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4">
              <div className="flex items-center justify-between">
                <span className={`text-sm font-semibold ${m.color}`}>{m.label}</span>
                <div className="text-right">
                  <p className="text-sm font-medium text-white">{ngn.format(row.total)}</p>
                  <p className="text-xs text-slate-500">{pct}% of total</p>
                </div>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-green-500" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
        {!(summary.by_category || []).length && <p className="text-sm text-slate-500">No cost data yet.</p>}
      </div>

      {/* Batch-level table with farm breakdown */}
      {batches.length > 0 && (
        <div className="mt-5 space-y-4">
          <h3 className="text-lg font-semibold">Batch &amp; Farm Output Summary</h3>
          {batches.map((b) => (
            <div key={b.id} className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-white">{b.id}</p>
                  <p className="text-xs text-slate-400">{fmtDate(b.batch_date)} · {b.mill_name}</p>
                  {b.notes && <p className="text-xs text-slate-500 italic">{b.notes}</p>}
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold text-emerald-300">{Number(b.cpo_kegs).toFixed(1)} kegs CPO</p>
                  <p className="text-xs text-slate-400">{fmtN(b.ffb_count)} FFB units</p>
                </div>
              </div>
              <FarmBreakdownTable breakdown={farmBreakdowns[b.id]} batchId={b.id} />
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <button className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-left font-medium text-white hover:bg-white/10">Export CSV Report</button>
        <button className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-left font-medium text-white hover:bg-white/10">Download PDF Statement</button>
      </div>
    </Shell>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-NG", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Formats YYYY-MM-DD → DD/MM/YYYY (matches user's preferred format)
function fmtDate(value) {
  if (!value) return "—";
  const s = String(value).slice(0, 10);
  const [y, m, d] = s.split("-");
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}
