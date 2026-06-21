# Deployment — transcriber.sangahub.com

Deploy the Transcriber app on a Linux VPS (Ubuntu 22.04/24.04 recommended).

**PostgreSQL is already running** on the server (existing Docker instance). This guide only deploys the Next.js app and connects to that database.

**Web server: Apache** (reverse proxy to the Node.js app).

## Architecture

```
Internet
   │
   ▼
Apache (443/80)  →  transcriber.sangahub.com
   │
   ▼
Next.js app (127.0.0.1:3030)  — systemd service  ← PORT from .env
   │
   ├── Existing PostgreSQL (Docker, already on server)
   ├── uploads/  (audio files on disk)
   └── ffmpeg    (audio normalization for Soniox)
```

## 1. Server prerequisites

SSH into your server, then install dependencies:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git apache2 certbot python3-certbot-apache ffmpeg

# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Enable Apache proxy modules:

```bash
sudo a2enmod proxy proxy_http headers ssl
sudo systemctl reload apache2
```

Verify:

```bash
node -v         # v20.x
ffmpeg -version
apache2 -v
```

## 2. DNS

Create an **A record** in your DNS panel:

| Type | Name        | Value              | TTL  |
|------|-------------|--------------------|------|
| A    | transcriber | `<your-server-IP>` | 300  |

Result: `transcriber.sangahub.com` → your VPS IP.

```bash
dig +short transcriber.sangahub.com
```

## 3. Prepare the database (existing PostgreSQL)

```bash
docker exec -it <your-postgres-container> psql -U postgres
```

```sql
CREATE USER transcriber WITH PASSWORD 'STRONG_DB_PASSWORD';
CREATE DATABASE transcriber OWNER transcriber;
GRANT ALL PRIVILEGES ON DATABASE transcriber TO transcriber;
\q
```

Test connectivity:

```bash
psql "postgresql://transcriber:STRONG_DB_PASSWORD@127.0.0.1:5432/transcriber" -c "SELECT 1"
```

## 4. Deploy the application

```bash
cd /var/www/transcriber
git clone <your-repo-url> .
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
PORT=3030
```

`PORT` must match the port in `deploy/apache.conf` (`ProxyPass`).

```bash
chmod 600 .env
mkdir -p uploads
```

## 6. Build and initialize database tables

```bash
npm run setup:production
```

Or manually:

```bash
npm ci --include=dev
npm run build
npm run db:sync
npm run db:seed
```

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

Confirm the app is listening on your PORT:

```bash
curl -I http://127.0.0.1:3030
```

## 8. Apache reverse proxy

Edit `deploy/apache.conf` if your `PORT` is not `3030`, then:

```bash
sudo cp deploy/apache.conf /etc/apache2/sites-available/transcriber.sangahub.com.conf
sudo a2ensite transcriber.sangahub.com.conf
sudo apache2ctl configtest
sudo systemctl reload apache2
```

Test HTTP: `http://transcriber.sangahub.com`

## 9. HTTPS (Let's Encrypt)

```bash
sudo certbot --apache -d transcriber.sangahub.com
```

Test HTTPS: `https://transcriber.sangahub.com`

## 10. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Apache Full'
sudo ufw enable
sudo ufw status
```

---

## Updating the app

```bash
cd /var/www/transcriber
git pull
npm run setup:production
sudo systemctl restart transcriber
```

---

## Useful commands

| Task               | Command                                              |
|--------------------|------------------------------------------------------|
| App status         | `sudo systemctl status transcriber`                    |
| Restart app        | `sudo systemctl restart transcriber`                 |
| App logs           | `sudo journalctl -u transcriber -f`                  |
| Apache test/reload | `sudo apache2ctl configtest && sudo systemctl reload apache2` |
| Apache error log   | `sudo tail -f /var/log/apache2/transcriber-error.log` |

---

## Production notes

### Upload size

Apache config sets **100 MB** upload limit (`LimitRequestBody 104857600`). Increase in `deploy/apache.conf` if needed.

### PORT and Apache must match

| `.env`        | `deploy/apache.conf`              |
|---------------|-----------------------------------|
| `PORT=3030`   | `ProxyPass / http://127.0.0.1:3030/` |
| `PORT=3000`   | `ProxyPass / http://127.0.0.1:3000/` |

### ffmpeg

Required for Soniox — converts MP3 uploads to 16 kHz mono before transcription.

### Security

This app has **no built-in authentication**. To restrict access with Apache basic auth:

```bash
sudo htpasswd -c /etc/apache2/.htpasswd-transcriber admin
```

Add inside the `<VirtualHost>` block:

```apache
<Location />
    AuthType Basic
    AuthName "Transcriber"
    AuthUserFile /etc/apache2/.htpasswd-transcriber
    Require valid-user
</Location>
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| 502/503 Bad Gateway | App not running — `sudo systemctl status transcriber` |
| Wrong port | Check `PORT` in `.env` matches `ProxyPass` in Apache config |
| `EADDRINUSE :3000` | Another process on that port — use `PORT=3030` in `.env` |
| Soniox fails | Check `ffmpeg -version`; verify `SONIOX_API_KEY` |
| Upload fails (413) | Increase `LimitRequestBody` in Apache config |

---

## Quick checklist

- [ ] DNS A record: `transcriber.sangahub.com` → server IP
- [ ] Node 20, ffmpeg, Apache installed
- [ ] Apache modules: `proxy`, `proxy_http`, `headers`, `ssl`
- [ ] `transcriber` database created on existing Postgres
- [ ] `.env` configured (`PORT`, `DATABASE_URL`, API keys)
- [ ] `npm run setup:production`
- [ ] systemd service running on correct PORT
- [ ] Apache vhost enabled (`ProxyPass` port matches `.env`)
- [ ] SSL via `certbot --apache`

---

## Local development only

`docker-compose.yml` is optional — local Postgres for development only.

## Nginx (alternative)

If you use Nginx instead of Apache, see `deploy/nginx.conf`.
