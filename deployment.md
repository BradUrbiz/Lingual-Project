# Deployment Guide

## Production URL

**Live App:** <https://lingual-app-6288717566.us-central1.run.app>

## Google Cloud Run Deployment

### Prerequisites

1. Google Cloud SDK installed
2. Authenticated with `gcloud auth login`
3. Project configured: `gcloud config set project <PROJECT_ID>`

### Deploy Command

```bash
gcloud run deploy lingual-app --source . --region us-central1 --allow-unauthenticated
```

### Environment Variables (Cloud Run)

Set these in Google Cloud Console > Cloud Run > lingual-app > Edit & Deploy > Variables:

| Variable | Description |
| -------- | ----------- |
| `OPENAI_API_KEY` | OpenAI API key for GPT-4o Realtime API |
| `GOOGLE_CLOUD_PROJECT` | Firebase/GCP project ID |
| `SECRET_KEY` | Flask session secret key |

**Note:** `GOOGLE_APPLICATION_CREDENTIALS` is automatically provided by Cloud Run when running in GCP.

### Service Account

The Cloud Run service uses the default compute service account. Ensure it has:

- Firestore read/write access
- Firebase Authentication admin access

## Local Development

### Backend (Flask)

```bash
# Activate virtual environment
source .venv/bin/activate  # macOS/Linux
.venv\Scripts\activate     # Windows

# Install dependencies
pip install -r requirements.txt

# Run server
python main.py  # Runs on localhost:5000
```

### Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev  # Runs on localhost:5173
```

### Required Local Files

1. **`.env`** - Environment variables

   ```env
   OPENAI_API_KEY=sk-...
   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
   GOOGLE_CLOUD_PROJECT=your-project-id
   SECRET_KEY=your-secret-key
   ```

2. **`service-account.json`** - Firebase Admin SDK credentials
   - Download from Firebase Console > Project Settings > Service Accounts
   - **Never commit this file to git**

## Docker (Alternative)

```bash
# Build
docker build -t lingual .

# Run locally
docker run -p 8080:8080 \
  -e OPENAI_API_KEY=sk-... \
  -e GOOGLE_CLOUD_PROJECT=your-project-id \
  -e SECRET_KEY=your-secret-key \
  -v /path/to/service-account.json:/app/service-account.json \
  lingual
```

## Troubleshooting

### Common Errors

| Error | Cause | Solution |
| ----- | ----- | -------- |
| `api/auth/verify 500` | Missing service-account.json | Add Firebase credentials |
| `ECONNREFUSED` | Backend not running | Start Flask server first |
| `Cross-Origin-Opener-Policy` | Firebase popup auth | Can be ignored (cosmetic) |

### Team Member Setup

1. Clone repository
2. Get `.env` and `service-account.json` from team lead
3. Run backend: `python main.py`
4. Run frontend: `cd frontend && npm run dev`
5. Open <http://localhost:5173>
