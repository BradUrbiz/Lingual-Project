# Use Python 3.11 slim image for smaller size
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV FLASK_APP=main.py
ENV FLASK_ENV=production

# Install system dependencies (if needed for any Python packages)
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
COPY templates/ ./templates/
COPY data/ ./data/
COPY static/ ./static/

# Expose port (Cloud Run uses 8080 by default)
EXPOSE 8080

# Run with gunicorn for production
# Cloud Run sets PORT env variable, default to 8080
CMD exec gunicorn --bind :${PORT:-8080} --workers 1 --threads 8 --timeout 0 main:app
