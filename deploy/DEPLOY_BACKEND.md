# Deploying the Django backend on the EC2 server

The frontend already runs on the EC2 instance (`15.252.157.44`, `tapalbaecosystem.com`).
nginx on port 80 should serve the React build in `dist/` and forward `/api`, `/auth`,
`/media`, `/admin`, `/static`, and the Firebase push helpers to Django on `127.0.0.1:8000`.
Node on port 4173 is no longer required once that nginx config is live.

```
Browser ──► nginx :80/:443 ──► dist/ (React) + gunicorn 127.0.0.1:8000
                                 (/api /auth /media /admin /static /firebase-*)
```

Until nginx is switched, the optional Node server (`node server/production.mjs` on 4173)
still serves `dist/` and proxies the same paths to Django.

Paths below assume Ubuntu, user `ubuntu`, and the repo at
`/home/ubuntu/Intelligent-Brand-Ambassador-Tapal-New`. If yours differ, change them here and in
`deploy/tapal-backend.service`.

---

## 0. Check the instance

```bash
lsb_release -d; python3 --version; free -h; df -h /
sudo ss -tlnp | grep -E ':80 |:443 |:4173 |:8000 '    # what serves the site today
```

- **Python 3.11 or newer** is needed (Ubuntu 24.04 has 3.12). On Ubuntu 22.04 install 3.12:
  `sudo add-apt-repository ppa:deadsnakes/ppa && sudo apt install python3.12 python3.12-venv python3.12-dev`
  and use `python3.12` instead of `python3` below.
- **Memory:** the BA assessment engine loads speech and language models. Use at least 4 GB RAM
  (e.g. t3.medium). On a smaller instance add swap:
  `sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab`
- **Disk:** about 6 GB free for the Python packages and models.
- **Security group:** only 80 and 443 (and 22) open. Do **not** open 8000; Django listens on 127.0.0.1 only.

## 1. System packages

```bash
sudo apt update
sudo apt install -y python3-venv python3-dev build-essential ffmpeg libsndfile1 git
```

## 2. Get the latest code

In the same checkout the frontend runs from:

```bash
cd /home/ubuntu/Intelligent-Brand-Ambassador-Tapal-New
git pull
```

## 3. Python environment

```bash
cd tapal_backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip wheel
pip install torch==2.10.0 --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements-server.txt
```

(Use `requirements-server.txt`, not `requirements.txt`: that one is a Windows freeze and fails on Linux.)

## 4. Settings

```bash
sudo mkdir -p /etc/tapal
sudo cp ../deploy/backend.env.example /etc/tapal/backend.env
python3 -c "import secrets; print(secrets.token_urlsafe(50))"   # paste as DJANGO_SECRET_KEY
sudo nano /etc/tapal/backend.env                                  # set the key and GROQ_API_KEY
sudo chmod 600 /etc/tapal/backend.env && sudo chown ubuntu:ubuntu /etc/tapal/backend.env
```

## 5. Database and uploads (outside the repo)

`tapal_backend/db.sqlite3` and `tapal_backend/media/` are in git. The live copies must live outside
the checkout, or a `git pull` would overwrite them.

```bash
sudo mkdir -p /var/lib/tapal && sudo chown ubuntu:ubuntu /var/lib/tapal
# First deployment: start from the data in the repo (stores, BAs, shifts… you already have)
cp db.sqlite3 /var/lib/tapal/db.sqlite3
cp -r media /var/lib/tapal/media
# (or start empty: skip the two cp lines; step 6 creates the tables)
```

## 6. Migrate, static files, admin user

```bash
set -a; source /etc/tapal/backend.env; set +a
python manage.py migrate
python manage.py collectstatic --noinput
python manage.py check --deploy
# Only if the copied database has no Head Office login yet:
python manage.py createsuperuser        # then set user_type = 1 (Head Office) in /admin
```

## 7. Run it as a service

```bash
sudo cp ../deploy/tapal-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tapal-backend
sudo systemctl status tapal-backend --no-pager
curl -s http://127.0.0.1:8000/api/kpi-config/          # {"basePay":1000,...}
```

Logs: `journalctl -u tapal-backend -f`

## 8. Point nginx at Django (and stop Node on port 4173)

Supervisor push and Firebase config now live in Django
(`/api/push/...`, `/firebase-config.json`, `/firebase-messaging-sw.js`).
nginx can serve the built React app from `dist/` and proxy API traffic to gunicorn.
Node on port 4173 is optional after this.

1. Put the Firebase web keys and service-account path into `/etc/tapal/backend.env`
   (see `deploy/backend.env.example`). Copy `firebase-service-account.json` onto the
   server if it is not already there.
2. Rebuild the frontend assets:

```bash
cd /home/ubuntu/Intelligent-Brand-Ambassador-Tapal-New
npm ci && npm run build
```

3. Install the updated nginx site (serves `dist/` + proxies to :8000):

```bash
sudo cp deploy/nginx-tapalbaecosystem.conf /etc/nginx/sites-available/tapalbaecosystem
sudo ln -sf /etc/nginx/sites-available/tapalbaecosystem /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

4. Stop the old Node process on 4173 (pm2, systemd, or whichever owns it):

```bash
pm2 stop all          # or: pm2 delete all
# if it was started by hand: kill the process listening on 4173
sudo ss -tlnp | grep 4173   # should print nothing
```

5. Check through the public address:

```bash
curl -s http://127.0.0.1:8000/api/kpi-config/
curl -s http://tapalbaecosystem.com/api/kpi-config/
curl -s -o /dev/null -w '%{http_code}\n' http://tapalbaecosystem.com/firebase-config.json
curl -s -o /dev/null -w '%{http_code}\n' http://tapalbaecosystem.com/admin/login/
```

Until you are ready to switch nginx, you can keep Node running: the updated
`server/production.mjs` still serves `dist/` and proxies `/api`, `/auth`, `/media`,
`/admin`, `/static`, and the Firebase routes to Django on port 8000.

Then sign in to Head Office at http://tapalbaecosystem.com.

## 9. HTTPS (needed for the camera, location and push notifications)

Browsers only allow the camera (BA check-in selfie, supervisor visit photos), GPS and push
notifications on `https://`. If the site is still plain http:

1. Point DNS `A` records for `tapalbaecosystem.com` and `www` to `15.252.157.44`.
2. Confirm nginx is using `deploy/nginx-tapalbaecosystem.conf` (Django + `dist/`), then
   `sudo apt install -y certbot python3-certbot-nginx` if needed.
3. `sudo certbot --nginx -d tapalbaecosystem.com -d www.tapalbaecosystem.com`
4. In `/etc/tapal/backend.env` set `DJANGO_HTTPS=1`, then `sudo systemctl restart tapal-backend`.

## 10. After HTTPS: regenerate store QR codes

QR images made on a development machine point at `localhost`. With `SHOPPER_QR_BASE_URL` set, regenerate:

```bash
cd tapal_backend && source .venv/bin/activate && set -a && source /etc/tapal/backend.env && set +a
python manage.py shell -c "from api.models import Store; [s.generate_qr_image(force=True) or s.save() for s in Store.objects.all()]"
```

## Updating later

```bash
cd /home/ubuntu/Intelligent-Brand-Ambassador-Tapal-New && git pull
cd tapal_backend && source .venv/bin/activate && pip install -r requirements-server.txt
set -a; source /etc/tapal/backend.env; set +a
python manage.py migrate && python manage.py collectstatic --noinput
sudo systemctl restart tapal-backend
cd .. && npm ci && npm run build
sudo systemctl reload nginx
```

## Backups

Everything that matters is in `/var/lib/tapal` (database + uploaded photos/videos):

```bash
sqlite3 /var/lib/tapal/db.sqlite3 ".backup '/var/lib/tapal/backup-$(date +%F).sqlite3'"
```

Copy those backups (and `media/`) off the instance, e.g. to S3, on a schedule.
