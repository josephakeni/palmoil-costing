import os
from datetime import date
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv("DATABASE_URL")
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
ALLOWED_ORIGINS = [o.strip() for o in FRONTEND_ORIGIN.split(",")] + ["http://127.0.0.1:3000"]

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is required")

engine = create_engine(f"postgresql+psycopg2://{DATABASE_URL.split('://', 1)[1]}")

app = FastAPI(title="Palm Oil Costing - Production Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class BatchCreate(BaseModel):
    id: str
    mill_name: str
    operator: str
    batch_date: date
    ffb_count: int = 0
    cpo_kegs: float = 0
    pko_kegs: float = 0
    notes: Optional[str] = None


class BatchUpdate(BaseModel):
    mill_name: Optional[str] = None
    operator: Optional[str] = None
    batch_date: Optional[date] = None
    ffb_count: Optional[int] = None
    cpo_kegs: Optional[float] = None
    pko_kegs: Optional[float] = None
    notes: Optional[str] = None
    status: Optional[str] = None


class FarmProcurementCreate(BaseModel):
    farm_name: str
    ffb_units: int
    price_per_unit: float
    purchase_date: Optional[date] = None


class DailyOutputUpsert(BaseModel):
    farm_name: str
    production_date: date
    kegs_produced: float


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/batches")
def create_batch(batch: BatchCreate):
    with engine.begin() as conn:
        existing = conn.execute(
            text("SELECT id FROM batches WHERE id = :id"),
            {"id": batch.id},
        ).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="Batch ID already exists")

        conn.execute(
            text("""
                INSERT INTO batches (id, mill_name, operator, batch_date, ffb_count, cpo_kegs, pko_kegs, notes, status)
                VALUES (:id, :mill_name, :operator, :batch_date, :ffb_count, :cpo_kegs, :pko_kegs, :notes, 'OPEN')
            """),
            batch.model_dump(),
        )
    return {"message": "Batch created", "batch_id": batch.id}


@app.get("/batches")
def list_batches():
    with engine.begin() as conn:
        rows = conn.execute(
            text("SELECT * FROM batches ORDER BY created_at DESC")
        ).mappings().all()
        return [dict(row) for row in rows]


@app.get("/batches/{batch_id}")
def get_batch(batch_id: str):
    with engine.begin() as conn:
        row = conn.execute(
            text("SELECT * FROM batches WHERE id = :id"),
            {"id": batch_id},
        ).mappings().fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Batch not found")
        return dict(row)


@app.post("/batches/{batch_id}/farms")
def add_farm_procurement(batch_id: str, farm: FarmProcurementCreate):
    amount = round(farm.ffb_units * farm.price_per_unit, 2)
    with engine.begin() as conn:
        batch = conn.execute(
            text("SELECT id FROM batches WHERE id = :id"), {"id": batch_id}
        ).fetchone()
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found")

        conn.execute(
            text("""
                INSERT INTO farm_procurement (batch_id, farm_name, ffb_units, price_per_unit, amount, purchase_date)
                VALUES (:batch_id, :farm_name, :ffb_units, :price_per_unit, :amount, :purchase_date)
            """),
            {"batch_id": batch_id, "farm_name": farm.farm_name, "ffb_units": farm.ffb_units,
             "price_per_unit": farm.price_per_unit, "amount": amount, "purchase_date": farm.purchase_date},
        )
    return {"message": "Farm procurement recorded", "amount": amount}


@app.get("/batches/{batch_id}/farms")
def get_farm_breakdown(batch_id: str):
    with engine.begin() as conn:
        batch = conn.execute(
            text("SELECT ffb_count, cpo_kegs, pko_kegs FROM batches WHERE id = :id"),
            {"id": batch_id},
        ).mappings().fetchone()
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found")

        farms = conn.execute(
            text("SELECT * FROM farm_procurement WHERE batch_id = :batch_id ORDER BY created_at ASC"),
            {"batch_id": batch_id},
        ).mappings().all()

        # All daily outputs for this batch, keyed by farm_name
        outputs = conn.execute(
            text("SELECT * FROM farm_daily_output WHERE batch_id = :batch_id ORDER BY production_date ASC"),
            {"batch_id": batch_id},
        ).mappings().all()

    total_ffb = int(batch["ffb_count"] or 0)
    total_cpo = float(batch["cpo_kegs"] or 0)
    total_pko = float(batch["pko_kegs"] or 0)

    # Group daily outputs by farm name
    daily_by_farm: dict[str, list] = {}
    for o in outputs:
        daily_by_farm.setdefault(o["farm_name"], []).append(dict(o))

    breakdown = []
    for row in farms:
        units = int(row["ffb_units"])
        share = (units / total_ffb) if total_ffb > 0 else 0
        daily = daily_by_farm.get(row["farm_name"], [])
        actual_kegs = round(sum(float(d["kegs_produced"]) for d in daily), 2) if daily else None
        breakdown.append({
            **dict(row),
            "ffb_share_pct": round(share * 100, 1),
            "cpo_kegs_proportional": round(share * total_cpo, 2),
            "cpo_kegs_actual": actual_kegs,
            "daily_outputs": daily,
        })

    return {
        "batch_id": batch_id,
        "total_ffb": total_ffb,
        "total_cpo_kegs": total_cpo,
        "farms": breakdown,
    }


@app.post("/batches/{batch_id}/output")
def upsert_daily_output(batch_id: str, payload: DailyOutputUpsert):
    """Insert or update kegs for a farm on a given date (upsert on batch+farm+date)."""
    with engine.begin() as conn:
        batch = conn.execute(
            text("SELECT id FROM batches WHERE id = :id"), {"id": batch_id}
        ).fetchone()
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found")

        conn.execute(
            text("""
                INSERT INTO farm_daily_output (batch_id, farm_name, production_date, kegs_produced)
                VALUES (:batch_id, :farm_name, :production_date, :kegs_produced)
                ON CONFLICT (batch_id, farm_name, production_date)
                DO UPDATE SET kegs_produced = EXCLUDED.kegs_produced
            """),
            {
                "batch_id": batch_id,
                "farm_name": payload.farm_name,
                "production_date": payload.production_date,
                "kegs_produced": payload.kegs_produced,
            },
        )
    return {"message": "Daily output recorded", "batch_id": batch_id,
            "farm_name": payload.farm_name, "production_date": str(payload.production_date),
            "kegs_produced": payload.kegs_produced}


@app.delete("/batches/{batch_id}/output/{output_id}")
def delete_daily_output(batch_id: str, output_id: int):
    with engine.begin() as conn:
        result = conn.execute(
            text("DELETE FROM farm_daily_output WHERE id = :id AND batch_id = :batch_id"),
            {"id": output_id, "batch_id": batch_id},
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Output record not found")
    return {"message": "Deleted"}


@app.patch("/batches/{batch_id}")
def update_batch(batch_id: str, update: BatchUpdate):
    fields = {k: v for k, v in update.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    fields["batch_id"] = batch_id

    with engine.begin() as conn:
        result = conn.execute(
            text(f"UPDATE batches SET {set_clause} WHERE id = :batch_id"),
            fields,
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Batch not found")

    return {"message": "Batch updated", "batch_id": batch_id}
