# Dockerfile for Idlang Translator Service
FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHOME=/usr/local
ENV PATH=$PYTHOME/bin:$PATH

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    git \
    ffmpeg \
    libsndfile1 \
    libportaudio2 \
    libportaudiocpp0 \
    portaudio18-dev \
    libportaudio-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create model cache directory
RUN mkdir -p /app/model_cache

# Copy application code
COPY . /app/

# Expose port 5005
EXPOSE 5005

# Default to running the service
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5005", "--workers", "1"]