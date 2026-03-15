# Stage 1: Build React frontend
FROM node:20-slim AS frontend-builder

WORKDIR /app/frontend

# Copy frontend package files
COPY frontend/package*.json ./

# Install dependencies
RUN npm ci

# Copy frontend source
COPY frontend/ ./

# Copy Cubism SDK for Live2D avatar build (auto-detected by vite.config.ts)
COPY CubismSdkForWeb-5-r.4/Framework/dist /app/CubismSdkForWeb-5-r.4/Framework/dist

# Build the React app
RUN npm run build

# Stage 2: Python backend
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV FLASK_APP=main.py
ENV FLASK_ENV=production

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Install gunicorn for production server
RUN pip install --no-cache-dir gunicorn

# Copy application code
COPY main.py scoring.py ai.py database.py ./
COPY backend/ ./backend/
COPY data/ ./data/

# Copy static assets (images, etc.) - not templates
COPY static/ ./static/

# Copy built React frontend from builder stage
COPY --from=frontend-builder /app/frontend/dist ./static/react

# Expose port (Cloud Run uses 8080 by default)
EXPOSE 8080

# Run with gunicorn for production
CMD exec gunicorn --bind :${PORT:-8080} --workers 1 --threads 8 --timeout 0 main:app
