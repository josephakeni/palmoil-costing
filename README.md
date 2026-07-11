# Palm Oil Costing App

## Running on an Ubuntu Server

### 1. Clone the repo

```bash
git clone https://github.com/<you>/<repo-name>.git
cd <repo-name>
```

---

### 2. Start the backend services

```bash
cd palmoil-costing-backend
docker compose up -d --build
```

This starts PostgreSQL, Redis, Kafka, and the three backend services:
- production-service → port 8000
- cost-service → port 8080
- audit-service → port 8001

---

### 3. Build and run the frontend container

**Use the server's actual IP address — not `localhost`.**

`VITE_*` variables are baked into the JavaScript bundle at build time and are called from the user's browser, not from inside the container. Using `localhost` will cause "Failed to fetch" errors.

```bash
cd palmoil-costing-frontend

# Get your server's IP
SERVER_IP=$(hostname -I | awk '{print $1}')

docker build \
  --build-arg VITE_PRODUCTION_API=http://$SERVER_IP:8000 \
  --build-arg VITE_COST_API=http://$SERVER_IP:8080 \
  --build-arg VITE_AUDIT_API=http://$SERVER_IP:8001 \
  -t palmoil-frontend .

docker run -d -p 3000:80 --name palmoil-frontend palmoil-frontend
```

The frontend is now at `http://<server-ip>:3000`.

---

### 4. Open firewall ports

```bash
sudo ufw allow 3000
sudo ufw allow 8000
sudo ufw allow 8080
sudo ufw allow 8001
```

---

### Notes

- If the backend IP changes, you must rebuild the frontend image — you cannot update `VITE_*` values by restarting the container.
- Backend API docs (FastAPI): `http://<server-ip>:8000/docs` and `http://<server-ip>:8001/docs`
