# translator_service/Dockerfile
FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app
COPY requirements.txt .
RUN apt-get update && apt-get install -y build-essential git ffmpeg && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir -r requirements.txt

# Copy your translator source here (idoma_translator code)
COPY . /app

# Expose port 5005
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5005", "--workers", "1"]