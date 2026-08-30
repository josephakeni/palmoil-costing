import json
import os
import threading
import time

from confluent_kafka import Consumer
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv("DATABASE_URL")
KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:29092")
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
ALLOWED_ORIGINS = [o.strip() for o in FRONTEND_ORIGIN.split(",")] + ["http://127.0.0.1:3000"]

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is required")

engine = create_engine(f"postgresql+psycopg2://{DATABASE_URL.split('://', 1)[1]}")

app = FastAPI(title="Palm Oil Costing - Audit Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def kafka_consumer_loop():
    consumer = None
    while consumer is None:
        try:
            consumer = Consumer({
                "bootstrap.servers": KAFKA_BOOTSTRAP_SERVERS,
                "group.id": "audit-service-group",
                "auto.offset.reset": "earliest",
            })
            consumer.subscribe(["palmoil-cost-events"])
        except Exception:
            time.sleep(3)

    while True:
        try:
            msg = consumer.poll(1.0)
            if msg is None or msg.error():
                continue

            event = json.loads(msg.value().decode("utf-8"))
            with engine.begin() as conn:
                conn.execute(
                    text("""
                        INSERT INTO audit_events (batch_id, event_type, category, amount, description)
                        VALUES (:batch_id, :event_type, :category, :amount, :description)
                    """),
                    {
                        "batch_id": event.get("batchId", "unknown"),
                        "event_type": event.get("eventType", "UNKNOWN"),
                        "category": event.get("category"),
                        "amount": event.get("amount"),
                        "description": event.get("description"),
                    },
                )
        except Exception:
            time.sleep(1)


@app.on_event("startup")
def startup_event():
    thread = threading.Thread(target=kafka_consumer_loop, daemon=True)
    thread.start()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/audit")
def list_audit_events(limit: int = 50):
    with engine.begin() as conn:
        rows = conn.execute(
            text("SELECT * FROM audit_events ORDER BY created_at DESC LIMIT :limit"),
            {"limit": limit},
        ).mappings().all()
        return [dict(row) for row in rows]


@app.get("/audit/{batch_id}")
def batch_audit(batch_id: str):
    with engine.begin() as conn:
        rows = conn.execute(
            text("SELECT * FROM audit_events WHERE batch_id = :batch_id ORDER BY created_at DESC"),
            {"batch_id": batch_id},
        ).mappings().all()
        return [dict(row) for row in rows]


@app.get("/report/summary")
def cost_summary():
    with engine.begin() as conn:
        by_category = conn.execute(
            text("""
                SELECT category,
                       SUM(CASE WHEN event_type = 'COST_LOGGED' THEN amount
                                WHEN event_type = 'COST_DELETED' THEN -amount
                                ELSE 0 END) AS total
                FROM audit_events
                WHERE event_type IN ('COST_LOGGED', 'COST_DELETED')
                GROUP BY category
                HAVING SUM(CASE WHEN event_type = 'COST_LOGGED' THEN amount
                                WHEN event_type = 'COST_DELETED' THEN -amount
                                ELSE 0 END) > 0
                ORDER BY total DESC
            """)
        ).mappings().all()

        totals = conn.execute(
            text("""
                SELECT COUNT(DISTINCT batch_id) AS batch_count,
                       SUM(CASE WHEN event_type = 'COST_LOGGED' THEN amount
                                WHEN event_type = 'COST_DELETED' THEN -amount
                                ELSE 0 END) AS total_cost
                FROM audit_events
                WHERE event_type IN ('COST_LOGGED', 'COST_DELETED')
            """)
        ).mappings().fetchone()

        return {
            "batch_count": int(totals["batch_count"] or 0),
            "total_cost": float(totals["total_cost"] or 0),
            "by_category": [{"category": r["category"], "total": float(r["total"])} for r in by_category],
        }
