# Deployment — transcriber.sangahub.com

Deploy the Transcriber app on a Linux VPS (Ubuntu 22.04/24.04 recommended).

**PostgreSQL is already running** on the server (existing Docker instance). This guide only deploys the Next.js app and connects to that database.

## Architecture

```
Internet
   │
   ▼
Nginx (443/80)  →  transcriber.sangahub.com
   │
   ▼
Next.js app (127.0.0.1:3000)  — systemd service
   │
   ├── Existing PostgreSQL (Docker, already on server)
   ├── uploads/  (audio files on disk)
   └── ffmpeg    (audio normalization for Soniox)
```

## 1. Server prerequisites

SSH into your server, then install dependencies:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git nginx certbot python3-certbot-nginx ffmpeg

# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Verify:

```bash
node -v         # v20.x
ffmpeg -version
```

Docker is **not** required for this app — only your existing Postgres container should already be running.

## 2. DNS

Create an **A record** in your DNS panel:

| Type | Name        | Value              | TTL  |
|------|-------------|--------------------|------|
| A    | transcriber | `<your-server-IP>` | 300  |

Result: `transcriber.sangahub.com` → your VPS IP.

Confirm before continuing:

```bash
dig +short transcriber.sangahub.com
```

## 3. Prepare the database (existing PostgreSQL)

Connect to your **existing** Postgres instance and create a dedicated database for this app (run once):

```bash
# Example — adjust container name and credentials to match your setup
docker exec -it <your-postgres-container> psql -U postgres
```

```sql
CREATE USER transcriber WITH PASSWORD 'STRONG_DB_PASSWORD';
CREATE DATABASE transcriber OWNER transcriber;
GRANT ALL PRIVILEGES ON DATABASE transcriber TO transcriber;
\q
```

Test connectivity from the server host:

```bash
psql "postgresql://transcriber:STRONG_DB_PASSWORD@127.0.0.1:5432/transcriber" -c "SELECT 1"
```

Use the host/port your Postgres Docker container exposes (usually `127.0.0.1:5432` if the port is mapped to localhost).

## 4. Deploy the application

```bash
sudo mkdir -p /var/www/transcriber
sudo chown $USER:$USER /var/www/transcriber

cd /var/www/transcriber
git clone <your-repo-url> .
```

Or copy the project with `rsync`/`scp` if not using git:

```bash
rsync -avz --exclude node_modules --exclude .next ./ user@server:/var/www/transcriber/
```

## 5. Environment variables

```bash
cd /var/www/transcriber
cp .env.example .env
nano .env
```

Production `.env` example:

```env
DATABASE_URL=postgresql://transcriber:STRONG_DB_PASSWORD@127.0.0.1:5432/transcriber
SONIOX_API_KEY=your_soniox_key
DEEPGRAM_API_KEY=your_deepgram_key
UPLOAD_DIR=uploads
NODE_ENV=production
PORT=3000
```

Point `DATABASE_URL` at your existing Postgres (host, port, user, password, database name).

```bash
chmod 600 .env
mkdir -p uploads
```

## 6. Build and initialize database tables

```bash
cd /var/www/transcriber
npm ci
npm run build
npm run db:sync
npm run db:seed
```

This creates the `transcription_jobs` and `app_settings` tables in your existing database and seeds keyterms.

## 7. Run as a systemd service

```bash
sudo chown -R www-data:www-data /var/www/transcriber

sudo cp deploy/transcriber.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable transcriber
sudo systemctl start transcriber
sudo systemctl status transcriber
```

Logs:

```bash
sudo journalctl -u transcriber -f
```

## 8. Nginx reverse proxy

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/transcriber.sangahub.com
sudo ln -sf /etc/nginx/sites-available/transcriber.sangahub.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Test HTTP: `http://transcriber.sangahub.com`

## 9. HTTPS (Let's Encrypt)

```bash
sudo certbot --nginx -d transcriber.sangahub.com
```

Test HTTPS: `https://transcriber.sangahub.com`

## 10. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

---

## Updating the app

```bash
cd /var/www/transcriber
git pull
npm ci
npm run build
sudo systemctl restart transcriber
```

If schema changes:

```bash
npm run db:sync
```

---

## Useful commands

| Task              | Command                                      |
|-------------------|----------------------------------------------|
| App status        | `sudo systemctl status transcriber`            |
| Restart app       | `sudo systemctl restart transcriber`           |
| App logs          | `sudo journalctl -u transcriber -f`            |
| Nginx test/reload | `sudo nginx -t && sudo systemctl reload nginx` |

---

## Production notes

### Upload size

Nginx is configured for **100 MB** uploads (`client_max_body_size`). Increase in `deploy/nginx.conf` if you need larger files.

### ffmpeg

Required for Soniox — converts MP3 uploads to 16 kHz mono before transcription.

### Persistence

Back up regularly:

- Your existing PostgreSQL database (`transcriber` DB)
- `/var/www/transcriber/uploads` (audio files)

### Security

This app has **no built-in authentication**. If it should not be public:

- Restrict by IP in Nginx, or
- Add HTTP basic auth in Nginx, or
- Use a VPN / internal network only

Example Nginx basic auth:

```bash
sudo apt install apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd admin
```

Add inside the `server` block in `nginx.conf`:

```nginx
auth_basic "Transcriber";
auth_basic_user_file /etc/nginx/.htpasswd;
```

### Resource usage

- Long audio files run transcription in-process (background queue inside the Node process).
- A 4–5 minute file can take 30–60 seconds per provider.
- Recommend **2 GB+ RAM** and **2 CPU cores** for light team use.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| 502 Bad Gateway | App not running — `sudo systemctl status transcriber` |
| Soniox fails | Check `ffmpeg -version`; verify `SONIOX_API_KEY` in `.env` |
| DB connection error | Verify existing Postgres is running; test `psql` with `DATABASE_URL` |
| Upload fails (413) | Increase `client_max_body_size` in Nginx |

---

## Quick checklist

- [ ] DNS A record: `transcriber.sangahub.com` → server IP
- [ ] Node 20, ffmpeg, Nginx installed
- [ ] `transcriber` database + user created on **existing** Postgres
- [ ] `.env` configured with `DATABASE_URL` + API keys
- [ ] `npm ci && npm run build && npm run db:sync && npm run db:seed`
- [ ] systemd service running
- [ ] Nginx proxy configured
- [ ] SSL via certbot
- [ ] UFW enabled (80/443 only)

---

## Local development only

`docker-compose.yml` in this repo is optional — for spinning up a **local** Postgres when developing on your machine. It is **not** used in production on the server.
