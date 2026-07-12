CREATE TABLE IF NOT EXISTS batches (
    id          VARCHAR(50)    PRIMARY KEY,
    mill_name   VARCHAR(100)   NOT NULL,
    operator    VARCHAR(100)   NOT NULL,
    batch_date  DATE           NOT NULL,
    ffb_count   INTEGER        NOT NULL DEFAULT 0,
    cpo_kegs    NUMERIC(10,2)  NOT NULL DEFAULT 0,
    pko_kegs    NUMERIC(10,2)  NOT NULL DEFAULT 0,
    notes       TEXT,
    status      VARCHAR(20)    NOT NULL DEFAULT 'OPEN',
    created_at  TIMESTAMP      DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cost_entries (
    id          SERIAL         PRIMARY KEY,
    batch_id    VARCHAR(50)    NOT NULL,
    category    VARCHAR(40)    NOT NULL,
    amount      NUMERIC(14,2)  NOT NULL,
    description TEXT,
    farm_name   VARCHAR(100),
    cost_date   DATE,
    created_at  TIMESTAMP      DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS farm_procurement (
    id             SERIAL         PRIMARY KEY,
    batch_id       VARCHAR(50)    NOT NULL,
    farm_name      VARCHAR(100)   NOT NULL,
    ffb_units      INTEGER        NOT NULL,
    price_per_unit NUMERIC(10,2)  NOT NULL,
    amount         NUMERIC(14,2)  NOT NULL,
    purchase_date  DATE,
    created_at     TIMESTAMP      DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS farm_daily_output (
    id               SERIAL        PRIMARY KEY,
    batch_id         VARCHAR(50)   NOT NULL,
    farm_name        VARCHAR(100)  NOT NULL,
    production_date  DATE          NOT NULL,
    kegs_produced    NUMERIC(8,2)  NOT NULL,
    created_at       TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (batch_id, farm_name, production_date)
);

CREATE TABLE IF NOT EXISTS audit_events (
    id          SERIAL         PRIMARY KEY,
    batch_id    VARCHAR(50)    NOT NULL,
    event_type  VARCHAR(50)    NOT NULL,
    category    VARCHAR(40),
    amount      NUMERIC(14,2),
    description TEXT,
    created_at  TIMESTAMP      DEFAULT CURRENT_TIMESTAMP
);
